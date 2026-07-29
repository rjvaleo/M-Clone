// The step planner: given project state, per-voice cursors, and a time window,
// produce the notes to schedule and the advanced cursors. This is the pure,
// fully-tested heart of the engine — no audio, no timers, no DOM.

import type { ProjectState, NoteOrderCursor } from "./types";
import { Rng } from "./rng";
import { stepDurationSeconds, nextStepIndex, gate } from "./transform";
import { snapToScale, clampMidi } from "./music";

export type PlannedNote = {
  voice: number;
  note: number;
  velocity: number;
  channel: number;
  startSec: number; // AudioContext time domain
  durationSec: number;
};

export type VoiceCursor = {
  order: NoteOrderCursor;
  nextTimeSec: number;
};

/** One fresh cursor per voice, all starting at `startSec`. */
export function makeCursors(state: ProjectState, startSec: number): VoiceCursor[] {
  return state.voices.map(() => ({
    order: { pos: 0, last: -1 },
    nextTimeSec: startSec,
  }));
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
  rng: Rng,
  _windowStart: number,
  windowEnd: number,
): { notes: PlannedNote[]; cursors: VoiceCursor[] } {
  const notes: PlannedNote[] = [];
  const nextCursors: VoiceCursor[] = [];

  state.voices.forEach((v, vi) => {
    const cursor = cursors[vi];
    const pat = state.patterns[v.patternIndex];
    const outLen = Math.min(pat.outputLength, pat.steps.length);
    const stepDur = stepDurationSeconds(
      state.tempo,
      v.timeBaseNumerator,
      v.timeBaseDenominator,
    );

    let order = cursor.order;
    let t = cursor.nextTimeSec;

    if (outLen <= 0) {
      // Nothing to play; keep the clock from spinning forever.
      t = Math.max(t, windowEnd);
    } else {
      while (t < windowEnd) {
        if (v.playEnabled) {
          const r = nextStepIndex(v.noteOrder, order, outLen, rng);
          order = r.cursor;
          const step = pat.steps[r.index];
          if (step.pitches.length > 0 && gate(v.density, rng)) {
            for (const p of step.pitches) {
              let n = p + v.transposition;
              if (state.scaleSnap) n = snapToScale(n, state.root, state.scale);
              notes.push({
                voice: vi,
                note: clampMidi(n),
                velocity: clampMidi(v.velocity),
                channel: v.channel,
                startSec: t,
                durationSec: stepDur * v.legato,
              });
            }
          }
        }
        t += stepDur;
      }
    }

    nextCursors.push({ order, nextTimeSec: t });
  });

  return { notes, cursors: nextCursors };
}
