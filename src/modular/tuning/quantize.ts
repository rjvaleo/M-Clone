/**
 * Pulling a note onto a scale, keeping the pitch the scale actually asks for.
 *
 * This is the piece that was missing between the tuning library and the graph.
 * `tuning.ts` already knows what a degree is worth in cents and `scales.ts`
 * holds eighty-one scales in cents — but a note travelling down a cable is a
 * MIDI integer, and most of those scales do not land on MIDI integers. A maqam
 * with a 150-cent second, a 31-EDO, Werckmeister III: every one of them has
 * degrees between the piano keys.
 *
 * So a snapped note is two numbers, not one:
 *
 *   - `note` — the key a twelve-tone instrument presses, and what MIDI out
 *     sends. Always within a semitone of the true pitch.
 *   - `detuneCents` — the rest of the pitch, which an instrument that can bend
 *     applies and one that cannot ignores.
 *
 * That split is what lets the same note event drive a microtonal synth and a
 * hardware MIDI channel at once, each hearing as much of the scale as it can.
 * A quantiser that returned only a MIDI note would silently round every one of
 * these scales back into 12-TET, which is the whole thing worth avoiding.
 */

import { CENTS_PER_OCTAVE, degreeCents } from "./tuning";
import type { Scale } from "./scales";

const CENTS_PER_SEMITONE = 100;

/** Which way a note is allowed to move to reach a degree. */
export type SnapDirection = "nearest" | "down" | "up";

/** The chord shapes `m.chord-quantizer` offers, as scale degrees. */
export type ChordShape = "triad" | "seventh" | "power" | "sus4";

/**
 * Chord shapes named in scale degrees rather than semitones.
 *
 * A triad is degrees 0-2-4 of whatever scale is running, so it is a major
 * triad in Ionian and a minor one in Aeolian without either being special-
 * cased — and in a maqam it is whatever that maqam's first, third and fifth
 * degrees are, which is the point of doing this in degrees at all.
 */
export const CHORD_DEGREES: Readonly<Record<ChordShape, readonly number[]>> = {
  triad: [0, 2, 4],
  seventh: [0, 2, 4, 6],
  power: [0, 4],
  sus4: [0, 3, 4],
};

export interface RetunedNote {
  /** The MIDI key to press. Always within 50 cents of the true pitch. */
  note: number;
  /** The remainder of the pitch, in cents. Zero when the degree is a key. */
  detuneCents: number;
}

/**
 * Turn a pitch in cents-above-root into a key plus a trim.
 *
 * The rounding is what guarantees `|detuneCents| <= 50`: the key is the
 * *nearest* semitone, so whatever is left over cannot exceed half of one.
 */
function asKeyAndDetune(centsFromRoot: number, rootPitchClass: number): RetunedNote {
  const semitones = Math.round(centsFromRoot / CENTS_PER_SEMITONE);
  return {
    note: rootPitchClass + semitones,
    detuneCents: centsFromRoot - semitones * CENTS_PER_SEMITONE,
  };
}

/**
 * The best degree for `centsFromRoot`, searching only `allowed` degree
 * positions within each octave.
 *
 * The search spans the octave below through the octave above, which is more
 * than enough: the input is at most an octave from a degree in any scale that
 * has one, and the extra range costs a few dozen comparisons on a control-rate
 * path rather than an audio one.
 *
 * **Ties go to the lower candidate.** A note exactly between two degrees has
 * no correct answer, but it must have a *stable* one — otherwise the same note
 * snaps two different ways depending on iteration order, and a pattern changes
 * under you as you edit it.
 */
function bestDegreeCents(
  scale: Scale,
  centsFromRoot: number,
  allowed: readonly number[],
  direction: SnapDirection,
): number {
  const length = scale.cents.length;
  const octave = Math.floor(centsFromRoot / CENTS_PER_OCTAVE);
  let best: number | undefined;
  let bestDistance = Infinity;

  for (let step = octave - 1; step <= octave + 1; step++) {
    for (const position of allowed) {
      const candidate = degreeCents(scale, step * length + position);
      // A hair of tolerance so a candidate that *is* the input is never
      // excluded by floating-point drift in the cents table.
      if (direction === "down" && candidate > centsFromRoot + 1e-6) continue;
      if (direction === "up" && candidate < centsFromRoot - 1e-6) continue;
      const distance = Math.abs(candidate - centsFromRoot);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = candidate;
      }
    }
  }
  // Only reachable if `allowed` were empty, which no caller here does; the
  // input's own pitch is the honest answer rather than a thrown error on a
  // note-scheduling path.
  /* v8 ignore next */
  return best ?? centsFromRoot;
}

/** Snap a MIDI note onto the nearest degree of `scale` in the given key. */
export function snapToScale(
  note: number,
  scale: Scale,
  rootPitchClass: number,
  direction: SnapDirection = "nearest",
): RetunedNote {
  const allowed = scale.cents.map((_, index) => index);
  const centsFromRoot = (note - rootPitchClass) * CENTS_PER_SEMITONE;
  return asKeyAndDetune(bestDegreeCents(scale, centsFromRoot, allowed, direction), rootPitchClass);
}

/**
 * Snap a MIDI note onto a chord tone of `scale` in the given key.
 *
 * A shape naming a degree the scale does not have — a seventh in a pentatonic
 * — is not an error: `degreeCents` treats a scale as a repeating shape, so
 * degree 6 of a five-note scale is the second of the next octave. That is a
 * real pitch and a defensible one, which beats refusing to play the note.
 */
export function snapToChord(
  note: number,
  scale: Scale,
  rootPitchClass: number,
  chord: ChordShape,
  direction: SnapDirection = "nearest",
): RetunedNote {
  const allowed = CHORD_DEGREES[chord] ?? CHORD_DEGREES.triad;
  const centsFromRoot = (note - rootPitchClass) * CENTS_PER_SEMITONE;
  return asKeyAndDetune(bestDegreeCents(scale, centsFromRoot, allowed, direction), rootPitchClass);
}
