// Two clocks, one schedule.
//
// The runtime schedules events in *its* seconds — the domain of whatever timing
// source `PresentationClock` was given, which in the browser is
// `performance.now()`. The audio graph plays them in `AudioContext.currentTime`.
// Those are different clocks: they start at different moments, and they are
// driven by different hardware, so they drift.
//
// The drift is small and the lookahead is short, which is what makes a single
// measured offset enough. A note scheduled half a second ahead, on clocks
// disagreeing by even 100 parts per million, lands 50 microseconds off — three
// orders of magnitude below anything audible. What is *not* small is the offset
// itself, and getting its sign or its staleness wrong puts every note in the
// wrong place, so this exists rather than being an inline subtraction.
//
// Two behaviours matter more than the arithmetic:
//
//   **Smoothing.** Both readings are quantised and jittery. Easing toward each
//   new measurement keeps a note's placement from moving because a sample
//   happened to land badly.
//
//   **Snapping.** A suspended `AudioContext` stops advancing while
//   `performance.now()` keeps going, so the true offset jumps by however long
//   the context was asleep. Easing toward that would smear every note over
//   several seconds of catching up. A jump beyond what drift could explain is
//   therefore taken whole.

/** Beyond this, the clocks did not drift apart — one of them stopped. */
export const SNAP_THRESHOLD_SEC = 0.05;

/** How much of each new measurement is taken. Low enough to reject jitter. */
export const SMOOTHING = 0.2;

export type ClockBridgeOptions = {
  snapThresholdSec?: number;
  smoothing?: number;
};

export class AudioClockBridge {
  private readonly snapThresholdSec: number;
  private readonly smoothing: number;
  private offsetSec = 0;
  private started = false;
  private snaps = 0;

  constructor(options: ClockBridgeOptions = {}) {
    this.snapThresholdSec = Math.max(0, options.snapThresholdSec ?? SNAP_THRESHOLD_SEC);
    this.smoothing = Math.min(1, Math.max(0, options.smoothing ?? SMOOTHING));
  }

  /** Audio time minus runtime time, as currently believed. */
  get offset(): number {
    return this.offsetSec;
  }

  /** How many times the relationship jumped rather than drifted. */
  get snapCount(): number {
    return this.snaps;
  }

  get ready(): boolean {
    return this.started;
  }

  /**
   * Take one reading. Both arguments must be read at the same moment.
   *
   * Called once per scheduling wake rather than once per event: a batch of
   * events should all be placed against one consistent view of the two clocks,
   * not against a slightly different one each.
   */
  sample(audioNowSec: number, runtimeNowSec: number): void {
    if (!Number.isFinite(audioNowSec) || !Number.isFinite(runtimeNowSec)) return;
    const measured = audioNowSec - runtimeNowSec;
    if (!this.started) {
      this.offsetSec = measured;
      this.started = true;
      return;
    }
    if (Math.abs(measured - this.offsetSec) > this.snapThresholdSec) {
      this.offsetSec = measured;
      this.snaps += 1;
      return;
    }
    this.offsetSec += (measured - this.offsetSec) * this.smoothing;
  }

  /** A runtime timestamp in audio-context time. */
  toAudioTime(runtimeSec: number): number {
    return runtimeSec + this.offsetSec;
  }

  /** Forget the relationship, for a context that has been replaced. */
  reset(): void {
    this.started = false;
    this.offsetSec = 0;
  }
}
