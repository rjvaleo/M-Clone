/**
 * M NoteSeq: one voice of M as a Numerology note sequencer.
 *
 * What it stores and the rules its lanes follow. The pattern is M's — six
 * groups a–f, each an Original list and its Cyclic-Random (scrambled) copy —
 * and the Cyclic Variables are M's too, six positions of up to sixteen cells.
 * Around them sit Numerology's sequencer controls: start and end markers,
 * Skip, Select and Mute rows, a Direction, and per-step Random Jump and
 * Velocity lanes.
 */

import { createDefaultPattern, createDefaultProject } from "../../engine/project";
import type { CyclicStep, CyclicVariable, NoteOrderCursor } from "../../engine/types";
import type { Rng } from "../../engine/rng";
import { nextStepIndex } from "../../engine/transform";
import { POSITIONS, type VoicePattern } from "./model";

/** M's own pattern limit; Numerology stops at 128. */
export const MAX_SEQ_STEPS = 999;
/** M's cycles are one to sixteen cells. */
export const MAX_CYCLE_CELLS = 16;

const project = createDefaultProject();
const positions = <T>(make: (position: number) => T): T[] => Array.from({ length: POSITIONS }, (_, p) => make(p));

/* ===== Stored shapes ===== */

/** Cells per kind, per position a–f. */
export type SeqCells = Record<CyclicVariable, CyclicStep[][]>;
/** Cycle length per kind, per position. */
export type SeqCellLengths = Record<CyclicVariable, number[]>;

const toVoicePattern = (seedRiff: boolean): VoicePattern => {
  const pattern = createDefaultPattern("pattern", seedRiff);
  return {
    steps: pattern.steps.map((step) => [...step.pitches]),
    scrambled: pattern.scrambledSteps.map((step) => [...step.pitches]),
    length: pattern.outputLength,
  };
};

/** A fresh NoteSeq plays M's opening riff, as a fresh MonoNote plays its quarter notes. */
export const defaultNoteSeqPatterns = (): VoicePattern[] => positions((group) => toVoicePattern(group === 0));

export const defaultCells = (): SeqCells => ({
  accent: positions(() => structuredClone(project.cyclic.accent[0])),
  legato: positions(() => structuredClone(project.cyclic.legato[0])),
  rhythm: positions(() => structuredClone(project.cyclic.rhythm[0])),
});

export const defaultCellLengths = (): SeqCellLengths => ({
  accent: positions(() => MAX_CYCLE_CELLS),
  legato: positions(() => MAX_CYCLE_CELLS),
  rhythm: positions(() => MAX_CYCLE_CELLS),
});

/* ===== Which steps play ===== */

/**
 * The steps in play, in order: from the start marker to the end of the
 * pattern, wrapping round when the start sits past the end, less any skipped.
 * `size` is how many steps the lanes hold.
 */
export function activeSteps(length: number, start: number, skip: readonly boolean[], size = length): number[] {
  const end = Math.max(0, Math.min(MAX_SEQ_STEPS, length) - 1);
  const total = Math.max(size, length);
  const from = Math.max(0, Math.min(total - 1, Math.round(start)));
  const order: number[] = [];
  if (from <= end) for (let i = from; i <= end; i++) order.push(i);
  else {
    for (let i = from; i < total; i++) order.push(i);
    for (let i = 0; i <= end; i++) order.push(i);
  }
  return length > 0 ? order.filter((i) => !skip[i]) : [];
}

export const SEQ_DIRECTIONS = ["fwd", "rev", "alt1", "alt2", "rnd", "brownian", "walk"] as const;
export type SeqDirection = (typeof SEQ_DIRECTIONS)[number];
export const DIRECTION_LABELS: Record<SeqDirection, string> = {
  fwd: "Fwd", rev: "Rev", alt1: "Alt1", alt2: "Alt2", rnd: "Rnd", brownian: "Brown", walk: "Walk",
};

/**
 * The next position in the active steps for a Direction (manual p92). Alt1
 * turns round without repeating the ends, Alt2 repeats them; Rnd, Brownian
 * and Walk are M Clone's own random readers.
 */
export function directionIndex(
  dir: SeqDirection,
  cursor: NoteOrderCursor,
  length: number,
  rng: Rng,
): { index: number; cursor: NoteOrderCursor } {
  if (length <= 1) return { index: 0, cursor: { ...cursor, pos: cursor.pos + 1, last: 0 } };
  const pos = cursor.pos;
  let index: number;
  switch (dir) {
    case "rnd": return nextStepIndex("random", cursor, length, rng);
    case "brownian": return nextStepIndex("brownian", cursor, length, rng);
    case "walk": return nextStepIndex("random-walk", cursor, length, rng);
    case "rev": index = length - 1 - (pos % length); break;
    case "alt1": {
      const p = pos % (2 * length - 2);
      index = p < length ? p : 2 * length - 2 - p;
      break;
    }
    case "alt2": {
      const p = pos % (2 * length);
      index = p < length ? p : 2 * length - 1 - p;
      break;
    }
    default: index = pos % length;
  }
  return { index, cursor: { ...cursor, pos: pos + 1, last: index } };
}

/* ===== Edits ===== */

/** << and >>: roll the first `length` steps one place left (-1) or right (+1). */
export function shiftSteps<T>(values: readonly T[], length: number, by: -1 | 1): T[] {
  const n = Math.min(length, values.length);
  if (n <= 1) return [...values];
  const head = values.slice(0, n);
  const rolled = by < 0 ? [...head.slice(1), head[0]] : [head[n - 1], ...head.slice(0, n - 1)];
  return [...rolled, ...values.slice(n)];
}

/** 1/x: mirror every pitch around the middle of the pattern's span. */
export function invertPitches(steps: readonly number[][], length: number): number[][] {
  const notes = steps.slice(0, length).flat();
  if (notes.length === 0) return steps.map((s) => [...s]);
  const axis = Math.min(...notes) + Math.max(...notes);
  return steps.map((s, i) => (i < length
    ? s.map((p) => Math.max(0, Math.min(127, axis - p))).sort((a, b) => a - b)
    : [...s]));
}

/** One step of a per-step lane, padding a short lane with `fill`. */
export function setStepValue<T>(lane: readonly T[], index: number, value: T, fill: T): T[] {
  const next = [...lane];
  while (next.length <= index) next.push(fill);
  next[index] = value;
  return next;
}
