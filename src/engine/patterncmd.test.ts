// Tests for the Pattern and Edit menu commands, written against chapters 5, 20
// and 21 of the M 2.7 manual before the module exists. Each block quotes the
// sentence it pins down.
//
// Every command operates "on any selected Patterns or Regions" — passing null
// for the region means the whole Pattern.

import { describe, it, expect } from "vitest";
import {
  changeToRests,
  copyRegion,
  clearSteps,
  doubleWithRests,
  eliminateChords,
  eliminateRests,
  fillWithRests,
  insertPaste,
  pasteAtEnd,
  pasteNotes,
  pasteSteps,
  reverseOrder,
  rotateBackward,
  rotateForward,
  originalToScrambled,
  reScramble,
  swapScrambledAndOriginal,
  transposeSteps,
  tripleWithRests,
} from "./patterncmd";
import type { Pattern, StepEvent } from "./types";

/** "60 . 64 67" style shorthand — a dot is a rest, spaces separate chords. */
const S = (spec: string): StepEvent[] =>
  spec.split(/\s*\|\s*/).map((cell) => ({
    pitches: cell === "." ? [] : cell.split(/\s+/).map(Number),
  }));

const show = (steps: StepEvent[]): string =>
  steps.map((s) => (s.pitches.length ? s.pitches.join(" ") : ".")).join(" | ");

const scale = () => S("60 | 62 | 64 | 65");

const P = (original: string, scrambled: string): Pattern => ({
  id: "p",
  steps: S(original),
  scrambledSteps: S(scrambled),
  scrambleGeneration: 0,
  outputLength: S(original).length,
  maxSize: 100,
  chordMode: "single",
  insertMode: "insert",
  drumMachine: false,
});

describe("Cyclic Random Pattern commands", () => {
  // "This command generates a new Cyclic Random ordering of the selected
  // Pattern or Region."
  it("ReScramble changes only the stored Scrambled list", () => {
    const input = P("60 | 62 | 64 | 65", "60 | 62 | 64 | 65");
    const out = reScramble(input, null, 42);
    expect(show(out.steps)).toBe("60 | 62 | 64 | 65");
    expect(show(out.scrambledSteps)).not.toBe(show(input.scrambledSteps));
    expect([...out.scrambledSteps].flatMap((s) => s.pitches).sort((a, b) => a - b))
      .toEqual([60, 62, 64, 65]);
    expect(out.scrambleGeneration).toBe(1);
    expect(show(input.scrambledSteps)).toBe("60 | 62 | 64 | 65");
  });

  it("ReScramble affects only the selected Region", () => {
    const input = P("60 | 62 | 64 | 65", "60 | 62 | 64 | 65");
    const out = reScramble(input, { from: 1, to: 3 }, 42);
    expect(out.scrambledSteps[0].pitches).toEqual([60]);
    expect(show(out.scrambledSteps.slice(1))).not.toBe("62 | 64 | 65");
    expect(out.scrambledSteps.slice(1).flatMap((s) => s.pitches).sort((a, b) => a - b))
      .toEqual([62, 64, 65]);
  });

  it("accepts reversed Region endpoints and copies a one-step Region as-is", () => {
    const input = P("60 | 62 | 64", "70 | 71 | 72");
    const reversed = reScramble(input, { from: 2, to: 1 }, 42);
    expect(reversed.scrambledSteps[0].pitches).toEqual([70]);
    expect(show(reScramble(input, { from: 1, to: 1 }, 42).scrambledSteps))
      .toBe("70 | 62 | 72");
  });

  // "Don't Scramble Rests ... preserves the location of rests in the Cyclic
  // Random ordering when a reordering operation is performed."
  it("can preserve rest positions while scrambling notes and chords", () => {
    const input = P("60 | . | 62 65 | 64", "60 | . | 62 65 | 64");
    const out = reScramble(input, null, 42, true);
    expect(out.scrambledSteps[1].pitches).toEqual([]);
    expect(out.scrambledSteps.filter((s) => s.pitches.length > 0)
      .flatMap((s) => s.pitches).sort((a, b) => a - b))
      .toEqual([60, 62, 64, 65]);
  });

  // "This command copies the Original list to the Cyclic Random list."
  it("Original → Scrambled copies the whole Original list without aliasing", () => {
    const input = P("60 | 62 | 64", "70 | 71 | 72");
    const out = originalToScrambled(input, null);
    expect(show(out.scrambledSteps)).toBe("60 | 62 | 64");
    expect(out.scrambledSteps).not.toBe(out.steps);
    expect(out.scrambledSteps[0]).not.toBe(out.steps[0]);
    expect(out.scrambleGeneration).toBe(1);
  });

  it("Original → Scrambled copies only the corresponding Region", () => {
    const out = originalToScrambled(
      P("60 | 62 | 64 | 65", "70 | 71 | 72 | 73"),
      { from: 1, to: 2 },
    );
    expect(show(out.scrambledSteps)).toBe("70 | 62 | 64 | 73");
  });

  // "This command exchanges the list created by the Cyclic Random
  // ('scrambled') ordering of notes with the Original list."
  it("Swap exchanges the complete Original and Scrambled lists", () => {
    const input = P("60 | 62 | 64", "70 | 71 | 72");
    const out = swapScrambledAndOriginal(input, null);
    expect(show(out.steps)).toBe("70 | 71 | 72");
    expect(show(out.scrambledSteps)).toBe("60 | 62 | 64");
    expect(out.scrambleGeneration).toBe(1);
  });

  // "If operating on a Region, only the notes in the Region of the Original
  // and Scrambled lists in the region are exchanged."
  it("Swap exchanges only corresponding Region steps", () => {
    const out = swapScrambledAndOriginal(
      P("60 | 62 | 64 | 65", "70 | 71 | 72 | 73"),
      { from: 1, to: 2 },
    );
    expect(show(out.steps)).toBe("60 | 71 | 72 | 65");
    expect(show(out.scrambledSteps)).toBe("70 | 62 | 64 | 73");
  });

  it("Swap is its own inverse and never mutates its input", () => {
    const input = P("60 | 62 | 64", "70 | 71 | 72");
    const twice = swapScrambledAndOriginal(
      swapScrambledAndOriginal(input, { from: 0, to: 1 }),
      { from: 0, to: 1 },
    );
    expect(show(twice.steps)).toBe(show(input.steps));
    expect(show(twice.scrambledSteps)).toBe(show(input.scrambledSteps));
    expect(show(input.steps)).toBe("60 | 62 | 64");
  });
});

describe("Transpose commands", () => {
  // "These commands will permanently transpose a selected Pattern or Region by
  //  the specified amount." — as against the Variable, which is an offset.
  it("transposes the whole Pattern up a half step", () => {
    expect(show(transposeSteps(scale(), null, 1))).toBe("61 | 63 | 65 | 66");
  });

  it("transposes down a half step", () => {
    expect(show(transposeSteps(scale(), null, -1))).toBe("59 | 61 | 63 | 64");
  });

  it("transposes up and down an octave", () => {
    expect(show(transposeSteps(scale(), null, 12))).toBe("72 | 74 | 76 | 77");
    expect(show(transposeSteps(scale(), null, -12))).toBe("48 | 50 | 52 | 53");
  });

  it("touches only the selected Region", () => {
    expect(show(transposeSteps(scale(), { from: 1, to: 2 }, 12)))
      .toBe("60 | 74 | 76 | 65");
  });

  it("leaves rests as rests", () => {
    expect(show(transposeSteps(S("60 | . | 64"), null, 2))).toBe("62 | . | 66");
  });

  it("transposes every note of a chord", () => {
    expect(show(transposeSteps(S("60 64 67"), null, 1))).toBe("61 65 68");
  });

  it("keeps notes inside the MIDI range", () => {
    expect(transposeSteps(S("127"), null, 12)[0].pitches[0]).toBeLessThanOrEqual(127);
    expect(transposeSteps(S("0"), null, -12)[0].pitches[0]).toBeGreaterThanOrEqual(0);
  });

  it("does not mutate the steps it was given", () => {
    const original = scale();
    transposeSteps(original, null, 5);
    expect(show(original)).toBe("60 | 62 | 64 | 65");
  });
});

describe("Rotate Forward and Backward", () => {
  // "the first step in the Pattern becomes the last step, the second step
  //  becomes the first step, the third step becomes the second step"
  it("rotates forward by one step", () => {
    expect(show(rotateForward(scale(), null))).toBe("62 | 64 | 65 | 60");
  });

  it("rotates backward by one step", () => {
    expect(show(rotateBackward(scale(), null))).toBe("65 | 60 | 62 | 64");
  });

  // "if you performed a Rotate Forward followed by a Rotate Backward, you'd end
  //  up with your original Pattern again."
  it("round trips", () => {
    expect(show(rotateBackward(rotateForward(scale(), null), null)))
      .toBe(show(scale()));
  });

  it("rotates only within the Region", () => {
    expect(show(rotateForward(scale(), { from: 1, to: 3 })))
      .toBe("60 | 64 | 65 | 62");
  });

  it("leaves a single step alone", () => {
    expect(show(rotateForward(S("60"), null))).toBe("60");
    expect(show(rotateBackward(S("60"), null))).toBe("60");
  });
});

describe("Reverse Order", () => {
  // "This command reverses the notes in the Pattern or Region."
  it("reverses the whole Pattern", () => {
    expect(show(reverseOrder(scale(), null))).toBe("65 | 64 | 62 | 60");
  });

  it("reverses only the Region", () => {
    expect(show(reverseOrder(scale(), { from: 0, to: 1 })))
      .toBe("62 | 60 | 64 | 65");
  });
});

describe("Double and Triple with Rests", () => {
  // "expands the Pattern or Region by inserting a rest after each step"
  it("puts one rest after every step", () => {
    expect(show(doubleWithRests(scale(), null, 999)))
      .toBe("60 | . | 62 | . | 64 | . | 65 | .");
  });

  // "expands the Pattern or Region by inserting two rests after each step"
  it("puts two rests after every step", () => {
    expect(show(tripleWithRests(S("60 | 62"), null, 999)))
      .toBe("60 | . | . | 62 | . | .");
  });

  it("expands only the Region, leaving the rest of the Pattern in place", () => {
    expect(show(doubleWithRests(scale(), { from: 0, to: 1 }, 999)))
      .toBe("60 | . | 62 | . | 64 | 65");
  });

  // "When you use Double With Rests, Triple With Rests, or Eliminate Chords,
  //  the length of the Pattern is increased automatically."
  it("grows the Pattern", () => {
    expect(doubleWithRests(scale(), null, 999)).toHaveLength(8);
    expect(tripleWithRests(scale(), null, 999)).toHaveLength(12);
  });

  it("never grows past the Pattern Size Numerical", () => {
    expect(doubleWithRests(scale(), null, 6)).toHaveLength(6);
  });
});

describe("Eliminate Chords", () => {
  // "turning each step containing a chord into a series of steps, each one
  //  containing a note of the chord. The order of the new steps is determined
  //  by the order in which you entered the notes of the chord."
  it("spreads a chord across consecutive steps in entry order", () => {
    expect(show(eliminateChords(S("60 64 67"), null, 999))).toBe("60 | 64 | 67");
  });

  it("leaves single notes and rests untouched", () => {
    expect(show(eliminateChords(S("60 | . | 62"), null, 999))).toBe("60 | . | 62");
  });

  it("expands the Pattern's length", () => {
    expect(eliminateChords(S("60 64 | 67 69 71"), null, 999)).toHaveLength(5);
  });

  it("works within a Region", () => {
    expect(show(eliminateChords(S("60 64 | 67 69"), { from: 1, to: 1 }, 999)))
      .toBe("60 64 | 67 | 69");
  });

  it("never grows past the Pattern Size Numerical", () => {
    expect(eliminateChords(S("60 64 67 69"), null, 2)).toHaveLength(2);
  });
});

describe("Eliminate Rests", () => {
  // "shrinks the selected Pattern or Region by deleting all rest steps."
  it("drops every rest", () => {
    expect(show(eliminateRests(S("60 | . | 62 | . | ."), null))).toBe("60 | 62");
  });

  // "a way to undo an unfortunate choice of Double With Rests"
  it("undoes Double with Rests", () => {
    expect(show(eliminateRests(doubleWithRests(scale(), null, 999), null)))
      .toBe(show(scale()));
  });

  it("drops rests only inside the Region", () => {
    expect(show(eliminateRests(S("60 | . | 62 | ."), { from: 0, to: 1 })))
      .toBe("60 | 62 | .");
  });
});

describe("Change to Rests", () => {
  // "removes all notes from a selected Pattern or Region without deleting
  //  steps." — "For Regions, it's identical to using the Eraser."
  it("empties the steps but keeps them", () => {
    const out = changeToRests(scale(), null);
    expect(show(out)).toBe(". | . | . | .");
    expect(out).toHaveLength(4);
  });

  it("empties only the Region", () => {
    expect(show(changeToRests(scale(), { from: 1, to: 2 })))
      .toBe("60 | . | . | 65");
  });
});

describe("Clear", () => {
  // "Clear deletes the notes in the selected Pattern or Region." Set against
  // Change to Rests, which is explicitly "without deleting steps", Clear takes
  // the steps with it.
  it("removes the steps of a Region", () => {
    expect(show(clearSteps(scale(), { from: 1, to: 2 }))).toBe("60 | 65");
  });

  it("empties the whole Pattern", () => {
    expect(clearSteps(scale(), null)).toHaveLength(0);
  });
});

describe("Fill With Rests", () => {
  // "fills the entire Pattern, up to its maximum size (as indicated by the
  //  Pattern Size Numerical), with rests" and "doesn't care whether you have a
  //  Region or Pattern selected. It obliterates everything in its path."
  it("fills to the Size Numerical", () => {
    expect(fillWithRests(scale(), 10)).toHaveLength(10);
  });

  it("leaves nothing but rests", () => {
    expect(fillWithRests(scale(), 5).every((s) => s.pitches.length === 0)).toBe(true);
  });
});

describe("Copy and Cut", () => {
  // Cut and Copy put the selection on the clipboard; Cut then clears it.
  it("copies the whole Pattern when nothing is selected", () => {
    expect(show(copyRegion(scale(), null))).toBe(show(scale()));
  });

  it("copies just the Region", () => {
    expect(show(copyRegion(scale(), { from: 1, to: 2 }))).toBe("62 | 64");
  });

  it("hands back a detached copy, not a view of the Pattern", () => {
    const steps = scale();
    const clip = copyRegion(steps, null);
    clip[0].pitches.push(99);
    expect(show(steps)).toBe("60 | 62 | 64 | 65");
  });

  it("copies nothing from an empty Pattern", () => {
    expect(copyRegion([], null)).toEqual([]);
  });
});

describe("Paste", () => {
  const clip = () => S("70 | 71 | 72");

  // "The number of steps pasted into a Region can't exceed the number of steps
  //  already in the Region."
  it("truncates to the size of the Region", () => {
    expect(show(pasteSteps(scale(), { from: 1, to: 2 }, clip())))
      .toBe("60 | 70 | 71 | 65");
  });

  // "If, however, you select the entire Pattern and then paste, the entire
  //  Clipboard contents will be pasted regardless."
  it("replaces the whole Pattern outright", () => {
    expect(show(pasteSteps(scale(), null, clip()))).toBe("70 | 71 | 72");
  });

  it("leaves the tail of an over-long Region as it was", () => {
    // A two-step clipboard into a four-step Region fills the first two only.
    expect(show(pasteSteps(scale(), { from: 0, to: 3 }, S("70 | 71"))))
      .toBe("70 | 71 | 64 | 65");
  });

  it("does nothing with an empty clipboard", () => {
    expect(show(pasteSteps(scale(), { from: 0, to: 1 }, []))).toBe(show(scale()));
  });
});

describe("Paste Notes", () => {
  // "replaces only the notes of the selected Pattern or Region", leaving the
  // Pattern's length alone.
  it("overwrites notes without changing the length", () => {
    const out = pasteNotes(scale(), null, S("70 | 71"));
    expect(show(out)).toBe("70 | 71 | 64 | 65");
    expect(out).toHaveLength(4);
  });

  it("starts at the Region", () => {
    expect(show(pasteNotes(scale(), { from: 2, to: 3 }, S("70 | 71"))))
      .toBe("60 | 62 | 70 | 71");
  });
});

describe("Paste at End", () => {
  // "places all the note information at the end of the selected Pattern,
  //  increasing the Pattern's length."
  it("appends the clipboard", () => {
    expect(show(pasteAtEnd(S("60 | 62"), S("70 | 71"), 999)))
      .toBe("60 | 62 | 70 | 71");
  });

  it("stops at the Pattern Size Numerical", () => {
    expect(pasteAtEnd(S("60 | 62"), S("70 | 71"), 3)).toHaveLength(3);
  });
});

describe("Insert Paste", () => {
  // "inserts any steps needed to completely Paste the information" and is "the
  //  only editing command that works with a Pointwise Selection".
  it("pushes the clipboard in at the insertion point", () => {
    expect(show(insertPaste(scale(), 2, S("70 | 71"), 999)))
      .toBe("60 | 62 | 70 | 71 | 64 | 65");
  });

  it("inserts at the very start", () => {
    expect(show(insertPaste(S("60"), 0, S("70"), 999))).toBe("70 | 60");
  });

  it("stops at the Pattern Size Numerical", () => {
    expect(insertPaste(scale(), 0, S("70 | 71 | 72"), 5)).toHaveLength(5);
  });
});
