// When a topology change is allowed to happen, and when the old nodes may go.
//
// Rebuilding part of the audio graph while it is making sound has two failure
// modes, and they pull in opposite directions. Disconnect too early and the
// signal steps to silence — a click. Dispose too late, or never, and the old
// subgraph stays alive, still holding buffers and still costing CPU — a leak
// that only shows up after an hour of editing.
//
// The protocol is therefore fixed and short: build the replacement, fade the
// two across each other on the audio clock, and only then disconnect and
// dispose — with a safety margin, because "the ramp has ended" is a statement
// about scheduled audio time, not about when a timer happens to fire.

/** Long enough to be inaudible as a step, short enough not to smear an edit. */
export const CROSSFADE_SEC = 0.015;

/**
 * Extra time held before disposal.
 *
 * Disposal runs on a wall-clock timer while the fade runs on the audio clock,
 * and the two agree only approximately. The margin is what keeps a late timer
 * from being an audible truncation instead of a harmless delay.
 */
export const DISPOSE_MARGIN_SEC = 0.05;

export type CrossfadeSchedule = {
  /** Audio time the fade begins. */
  fadeStartSec: number;
  /** Audio time both ramps have completed. */
  fadeEndSec: number;
  /** Audio time the outgoing nodes may be disconnected and dropped. */
  disposeAtSec: number;
  /** Seconds from now until disposal, for a wall-clock timer. */
  disposeDelaySec: number;
};

/**
 * The timing for one topology transition.
 *
 * Fades start a hair in the future rather than exactly now: scheduling a ramp
 * at a time that has already passed by the time the audio thread reaches it
 * collapses the ramp into a step, which is the click the fade exists to avoid.
 */
export function crossfadeSchedule(
  nowSec: number,
  durationSec: number = CROSSFADE_SEC,
  marginSec: number = DISPOSE_MARGIN_SEC,
): CrossfadeSchedule {
  const start = Math.max(0, nowSec);
  const duration = Math.max(0, durationSec);
  const margin = Math.max(0, marginSec);
  const fadeEndSec = start + duration;
  const disposeAtSec = fadeEndSec + margin;
  return {
    fadeStartSec: start,
    fadeEndSec,
    disposeAtSec,
    disposeDelaySec: disposeAtSec - nowSec,
  };
}

/**
 * Deferred work on the wall clock, injected so transitions are testable
 * without waiting in real time.
 */
export interface TransitionScheduler {
  /** Current audio time. */
  now(): number;
  /** Run `task` after `delaySec`. */
  after(delaySec: number, task: () => void): void;
  /** Drop anything not yet run, for teardown. */
  cancelAll(): void;
}

/** The browser implementation. Disposal is not time-critical, so a timer is fine. */
export function timerTransitionScheduler(now: () => number): TransitionScheduler {
  const pending = new Set<ReturnType<typeof setTimeout>>();
  return {
    now,
    after(delaySec, task) {
      const handle = setTimeout(() => {
        pending.delete(handle);
        task();
      }, Math.max(0, delaySec) * 1000);
      pending.add(handle);
    },
    cancelAll() {
      for (const handle of pending) clearTimeout(handle);
      pending.clear();
    },
  };
}

/** A scheduler a test drives by hand. */
export class ManualTransitionScheduler implements TransitionScheduler {
  private currentSec: number;
  private tasks: { atSec: number; task: () => void }[] = [];

  constructor(startSec = 0) {
    this.currentSec = startSec;
  }

  now(): number {
    return this.currentSec;
  }

  after(delaySec: number, task: () => void): void {
    this.tasks.push({ atSec: this.currentSec + Math.max(0, delaySec), task });
  }

  cancelAll(): void {
    this.tasks = [];
  }

  get pendingCount(): number {
    return this.tasks.length;
  }

  /** Move time forward, running everything that comes due, in order. */
  advance(seconds: number): void {
    this.currentSec += seconds;
    const due = this.tasks
      .filter((entry) => entry.atSec <= this.currentSec)
      .sort((a, b) => a.atSec - b.atSec);
    this.tasks = this.tasks.filter((entry) => entry.atSec > this.currentSec);
    for (const entry of due) entry.task();
  }
}
