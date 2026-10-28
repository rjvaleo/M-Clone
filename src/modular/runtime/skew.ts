// Converting audio time to the timestamp domain Web MIDI expects.
//
// `MIDIOutput.send(data, timestamp)` takes a `performance.now()` time, while
// everything musical is scheduled against `AudioContext` time. Getting that
// conversion right is what keeps an external device and the internal synth
// playing the same note at the same moment.
//
// Two failure modes are addressed.
//
// Output latency. `getOutputTimestamp()` pairs a context time with the moment
// that audio frame actually *reaches the output*, so a map built from it
// already accounts for output latency. Not every browser implements it, and
// the obvious fallback — pairing `currentTime` with a bare `performance.now()`
// — silently claims audio scheduled now is heard now. It isn't: it is heard
// `outputLatency` later, typically 10-40 ms and far more over Bluetooth. On
// that path MIDI fires early against the synth. The fallback here adds the
// latency explicitly so both paths mean the same thing.
//
// Anchor jitter. `getOutputTimestamp()` is quantized to the render quantum, so
// re-anchoring on every batch injects a few milliseconds of jitter into every
// timestamp, and the audio hardware clock and the system clock genuinely run
// at slightly different rates over a long session. Instead of trusting one
// instantaneous sample, this tracks a least-squares line through a bounded
// window of recent samples: jitter averages out and real drift is followed.

/** The part of `AudioContext` this module needs, so tests can supply a fake. */
export interface AudioTimingSource {
  readonly currentTime: number;
  readonly outputLatency?: number;
  readonly baseLatency?: number;
  getOutputTimestamp?(): { contextTime?: number; performanceTime?: number };
}

/**
 * How long after being scheduled a sample is actually heard. `outputLatency`
 * is the honest figure; `baseLatency` is a lower bound some browsers offer
 * instead; zero is the last resort.
 */
export function outputLatencySec(source: AudioTimingSource): number {
  const output = source.outputLatency;
  if (typeof output === "number" && Number.isFinite(output) && output >= 0) return output;
  const base = source.baseLatency;
  if (typeof base === "number" && Number.isFinite(base) && base >= 0) return base;
  return 0;
}

/** Milliseconds of performance-clock time per second of context time. */
const NOMINAL_SLOPE = 1000;
/** A real hardware clock is within a fraction of a percent of nominal. */
const MIN_SLOPE = 900;
const MAX_SLOPE = 1100;

type Sample = { contextSec: number; performanceMs: number };

/**
 * A least-squares line from context time to performance time over a bounded
 * window of samples.
 */
export class ClockSkewTracker {
  private readonly capacity: number;
  private readonly samples: Sample[] = [];
  private writeIndex = 0;
  private slope = NOMINAL_SLOPE;
  private intercept = 0;
  private anchored = false;

  constructor(capacity = 64) {
    this.capacity = Math.max(2, Math.floor(capacity));
  }

  /** Samples currently informing the fit. */
  get sampleCount(): number {
    return this.samples.length;
  }

  /** True once at least one sample has been seen. */
  get ready(): boolean {
    return this.anchored;
  }

  /** Milliseconds of performance time per second of context time. */
  get slopeMsPerSec(): number {
    return this.slope;
  }

  observe(contextSec: number, performanceMs: number): void {
    if (!Number.isFinite(contextSec) || !Number.isFinite(performanceMs)) return;
    const sample = { contextSec, performanceMs };
    if (this.samples.length < this.capacity) this.samples.push(sample);
    else {
      this.samples[this.writeIndex] = sample;
      this.writeIndex = (this.writeIndex + 1) % this.capacity;
    }
    this.anchored = true;
    this.refit();
  }

  /**
   * Refit over the whole window. Centering on the window mean keeps the
   * normal equations well conditioned even hours into a session, and at a few
   * dozen samples per fit the cost is irrelevant next to the accuracy.
   */
  private refit(): void {
    const n = this.samples.length;
    if (n === 1) {
      this.slope = NOMINAL_SLOPE;
      this.intercept = this.samples[0].performanceMs - NOMINAL_SLOPE * this.samples[0].contextSec;
      return;
    }
    let meanX = 0;
    let meanY = 0;
    for (const sample of this.samples) {
      meanX += sample.contextSec;
      meanY += sample.performanceMs;
    }
    meanX /= n;
    meanY /= n;
    let sxx = 0;
    let sxy = 0;
    for (const sample of this.samples) {
      const dx = sample.contextSec - meanX;
      sxx += dx * dx;
      sxy += dx * (sample.performanceMs - meanY);
    }
    // Too little spread in x to estimate a rate — hold the nominal one.
    const slope = sxx > 1e-9 ? sxy / sxx : NOMINAL_SLOPE;
    this.slope = Math.min(MAX_SLOPE, Math.max(MIN_SLOPE, slope));
    this.intercept = meanY - this.slope * meanX;
  }

  /** Performance-clock time of a context time, per the current fit. */
  toPerformanceMs(contextSec: number): number {
    return this.intercept + this.slope * contextSec;
  }

  reset(): void {
    this.samples.length = 0;
    this.writeIndex = 0;
    this.slope = NOMINAL_SLOPE;
    this.intercept = 0;
    this.anchored = false;
  }
}

/**
 * The single place the runtime converts musical time into a MIDI timestamp.
 *
 * Every adapter goes through this, so "when is this heard" has exactly one
 * answer regardless of which browser timing APIs happen to exist.
 */
export class PresentationClock {
  private readonly source: AudioTimingSource;
  private readonly now: () => number;
  private readonly tracker: ClockSkewTracker;

  constructor(
    source: AudioTimingSource,
    now: () => number = () => performance.now(),
    tracker: ClockSkewTracker = new ClockSkewTracker(),
  ) {
    this.source = source;
    this.now = now;
    this.tracker = tracker;
  }

  /** Current audio time — the domain everything is scheduled in. */
  nowSec(): number {
    return this.source.currentTime;
  }

  get skew(): ClockSkewTracker {
    return this.tracker;
  }

  /**
   * Take one timing sample. Called once per scheduling wake, not per batch, so
   * batches read a smoothed fit instead of a fresh quantized reading.
   */
  sample(): void {
    const stamp = this.source.getOutputTimestamp?.();
    if (
      stamp &&
      typeof stamp.contextTime === "number" &&
      typeof stamp.performanceTime === "number" &&
      Number.isFinite(stamp.contextTime) &&
      Number.isFinite(stamp.performanceTime)
    ) {
      // Already an "audio reaching the output" pair — use it as it stands.
      this.tracker.observe(stamp.contextTime, stamp.performanceTime);
      return;
    }
    // No output timestamp: audio scheduled at `currentTime` is heard one
    // output latency from now, and that is the pair we must record.
    this.tracker.observe(
      this.source.currentTime,
      this.now() + outputLatencySec(this.source) * 1000,
    );
  }

  /**
   * Performance-clock time at which audio scheduled for `contextSec` is heard.
   * `trimMs` is the user's MIDI latency control — a deliberate offset on top of
   * a correct alignment, never the mechanism that produces one.
   */
  performanceMsFor(contextSec: number, trimMs = 0): number {
    if (!this.tracker.ready) this.sample();
    return this.tracker.toPerformanceMs(contextSec) + trimMs;
  }

  reset(): void {
    this.tracker.reset();
  }
}
