import { describe, expect, it } from "vitest";
import {
  applyRoutings,
  destinationRange,
  emptyMatrix,
  MOD_DESTINATIONS,
  MOD_SOURCES,
  modulate,
  readMatrix,
  setRouting,
  sourceIsContinuous,
  type ModMatrix,
  type ModSourceValues,
} from "./modMatrix";

/**
 * The modulation matrix, as a model.
 *
 * Eight sources by twelve destinations is ninety-six numbers, and the thing that
 * makes it usable rather than a wall is that every one of them means the same
 * thing: an amount in −1…+1, scaled into whatever units the destination happens
 * to speak. Getting that mapping right is the whole job, and none of it needs
 * an AudioContext to check.
 */

const noSources: ModSourceValues = {
  lfo1: 0, lfo2: 0, ampEnv: 0, filterEnv: 0,
  velocity: 0, note: 0, modWheel: 0, random: 0,
};

describe("The matrix", () => {
  it("is the eight sources and twelve destinations the plan named", () => {
    expect(MOD_SOURCES).toHaveLength(8);
    expect(MOD_DESTINATIONS).toHaveLength(12);
    expect(MOD_SOURCES).toContain("lfo1");
    expect(MOD_SOURCES).toContain("velocity");
    expect(MOD_DESTINATIONS).toContain("osc1-pitch");
    expect(MOD_DESTINATIONS).toContain("filter-cutoff");
    expect(MOD_DESTINATIONS).toContain("pan");
  });

  it("starts with nothing routed anywhere", () => {
    const matrix = emptyMatrix();
    for (const source of MOD_SOURCES) {
      for (const destination of MOD_DESTINATIONS) {
        expect(readMatrix(matrix, source, destination), `${source}→${destination}`).toBe(0);
      }
    }
  });

  it("routes one source to one destination without touching the rest", () => {
    const matrix = setRouting(emptyMatrix(), "lfo1", "filter-cutoff", 0.5);
    expect(readMatrix(matrix, "lfo1", "filter-cutoff")).toBe(0.5);
    expect(readMatrix(matrix, "lfo1", "pan")).toBe(0);
    expect(readMatrix(matrix, "lfo2", "filter-cutoff")).toBe(0);
  });

  it("does not modify the matrix it was given", () => {
    // Routings live in the document, and a document edit is a new value.
    const before = emptyMatrix();
    const after = setRouting(before, "lfo1", "pan", 1);
    expect(readMatrix(before, "lfo1", "pan")).toBe(0);
    expect(after).not.toBe(before);
  });

  it("holds an amount to the range a knob can reach", () => {
    const matrix = setRouting(setRouting(emptyMatrix(), "lfo1", "pan", 4), "lfo2", "pan", -9);
    expect(readMatrix(matrix, "lfo1", "pan")).toBe(1);
    expect(readMatrix(matrix, "lfo2", "pan")).toBe(-1);
  });

  it("ignores a routing that names something it does not have", () => {
    // A document written by a later build may name a source this one lacks.
    // Dropping the routing loses a modulation; throwing loses the patch.
    const matrix = setRouting(emptyMatrix(), "aftertouch" as never, "pan", 1);
    expect(readMatrix(matrix, "lfo1", "pan")).toBe(0);
    expect(readMatrix(matrix, "aftertouch" as never, "pan")).toBe(0);
    expect(readMatrix(emptyMatrix(), "lfo1", "osc9-pitch" as never)).toBe(0);
  });

  it("reads an amount that is not a number as no routing at all", () => {
    const matrix = setRouting(emptyMatrix(), "lfo1", "pan", Number.NaN);
    expect(readMatrix(matrix, "lfo1", "pan")).toBe(0);
  });

  it("reads a matrix with rows missing as unrouted", () => {
    // `readMatrix` is exported, so it can be handed something assembled by
    // hand rather than by `emptyMatrix`. A missing row is no routing.
    expect(readMatrix({} as ModMatrix, "lfo1", "pan")).toBe(0);
  });
});

describe("What a source is", () => {
  it("separates the ones that move continuously from the ones fixed at note time", () => {
    // This split is the whole performance story: continuous sources become
    // real nodes wired to a param, and the rest fold into the ramps a voice
    // schedules once and then forgets about.
    expect(sourceIsContinuous("lfo1")).toBe(true);
    expect(sourceIsContinuous("lfo2")).toBe(true);
    expect(sourceIsContinuous("modWheel")).toBe(true);
    expect(sourceIsContinuous("velocity")).toBe(false);
    expect(sourceIsContinuous("note")).toBe(false);
    expect(sourceIsContinuous("random")).toBe(false);
    expect(sourceIsContinuous("ampEnv")).toBe(false);
    expect(sourceIsContinuous("filterEnv")).toBe(false);
  });
});

describe("What a destination means", () => {
  it("measures pitch in cents, so a scale and an LFO speak the same units", () => {
    const range = destinationRange("osc1-pitch");
    expect(range.unit).toBe("cents");
    // Two octaves either way is the usual full-depth pitch sweep.
    expect(range.depth).toBe(2400);
  });

  it("measures cutoff in octaves, because a filter is heard logarithmically", () => {
    // A cutoff modulated in hertz sweeps inaudibly at the bottom and wildly at
    // the top. Octaves sound the same wherever the knob is set.
    const range = destinationRange("filter-cutoff");
    expect(range.unit).toBe("octaves");
    expect(range.depth).toBe(4);
  });

  it("measures pan and level as plain fractions", () => {
    expect(destinationRange("pan")).toEqual({ unit: "linear", depth: 1, min: -1, max: 1 });
    expect(destinationRange("osc1-level").unit).toBe("linear");
    expect(destinationRange("volume").min).toBe(0);
  });

  it("gives every destination a range", () => {
    for (const destination of MOD_DESTINATIONS) {
      const range = destinationRange(destination);
      expect(range.depth, destination).toBeGreaterThan(0);
      expect(range.max, destination).toBeGreaterThan(range.min);
    }
  });
});

describe("Evaluating a destination", () => {
  it("is zero when nothing is routed to it", () => {
    expect(modulate(emptyMatrix(), "filter-cutoff", noSources)).toBe(0);
  });

  it("scales a source by its amount and the destination's depth", () => {
    // LFO at full swing, routed at half depth, on a ±2400 cent destination.
    const matrix = setRouting(emptyMatrix(), "lfo1", "osc1-pitch", 0.5);
    expect(modulate(matrix, "osc1-pitch", { ...noSources, lfo1: 1 })).toBe(1200);
    expect(modulate(matrix, "osc1-pitch", { ...noSources, lfo1: -1 })).toBe(-1200);
  });

  it("sums every source that reaches the same destination", () => {
    const matrix = setRouting(
      setRouting(emptyMatrix(), "lfo1", "osc1-pitch", 0.25),
      "velocity", "osc1-pitch", 0.25,
    );
    const sources = { ...noSources, lfo1: 1, velocity: 1 };
    expect(modulate(matrix, "osc1-pitch", sources)).toBe(1200);
  });

  it("lets two sources cancel, which is what a negative amount is for", () => {
    const matrix = setRouting(
      setRouting(emptyMatrix(), "lfo1", "pan", 1),
      "lfo2", "pan", -1,
    );
    expect(modulate(matrix, "pan", { ...noSources, lfo1: 1, lfo2: 1 })).toBe(0);
  });

  it("clamps the total, so a stack of routings cannot leave the legal range", () => {
    // Four sources at full depth would otherwise pan four times hard right.
    let matrix = emptyMatrix();
    for (const source of ["lfo1", "lfo2", "velocity", "modWheel"] as const) {
      matrix = setRouting(matrix, source, "pan", 1);
    }
    const sources = { ...noSources, lfo1: 1, lfo2: 1, velocity: 1, modWheel: 1 };
    expect(modulate(matrix, "pan", sources)).toBe(1);
  });

  it("reads a source value that is not a number as silence", () => {
    const matrix = setRouting(emptyMatrix(), "lfo1", "pan", 1);
    expect(modulate(matrix, "pan", { ...noSources, lfo1: Number.NaN })).toBe(0);
  });
});

describe("Applying modulation to a value", () => {
  it("adds cents to a pitch", () => {
    expect(applyRoutings("osc1-pitch", 0, 1200)).toBe(1200);
  });

  it("multiplies a cutoff by octaves, rather than adding hertz to it", () => {
    // One octave up from 1 kHz is 2 kHz, and from 200 Hz is 400 Hz — the same
    // musical distance from either starting point.
    expect(applyRoutings("filter-cutoff", 1000, 1)).toBeCloseTo(2000, 6);
    expect(applyRoutings("filter-cutoff", 200, 1)).toBeCloseTo(400, 6);
    expect(applyRoutings("filter-cutoff", 1000, -1)).toBeCloseTo(500, 6);
  });

  it("holds a modulated value inside the destination's own range", () => {
    expect(applyRoutings("pan", 0.8, 0.8)).toBe(1);
    expect(applyRoutings("volume", 0.2, -0.9)).toBe(0);
    expect(applyRoutings("filter-cutoff", 18000, 4)).toBeLessThanOrEqual(
      destinationRange("filter-cutoff").max,
    );
  });

  it("leaves a value alone when there is no modulation", () => {
    expect(applyRoutings("osc2-level", 0.6, 0)).toBe(0.6);
  });
});

describe("A matrix read back from a document", () => {
  it("keeps the routings it recognises and drops the rest", () => {
    const stored = [
      { source: "lfo1", destination: "filter-cutoff", amount: 0.5 },
      { source: "nonsense", destination: "pan", amount: 1 },
      { source: "lfo2", destination: "nowhere", amount: 1 },
      { source: "velocity", destination: "volume", amount: 2 },
    ];
    const matrix = readMatrix.fromJson(stored);
    expect(readMatrix(matrix, "lfo1", "filter-cutoff")).toBe(0.5);
    expect(readMatrix(matrix, "velocity", "volume")).toBe(1);
  });

  it("survives storage that is not a list of routings at all", () => {
    for (const stored of [null, "nonsense", 42, [null], [{ source: "lfo1" }]]) {
      expect(() => readMatrix.fromJson(stored)).not.toThrow();
    }
    expect(readMatrix.fromJson(null)).toEqual(emptyMatrix());
  });

  it("writes back only what is routed, so a saved patch stays small", () => {
    // Ninety-six zeroes in every document would be most of the file.
    const matrix = setRouting(emptyMatrix(), "lfo1", "pan", 0.25);
    const json = readMatrix.toJson(matrix);
    expect(json).toEqual([{ source: "lfo1", destination: "pan", amount: 0.25 }]);
  });

  it("round-trips", () => {
    let matrix: ModMatrix = emptyMatrix();
    matrix = setRouting(matrix, "lfo1", "osc1-pitch", 0.5);
    matrix = setRouting(matrix, "filterEnv", "filter-cutoff", -0.75);
    matrix = setRouting(matrix, "velocity", "volume", 1);
    expect(readMatrix.fromJson(readMatrix.toJson(matrix))).toEqual(matrix);
  });
});
