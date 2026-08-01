// Tests for the Transposition Variable's Note/Octave representation, written
// against chapters 7 and 17 of the M 2.7 manual before the module exists.
// Each block quotes the claim it pins down.

import { describe, it, expect } from "vitest";
import {
  MAX_TRANSPOSE_SEMITONES,
  MIN_TRANSPOSE_SEMITONES,
  TRANSPOSE_NOTES,
  formatTranspose,
  fromNoteOctave,
  stepNote,
  stepOctave,
  toNoteOctave,
} from "./transpose";

describe("the Note numerical", () => {
  it("runs chromatically from C to B", () => {
    expect(TRANSPOSE_NOTES).toEqual([
      "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B",
    ]);
  });
});

describe("C3 is no transposition", () => {
  // "The actual note you're setting is relative to C3, which is defined as no
  //  transposition."
  it("reads zero semitones", () => {
    expect(fromNoteOctave(0, 3)).toBe(0);
  });

  it("displays as C3", () => {
    expect(formatTranspose(0)).toBe("C3");
  });

  it("is where an untransposed Voice sits", () => {
    expect(toNoteOctave(0)).toEqual({ note: 0, octave: 3 });
  });
});

describe("the Note numerical transposes by half steps", () => {
  // "if you were to play C#3 on the keyboard, you would transpose a Voice up
  //  1 half step from C3."
  it("C#3 is one half step up", () => {
    expect(fromNoteOctave(1, 3)).toBe(1);
    expect(formatTranspose(1)).toBe("C#3");
  });

  // "A value of D3 would then transpose your Voice up two half steps."
  it("D3 is two half steps up", () => {
    expect(fromNoteOctave(2, 3)).toBe(2);
  });

  it("covers the whole chromatic octave above C3", () => {
    for (let note = 0; note < 12; note++) {
      expect(fromNoteOctave(note, 3)).toBe(note);
    }
  });
});

describe("the Octave numerical", () => {
  // "The Octave Numerical also refers to a relative position, where octave 3
  //  is the octave of the original Pattern. If the Note Numerical is set to C,
  //  an Octave Numerical value of 4 would transpose the Voice up an octave and
  //  an Octave of 2 would transpose the voice down an octave."
  it("C4 is up an octave", () => {
    expect(fromNoteOctave(0, 4)).toBe(12);
  });

  it("C2 is down an octave", () => {
    expect(fromNoteOctave(0, 2)).toBe(-12);
  });

  it("combines with the note", () => {
    // The screenshot shows Voice 2 at D#4: an octave plus a minor third.
    expect(fromNoteOctave(3, 4)).toBe(15);
    expect(formatTranspose(15)).toBe("D#4");
  });

  it("reads back negative transpositions correctly", () => {
    // A half step down from C3 is B2, not "C-1 minus something".
    expect(toNoteOctave(-1)).toEqual({ note: 11, octave: 2 });
    expect(formatTranspose(-1)).toBe("B2");
    expect(formatTranspose(-12)).toBe("C2");
    expect(formatTranspose(-13)).toBe("B1");
  });
});

describe("round tripping", () => {
  it("survives semitones -> note/octave -> semitones", () => {
    for (let s = MIN_TRANSPOSE_SEMITONES; s <= MAX_TRANSPOSE_SEMITONES; s++) {
      const { note, octave } = toNoteOctave(s);
      expect(fromNoteOctave(note, octave)).toBe(s);
    }
  });

  it("always reports a note inside the chromatic octave", () => {
    for (let s = MIN_TRANSPOSE_SEMITONES; s <= MAX_TRANSPOSE_SEMITONES; s++) {
      const { note } = toNoteOctave(s);
      expect(note).toBeGreaterThanOrEqual(0);
      expect(note).toBeLessThan(12);
    }
  });
});

describe("stepping the Note numerical", () => {
  // "If you keep increasing the Note Numerical, you'll be transposing by half
  //  steps. When you go above the note B, the Octave Numerical will increase
  //  automatically."
  it("carries into the octave when it passes B", () => {
    expect(formatTranspose(stepNote(fromNoteOctave(11, 3), +1))).toBe("C4");
  });

  it("borrows from the octave when it drops below C", () => {
    expect(formatTranspose(stepNote(fromNoteOctave(0, 3), -1))).toBe("B2");
  });

  it("moves a half step at a time within an octave", () => {
    expect(formatTranspose(stepNote(0, +1))).toBe("C#3");
    expect(formatTranspose(stepNote(1, +1))).toBe("D3");
  });

  it("climbs from C3 to C#4 in twelve steps, as the tutorial walks through", () => {
    let value = 0;
    for (let i = 0; i < 13; i++) value = stepNote(value, +1);
    expect(formatTranspose(value)).toBe("C#4");
  });
});

describe("stepping the Octave numerical", () => {
  it("moves a whole octave and leaves the note alone", () => {
    const cSharp4 = fromNoteOctave(1, 4);
    expect(formatTranspose(stepOctave(cSharp4, -1))).toBe("C#3");
    expect(formatTranspose(stepOctave(cSharp4, +1))).toBe("C#5");
  });
});

describe("range", () => {
  it("clamps rather than wrapping at the top", () => {
    expect(stepNote(MAX_TRANSPOSE_SEMITONES, +1)).toBe(MAX_TRANSPOSE_SEMITONES);
    expect(stepOctave(MAX_TRANSPOSE_SEMITONES, +1)).toBe(MAX_TRANSPOSE_SEMITONES);
  });

  it("clamps rather than wrapping at the bottom", () => {
    expect(stepNote(MIN_TRANSPOSE_SEMITONES, -1)).toBe(MIN_TRANSPOSE_SEMITONES);
    expect(stepOctave(MIN_TRANSPOSE_SEMITONES, -1)).toBe(MIN_TRANSPOSE_SEMITONES);
  });

  it("clamps a note/octave pair built outside the range", () => {
    expect(fromNoteOctave(0, 99)).toBe(MAX_TRANSPOSE_SEMITONES);
    expect(fromNoteOctave(0, -99)).toBe(MIN_TRANSPOSE_SEMITONES);
  });

  it("spans whole octaves either side of C3", () => {
    // Math.abs because a negative multiple of 12 gives JS's -0.
    expect(Math.abs(MIN_TRANSPOSE_SEMITONES % 12)).toBe(0);
    expect(Math.abs(MAX_TRANSPOSE_SEMITONES % 12)).toBe(0);
    expect(MIN_TRANSPOSE_SEMITONES).toBeLessThan(0);
    expect(MAX_TRANSPOSE_SEMITONES).toBeGreaterThan(0);
  });
});
