import type { CyclicLevelRange, CyclicStep } from "./types";
import type { Rng } from "./rng";

const clampLevel = (value: number) => Math.max(0, Math.min(4, Math.round(value)));

/** Convert a zero-based marker column to M's inclusive 1–16 loop length. */
export const cyclicLengthFromStepIndex = (stepIndex: number): number =>
  Math.max(1, Math.min(16, Math.round(stepIndex) + 1));

/** Accept legacy numeric steps and canonicalize every value to an ordered range. */
export function normalizeCyclicStep(step: CyclicStep): CyclicLevelRange {
  if (typeof step === "number") {
    const level = clampLevel(step);
    return { min: level, max: level };
  }
  const a = clampLevel(step.min);
  const b = clampLevel(step.max);
  return { min: Math.min(a, b), max: Math.max(a, b) };
}

/** Pick uniformly and inclusively; a point consumes no RNG, preserving old seeds. */
export function pickCyclicLevel(step: CyclicStep, rng: Rng): number {
  const { min, max } = normalizeCyclicStep(step);
  return min === max ? min : min + rng.int(max - min + 1);
}
