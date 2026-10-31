import { describe, expect, it } from "vitest";
import { Rng } from "../../engine/rng";
import { snapToScale } from "../../engine/music";
import { normalizeCyclicStep } from "../../engine/cyclic";
import { defaultNoteSeqPatterns, defaultCells } from "./noteSeq";
import { GENERATORS, generate, type SeqMaterial } from "./generate";
import { DEFAULT_EVOLVE, EVOLVE_TRANSFORMS, evolve } from "./evolve";

const material = (): SeqMaterial => {
  const cells = defaultCells();
  return {
    pattern: defaultNoteSeqPatterns()[0],
    cells: { accent: cells.accent[0], legato: cells.legato[0], rhythm: cells.rhythm[0] },
    root: 0,
    scale: "major",
  };
};
const sorted = (steps: number[][]) => steps.flat().sort((a, b) => a - b);

describe("Generate: M's pattern commands", () => {
  it("ReScramble deals the played steps into a new scrambled order", () => {
    const before = material();
    const after = generate("rescramble", before, new Rng(2), { preserveRests: false });
    expect(sorted(after.pattern.scrambled.slice(0, 8))).toEqual(sorted(before.pattern.steps.slice(0, 8)));
    expect(after.pattern.scrambled.slice(0, 8)).not.toEqual(before.pattern.scrambled.slice(0, 8));
    expect(after.pattern.steps).toEqual(before.pattern.steps);
  });

  it("ReScramble with Don't Scramble Rests keeps the rests where they are", () => {
    const base = material();
    base.pattern = { ...base.pattern, steps: [[60], [], [64], [], [67], [], [], []], scrambled: [[60], [], [64], [], [67], [], [], []] };
    const after = generate("rescramble", base, new Rng(5), { preserveRests: true });
    expect(after.pattern.scrambled.map((s) => s.length > 0)).toEqual(base.pattern.steps.map((s) => s.length > 0));
  });

  it("Reverse and Swap are M's commands", () => {
    const reversed = generate("reverse", material(), new Rng(1), { preserveRests: false });
    expect(reversed.pattern.steps.slice(0, 8).map((s) => s[0])).toEqual([72, 71, 69, 67, 65, 64, 62, 60]);
    const swapped = generate("swap", material(), new Rng(1), { preserveRests: false });
    expect(swapped.pattern.steps.slice(0, 8)).toEqual(material().pattern.scrambled.slice(0, 8));
  });
});

describe("Generate: Numerology's algorithms (manual p49–51)", () => {
  it("RndAll changes every played pitch to a note in the scale, and every cell", () => {
    const after = generate("rnd-all", material(), new Rng(11), { preserveRests: false });
    const notes = after.pattern.steps.slice(0, 8).flat();
    expect(notes).toHaveLength(8);
    for (const note of notes) expect(snapToScale(note, 0, "major")).toBe(note);
    expect(after.pattern.length).toBe(8);
  });

  it("RndFew changes no more than 15% of what it could", () => {
    const before = material();
    const after = generate("rnd-few", before, new Rng(3), { preserveRests: false });
    const changed = after.pattern.steps.slice(0, 8).filter((s, i) => s[0] !== before.pattern.steps[i][0]).length;
    expect(changed).toBeLessThanOrEqual(Math.ceil(8 * 0.15));
  });

  it("random cells keep away from the extremes", () => {
    const after = generate("rnd-all", material(), new Rng(9), { preserveRests: false });
    for (const cell of after.cells.accent) expect(normalizeCyclicStep(cell).min).toBeGreaterThanOrEqual(1);
  });

  it("357 copies one short cell out in strict repetition", () => {
    const after = generate("357", material(), new Rng(4), { preserveRests: false });
    const notes = after.pattern.steps.slice(0, 8).map((s) => s[0]);
    const period = [3, 5, 7].find((k) => notes.every((n, i) => i < k || n === notes[i - k]));
    expect(period).toBeDefined();
  });

  it("Minmal repeats its cell irregularly but only ever uses the cell's notes", () => {
    const after = generate("minmal", material(), new Rng(6), { preserveRests: false });
    expect(new Set(after.pattern.steps.slice(0, 8).flat()).size).toBeLessThanOrEqual(8);
    expect(after.pattern.steps.slice(0, 8).every((s) => s.length === 1)).toBe(true);
  });

  it("is repeatable for a seed and lists every algorithm once", () => {
    expect(generate("cell", material(), new Rng(8), { preserveRests: false }))
      .toEqual(generate("cell", material(), new Rng(8), { preserveRests: false }));
    expect(new Set(GENERATORS.map((g) => g.id)).size).toBe(GENERATORS.length);
  });
});

describe("Evolve: X, Y and Z (manual p51–52)", () => {
  const always = (dimension: "x" | "y" | "z", id: string) => ({ ...DEFAULT_EVOLVE, [dimension]: [{ id, probability: 100 }] });

  it("X swaps two pitch values, keeping the notes", () => {
    const before = material();
    const after = evolve("x", always("x", "swap-pitches"), before, new Rng(1));
    expect(sorted(after.pattern.steps)).toEqual(sorted(before.pattern.steps));
    expect(after.pattern.steps).not.toEqual(before.pattern.steps);
  });

  it("X moves one step a minor third", () => {
    const before = material();
    const after = evolve("x", always("x", "minor-third"), before, new Rng(2));
    const moved = after.pattern.steps.map((s, i) => (s[0] ?? 0) - (before.pattern.steps[i][0] ?? 0)).filter((d) => d !== 0);
    expect(moved).toHaveLength(1);
    expect(Math.abs(moved[0])).toBe(3);
  });

  it("Z widens an accent cell into a range — M then picks inside it", () => {
    const after = evolve("z", always("z", "widen-accent"), material(), new Rng(3));
    expect(after.cells.accent.some((cell) => typeof cell === "object" && cell.min !== cell.max)).toBe(true);
  });

  it("a transformation at 0% never runs", () => {
    const before = material();
    expect(evolve("x", { ...DEFAULT_EVOLVE, x: [{ id: "swap-pitches", probability: 0 }] }, before, new Rng(1))).toEqual(before);
  });

  it("defaults put pitch on X, timing on Y and velocity on Z", () => {
    const dims = (d: "x" | "y" | "z") => DEFAULT_EVOLVE[d].map((t) => EVOLVE_TRANSFORMS.find((e) => e.id === t.id)!.kind);
    expect(new Set(dims("x"))).toEqual(new Set(["pitch"]));
    expect(new Set(dims("y"))).toEqual(new Set(["timing"]));
    expect(new Set(dims("z"))).toEqual(new Set(["velocity"]));
  });
});

describe("Generate: a pattern of rests", () => {
  const rests = (): SeqMaterial => ({ ...material(), pattern: { steps: [[], [], [], []], scrambled: [[], [], [], []], length: 4 } });

  it("RndFew leaves rests as rests", () => {
    expect(generate("rnd-few", rests(), new Rng(3), { preserveRests: false }).pattern.steps).toEqual([[], [], [], []]);
  });

  it("RndAll fills every step with a scale note within an octave of middle C", () => {
    const notes = generate("rnd-all", rests(), new Rng(3), { preserveRests: false }).pattern.steps.flat();
    expect(notes).toHaveLength(4);
    for (const note of notes) {
      expect(snapToScale(note, 0, "major")).toBe(note);
      expect(Math.abs(note - 60)).toBeLessThanOrEqual(12);
    }
  });
});
