// Pure transformation primitives — the ordered chain M applies per step.
// Every function here is deterministic given its inputs (RNG included), which
// keeps the musical logic fully testable.

import type {
  NoteOrder,
  NoteOrderCursor,
  NoteOrderMix,
  VelocityRange,
} from "./types";
import { Rng, BrownianWalk } from "./rng";

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

/** Clamp and order the two MIDI endpoints used by M's Velocity Range. */
export function normalizeVelocityRange(range: VelocityRange): VelocityRange {
  const a = Math.max(0, Math.min(127, Math.round(range.low)));
  const b = Math.max(0, Math.min(127, Math.round(range.high)));
  return { low: Math.min(a, b), high: Math.max(a, b) };
}

/** Accent 0 is a rest; levels 1–4 divide the selected range evenly. */
export function velocityForAccent(range: VelocityRange, rawLevel: number): number {
  const level = Math.max(0, Math.min(4, Math.round(rawLevel)));
  if (level === 0) return 0;
  const { low, high } = normalizeVelocityRange(range);
  return Math.round(low + ((high - low) * (level - 1)) / 3);
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
  let bval = cursor.bval;
  if (order === "original") {
    index = cursor.pos % length;
  } else if (order === "reverse") {
    index = length - 1 - (cursor.pos % length);
  } else if (order === "random") {
    index = rng.pickIndexAvoiding(length, cursor.last);
  } else if (order === "brownian") {
    // 1/f-ish smooth wander: the walk position maps onto the step range, so
    // the read head drifts gradually instead of jumping. This is the "alive"
    // randomness — coherent motion that still surprises.
    bval = new BrownianWalk(rng, cursor.bval, 0.18).next();
    index = Math.min(length - 1, Math.floor(bval * length));
  } else {
    // random-walk: step one place up or down around the ring
    const base = cursor.last < 0 ? 0 : cursor.last;
    const dir = rng.chance(0.5) ? 1 : -1;
    index = (((base + dir) % length) + length) % length;
  }
  return { index, cursor: { pos: cursor.pos + 1, last: index, bval } };
}

/** Build the stored, repeating permutation used by M's Cyclic Random mode. */
export function makeCyclicOrder(length: number, seed: number): number[] {
  const order = Array.from({ length }, (_, i) => i);
  const rng = new Rng(seed);
  for (let i = order.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

/** Convert the two movable edge controls into M's three percentages. */
export function noteOrderMixFromEdges(
  originalValue: number,
  utterlyValue: number,
): NoteOrderMix {
  const original = Math.max(0, Math.min(100, Math.round(originalValue)));
  const utterly = Math.max(
    0,
    Math.min(100 - original, Math.round(utterlyValue)),
  );
  return { original, cyclic: 100 - original - utterly, utterly };
}

export function setNoteOrderEdge(
  mix: NoteOrderMix,
  edge: "original" | "utterly",
  value: number,
): NoteOrderMix {
  const next = Math.max(0, Math.min(100, Math.round(value)));
  if (edge === "original") {
    return noteOrderMixFromEdges(next, Math.min(mix.utterly, 100 - next));
  }
  const utterly = next;
  const original = Math.min(mix.original, 100 - utterly);
  return noteOrderMixFromEdges(original, utterly);
}

export function setNoteOrderBoundary(
  mix: NoteOrderMix,
  boundary: "originalEnd" | "utterlyStart",
  position: number,
): NoteOrderMix {
  return boundary === "originalEnd"
    ? setNoteOrderEdge(mix, "original", position)
    : setNoteOrderEdge(mix, "utterly", 100 - position);
}

export function noteOrderHandleLayout(mix: NoteOrderMix): {
  originalEnd: number;
  utterlyStart: number;
} {
  return {
    originalEnd: mix.original,
    utterlyStart: 100 - mix.utterly,
  };
}

/**
 * Pick among M's three note-order sources by percentage.
 * Original and Cyclic advance repeatably; Utterly chooses afresh on every step.
 */
export function nextMixedStepIndex(
  mix: NoteOrderMix,
  cursor: NoteOrderCursor,
  length: number,
  rng: Rng,
): {
  index: number;
  source: "original" | "cyclic" | "utterly";
  cursor: NoteOrderCursor;
} {
  const roll = rng.next() * 100;
  let index: number;
  let source: "original" | "cyclic" | "utterly";
  if (roll < mix.original) {
    index = cursor.pos % length;
    source = "original";
  } else if (roll < mix.original + mix.cyclic) {
    index = cursor.pos % length;
    source = "cyclic";
  } else {
    index = rng.pickIndexAvoiding(length, cursor.last);
    source = "utterly";
  }
  return {
    index,
    source,
    cursor: { ...cursor, pos: cursor.pos + 1, last: index },
  };
}
