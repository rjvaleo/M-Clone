import { describe, expect, it } from "vitest";
import type { Rng } from "../../engine/rng";
import type { CyclicStep } from "../../engine/types";
import type { SeqMaterial } from "./generate";
import { DEFAULT_EVOLVE, evolve, type EvolveConfig, type EvolveId } from "./evolve";

/** An Rng that plays back fixed draws, so each transformation's choice is known. */
const scripted = (...draws: number[]): Rng => {
  let at = 0;
  const next = () => draws[at++ % draws.length];
  return { next, int: (n: number) => Math.floor(next() * n), chance: (p: number) => next() < p } as unknown as Rng;
};

const material = (overrides: Partial<SeqMaterial> = {}): SeqMaterial => ({
  pattern: { steps: [[60], [], [64], [67]], scrambled: [[67], [], [60], [64]], length: 4 },
  cells: { accent: [2, { min: 1, max: 3 }, 4, 0], legato: [0, 4, 2], rhythm: [1, 3] },
  root: 0,
  scale: "major",
  ...overrides,
});
const withCells = (cells: Partial<Record<"accent" | "legato" | "rhythm", CyclicStep[]>>) =>
  material({ cells: { ...material().cells, ...cells } });
const always = (dimension: "x" | "y" | "z", id: EvolveId): EvolveConfig => ({ ...DEFAULT_EVOLVE, [dimension]: [{ id, probability: 100 }] });

describe("Evolve X: pitch", () => {
  it("swaps two sounding steps, never a rest", () => {
    // a = 0, b = 1 → 2 (skips a): sounding steps 0 and 3 swap.
    const after = evolve("x", always("x", "swap-pitches"), material(), scripted(0.1, 0.6));
    expect(after.pattern.steps).toEqual([[67], [], [64], [60]]);
  });

  it("leaves a pattern with fewer than two notes alone", () => {
    const lonely = material({ pattern: { steps: [[60], []], scrambled: [[60], []], length: 2 } });
    expect(evolve("x", always("x", "swap-pitches"), lonely, scripted(0))).toBe(lonely);
  });

  it("moves one step an octave down, clamped to MIDI", () => {
    const after = evolve("x", always("x", "octave"), material(), scripted(0, 0.7));
    expect(after.pattern.steps[0]).toEqual([48]);
    const low = material({ pattern: { steps: [[5]], scrambled: [[5]], length: 1 } });
    expect(evolve("x", always("x", "octave"), low, scripted(0, 0.7)).pattern.steps[0]).toEqual([0]);
  });

  it("moves nothing when every step is a rest", () => {
    const rests = material({ pattern: { steps: [[], []], scrambled: [[], []], length: 2 } });
    expect(evolve("x", always("x", "minor-third"), rests, scripted(0))).toBe(rests);
  });

  it("swaps two scrambled steps, rests included", () => {
    const after = evolve("x", always("x", "swap-scrambled"), material(), scripted(0, 0));
    expect(after.pattern.scrambled).toEqual([[], [67], [60], [64]]);
    expect(after.pattern.steps).toEqual(material().pattern.steps);
    const one = material({ pattern: { steps: [[60]], scrambled: [[60]], length: 1 } });
    expect(evolve("x", always("x", "swap-scrambled"), one, scripted(0))).toBe(one);
  });
});

describe("Evolve Y: timing", () => {
  it("swaps two legato cells", () => {
    expect(evolve("y", always("y", "swap-legato"), material(), scripted(0.5, 0)).cells.legato).toEqual([4, 0, 2]);
    const one = withCells({ legato: [2] });
    expect(evolve("y", always("y", "swap-legato"), one, scripted(0))).toBe(one);
  });

  it("nudges one rhythm cell a level, never past the top", () => {
    expect(evolve("y", always("y", "nudge-rhythm"), material(), scripted(0.9, 0.2)).cells.rhythm).toEqual([1, 4]);
    expect(evolve("y", always("y", "nudge-rhythm"), withCells({ rhythm: [4] }), scripted(0, 0.2)).cells.rhythm).toEqual([4]);
    const none = withCells({ rhythm: [] });
    expect(evolve("y", always("y", "nudge-rhythm"), none, scripted(0))).toBe(none);
  });

  it("widens a legato cell upward, or downward from the top", () => {
    // Level 0 can only widen upward, without a coin toss.
    expect(evolve("y", always("y", "widen-legato"), material(), scripted(0)).cells.legato[0]).toEqual({ min: 0, max: 1 });
    // Level 4 can only widen downward.
    expect(evolve("y", always("y", "widen-legato"), material(), scripted(0.5)).cells.legato[1]).toEqual({ min: 3, max: 4 });
    // In between, the coin decides: heads up, tails down.
    expect(evolve("y", always("y", "widen-legato"), material(), scripted(0.9, 0.2)).cells.legato[2]).toEqual({ min: 2, max: 3 });
    expect(evolve("y", always("y", "widen-legato"), material(), scripted(0.9, 0.8)).cells.legato[2]).toEqual({ min: 1, max: 2 });
    const none = withCells({ legato: [] });
    expect(evolve("y", always("y", "widen-legato"), none, scripted(0))).toBe(none);
  });
});

describe("Evolve Z: velocity", () => {
  it("nudges a whole accent range, holding it inside 0–4", () => {
    expect(evolve("z", always("z", "nudge-accent"), material(), scripted(0.3, 0.9)).cells.accent[1]).toEqual({ min: 0, max: 2 });
    expect(evolve("z", always("z", "nudge-accent"), material(), scripted(0.6, 0.2)).cells.accent[2]).toBe(4);
  });

  it("narrows an accent range from either end, to a single level when it closes", () => {
    expect(evolve("z", always("z", "narrow-accent"), material(), scripted(0, 0.2)).cells.accent[1]).toEqual({ min: 2, max: 3 });
    expect(evolve("z", always("z", "narrow-accent"), material(), scripted(0, 0.8)).cells.accent[1]).toEqual({ min: 1, max: 2 });
    const close = withCells({ accent: [{ min: 1, max: 2 }] });
    expect(evolve("z", always("z", "narrow-accent"), close, scripted(0, 0.2)).cells.accent).toEqual([2]);
    const points = withCells({ accent: [1, 2] });
    expect(evolve("z", always("z", "narrow-accent"), points, scripted(0))).toBe(points);
  });
});

describe("Evolve: each transformation's chance", () => {
  it("runs a part-chance transformation only when its draw falls under it", () => {
    const half: EvolveConfig = { ...DEFAULT_EVOLVE, y: [{ id: "swap-legato", probability: 50 }] };
    expect(evolve("y", half, material(), scripted(0.3, 0.5, 0)).cells.legato).toEqual([4, 0, 2]);
    expect(evolve("y", half, material(), scripted(0.7))).toEqual(material());
  });

  it("a dimension with nothing configured changes nothing", () => {
    const before = material();
    expect(evolve("y", { x: [] } as unknown as EvolveConfig, before, scripted(0))).toBe(before);
  });
});
