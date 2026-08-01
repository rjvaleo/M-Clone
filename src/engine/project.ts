// Default project factory — pure, so it's easy to test and to reset from.

import type { ProjectState, Pattern, VoiceState } from "./types";
import { neutralTimeMap } from "./timemap";
import { scrambleSteps } from "./patterncmd";

export const STEP_COUNT = 16;
export const VOICE_COUNT = 4;
export const PATTERN_COUNT = 4;
export const CYCLIC_NEUTRAL_LEVEL = 2;
/** Default ceiling of the Pattern Size Numerical, as M shipped it. */
export const DEFAULT_MAX_SIZE = 100;

/** A C-major seed riff so the app makes sound the moment you press play. */
const SEED_RIFF = [60, 62, 64, 65, 67, 69, 71, 72];

export function createDefaultPattern(id: string, seedRiff = false): Pattern {
  const steps = Array.from({ length: STEP_COUNT }, (_, i) => ({
    pitches: seedRiff && i < SEED_RIFF.length ? [SEED_RIFF[i]] : [],
  }));
  const outputLength = seedRiff ? SEED_RIFF.length : STEP_COUNT;
  return {
    id,
    steps,
    scrambledSteps: [
      ...scrambleSteps(steps.slice(0, outputLength), 1),
      ...steps.slice(outputLength).map((step) => ({ pitches: [...step.pitches] })),
    ],
    scrambleGeneration: 0,
    outputLength,
    maxSize: DEFAULT_MAX_SIZE,
    chordMode: "single",
    insertMode: "insert",
    drumMachine: false,
  };
}

export function createDefaultVoice(index: number): VoiceState {
  return {
    patternIndex: index,
    playEnabled: index === 0,
    transposition: 0,
    noteOrderMix: { original: 100, cyclic: 0, utterly: 0 },
    density: 1,
    velocityRange: { low: 48, high: 110 },
    timeBaseNumerator: 1,
    timeBaseDenominator: 8,
    timeDistort: neutralTimeMap(),
    legato: 0.9,
    channel: index + 1,
    outputChannels: [index + 1],
    program: 0,
  };
}

export function createDefaultProject(): ProjectState {
  const neutralCycle = () =>
    Array.from({ length: VOICE_COUNT }, () =>
      Array(STEP_COUNT).fill(CYCLIC_NEUTRAL_LEVEL),
    );
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
    diatonicTranspose: false,
    secondOrderTranspose: false,
    chordTones: false,
    cyclic: {
      accent: neutralCycle(),
      legato: neutralCycle(),
      rhythm: neutralCycle(),
    },
    cyclicLengths: {
      accent: Array(VOICE_COUNT).fill(STEP_COUNT),
      legato: Array(VOICE_COUNT).fill(STEP_COUNT),
      rhythm: Array(VOICE_COUNT).fill(STEP_COUNT),
    },
    cyclicValues: {
      legato: [13, 18, 33, 69, 100],
      rhythm: [1, 1, 1.5, 2, 5],
    },
  };
}
