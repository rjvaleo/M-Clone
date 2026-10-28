// One voice, one step: the two halves of M's step logic, pulled out of the
// planner so the canvas modules can run them too.
//
// `cyclePicks` is the Cyclic Variables: which cell each cycle reads, the level
// it picks, and the counters advanced for the next step. `playStep` is the
// rest: Note Order, Note Density, pitch and velocity. The planner calls both
// in this order with one random generator per voice, which keeps M's draw
// order — accent, legato, rhythm, then order, then density — and so every
// seeded performance plays exactly as it always has.

import type {
  CyclicStep,
  CyclicVariable,
  NoteOrderCursor,
  StepEvent,
  VoiceState,
} from "./types";
import type { Rng } from "./rng";
import type { ScaleName } from "./music";
import { pickCyclicLevel } from "./cyclic";
import { nextMixedStepIndex, gate, velocityForAccent } from "./transform";
import { snapToScale, snapToChord, diatonicTranspose, clampMidi } from "./music";

export type CyclicCounters = Record<CyclicVariable, number>;

/** One voice's three cycles, their lengths, and the values their levels mean. */
export type VoiceCycles = {
  cells: Record<CyclicVariable, readonly CyclicStep[]>;
  lengths: Record<CyclicVariable, number>;
  values: { legato: readonly number[]; rhythm: readonly number[] };
};

export type CyclePicks = {
  /** The cell each cycle read on this step. */
  cells: CyclicCounters;
  accentLevel: number;
  /** Note length as a fraction of the time to the next step. */
  legato: number;
  /** The step's length as a multiple of the voice's time base. */
  rhythm: number;
  /** The counters for the next step, each wrapped at its own length. */
  next: CyclicCounters;
  /** The Rhythm cycle, longer than one cell, began again on this step. */
  rhythmRestarted: boolean;
};

export const cycleLength = (lengths: Record<CyclicVariable, number>, kind: CyclicVariable): number =>
  Math.max(1, Math.min(16, lengths[kind]));

/**
 * The cell a counter reads. A counter left past the end of a cycle that has
 * since been shortened starts again from the first cell, as M does.
 */
const cellFor = (cycles: VoiceCycles, kind: CyclicVariable, counter: number): number =>
  counter >= cycleLength(cycles.lengths, kind) ? 0 : counter;

export function cyclePicks(cycles: VoiceCycles, counters: CyclicCounters, rng: Rng): CyclePicks {
  const cells = {
    accent: cellFor(cycles, "accent", counters.accent),
    legato: cellFor(cycles, "legato", counters.legato),
    rhythm: cellFor(cycles, "rhythm", counters.rhythm),
  };
  const level = (kind: CyclicVariable) => pickCyclicLevel(cycles.cells[kind][cells[kind]], rng);
  const accentLevel = level("accent");
  const legato = cycles.values.legato[level("legato")] / 100;
  const rhythm = cycles.values.rhythm[level("rhythm")];
  const advance = (kind: CyclicVariable) => (cells[kind] + 1) % cycleLength(cycles.lengths, kind);
  return {
    cells,
    accentLevel,
    legato,
    rhythm,
    next: { accent: advance("accent"), legato: advance("legato"), rhythm: advance("rhythm") },
    rhythmRestarted: cells.rhythm === 0 && cycleLength(cycles.lengths, "rhythm") > 1,
  };
}

export type StepVoice = Pick<
  VoiceState,
  "noteOrderMix" | "density" | "velocityRange" | "transposition" | "legato" | "playEnabled"
>;

export type StepHarmony = {
  root: number;
  scale: ScaleName;
  scaleSnap: boolean;
  diatonicTranspose?: boolean;
  chordTones?: boolean;
};

export type StepPattern = {
  steps: readonly StepEvent[];
  scrambledSteps: readonly StepEvent[];
  outputLength: number;
};

/** What a voice carries from one step to the next. */
export type StepState = { order: NoteOrderCursor; holdNext: boolean };

export type PlayedStep = {
  index: number;
  source: "original" | "cyclic" | "utterly";
  /** The voice is enabled, so this step counts (it may still be silent). */
  played: boolean;
  sounds: boolean;
  /** Final MIDI notes; empty when silent. */
  pitches: number[];
  velocity: number;
  /** Note length as a multiple of the time to the next step. */
  lengthFactor: number;
  next: StepState;
};

export function playStep(
  voice: StepVoice,
  pattern: StepPattern,
  harmony: StepHarmony,
  state: StepState,
  accentLevel: number,
  cycleLegato: number,
  velocityOffset: number,
  rng: Rng,
): PlayedStep {
  const outLen = Math.min(pattern.outputLength, pattern.steps.length);
  if (outLen <= 0) {
    return {
      index: 0, source: "original", played: false, sounds: false, pitches: [], velocity: 0,
      lengthFactor: 0, next: state,
    };
  }
  const accented = velocityForAccent(voice.velocityRange, accentLevel);
  const velocity = accented > 0 && velocityOffset
    ? Math.max(1, Math.min(127, accented + velocityOffset))
    : accented;
  // A muted voice keeps reading its pattern, so turning it back on finds it in phase.
  const r = nextMixedStepIndex(voice.noteOrderMix, state.order, outLen, rng);
  const base = { index: r.index, source: r.source, velocity };
  if (!voice.playEnabled) {
    return { ...base, played: false, sounds: false, pitches: [], lengthFactor: 0,
      next: { order: r.cursor, holdNext: state.holdNext } };
  }
  const patternStep = (r.source === "cyclic" ? pattern.scrambledSteps : pattern.steps)[r.index];
  // Note Density, as M plays it: a slot whose draw fails still sounds, held
  // through the next slot, and that next slot is the silent one. At 0 nothing
  // sounds, which is what the manual promises.
  let sounds = false;
  let held = false;
  let holdNext = state.holdNext;
  if (velocity > 0 && patternStep.pitches.length > 0) {
    const passed = gate(voice.density, rng);
    sounds = !holdNext && (passed || voice.density > 0);
    held = !passed;
    holdNext = !passed;
  } else {
    holdNext = false;
  }
  const pitches = sounds ? patternStep.pitches.map((p) => {
    let n = harmony.diatonicTranspose
      ? diatonicTranspose(p, harmony.root, harmony.scale, voice.transposition)
      : p + voice.transposition;
    if (harmony.scaleSnap) n = snapToScale(n, harmony.root, harmony.scale);
    if (harmony.chordTones) n = snapToChord(n, harmony.root, harmony.scale);
    return clampMidi(n);
  }) : [];
  return {
    ...base,
    played: true,
    sounds,
    pitches,
    lengthFactor: sounds ? voice.legato * cycleLegato + (held ? 1 : 0) : 0,
    next: { order: r.cursor, holdNext },
  };
}
