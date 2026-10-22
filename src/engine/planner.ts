// The step planner: given project state, per-voice cursors, and a time window,
// produce the notes to schedule and the advanced cursors. This is the pure,
// fully-tested heart of the engine — no audio, no timers, no DOM.

import type { ProjectState, NoteOrderCursor, CyclicVariable } from "./types";
import { Rng } from "./rng";
import {
  stepDurationSeconds,
  nextMixedStepIndex,
  gate,
  velocityForAccent,
} from "./transform";
import { snapToScale, snapToChord, diatonicTranspose, clampMidi } from "./music";
import { distortClockSeconds } from "./timemap";
import { pickCyclicLevel } from "./cyclic";

export type PlannedNote = {
  voice: number;
  note: number;
  velocity: number;
  channel: number;
  startSec: number; // AudioContext time domain
  durationSec: number;
  /** Absolute musical position on the shared 960 PPQN transport timeline. */
  atTick?: number;
  durationTicks?: number;
  /**
   * Which of the three Note Order lists this step was drawn from.
   *
   * `nextMixedStepIndex` has always decided this and the planner used it to
   * choose a list and then dropped it. Carrying it lets the readout colour a
   * note by where it came from, which is the only way to see the Note Order
   * mix actually working rather than inferring it from the slider.
   */
  source?: "original" | "cyclic" | "utterly";
  /**
   * The Rhythm variable's multiplier for this voice on this step.
   *
   * It is the voice's clock divider: the planner scales both the step's
   * duration and its advance by it, so a voice at 0.5 takes steps twice as
   * often as one at 1.0. Carried out so a display can give each lane its own
   * rate instead of pretending every voice moves at the same speed.
   */
  rhythm?: number;
};
export type PlannedStep = { voice: number; step: number };

export const PPQN = 960;

/**
 * One counter per Cyclic Variable. M keeps them separate and wraps each at its
 * own cycle length, which is what lets cycles of different lengths phase
 * against each other: a 3-step Accent over a 4-step Legato repeats every 12.
 */
export type CyclicCounters = Record<CyclicVariable, number>;

export type VoiceCursor = {
  order: NoteOrderCursor;
  /** Real time of the next event — what actually gets scheduled. */
  nextTimeSec: number;
  /** Absolute time this voice's clock started, the origin of its time map. */
  originSec: number;
  /**
   * Undistorted clock time elapsed since `originSec`. Steps advance this
   * evenly; Time Distortion decides where that lands in real time.
   */
  clockSec: number;
  cyclicPos: CyclicCounters;
  transportTick: number;
  /** The last slot's density draw failed, so this slot is held over and silent. */
  holdNext: boolean;
};

const cycleLength = (state: ProjectState, kind: CyclicVariable, voice: number): number =>
  Math.max(1, Math.min(16, state.cyclicLengths[kind][voice]));

/**
 * The step a counter reads. A counter left past the end of a cycle that has
 * since been shortened starts again from the first step, as M does.
 */
const cycleStep = (state: ProjectState, kind: CyclicVariable, voice: number, counter: number): number =>
  counter >= cycleLength(state, kind, voice) ? 0 : counter;

function cyclicLevel(
  state: ProjectState,
  kind: CyclicVariable,
  voice: number,
  step: number,
  rng: Rng,
): number {
  return pickCyclicLevel(state.cyclic[kind][voice][step], rng);
}

function cyclicMultiplier(
  state: ProjectState,
  kind: "legato" | "rhythm",
  voice: number,
  step: number,
  rng: Rng,
): number {
  const value = state.cyclicValues[kind][cyclicLevel(state, kind, voice, step, rng)];
  return kind === "legato" ? value / 100 : value;
}

/** One fresh cursor per voice, all starting at `startSec`. */
export function makeCursors(state: ProjectState, startSec: number): VoiceCursor[] {
  return state.voices.map((voice) => {
    const phase = Math.max(0, voice.phase);
    const phaseSec = phase * (60 / state.tempo) / 96;
    return {
      order: { pos: 0, last: -1, bval: 0.5 },
      nextTimeSec: startSec + phaseSec,
      originSec: startSec + phaseSec,
      clockSec: 0,
      cyclicPos: { accent: 0, legato: 0, rhythm: 0 },
      transportTick: Math.round(phase * PPQN / 96),
      holdNext: false,
    };
  });
}

/**
 * Plan every note that begins within [windowStart, windowEnd) for all voices.
 * `windowStart` is unused directly — each voice carries its own `nextTimeSec`,
 * which is where playback actually resumes — but it documents the caller's
 * scheduling window.
 */
export function planWindow(
  state: ProjectState,
  cursors: VoiceCursor[],
  rng: Rng | readonly Rng[],
  _windowStart: number,
  windowEnd: number,
): {
  notes: PlannedNote[];
  cursors: VoiceCursor[];
  steps: PlannedStep[];
  /** Voices whose Rhythm cycle (of more than one step) began again in this window. */
  cyclicResets: number[];
} {
  const notes: PlannedNote[] = [];
  const steps: PlannedStep[] = [];
  const nextCursors: VoiceCursor[] = [];
  const cyclicResets: number[] = [];

  state.voices.forEach((v, vi) => {
    const voiceRng = Array.isArray(rng) ? rng[vi] : rng as Rng;
    const cursor = cursors[vi];
    if (v.timeBaseDenominator <= 0 || v.mouseAdvance) {
      nextCursors.push(cursor); // `sa`: advanced only by Input Control
      return;
    }
    const pat = state.patterns[v.patternIndex];
    const outLen = Math.min(pat.outputLength, pat.steps.length);
    const stepDur = stepDurationSeconds(
      state.tempo,
      v.timeBaseNumerator,
      v.timeBaseDenominator,
    );

    let order = cursor.order;
    // Steps advance clock time evenly; the Time Distortion Map decides where
    // that lands in real time. With a neutral map the two are identical.
    const realAt = (clock: number) =>
      cursor.originSec + distortClockSeconds(v.timeDistort, state.tempo, clock);

    let clockSec = cursor.clockSec;
    let t = realAt(clockSec);
    let cyclicPos = cursor.cyclicPos;
    let transportTick = cursor.transportTick;
    let rhythmRestarted = false;
    let holdNext = cursor.holdNext;
    const baseTicks = PPQN * 4 * v.timeBaseNumerator / v.timeBaseDenominator;

    if (outLen <= 0) {
      // Nothing to play; keep the clock from spinning forever.
      clockSec += Math.max(0, windowEnd - t);
      t = realAt(clockSec);
    } else {
      while (t < windowEnd) {
        const step = {
          accent: cycleStep(state, "accent", vi, cyclicPos.accent),
          legato: cycleStep(state, "legato", vi, cyclicPos.legato),
          rhythm: cycleStep(state, "rhythm", vi, cyclicPos.rhythm),
        };
        if (step.rhythm === 0 && cycleLength(state, "rhythm", vi) > 1) rhythmRestarted = true;
        const accented = velocityForAccent(
          v.velocityRange,
          cyclicLevel(state, "accent", vi, step.accent, voiceRng),
        );
        const velocity = accented > 0 && state.velocityOffset
          ? Math.max(1, Math.min(127, accented + state.velocityOffset))
          : accented;
        const legato = cyclicMultiplier(state, "legato", vi, step.legato, voiceRng);
        const rhythm = cyclicMultiplier(state, "rhythm", vi, step.rhythm, voiceRng);
        const nextClockSec = clockSec + stepDur * rhythm;
        const nextOnsetSec = realAt(nextClockSec);
        const onsetIntervalSec = Math.max(0, nextOnsetSec - t);
        // Play-Enable only decides whether the step sounds: a muted voice keeps
        // reading its pattern, so turning it back on finds it in phase.
        const r = nextMixedStepIndex(v.noteOrderMix, order, outLen, voiceRng);
        order = r.cursor;
        if (v.playEnabled) {
          steps.push({ voice: vi, step: r.index });
          const source =
            r.source === "cyclic" ? pat.scrambledSteps : pat.steps;
          const patternStep = source[r.index];
          // Note Density, as M plays it: a slot whose draw fails still sounds,
          // held through the next slot, and that next slot is the silent one.
          // At 0 nothing sounds, which is what the manual promises.
          let sounds = false;
          let held = false;
          if (velocity > 0 && patternStep.pitches.length > 0) {
            const passed = gate(v.density, voiceRng);
            sounds = !holdNext && (passed || v.density > 0);
            held = !passed;
            holdNext = !passed;
          } else {
            holdNext = false;
          }
          if (sounds) {
            const lengthFactor = v.legato * legato + (held ? 1 : 0);
            for (const p of patternStep.pitches) {
              let n: number;
              if (state.diatonicTranspose) {
                n = diatonicTranspose(p, state.root, state.scale, v.transposition);
              } else {
                n = p + v.transposition;
              }
              if (state.scaleSnap) n = snapToScale(n, state.root, state.scale);
              if (state.chordTones) n = snapToChord(n, state.root, state.scale);
              for (const channel of v.outputChannels) {
                notes.push({
                  voice: vi,
                  note: clampMidi(n),
                  velocity,
                  channel,
                  startSec: t,
                  durationSec: onsetIntervalSec * lengthFactor,
                  atTick: Math.round(transportTick),
                  durationTicks: Math.max(0, Math.round(baseTicks * rhythm * lengthFactor)),
                  source: r.source,
                  rhythm,
                });
              }
            }
          }
        }
        clockSec = nextClockSec;
        transportTick += Math.round(baseTicks * rhythm);
        t = nextOnsetSec;
        const advance = (kind: CyclicVariable) =>
          (step[kind] + 1) % cycleLength(state, kind, vi);
        cyclicPos = { accent: advance("accent"), legato: advance("legato"), rhythm: advance("rhythm") };
      }
    }
    if (rhythmRestarted) cyclicResets.push(vi);

    nextCursors.push({
      order,
      nextTimeSec: t,
      originSec: cursor.originSec,
      clockSec,
      cyclicPos,
      transportTick,
      holdNext,
    });
  });

  return { notes, cursors: nextCursors, steps, cyclicResets };
}
