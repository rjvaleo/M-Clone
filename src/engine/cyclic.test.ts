import { describe, expect, it } from "vitest";
import { Rng } from "./rng";
import { cyclicLengthFromStepIndex, normalizeCyclicStep, pickCyclicLevel } from "./cyclic";

describe("cyclic level ranges", () => {
  it("maps a zero-based loop marker to its inclusive one-based length", () => {
    expect(cyclicLengthFromStepIndex(0)).toBe(1);
    expect(cyclicLengthFromStepIndex(7)).toBe(8);
    expect(cyclicLengthFromStepIndex(15)).toBe(16);
  });

  it("migrates a legacy number to a one-level range", () => {
    expect(normalizeCyclicStep(3)).toEqual({ min: 3, max: 3 });
  });

  it("orders and clamps a drawn range to levels 0-4", () => {
    expect(normalizeCyclicStep({ min: 9, max: -2 })).toEqual({ min: 0, max: 4 });
  });

  it("does not consume randomness for a single level", () => {
    const rng = new Rng(7);
    expect(pickCyclicLevel(2, rng)).toBe(2);
    expect(rng.next()).toBeCloseTo(new Rng(7).next(), 12);
  });

  it("deterministically chooses an inclusive level inside a range", () => {
    const a = new Rng(42);
    const b = new Rng(42);
    const first = Array.from({ length: 12 }, () => pickCyclicLevel({ min: 1, max: 3 }, a));
    const second = Array.from({ length: 12 }, () => pickCyclicLevel({ min: 1, max: 3 }, b));
    expect(first).toEqual(second);
    expect(new Set(first)).toEqual(new Set([1, 2, 3]));
  });
});
