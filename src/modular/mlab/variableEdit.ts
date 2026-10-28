/**
 * The arithmetic of M's Variable edit windows (Note Density, Velocity Range,
 * Transposition), as M Variables' editor draws them.
 */

import type { VelocityRange } from "../../engine/types";

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

/** Note Density: the square at `x` along a track `width` wide, 0–1 in hundredths. */
export const densityAt = (x: number, width: number): number =>
  Math.round(Math.max(0, Math.min(1, x / Math.max(1, width))) * 100) / 100;

/**
 * Velocity Range: drag the low end, the high end (each stopping at the
 * other), or the band, which carries both and stops at 1 and 127.
 */
export function dragVelocityRange(range: VelocityRange, part: "low" | "high" | "band", value: number, delta: number): VelocityRange {
  const v = Math.round(Math.max(1, Math.min(127, value)));
  if (part === "low") return { low: Math.min(v, range.high), high: range.high };
  if (part === "high") return { low: range.low, high: Math.max(v, range.low) };
  const shift = Math.max(1 - range.low, Math.min(127 - range.high, Math.round(delta)));
  return { low: range.low + shift, high: range.high + shift };
}

/** Transposition as M shows it: where Middle C (C3) lands. */
export function transpositionLabel(semitones: number): { note: string; octave: number } {
  const n = 60 + semitones;
  return { note: NOTE_NAMES[((n % 12) + 12) % 12], octave: Math.floor(n / 12) - 2 };
}

export const transposeBy = (semitones: number, cell: "note" | "octave", steps: number): number =>
  Math.max(-48, Math.min(48, semitones + steps * (cell === "octave" ? 12 : 1)));
