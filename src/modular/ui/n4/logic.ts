/**
 * The arithmetic behind the Numerology-style kit: the row action menus, the
 * values printed under each step, pointer → step and pointer → value, the
 * Select row's relative moves, the Note Order split and the cell ranges.
 *
 * Kept out of the components so each rule is tested on its own.
 */

import type { Rng } from "../../../engine/rng";
import type { CyclicStep, NoteOrderMix } from "../../../engine/types";
import { normalizeCyclicStep } from "../../../engine/cyclic";
import { setNoteOrderBoundary } from "../../../engine/transform";

/* ===== Row action menus (manual p89–90) ===== */

/** Share of the active steps each action changes; "one" is always a single step. */
export const ACTION_SHARES = { one: 0, few: 0.25, some: 0.5, most: 0.75, all: 1 } as const;
export type RowAction = keyof typeof ACTION_SHARES;

/** The active steps, start to end; a start after the end wraps round. */
export type StepRange = { from: number; to: number };

export function rangeSteps(range: StepRange, size: number): number[] {
  const out: number[] = [];
  const from = Math.max(0, Math.min(size - 1, range.from));
  const to = Math.max(0, Math.min(size - 1, range.to));
  if (from <= to) for (let i = from; i <= to; i++) out.push(i);
  else {
    for (let i = 0; i <= to; i++) out.push(i);
    for (let i = from; i < size; i++) out.push(i);
  }
  return out;
}

/**
 * "Skip a Few", "Unmute Most" and the rest: set `on` for a random share of
 * the steps in range that are not already set that way.
 */
export function applyRowAction(
  flags: readonly boolean[],
  action: RowAction,
  on: boolean,
  range: StepRange,
  rng: Rng,
): boolean[] {
  const out = [...flags];
  const steps = rangeSteps(range, flags.length);
  const count = action === "one" ? 1 : Math.max(1, Math.round(steps.length * ACTION_SHARES[action]));
  const candidates = steps.filter((i) => out[i] !== on);
  for (let n = 0; n < count && candidates.length > 0; n++) {
    const [pick] = candidates.splice(rng.int(candidates.length), 1);
    out[pick] = on;
  }
  return out;
}

/* ===== Values under each step ===== */

export type LaneFormat = "gate" | "level" | "percent" | "signed" | "number" | "ratio";

export function formatLaneValue(value: number | CyclicStep, format: LaneFormat): string {
  if (typeof value === "object") {
    const { min, max } = normalizeCyclicStep(value);
    return min === max ? String(min) : `${min}–${max}`;
  }
  switch (format) {
    case "gate": return value <= 0 ? "–" : value >= 1 ? "Tie" : value.toFixed(2);
    case "level": return String(Math.round(value));
    case "percent": return `${Math.round(value)}%`;
    case "signed": return value.toFixed(2);
    case "ratio": return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0$/, "");
    default: return value.toFixed(2);
  }
}

/* ===== Pointer maths ===== */

export function stepFromX(x: number, width: number, steps: number): number {
  return Math.max(0, Math.min(steps - 1, Math.floor((x / Math.max(1, width)) * steps)));
}

/** A lane's value at a height: top is `max`, bottom `min`, snapped to `step`. */
export function laneValueFromY(y: number, height: number, min: number, max: number, step: number): number {
  const t = 1 - Math.max(0, Math.min(1, y / Math.max(1, height)));
  const raw = min + t * (max - min);
  const snapped = Math.round(raw / step) * step;
  return Number(Math.max(min, Math.min(max, snapped)).toFixed(6));
}

/* ===== Select row (manual p89) ===== */

/**
 * Set one step's value. If that step is selected, every selected step moves
 * by the same amount, each clamped to the lane's range.
 */
export function moveSelected(
  values: readonly number[],
  selected: readonly boolean[],
  index: number,
  value: number,
  min: number,
  max: number,
): number[] {
  const clamp = (v: number) => Number(Math.max(min, Math.min(max, v)).toFixed(6));
  if (!selected[index]) return values.map((v, i) => (i === index ? clamp(value) : v));
  const delta = value - values[index];
  return values.map((v, i) => (selected[i] ? clamp(v + delta) : v));
}

/* ===== Note Order split ===== */

/** The Orig | Scram | Rand bar: two edges, as M's Note Order triangle has. */
export const splitFromDrag = (mix: NoteOrderMix, edge: "originalEnd" | "utterlyStart", position: number): NoteOrderMix =>
  setNoteOrderBoundary(mix, edge, position);

/* ===== Cell ranges ===== */

/**
 * Drag a cyclic cell's top or bottom to open it into a range — M picks a
 * level inside it at random each pass — or its middle to move it whole.
 * A range whose edges meet is a single level again.
 */
export function cellRangeDrag(cell: CyclicStep, part: "top" | "bottom" | "middle", level: number): CyclicStep {
  const { min, max } = normalizeCyclicStep(cell);
  const to = Math.max(0, Math.min(4, Math.round(level)));
  let next: { min: number; max: number };
  if (part === "top") next = { min: Math.min(min, to), max: Math.max(min, to) };
  else if (part === "bottom") next = { min: Math.min(to, max), max: Math.max(to, max) };
  else {
    const shift = Math.max(-min, Math.min(4 - max, to - max));
    next = { min: min + shift, max: max + shift };
  }
  return next.min === next.max ? next.min : next;
}

/* ===== Note names ===== */

const FLAT_NAMES = ["C", "Db,C#", "D", "Eb,D#", "E", "F", "Gb,F#", "G", "Ab,G#", "A", "Bb,A#", "B"];

/** A pitch as the PolyNote labels its rows: "Db,C# 4", with MIDI 60 as C 3 (manual p95). */
export const polyNoteName = (pitch: number): string =>
  `${FLAT_NAMES[((pitch % 12) + 12) % 12]} ${Math.floor(pitch / 12) - 2}`;

/* ===== The step chip row ===== */

export type ChipState = { skip: boolean; mute: boolean };

/** A click on a step's chip: none → Skip → Mute → none. */
export function nextChip(state: ChipState): ChipState {
  if (!state.skip && !state.mute) return { skip: true, mute: false };
  if (state.skip) return { skip: false, mute: true };
  return { skip: false, mute: false };
}

const JUMP_LEVELS = [0, 0.25, 0.5, 1];
/** Alt-click: the step's Random Jump chance, up a level and round. */
export function nextJump(chance: number): number {
  const next = JUMP_LEVELS.find((level) => level > chance + 1e-9);
  return next ?? 0;
}

/* ===== Two-thumb range sliders ===== */

export type Range = { low: number; high: number };

/** Move the thumb nearer to `value` (or the one named), never past the other. */
export function rangeDrag(range: Range, value: number, thumb?: "low" | "high"): Range {
  const which = thumb ?? (Math.abs(value - range.low) <= Math.abs(value - range.high) ? "low" : "high");
  return which === "low"
    ? { low: Math.min(value, range.high), high: range.high }
    : { low: range.low, high: Math.max(value, range.low) };
}

/* ===== Tempo range ===== */

export type TempoRange = { low: number; tempo: number; high: number };

/** M's Conducting tempo bar: a low end, a high end, and the tempo between them. */
export function tempoRangeDrag(range: TempoRange, part: "low" | "high" | "tempo", value: number): TempoRange {
  const v = Math.round(value);
  if (part === "tempo") return { ...range, tempo: Math.max(range.low, Math.min(range.high, v)) };
  const next = part === "low"
    ? { low: Math.min(v, range.high), high: range.high }
    : { low: range.low, high: Math.max(v, range.low) };
  return { ...next, tempo: Math.max(next.low, Math.min(next.high, range.tempo)) };
}

/* ===== Faders side by side ===== */

/** Which of `count` faders across `width` is under the pointer, and the value at its height. */
export function faderUnder(
  x: number, y: number, width: number, height: number, count: number, min: number, max: number, step: number,
): { index: number; value: number } {
  return { index: stepFromX(x, width, count), value: laneValueFromY(y, height, min, max, step) };
}
