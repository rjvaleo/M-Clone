// The step planner: given project state, per-voice cursors, and a time window,
// produce the notes to schedule and the advanced cursors. This is the pure,
// fully-tested heart of the engine — no audio, no timers, no DOM.

import type { ProjectState, NoteOrderCursor } from "./types";
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
};

export const PPQN = 960;

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
  cyclicPos: number;
  transportTick: number;
};

function cyclicMultiplier(
  state: ProjectState,
  kind: "legato" | "rhythm",
  voice: number,
  position: number,
  rng: Rng,
): number {
  const cycle = state.cyclic[kind][voice];
  const length = state.cyclicLengths[kind][voice];
  const level = pickCyclicLevel(cycle[position % length], rng);
  const value = state.cyclicValues[kind][level];
  return kind === "legato" ? value / 100 : value;
}

function cyclicLevel(
  state: ProjectState,
  kind: "accent" | "legato" | "rhythm",
  voice: number,
  position: number,
  rng: Rng,
): number {
  const cycle = state.cyclic[kind][voice];
  const length = state.cyclicLengths[kind][voice];
  return pickCyclicLevel(cycle[position % length], rng);
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
      cyclicPos: 0,
      transportTick: Math.round(phase * PPQN / 96),
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
): { notes: PlannedNote[]; cursors: VoiceCursor[] } {
  const notes: PlannedNote[] = [];
  const nextCursors: VoiceCursor[] = [];

  // Effective per-voice transposition. Second-Order Transpose stacks the
  // voices cumulatively (a harmonizer feeding a harmonizer), so each voice
  // adds the transpositions of the voices above it — building implied chords.
  const baseTrans = state.voices.map((v) => v.transposition);
  let effTrans = baseTrans;
  if (state.secondOrderTranspose) {
    let acc = 0;
    effTrans = baseTrans.map((t) => (acc += t));
  }

  state.voices.forEach((v, vi) => {
    const voiceRng = Array.isArray(rng) ? rng[vi] : rng as Rng;
    const cursor = cursors[vi];
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
    const baseTicks = PPQN * 4 * v.timeBaseNumerator / v.timeBaseDenominator;

    if (outLen <= 0) {
      // Nothing to play; keep the clock from spinning forever.
      clockSec += Math.max(0, windowEnd - t);
      t = realAt(clockSec);
    } else {
      while (t < windowEnd) {
        const velocity = velocityForAccent(
          v.velocityRange,
          cyclicLevel(state, "accent", vi, cyclicPos, voiceRng),
        );
        const legato = cyclicMultiplier(state, "legato", vi, cyclicPos, voiceRng);
        const rhythm = cyclicMultiplier(state, "rhythm", vi, cyclicPos, voiceRng);
        const nextClockSec = clockSec + stepDur * rhythm;
        const nextOnsetSec = realAt(nextClockSec);
        const onsetIntervalSec = Math.max(0, nextOnsetSec - t);
        if (v.playEnabled) {
          const r = nextMixedStepIndex(v.noteOrderMix, order, outLen, voiceRng);
          order = r.cursor;
          const source =
            r.source === "cyclic" ? pat.scrambledSteps : pat.steps;
          const step = source[r.index];
          if (velocity > 0 && step.pitches.length > 0 && gate(v.density, voiceRng)) {
            for (const p of step.pitches) {
              let n: number;
              if (state.diatonicTranspose) {
                n = diatonicTranspose(p, state.root, state.scale, effTrans[vi]);
              } else {
                n = p + effTrans[vi];
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
                  durationSec: onsetIntervalSec * v.legato * legato,
                  atTick: Math.round(transportTick),
                  durationTicks: Math.max(0, Math.round(baseTicks * rhythm * v.legato * legato)),
                });
              }
            }
          }
        }
        clockSec = nextClockSec;
        transportTick += Math.round(baseTicks * rhythm);
        t = nextOnsetSec;
        cyclicPos = (cyclicPos + 1) % 16;
      }
    }

    nextCursors.push({
      order,
      nextTimeSec: t,
      originSec: cursor.originSec,
      clockSec,
      cyclicPos,
      transportTick,
    });
  });

  return { notes, cursors: nextCursors };
}
