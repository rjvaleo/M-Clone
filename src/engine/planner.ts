// The step planner: given project state, per-voice cursors, and a time window,
// produce the notes to schedule and the advanced cursors. This is the pure,
// fully-tested heart of the engine — no audio, no timers, no DOM.

import type { ProjectState, NoteOrderCursor } from "./types";
import { Rng } from "./rng";
import { stepDurationSeconds } from "./transform";
import { distortClockSeconds } from "./timemap";
import { cyclePicks, playStep, type CyclicCounters, type VoiceCycles } from "./step";

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
export type { CyclicCounters };

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
      const cycles: VoiceCycles = {
        cells: {
          accent: state.cyclic.accent[vi],
          legato: state.cyclic.legato[vi],
          rhythm: state.cyclic.rhythm[vi],
        },
        lengths: {
          accent: state.cyclicLengths.accent[vi],
          legato: state.cyclicLengths.legato[vi],
          rhythm: state.cyclicLengths.rhythm[vi],
        },
        values: state.cyclicValues,
      };
      while (t < windowEnd) {
        const picks = cyclePicks(cycles, cyclicPos, voiceRng);
        if (picks.rhythmRestarted) rhythmRestarted = true;
        const rhythm = picks.rhythm;
        const nextClockSec = clockSec + stepDur * rhythm;
        const nextOnsetSec = realAt(nextClockSec);
        const onsetIntervalSec = Math.max(0, nextOnsetSec - t);
        const played = playStep(v, pat, state, { order, holdNext }, picks.accentLevel,
          picks.legato, state.velocityOffset ?? 0, voiceRng);
        order = played.next.order;
        holdNext = played.next.holdNext;
        if (played.played) steps.push({ voice: vi, step: played.index });
        for (const note of played.pitches) {
          for (const channel of v.outputChannels) {
            notes.push({
              voice: vi,
              note,
              velocity: played.velocity,
              channel,
              startSec: t,
              durationSec: onsetIntervalSec * played.lengthFactor,
              atTick: Math.round(transportTick),
              durationTicks: Math.max(0, Math.round(baseTicks * rhythm * played.lengthFactor)),
              source: played.source,
              rhythm,
            });
          }
        }
        clockSec = nextClockSec;
        transportTick += Math.round(baseTicks * rhythm);
        t = nextOnsetSec;
        cyclicPos = picks.next;
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
