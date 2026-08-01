// The Transposition Variable's Note/Octave numericals.
//
// M expresses transposition as a note you could have played rather than as a
// count of semitones: "The actual note you're setting is relative to C3, which
// is defined as no transposition. This is the same way that Keyboard Transpose
// works in M (and many other programs)." Play C#3 and the Voice goes up a half
// step; set the numericals to C#3 and you get the same thing.
//
// It's relative, not absolute — "If you've made a Pattern in the key of F, a
// value of C3 in the Edit Window would still mean no transposition, and you
// would hear your Voice in F." So the engine keeps storing plain semitones and
// this module is purely the reading of them the edit window presents.

export const TRANSPOSE_NOTES = [
  "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B",
] as const;

/** The octave that means no transposition — the octave of the Pattern itself. */
export const HOME_OCTAVE = 3;

/** Three octaves either side of C3. */
export const MIN_TRANSPOSE_SEMITONES = -36;
export const MAX_TRANSPOSE_SEMITONES = 36;

export type NoteOctave = { note: number; octave: number };

const clamp = (v: number) =>
  Math.max(MIN_TRANSPOSE_SEMITONES, Math.min(MAX_TRANSPOSE_SEMITONES, v));

/**
 * Semitones to the pair the numericals display. Uses floored division so a
 * downward transposition reads the musical way round — a half step below C3 is
 * B2, not C3 with a negative note.
 */
export function toNoteOctave(semitones: number): NoteOctave {
  const s = clamp(Math.round(semitones));
  const note = ((s % 12) + 12) % 12;
  return { note, octave: HOME_OCTAVE + Math.floor(s / 12) };
}

/** The pair back to semitones, clamped to the range the numericals allow. */
export function fromNoteOctave(note: number, octave: number): number {
  return clamp((octave - HOME_OCTAVE) * 12 + note);
}

/** "C3", "D#4", "B2" — what the numericals read. */
export function formatTranspose(semitones: number): string {
  const { note, octave } = toNoteOctave(semitones);
  return `${TRANSPOSE_NOTES[note]}${octave}`;
}

/**
 * Step the Note numerical. "When you go above the note B, the Octave Numerical
 * will increase automatically" — and symmetrically below C it borrows one, so
 * stepping is simply a half step in either direction.
 */
export function stepNote(semitones: number, delta: number): number {
  return clamp(clamp(Math.round(semitones)) + delta);
}

/** Step the Octave numerical, leaving the note where it is. */
export function stepOctave(semitones: number, delta: number): number {
  return clamp(clamp(Math.round(semitones)) + delta * 12);
}
