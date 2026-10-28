/**
 * Turning a scale degree into a frequency.
 *
 * Ported from the scale sequencer, where this was the good idea: a note is a
 * *degree of a scale* measured in cents, not a MIDI number. Everything a
 * microtonal system needs follows from that — a maqam's neutral second, a
 * Pythagorean third, a 31-EDO step — and none of it survives being rounded to
 * the nearest semitone on the way through.
 *
 * All four functions here are pure. Nothing touches an AudioContext, so the
 * tuning can be reasoned about, tested and shown on a face without making a
 * sound.
 *
 * ## Two corrections against the source
 *
 * `degreeCents` handles degrees below the root. The original used
 * `degree % length`, and JavaScript's `%` keeps the sign of its left operand,
 * so degree −1 read as −1 rather than as the seventh below — every scale went
 * wrong the moment a step was transposed downward past its root.
 *
 * `nearestDegree` rounds to the nearer neighbour. The original walked the
 * degrees and kept the first that was closest, which is the same thing only
 * when the scale is symmetrical.
 */

import type { Scale } from "./scales";

/** Cents in an octave. The one constant everything else is derived from. */
export const CENTS_PER_OCTAVE = 1200;

/** A4, the pitch every MIDI note is measured against. */
export const A4_HZ = 440;
export const A4_MIDI = 69;

/** How much a pitch is multiplied by, `cents` above where it started. */
export const centsToRatio = (cents: number): number =>
  Math.pow(2, cents / CENTS_PER_OCTAVE);

/** A frequency `cents` above `rootHz`. */
export const centsToHz = (rootHz: number, cents: number): number =>
  rootHz * centsToRatio(cents);

/** The interval between two frequencies, in cents. */
export const hzToCents = (fromHz: number, toHz: number): number =>
  CENTS_PER_OCTAVE * Math.log2(toHz / fromHz);

/** Equal-tempered pitch of a MIDI note, for choosing a root. */
export const rootHzForMidi = (midi: number): number =>
  A4_HZ * Math.pow(2, (midi - A4_MIDI) / 12);

/** Positive remainder, which is what a scale degree needs and `%` is not. */
const wrap = (value: number, modulo: number): number =>
  ((value % modulo) + modulo) % modulo;

/**
 * Cents above the root for a degree, counting past either end of the scale.
 *
 * Degree 7 of a seven-note scale is the octave, degree 8 the ninth, degree −1
 * the seventh below. A scale is a repeating shape, not a list with ends.
 */
export function degreeCents(scale: Scale, degree: number): number {
  const length = scale.cents.length;
  const step = Math.floor(degree);
  const octave = Math.floor(step / length);
  return scale.cents[wrap(step, length)] + octave * CENTS_PER_OCTAVE;
}

/** The frequency of a degree, given where the root is. */
export const degreeHz = (scale: Scale, rootHz: number, degree: number): number =>
  centsToHz(rootHz, degreeCents(scale, degree));

/** Which degree a pitch belongs to, and how far from it that pitch is. */
export function nearestDegree(scale: Scale, cents: number): {
  degree: number;
  octave: number;
  /** Positive when the pitch is sharp of the degree. */
  errorCents: number;
} {
  const length = scale.cents.length;
  const octave = Math.floor(cents / CENTS_PER_OCTAVE);
  const within = cents - octave * CENTS_PER_OCTAVE;

  let best = 0;
  let bestError = Infinity;
  let bestOctave = octave;
  // The octave above is a candidate too: a pitch just under 1200 cents is
  // nearer the next root than the last degree of this octave.
  for (let index = 0; index <= length; index++) {
    const wrapped = index === length;
    const candidate = wrapped
      ? CENTS_PER_OCTAVE
      : scale.cents[index];
    const error = within - candidate;
    if (Math.abs(error) < Math.abs(bestError)) {
      best = wrapped ? 0 : index;
      bestOctave = wrapped ? octave + 1 : octave;
      bestError = error;
    }
  }
  return { degree: best, octave: bestOctave, errorCents: bestError };
}

export type KeyboardRange = {
  rootHz: number;
  /** The MIDI note the root sits on, so the scale lands where it is played. */
  rootMidi: number;
  low: number;
  high: number;
};

export type MappedKey = {
  midi: number;
  /** The true pitch of this key in this tuning — not the piano's. */
  hz: number;
  degree: number;
  octave: number;
  /** Within a quarter-tone of a real degree, so worth lighting up. */
  inScale: boolean;
  isRoot: boolean;
};

/** How near a key must be to a degree to count as in the scale. */
const IN_SCALE_CENTS = 50;

/**
 * Lay a scale across a keyboard.
 *
 * Each key keeps its equal-tempered position — that is where the finger goes —
 * but sounds the scale degree nearest to it, at that degree's true pitch. It is
 * what lets a 12-note keyboard play a 31-tone temperament without pretending
 * the extra pitches are not there.
 */
export function mapKeyboard(scale: Scale, range: KeyboardRange): MappedKey[] {
  const keys: MappedKey[] = [];
  for (let midi = range.low; midi <= range.high; midi++) {
    const fromRoot = (midi - range.rootMidi) * 100;
    const found = nearestDegree(scale, fromRoot);
    const cents = scale.cents[found.degree] + found.octave * CENTS_PER_OCTAVE;
    keys.push({
      midi,
      hz: centsToHz(range.rootHz, cents),
      degree: found.degree,
      octave: found.octave,
      inScale: Math.abs(found.errorCents) < IN_SCALE_CENTS,
      isRoot: found.degree === 0 && Math.abs(found.errorCents) < IN_SCALE_CENTS,
    });
  }
  return keys;
}
