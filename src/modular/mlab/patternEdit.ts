/**
 * Editing one voice's pattern on M Pattern's face, and M's Pattern menu
 * commands, all through M Clone's own patterncmd.ts. Like M, any edit to the
 * Original list keeps the Cyclic Random copy a shuffle of what is played.
 */

import {
  doubleWithRests,
  eliminateChords,
  eliminateRests,
  originalToScrambled,
  reScramble,
  reverseOrder,
  rotateBackward,
  rotateForward,
  scrambleSteps,
  swapScrambledAndOriginal,
  transposeSteps,
  tripleWithRests,
} from "../../engine/patterncmd";
import { createDefaultPattern } from "../../engine/project";
import type { Pattern, StepEvent } from "../../engine/types";
import type { VoicePattern } from "./model";

export const MAX_PATTERN_STEPS = 999;

const toEvents = (steps: number[][]): StepEvent[] => steps.map((pitches) => ({ pitches: [...pitches] }));
const fromEvents = (steps: StepEvent[]): number[][] => steps.map((step) => [...step.pitches]);

/** A stable seed from the material itself, so a reshuffle is repeatable. */
const seedOf = (steps: number[][]): number => {
  let hash = 2166136261;
  for (const char of JSON.stringify(steps)) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return hash >>> 0;
};

/** Keep the scrambled copy a shuffle of the played steps, as M does after an edit. */
function withScramble(steps: number[][], length: number): VoicePattern {
  const played = steps.slice(0, length);
  const shuffled = fromEvents(scrambleSteps(toEvents(played), seedOf(played)));
  return { steps, length, scrambled: [...shuffled, ...steps.slice(length).map((s) => [...s])] };
}

export function toggleNote(pattern: VoicePattern, step: number, pitch: number): VoicePattern {
  const steps = pattern.steps.map((s) => [...s]);
  while (steps.length <= step) steps.push([]);
  const notes = steps[step];
  steps[step] = notes.includes(pitch) ? notes.filter((n) => n !== pitch) : [...notes, pitch].sort((a, b) => a - b);
  return withScramble(steps, Math.max(pattern.length, step + 1));
}

export function setPatternLength(pattern: VoicePattern, length: number): VoicePattern {
  const target = Math.max(1, Math.min(MAX_PATTERN_STEPS, Math.round(length)));
  const steps = pattern.steps.map((s) => [...s]);
  while (steps.length < target) steps.push([]);
  return withScramble(steps, target);
}

export const PATTERN_COMMANDS = [
  { id: "rescramble", label: "ReScramble" },
  { id: "original-to-scrambled", label: "Original → Scrambled" },
  { id: "swap", label: "Swap" },
  { id: "transpose-up-half", label: "+1" },
  { id: "transpose-down-half", label: "−1" },
  { id: "transpose-up-octave", label: "+12" },
  { id: "transpose-down-octave", label: "−12" },
  { id: "rotate-forward", label: "Rotate ←" },
  { id: "rotate-backward", label: "Rotate →" },
  { id: "reverse", label: "Reverse" },
  { id: "double", label: "Double" },
  { id: "triple", label: "Triple" },
  { id: "eliminate-chords", label: "No chords" },
  { id: "eliminate-rests", label: "No rests" },
] as const;
export type PatternCommandId = (typeof PATTERN_COMMANDS)[number]["id"];

const asPattern = (pattern: VoicePattern): Pattern => ({
  ...createDefaultPattern("m-lab"),
  steps: toEvents(pattern.steps.slice(0, pattern.length)),
  scrambledSteps: toEvents(pattern.scrambled.slice(0, pattern.length)),
  outputLength: pattern.length,
});

/** One of M's Pattern menu commands, applied to the played steps. */
export function runPatternCommand(pattern: VoicePattern, id: PatternCommandId): VoicePattern {
  const whole = asPattern(pattern);
  const tail = pattern.steps.slice(pattern.length);
  const scrambleCommand = (next: Pattern): VoicePattern => ({
    steps: [...fromEvents(next.steps), ...tail],
    scrambled: [...fromEvents(next.scrambledSteps), ...tail],
    length: pattern.length,
  });
  if (id === "rescramble") return scrambleCommand(reScramble(whole, null, seedOf(pattern.scrambled) + 1));
  if (id === "original-to-scrambled") return scrambleCommand(originalToScrambled(whole, null));
  if (id === "swap") return scrambleCommand(swapScrambledAndOriginal(whole, null));
  const rewrite: Record<Exclude<PatternCommandId, "rescramble" | "original-to-scrambled" | "swap">, (s: StepEvent[]) => StepEvent[]> = {
    "transpose-up-half": (s) => transposeSteps(s, null, 1),
    "transpose-down-half": (s) => transposeSteps(s, null, -1),
    "transpose-up-octave": (s) => transposeSteps(s, null, 12),
    "transpose-down-octave": (s) => transposeSteps(s, null, -12),
    "rotate-forward": (s) => rotateForward(s, null),
    "rotate-backward": (s) => rotateBackward(s, null),
    reverse: (s) => reverseOrder(s, null),
    double: (s) => doubleWithRests(s, null, MAX_PATTERN_STEPS),
    triple: (s) => tripleWithRests(s, null, MAX_PATTERN_STEPS),
    "eliminate-chords": (s) => eliminateChords(s, null, MAX_PATTERN_STEPS),
    "eliminate-rests": (s) => eliminateRests(s, null),
  };
  const played = fromEvents(rewrite[id](whole.steps));
  const length = Math.max(1, Math.min(MAX_PATTERN_STEPS, played.length));
  return withScramble([...played, ...tail].slice(0, Math.max(length, played.length + tail.length)), length);
}

/** Two octaves of rows around the pattern's notes, highest first. */
export function pitchRows(pattern: VoicePattern, rows = 24): number[] {
  const notes = pattern.steps.slice(0, pattern.length).flat();
  const centre = notes.length ? Math.round((Math.min(...notes) + Math.max(...notes)) / 2) : 60;
  const top = Math.max(rows - 1, Math.min(127, centre + Math.floor(rows / 2)));
  return Array.from({ length: rows }, (_, i) => top - i);
}

/**
 * Rows for just the notes the loop plays, two either side, highest first:
 * at least an octave so there is room to add notes, at most two.
 */
export function fitPitchRows(pattern: VoicePattern, pad = 2, min = 12, max = 24): number[] {
  const notes = pattern.steps.slice(0, pattern.length).flat();
  if (!notes.length) return pitchRows(pattern, min);
  let top = Math.min(127, Math.max(...notes) + pad);
  let bottom = Math.max(0, Math.min(...notes) - pad);
  while (top - bottom + 1 < min) { if (top < 127) top += 1; if (top - bottom + 1 < min && bottom > 0) bottom -= 1; }
  if (top - bottom + 1 > max) {
    const centre = Math.round((Math.min(...notes) + Math.max(...notes)) / 2);
    top = Math.min(127, centre + max / 2 - 1);
    bottom = top - max + 1;
  }
  return Array.from({ length: top - bottom + 1 }, (_, i) => top - i);
}
