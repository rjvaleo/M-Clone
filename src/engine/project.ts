// Default project factory — pure, so it's easy to test and to reset from.

import type { ProjectState, Pattern, VoiceState } from "./types";

export const STEP_COUNT = 16;
export const VOICE_COUNT = 4;
export const PATTERN_COUNT = 4;

/** A C-major seed riff so the app makes sound the moment you press play. */
const SEED_RIFF = [60, 62, 64, 65, 67, 69, 71, 72];

export function createDefaultPattern(id: string, seedRiff = false): Pattern {
  const steps = Array.from({ length: STEP_COUNT }, (_, i) => ({
    pitches: seedRiff && i < SEED_RIFF.length ? [SEED_RIFF[i]] : [],
  }));
  return { id, steps, outputLength: seedRiff ? SEED_RIFF.length : STEP_COUNT };
}

export function createDefaultVoice(index: number): VoiceState {
  return {
    patternIndex: index,
    playEnabled: index === 0,
    transposition: 0,
    noteOrder: "original",
    density: 1,
    velocity: 100,
    timeBaseNumerator: 1,
    timeBaseDenominator: 8,
    legato: 0.9,
    channel: index + 1,
    program: 0,
  };
}

export function createDefaultProject(): ProjectState {
  return {
    tempo: 120,
    patterns: Array.from({ length: PATTERN_COUNT }, (_, i) =>
      createDefaultPattern(`pattern-${i + 1}`, i === 0),
    ),
    voices: Array.from({ length: VOICE_COUNT }, (_, i) => createDefaultVoice(i)),
    root: 0,
    scale: "major",
    scaleSnap: false,
    seed: 1,
  };
}
