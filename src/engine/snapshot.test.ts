// Tests for Snapshots, written against chapter 18 of the M 2.7 manual. Each
// block quotes the claim it pins down, so a failure points at a sentence in the
// manual rather than at an opinion.

import { describe, it, expect } from "vitest";
import {
  type ArrowState,
  QUANTIZE_VALUES,
  SNAPSHOT_LETTERS,
  applySnapshot,
  captureSnapshot,
  quantizeDelay,
} from "./snapshot";
import { createDefaultProject } from "./project";
import { makePresetPositions, POSITION_VARS } from "./variables";

const arrows: Record<string, ArrowState> = {
  density: { on: true, dir: "right" },
  transposition: { on: false, dir: "up" },
};

const setup = () => ({
  project: createDefaultProject(),
  positions: makePresetPositions(),
});

describe("the Snapshot locations", () => {
  // "These are 26 locations for storing screen control combinations."
  it("are 26, lettered A to Z", () => {
    expect(SNAPSHOT_LETTERS).toHaveLength(26);
    expect(SNAPSHOT_LETTERS[0]).toBe("A");
    expect(SNAPSHOT_LETTERS[25]).toBe("Z");
  });
});

describe("what a Snapshot captures", () => {
  it("records every Variable's active Position", () => {
    const { project, positions } = setup();
    const snap = captureSnapshot(project, positions, arrows, 0);
    for (const id of POSITION_VARS) {
      expect(snap.actives[id]).toBe(positions[id].active);
    }
    // The shipped presets start Note Density and Note Order on e.
    expect(snap.actives.density).toBe(4);
    expect(snap.actives.noteOrderMix).toBe(4);
  });

  // "Settings of all Conducting Arrows."
  it("records the Conducting Arrows", () => {
    const { project, positions } = setup();
    const snap = captureSnapshot(project, positions, arrows, 0);
    expect(snap.arrows.density).toEqual({ on: true, dir: "right" });
    expect(snap.arrows.transposition).toEqual({ on: false, dir: "up" });
  });

  it("copies the arrows rather than aliasing them", () => {
    const { project, positions } = setup();
    const live: Record<string, ArrowState> = {
      density: { on: true, dir: "right" },
    };
    const snap = captureSnapshot(project, positions, live, 0);
    live.density.on = false;
    expect(snap.arrows.density.on).toBe(true);
  });

  // "Play-Enable ... Output Length, Time Base ... for each Voice"
  it("records Play-Enable, Time Base and Output Length per Voice", () => {
    const { project, positions } = setup();
    project.voices[1].playEnabled = false;
    project.voices[2].timeBaseNumerator = 3;
    project.voices[2].timeBaseDenominator = 16;
    project.patterns[0].outputLength = 5;
    const snap = captureSnapshot(project, positions, arrows, 0);
    expect(snap.playEnabled[1]).toBe(false);
    expect(snap.timeBase[2]).toEqual({ numerator: 3, denominator: 16 });
    expect(snap.outputLength[0]).toBe(5);
  });

  it("records the Pattern Group letter", () => {
    const { project, positions } = setup();
    expect(captureSnapshot(project, positions, arrows, 3).patternGroup).toBe(3);
  });

  // "a Snapshot only stores the Position (1-6) of the Variable, not the
  //  contents at that Position."
  it("stores no musical material — no patterns, no note contents", () => {
    const { project, positions } = setup();
    const snap = captureSnapshot(project, positions, arrows, 0);
    const json = JSON.stringify(snap);
    expect(json).not.toContain("steps");
    expect(json).not.toContain("pitches");
    expect(Object.keys(snap).sort()).toEqual([
      "actives", "arrows", "outputLength", "patternGroup", "playEnabled", "timeBase",
    ]);
  });

  it("stores Cyclic Variable Positions by index, not their contents", () => {
    const { project, positions } = setup();
    const cyclicActives = { accent: 2, legato: 4, rhythm: 5 } as const;
    const snap = captureSnapshot(
      project, positions, arrows, 0, undefined, cyclicActives,
    );
    expect(snap.cyclicActives).toEqual(cyclicActives);
    expect(snap).not.toHaveProperty("cyclic");
    expect(snap).not.toHaveProperty("cyclicLengths");
  });
});

describe("executing a Snapshot", () => {
  it("applies only controls included by Hold/Do", () => {
    const { project, positions } = setup();
    const snap = captureSnapshot(project, positions, arrows, 3, {
      actives: ["transposition"], patternGroup: false,
    });
    snap.actives.transposition = 2;
    const changed = { ...project, voices: project.voices.map((voice) => ({ ...voice })) };
    changed.voices[0].playEnabled = !project.voices[0].playEnabled;
    const restored = applySnapshot(changed, snap);
    expect(restored.voices[0].playEnabled).toBe(changed.voices[0].playEnabled);
  });
  it("accepts a sparse inclusion mask", () => {
    const { project, positions } = setup();
    const snap = captureSnapshot(project, positions, arrows, 0, { patternGroup: true });
    expect(snap.included).toEqual({ patternGroup: true });
  });
  it("puts Play-Enable and Time Base back", () => {
    const { project, positions } = setup();
    const snap = captureSnapshot(project, positions, arrows, 0);
    const changed: typeof project = {
      ...project,
      voices: project.voices.map((v) => ({
        ...v, playEnabled: !v.playEnabled, timeBaseDenominator: 32,
      })),
    };
    const restored = applySnapshot(changed, snap);
    expect(restored.voices.map((v) => v.playEnabled))
      .toEqual(project.voices.map((v) => v.playEnabled));
    expect(restored.voices[0].timeBaseDenominator)
      .toBe(project.voices[0].timeBaseDenominator);
  });

  it("puts Output Length back without exceeding the pattern", () => {
    const { project, positions } = setup();
    project.patterns[0].outputLength = 4;
    const snap = captureSnapshot(project, positions, arrows, 0);
    snap.outputLength[0] = 9999; // a stale snapshot from a longer pattern
    const restored = applySnapshot(project, snap);
    expect(restored.patterns[0].outputLength)
      .toBeLessThanOrEqual(project.patterns[0].steps.length);
  });

  it("leaves musical material untouched", () => {
    const { project, positions } = setup();
    const snap = captureSnapshot(project, positions, arrows, 0);
    const restored = applySnapshot(project, snap);
    expect(restored.patterns[0].steps).toBe(project.patterns[0].steps);
  });

  it("does not mutate the project it was given", () => {
    const { project, positions } = setup();
    const snap = captureSnapshot(project, positions, arrows, 0);
    const before = project.voices[0].playEnabled;
    snap.playEnabled[0] = !before;
    applySnapshot(project, snap);
    expect(project.voices[0].playEnabled).toBe(before);
  });

  it("tolerates a snapshot taken with fewer voices or patterns", () => {
    const { project, positions } = setup();
    const snap = captureSnapshot(project, positions, arrows, 0);
    snap.playEnabled = [];
    snap.timeBase = [];
    snap.outputLength = [];
    const restored = applySnapshot(project, snap);
    expect(restored.voices[0].playEnabled).toBe(project.voices[0].playEnabled);
    expect(restored.voices[0].timeBaseNumerator)
      .toBe(project.voices[0].timeBaseNumerator);
    expect(restored.patterns[0].outputLength)
      .toBe(project.patterns[0].outputLength);
  });
});

describe("Snapshot Quantization", () => {
  it("offers the wave plus the note values", () => {
    expect(QUANTIZE_VALUES[0]).toBe(0);
    expect([...QUANTIZE_VALUES]).toEqual([0, 1, 2, 4, 8, 16]);
  });

  // "The wave value ... means that no quantization is performed."
  it("delays nothing on the wave setting", () => {
    expect(quantizeDelay(0, 120, 0.3)).toBe(0);
  });

  // "The whole note value will delay the execution of an event until the next
  //  whole note quantization point."
  it("delays to the next whole note", () => {
    // A whole note at 120bpm is 2s. A third of a second in, 1.7s remain.
    expect(quantizeDelay(1, 120, 0.3)).toBeCloseTo(1.7, 9);
  });

  it("delays to the next quarter note", () => {
    // A quarter note at 120bpm is 0.5s.
    expect(quantizeDelay(4, 120, 0.3)).toBeCloseTo(0.2, 9);
  });

  it("waits for nothing when already on a quantization point", () => {
    expect(quantizeDelay(4, 120, 0)).toBe(0);
    expect(quantizeDelay(4, 120, 1.5)).toBe(0);
  });

  it("follows the tempo", () => {
    expect(quantizeDelay(1, 60, 0)).toBe(0);
    expect(quantizeDelay(1, 60, 1)).toBeCloseTo(3, 9); // whole note = 4s
  });

  it("never returns a negative or nonsense wait", () => {
    for (const q of QUANTIZE_VALUES) {
      for (const t of [0, 0.1, 0.9, 3.7]) {
        expect(quantizeDelay(q, 120, t)).toBeGreaterThanOrEqual(0);
      }
    }
    expect(quantizeDelay(4, 0, 1)).toBe(0);
  });
});
