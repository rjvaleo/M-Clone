// Pure transformation primitives — the ordered chain M applies per step.
// Every function here is deterministic given its inputs (RNG included), which
// keeps the musical logic fully testable.

import type { NoteOrder, NoteOrderCursor } from "./types";
import { Rng } from "./rng";

/**
 * Seconds per step for a Voice's time base.
 * A whole note is 4 * (60 / tempo) seconds; a step is (numerator/denominator)
 * of a whole note. So denominator 8 = eighth notes; numerator 2 = twice as long.
 */
export function stepDurationSeconds(
  tempo: number,
  numerator: number,
  denominator: number,
): number {
  const wholeNote = 4 * (60 / tempo);
  return wholeNote * (numerator / denominator);
}

/** Per-voice transposition (semitone shift of every pitch in the step). */
export function transposePitches(pitches: number[], semitones: number): number[] {
  return pitches.map((p) => p + semitones);
}

/** Density gate: whether this step actually sounds. */
export function gate(density: number, rng: Rng): boolean {
  return rng.chance(density);
}

/**
 * Compute the step index a Voice should read next, given its Note Order and
 * traversal cursor. Returns the index plus the advanced cursor.
 */
export function nextStepIndex(
  order: NoteOrder,
  cursor: NoteOrderCursor,
  length: number,
  rng: Rng,
): { index: number; cursor: NoteOrderCursor } {
  let index: number;
  if (order === "original") {
    index = cursor.pos % length;
  } else if (order === "reverse") {
    index = length - 1 - (cursor.pos % length);
  } else if (order === "random") {
    index = rng.pickIndexAvoiding(length, cursor.last);
  } else {
    // random-walk: step one place up or down around the ring
    const base = cursor.last < 0 ? 0 : cursor.last;
    const dir = rng.chance(0.5) ? 1 : -1;
    index = (((base + dir) % length) + length) % length;
  }
  return { index, cursor: { pos: cursor.pos + 1, last: index } };
}
