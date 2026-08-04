import { describe, expect, it } from "vitest";
import {
  applyDrag,
  cellCoversLevel,
  cellSpan,
  clampLevel,
  CYCLIC_PRESET_COUNT,
  CYCLIC_STEPS,
  defaultPreset,
  fillPreset,
  isRangedCell,
  legendFor,
  makeCell,
  readPresets,
  summarisePreset,
  withCell,
  type CyclicPreset,
} from "./cyclicSequence";

const flat = (level: number): CyclicPreset =>
  Array.from({ length: CYCLIC_STEPS }, () => level);

const presets = (first: CyclicPreset): CyclicPreset[] =>
  Array.from({ length: CYCLIC_PRESET_COUNT }, (_, index) => (index === 0 ? first : flat(2)));

/** A column read top to bottom, level 4 first — what the grid shows. */
const column = (preset: CyclicPreset, step: number): string =>
  [4, 3, 2, 1, 0].map((level) => (cellCoversLevel(preset[step], level) ? "#" : ".")).join("");

describe("Cells", () => {
  it("treats a number as a fixed level spanning itself", () => {
    expect(cellSpan(3)).toEqual({ low: 3, high: 3 });
    expect(isRangedCell(3)).toBe(false);
  });

  it("treats a pair as a range, ordered low to high", () => {
    expect(cellSpan([4, 1])).toEqual({ low: 1, high: 4 });
    expect(isRangedCell([1, 4])).toBe(true);
  });

  it("does not call a collapsed pair a range", () => {
    // It would play one value every pass, so it must not be hatched as random.
    expect(isRangedCell([2, 2])).toBe(false);
    expect(cellSpan([2, 2])).toEqual({ low: 2, high: 2 });
  });

  it("collapses a single-level span back to a plain number", () => {
    expect(makeCell(2, 2)).toBe(2);
    expect(makeCell(3, 1)).toEqual([1, 3]);
  });

  it("clamps every level into 0..4", () => {
    expect(clampLevel(-3)).toBe(0);
    expect(clampLevel(9)).toBe(4);
    expect(clampLevel(2.4)).toBe(2);
    expect(makeCell(-5, 99)).toEqual([0, 4]);
  });

  it("covers exactly the levels inside its span", () => {
    expect(cellCoversLevel([1, 3], 0)).toBe(false);
    expect(cellCoversLevel([1, 3], 1)).toBe(true);
    expect(cellCoversLevel([1, 3], 3)).toBe(true);
    expect(cellCoversLevel([1, 3], 4)).toBe(false);
  });
});

describe("Reading stored presets", () => {
  it("always yields eight presets of sixteen steps", () => {
    const result = readPresets(undefined);
    expect(result).toHaveLength(CYCLIC_PRESET_COUNT);
    for (const preset of result) expect(preset).toHaveLength(CYCLIC_STEPS);
  });

  it("keeps fixed and ranged cells as stored", () => {
    const stored = [[0, [1, 3], 4]];
    const result = readPresets(stored);
    expect(result[0][0]).toBe(0);
    expect(result[0][1]).toEqual([1, 3]);
    expect(result[0][2]).toBe(4);
  });

  it("repeats a short preset rather than leaving holes", () => {
    // A document written before the length settled must still open.
    const result = readPresets([[0, 4]]);
    expect(result[0]).toHaveLength(CYCLIC_STEPS);
    expect(result[0][0]).toBe(0);
    expect(result[0][1]).toBe(4);
    expect(result[0][2]).toBe(0);
  });

  it("replaces anything unusable with a default rather than throwing", () => {
    expect(readPresets("nonsense")[0]).toEqual(defaultPreset());
    expect(readPresets([null, 5, {}])[0]).toEqual(defaultPreset());
    expect(readPresets([["x", true]])[0][0]).toBe(2);
  });
});

describe("Editing one cell", () => {
  it("changes only the step it was given", () => {
    const before = presets(flat(2));
    const after = withCell(before, 0, 3, 4);
    expect(after[0][3]).toBe(4);
    expect(after[0][2]).toBe(2);
    expect(after[0]).toHaveLength(CYCLIC_STEPS);
  });

  it("leaves every other preset untouched", () => {
    const before = presets(flat(2));
    const after = withCell(before, 0, 3, 4);
    for (let index = 1; index < CYCLIC_PRESET_COUNT; index++) {
      expect(after[index]).toEqual(before[index]);
    }
  });

  it("does not mutate the input", () => {
    const before = presets(flat(2));
    withCell(before, 0, 3, 4);
    expect(before[0][3]).toBe(2);
  });
});

describe("The drag gesture", () => {
  /**
   * The gesture that makes this M's editor rather than a step sequencer: a
   * vertical drag inside one step turns it into a range, so the step plays
   * somewhere between the two ends on every pass.
   */
  it("makes a range when dragged up or down within a step", () => {
    const after = applyDrag(presets(flat(2)), 0, { step: 4, level: 1 }, { step: 4, level: 4 });
    expect(after[0][4]).toEqual([1, 4]);
    expect(isRangedCell(after[0][4])).toBe(true);
    expect(column(after[0], 4)).toBe("####.");
  });

  it("makes the same range dragged in either direction", () => {
    const up = applyDrag(presets(flat(2)), 0, { step: 4, level: 1 }, { step: 4, level: 4 });
    const down = applyDrag(presets(flat(2)), 0, { step: 4, level: 4 }, { step: 4, level: 1 });
    expect(up[0][4]).toEqual(down[0][4]);
  });

  it("collapses back to a fixed level when released where it started", () => {
    const after = applyDrag(presets(flat(2)), 0, { step: 4, level: 3 }, { step: 4, level: 3 });
    expect(after[0][4]).toBe(3);
    expect(isRangedCell(after[0][4])).toBe(false);
  });

  it("paints the starting level across steps when dragged sideways", () => {
    const after = applyDrag(presets(flat(0)), 0, { step: 2, level: 4 }, { step: 6, level: 4 });
    for (let step = 2; step <= 6; step++) expect(after[0][step]).toBe(4);
    expect(after[0][1]).toBe(0);
    expect(after[0][7]).toBe(0);
  });

  it("paints the level it began on, not the one the pointer is over", () => {
    // Otherwise a slightly diagonal drag would write a different value into
    // every step it crossed.
    const after = applyDrag(presets(flat(0)), 0, { step: 2, level: 4 }, { step: 5, level: 1 });
    for (let step = 2; step <= 5; step++) expect(after[0][step]).toBe(4);
  });

  it("paints right to left as readily as left to right", () => {
    const after = applyDrag(presets(flat(0)), 0, { step: 6, level: 3 }, { step: 3, level: 3 });
    for (let step = 3; step <= 6; step++) expect(after[0][step]).toBe(3);
  });

  it("touches only the active preset", () => {
    const before = presets(flat(2));
    const after = applyDrag(before, 0, { step: 0, level: 4 }, { step: 15, level: 4 });
    expect(after[1]).toEqual(before[1]);
  });
});

describe("Fill actions", () => {
  it("sets every step of the active preset", () => {
    const after = fillPreset(presets(flat(2)), 0, 0);
    expect(after[0].every((cell) => cell === 0)).toBe(true);
    expect(after[1]).toEqual(flat(2));
  });

  it("clamps the level it fills with", () => {
    expect(fillPreset(presets(flat(2)), 0, 99)[0][0]).toBe(4);
  });
});

describe("Preset summaries", () => {
  it("reports a single level plainly", () => {
    expect(summarisePreset(flat(3))).toBe("all 3");
  });

  it("reports the span when levels differ", () => {
    const preset = flat(1);
    preset[0] = 4;
    expect(summarisePreset(preset)).toBe("1–4");
  });

  it("counts ranged steps, since they are what makes it move", () => {
    const preset = flat(2);
    preset[0] = [0, 4];
    preset[5] = [1, 3];
    expect(summarisePreset(preset)).toBe("0–4 · 2r");
  });
});

describe("Module legends", () => {
  it("gives each module its own meaning for the same level", () => {
    // One sequence, three destinations — the level is identical, what it turns
    // into is not.
    expect(legendFor("m.cyclic-accent").valueForLevel(4)).toBe("100%");
    expect(legendFor("m.cyclic-legato").valueForLevel(4)).toBe("200%");
    expect(legendFor("m.cyclic-rhythm").valueForLevel(4)).toBe("×1.5");
  });

  it("matches the runtime's rhythm factors exactly", () => {
    // These must agree with `rhythmFactor` in the processors, or the grid
    // would be describing something the engine does not do.
    const rhythm = legendFor("m.cyclic-rhythm");
    expect([0, 1, 2, 3, 4].map((level) => rhythm.valueForLevel(level)))
      .toEqual(["×0.5", "×0.75", "×1", "×1.25", "×1.5"]);
  });

  it("falls back for an unknown module", () => {
    expect(legendFor("m.unknown").valueForLevel(3)).toBe("3");
  });
});
