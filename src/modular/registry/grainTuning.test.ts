import { describe, expect, it } from "vitest";
import { QUANTISE_CASES } from "./grainTuning.generated";
import { GRAIN_SCALES, type GrainScale, pitchText, quantise, scaleDegrees, scaleOf, tuningName } from "./grainTuning";

describe("The Grain Engine's tuning, as prism_grain::tuning", () => {
  it("has the crate's eighty-one scales", () => {
    expect(GRAIN_SCALES).toHaveLength(81);
    expect(GRAIN_SCALES[0].name).toBe("Ionian (Major)");
  });

  it("snaps exactly as the crate's quantise does, every scale and both grids", () => {
    const wrong = QUANTISE_CASES.filter(([shift, scale, step, want]) => quantise(shift, scale, step) !== Math.fround(want));
    expect(wrong).toEqual([]);
    expect(QUANTISE_CASES.length).toBeGreaterThan(1000);
  });

  it("reads and writes as MultiGrainLive's pitch row does", () => {
    expect(scaleOf("free")).toBeNull();
    expect(scaleOf("Dorian")).toBe("Dorian");
    expect(tuningName(null, 0)).toBe("free");
    expect(tuningName(null, 0.5)).toBe("0.5 st grid");
    expect(pitchText(3, null, 1)).toBe("+3.0 st");
    expect(pitchText(-0.255, null, 0)).toBe("-0.26 st · -25¢");
    expect(scaleDegrees(null, 0).cents).toHaveLength(12);
    expect(scaleDegrees(null, 0.5).cents).toHaveLength(24);
    expect(scaleDegrees("Major Pentatonic", 0)).toEqual({ cents: [0, 200, 400, 700, 900], span: 1200 });
  });
});

describe("The Grain Engine's tuning, for a scale with nothing in it", () => {
  /** A scale added to the table for the length of `run`, as a regenerated catalogue might. */
  const withScale = (scale: GrainScale, run: () => void) => {
    const table = GRAIN_SCALES as GrainScale[];
    table.push(scale);
    try {
      run();
    } finally {
      table.pop();
    }
  };

  it("leaves the pitch where it is when the scale has no degrees", () => {
    withScale({ cat: "test", name: "Empty", info: "", cents: [], span: 1200 }, () => {
      expect(quantise(1.37, "Empty", 0)).toBe(Math.fround(1.37));
    });
  });

  it("repeats a scale with no span of its own at the octave", () => {
    withScale({ cat: "test", name: "Spanless", info: "", cents: [0, 700], span: 0 }, () => {
      expect(scaleDegrees("Spanless", 1)).toEqual({ cents: [0, 700], span: 1200 });
    });
  });
});
