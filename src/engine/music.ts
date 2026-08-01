// Musical helpers: note names, scales, and scale-snapping (the "key sensing" guardrail).

export const NOTE_NAMES = [
  "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B",
] as const;

export type ScaleName =
  | "chromatic"
  | "major"
  | "minor"
  | "dorian"
  | "mixolydian"
  | "lydian"
  | "phrygian"
  | "harmonicMinor"
  | "majorPentatonic"
  | "minorPentatonic"
  | "blues";

// Scale degrees as semitone offsets from the root.
export const SCALES: Record<ScaleName, number[]> = {
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  harmonicMinor: [0, 2, 3, 5, 7, 8, 11],
  majorPentatonic: [0, 2, 4, 7, 9],
  minorPentatonic: [0, 3, 5, 7, 10],
  blues: [0, 3, 5, 6, 7, 10],
};

export function midiToName(note: number): string {
  const octave = Math.floor(note / 12) - 1;
  return `${NOTE_NAMES[((note % 12) + 12) % 12]}${octave}`;
}

/**
 * Snap a MIDI note into the given key/scale (the modern "key-sensing" guardrail).
 * Finds the nearest scale tone; ties resolve downward.
 */
export function snapToScale(note: number, root: number, scale: ScaleName): number {
  const degrees = SCALES[scale];
  if (degrees.length === 12) return note; // chromatic: no change
  const pc = ((note % 12) + 12) % 12;
  const rootPc = ((root % 12) + 12) % 12;
  const rel = ((pc - rootPc) + 12) % 12;

  let best = degrees[0];
  let bestDist = 99;
  for (const d of degrees) {
    const dist = Math.min(Math.abs(rel - d), 12 - Math.abs(rel - d));
    if (dist < bestDist) {
      bestDist = dist;
      best = d;
    }
  }
  // Reconstruct the absolute note nearest to the original. `delta` is the
  // signed pitch-class distance folded into [-6, 5] (ties resolve downward),
  // so the result is always within a semitone-tritone of the input.
  const targetPc = (rootPc + best) % 12;
  const delta = (((targetPc - pc + 6) % 12) + 12) % 12 - 6;
  return note + delta;
}

/**
 * Diatonic (scale-aware) transposition: move `steps` scale degrees, folding
 * through the key so a "third" bends major/minor to stay in the scale. In
 * chromatic, steps are plain semitones.
 */
export function diatonicTranspose(
  note: number,
  root: number,
  scale: ScaleName,
  steps: number,
): number {
  const degrees = SCALES[scale];
  if (degrees.length === 12) return note + steps;
  const rootPc = ((root % 12) + 12) % 12;
  const snapped = snapToScale(note, root, scale);
  const relPc = ((snapped - rootPc) % 12 + 12) % 12;
  const di = degrees.indexOf(relPc);
  const len = degrees.length;
  const total = di + steps;
  const octave = Math.floor(total / len);
  const wrapped = ((total % len) + len) % len;
  return snapped - relPc + degrees[wrapped] + 12 * octave;
}

/**
 * Chord-tone targeting: snap a note to the nearest tone of the key's tonic
 * triad (1st/3rd/5th scale degrees; a major triad in chromatic). A simple
 * "lean into the chord" guardrail — progression-aware chords come later.
 */
export function snapToChord(note: number, root: number, scale: ScaleName): number {
  const degrees = SCALES[scale];
  const chord =
    degrees.length === 12 ? [0, 4, 7] : [degrees[0], degrees[2], degrees[4]];
  const rootPc = ((root % 12) + 12) % 12;
  const pc = ((note % 12) + 12) % 12;
  const rel = ((pc - rootPc) + 12) % 12;

  let best = chord[0];
  let bestDist = 99;
  for (const d of chord) {
    const dist = Math.min(Math.abs(rel - d), 12 - Math.abs(rel - d));
    if (dist < bestDist) {
      bestDist = dist;
      best = d;
    }
  }
  const targetPc = (rootPc + best) % 12;
  const delta = (((targetPc - pc + 6) % 12) + 12) % 12 - 6;
  return note + delta;
}

export function clampMidi(note: number): number {
  return Math.max(0, Math.min(127, Math.round(note)));
}
