// The Pattern and Edit menu commands.
//
// "The commands in the Pattern Menu operate on any selected Patterns or
// Regions." Passing `null` for the region here means the whole Pattern.
//
// The distinction that matters against the Variables: "the transpose commands
// change the key of the actual note material inside the Pattern, rather than
// merely playing that material with a pitch offset." Everything in this file
// rewrites material permanently — that is the point of these commands.
//
// All pure, all immutable: the caller owns the store.

import { Rng } from "./rng";
import type { Pattern, StepEvent } from "./types";

export type Region = { from: number; to: number } | null;

const rest = (): StepEvent => ({ pitches: [] });
const copyStep = (s: StepEvent): StepEvent => ({ pitches: [...s.pitches] });
const copySteps = (steps: StepEvent[]): StepEvent[] => steps.map(copyStep);

export function copyPattern(pattern: Pattern): Pattern {
  return {
    ...structuredClone(pattern),
    steps: copySteps(pattern.steps),
    scrambledSteps: copySteps(pattern.scrambledSteps),
  };
}

export function pastePattern(target: Pattern, source: Pattern): Pattern {
  return { ...copyPattern(source), id: target.id };
}

/** Resolve a region to a half-open slice of the steps, clamped to what exists. */
function span(steps: StepEvent[], region: Region): [number, number] {
  if (!region) return [0, steps.length];
  const from = Math.max(0, Math.min(region.from, region.to));
  const to = Math.min(steps.length - 1, Math.max(region.from, region.to));
  return [from, to + 1];
}

/**
 * Shuffle detached copies of the supplied steps. With Don't Scramble Rests,
 * rest positions stay fixed and only sounding steps trade places.
 */
export function scrambleSteps(
  steps: StepEvent[],
  seed: number,
  preserveRests = false,
): StepEvent[] {
  const out = copySteps(steps);
  const movable = out
    .map((step, index) => ({ step, index }))
    .filter(({ step }) => !preserveRests || step.pitches.length > 0);
  const rng = new Rng(seed);
  for (let i = movable.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [movable[i].step, movable[j].step] = [movable[j].step, movable[i].step];
  }
  for (const { step, index } of movable) out[index] = step;
  return out;
}

function patternSpan(pattern: Pattern, region: Region): [number, number] {
  const length = Math.min(pattern.steps.length, pattern.scrambledSteps.length);
  return span(pattern.steps.slice(0, length), region);
}

/** "generates a new Cyclic Random ordering of the selected Pattern or Region." */
export function reScramble(
  pattern: Pattern,
  region: Region,
  seed: number,
  preserveRests = false,
): Pattern {
  const [from, to] = patternSpan(pattern, region);
  const scrambledSteps = copySteps(pattern.scrambledSteps);
  const replacement = scrambleSteps(
    pattern.steps.slice(from, to),
    seed,
    preserveRests,
  );
  scrambledSteps.splice(from, to - from, ...replacement);
  return {
    ...pattern,
    steps: copySteps(pattern.steps),
    scrambledSteps,
    scrambleGeneration: pattern.scrambleGeneration + 1,
  };
}

/** "copies the Original list to the Cyclic Random list." */
export function originalToScrambled(pattern: Pattern, region: Region): Pattern {
  const [from, to] = patternSpan(pattern, region);
  const scrambledSteps = copySteps(pattern.scrambledSteps);
  scrambledSteps.splice(from, to - from, ...copySteps(pattern.steps.slice(from, to)));
  return {
    ...pattern,
    steps: copySteps(pattern.steps),
    scrambledSteps,
    scrambleGeneration: pattern.scrambleGeneration + 1,
  };
}

/** Exchange corresponding Original and Scrambled material. */
export function swapScrambledAndOriginal(
  pattern: Pattern,
  region: Region,
): Pattern {
  const [from, to] = patternSpan(pattern, region);
  const steps = copySteps(pattern.steps);
  const scrambledSteps = copySteps(pattern.scrambledSteps);
  for (let i = from; i < to; i++) {
    [steps[i], scrambledSteps[i]] = [scrambledSteps[i], steps[i]];
  }
  return {
    ...pattern,
    steps,
    scrambledSteps,
    scrambleGeneration: pattern.scrambleGeneration + 1,
  };
}

/** Rebuild the steps with `slice` swapped in for the region. */
function splice(
  steps: StepEvent[],
  region: Region,
  build: (slice: StepEvent[]) => StepEvent[],
): StepEvent[] {
  const [from, to] = span(steps, region);
  return [
    ...steps.slice(0, from).map(copyStep),
    ...build(steps.slice(from, to).map(copyStep)),
    ...steps.slice(to).map(copyStep),
  ];
}

/** Trim to the Pattern Size Numerical — nothing may grow past it. */
const cap = (steps: StepEvent[], maxSize: number) => steps.slice(0, maxSize);

/** Cut and Copy: lift the selection onto the clipboard, detached from the Pattern. */
export function copyRegion(steps: StepEvent[], region: Region): StepEvent[] {
  const [from, to] = span(steps, region);
  return steps.slice(from, to).map(copyStep);
}

/* ===== Pattern menu ===== */

export function transposeSteps(
  steps: StepEvent[],
  region: Region,
  semitones: number,
): StepEvent[] {
  return splice(steps, region, (slice) =>
    slice.map((s) => ({
      pitches: s.pitches.map((p) => Math.max(0, Math.min(127, p + semitones))),
    })),
  );
}

/** "the first step becomes the last step, the second step becomes the first". */
export function rotateForward(steps: StepEvent[], region: Region): StepEvent[] {
  return splice(steps, region, (slice) =>
    slice.length < 2 ? slice : [...slice.slice(1), slice[0]],
  );
}

export function rotateBackward(steps: StepEvent[], region: Region): StepEvent[] {
  return splice(steps, region, (slice) =>
    slice.length < 2 ? slice : [slice[slice.length - 1], ...slice.slice(0, -1)],
  );
}

export function reverseOrder(steps: StepEvent[], region: Region): StepEvent[] {
  return splice(steps, region, (slice) => [...slice].reverse());
}

/** Insert `count` rests after every step in the region. */
function padWithRests(
  steps: StepEvent[],
  region: Region,
  count: number,
  maxSize: number,
): StepEvent[] {
  return cap(
    splice(steps, region, (slice) =>
      slice.flatMap((s) => [s, ...Array.from({ length: count }, rest)]),
    ),
    maxSize,
  );
}

export const doubleWithRests = (s: StepEvent[], r: Region, maxSize: number) =>
  padWithRests(s, r, 1, maxSize);

export const tripleWithRests = (s: StepEvent[], r: Region, maxSize: number) =>
  padWithRests(s, r, 2, maxSize);

/**
 * "turning each step containing a chord into a series of steps, each one
 * containing a note of the chord. The order of the new steps is determined by
 * the order in which you entered the notes of the chord."
 */
export function eliminateChords(
  steps: StepEvent[],
  region: Region,
  maxSize: number,
): StepEvent[] {
  return cap(
    splice(steps, region, (slice) =>
      slice.flatMap((s) =>
        s.pitches.length > 1 ? s.pitches.map((p) => ({ pitches: [p] })) : [s],
      ),
    ),
    maxSize,
  );
}

/** "shrinks the selected Pattern or Region by deleting all rest steps." */
export function eliminateRests(steps: StepEvent[], region: Region): StepEvent[] {
  return splice(steps, region, (slice) =>
    slice.filter((s) => s.pitches.length > 0),
  );
}

/* ===== Edit menu ===== */

/** "removes all notes from a selected Pattern or Region without deleting steps." */
export function changeToRests(steps: StepEvent[], region: Region): StepEvent[] {
  return splice(steps, region, (slice) => slice.map(rest));
}

/**
 * Clear. The manual sets it against Change to Rests, which is explicitly
 * "without deleting steps" — so Clear takes the steps with it.
 */
export function clearSteps(steps: StepEvent[], region: Region): StepEvent[] {
  return splice(steps, region, () => []);
}

/** "fills an entire Pattern, up to its maximum size ... with rests." */
export function fillWithRests(_steps: StepEvent[], maxSize: number): StepEvent[] {
  return Array.from({ length: Math.max(0, maxSize) }, rest);
}

/**
 * Paste. Into a Region the clipboard is truncated — "the number of steps
 * pasted into a Region can't exceed the number of steps already in the Region"
 * — but over a whole Pattern it replaces everything.
 */
export function pasteSteps(
  steps: StepEvent[],
  region: Region,
  clipboard: StepEvent[],
): StepEvent[] {
  if (clipboard.length === 0) return steps.map(copyStep);
  if (!region) return clipboard.map(copyStep);
  return splice(steps, region, (slice) =>
    slice.map((s, i) => (i < clipboard.length ? copyStep(clipboard[i]) : s)),
  );
}

/**
 * Paste Notes: "replaces only the notes of the selected Pattern or Region",
 * leaving the Pattern's length — and everything else about it — alone.
 */
export function pasteNotes(
  steps: StepEvent[],
  region: Region,
  clipboard: StepEvent[],
): StepEvent[] {
  const [from] = span(steps, region);
  return steps.map((s, i) => {
    const at = i - from;
    return at >= 0 && at < clipboard.length ? copyStep(clipboard[at]) : copyStep(s);
  });
}

/** "places all the note information at the end ... increasing the length." */
export function pasteAtEnd(
  steps: StepEvent[],
  clipboard: StepEvent[],
  maxSize: number,
): StepEvent[] {
  return cap([...steps.map(copyStep), ...clipboard.map(copyStep)], maxSize);
}

/** "inserts any steps needed to completely Paste the information." */
export function insertPaste(
  steps: StepEvent[],
  at: number,
  clipboard: StepEvent[],
  maxSize: number,
): StepEvent[] {
  const point = Math.max(0, Math.min(steps.length, at));
  return cap(
    [
      ...steps.slice(0, point).map(copyStep),
      ...clipboard.map(copyStep),
      ...steps.slice(point).map(copyStep),
    ],
    maxSize,
  );
}
