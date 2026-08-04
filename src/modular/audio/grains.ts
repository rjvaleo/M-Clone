// Granular scanning: where the next grain comes from, and when.
//
// The AV prototype scheduled each grain with `setTimeout(…, 80)` and started it
// at whatever `currentTime` happened to be when the timer fired. That is the
// classic mistake this codebase already rejected for note scheduling, and it is
// worse here: at eighty milliseconds apart, main-thread jitter is a sizeable
// fraction of the spacing, so grains bunch and gap audibly — a granular texture
// turns grainy in the wrong way, and stays that way whenever the page is busy.
//
// The fix is the same one the runtime uses. A timer that fires *approximately*
// wakes a loop that schedules grains at times computed *exactly*, far enough
// ahead that a late wake still finds its work already placed. The timer decides
// only how often to think, never when a grain begins.
//
// What is kept from the prototype is the part that was right: the grain window
// shape (rise over the first fifth, hold, exponential release), position jitter
// around a scan point, freeze, and a stretch factor that decouples how fast the
// scan moves through the buffer from how fast grains are emitted.

/** How far ahead grains are placed. Comfortably longer than any timer jitter. */
export const GRAIN_LOOKAHEAD_SEC = 0.2;

/** How often the scheduler wakes. Short relative to the lookahead. */
export const GRAIN_WAKE_MS = 40;

/** A grain shorter than this is a click; longer than this is a loop. */
export const MIN_GRAIN_SEC = 0.005;
export const MAX_GRAIN_SEC = 2;

export type GrainSettings = {
  /** Length of one grain. */
  sizeSec: number;
  /** Time between grain starts. Shorter than `sizeSec` means overlap. */
  spacingSec: number;
  /** Scan centre through the buffer, 0 to 1. */
  position: number;
  /** Random spread around the centre, as a fraction of the buffer. */
  jitter: number;
  /** Below 1 the scan moves slower than real time; above, faster. */
  stretch: number;
  /** When true the scan stops advancing and the same region repeats. */
  freeze: boolean;
};

export type PlannedGrain = {
  /** Audio-clock time to start. */
  atSec: number;
  /** Seconds into the buffer. */
  offsetSec: number;
  durationSec: number;
};

export const clampGrainSize = (seconds: number): number =>
  Math.min(MAX_GRAIN_SEC, Math.max(MIN_GRAIN_SEC, Number.isFinite(seconds) ? seconds : MIN_GRAIN_SEC));

/**
 * Where one grain reads from.
 *
 * Clamped so a grain never runs off the end of the buffer, which would either
 * throw or produce a short grain with a hard edge — a click at exactly the
 * moment the scan reaches the end, which is the most noticeable place for one.
 */
export function grainOffsetSec(
  position: number,
  jitterUnit: number,
  bufferSeconds: number,
  grainSeconds: number,
  random: number,
): number {
  const usable = Math.max(0, bufferSeconds - grainSeconds);
  if (usable === 0) return 0;
  const centre = clampUnit(position) * usable;
  const spread = clampUnit(Math.abs(jitterUnit)) * usable;
  const jittered = centre + (random * 2 - 1) * spread;
  return Math.min(usable, Math.max(0, jittered));
}

/**
 * How far the scan advances between grains.
 *
 * Dividing by stretch is what separates the two rates: at a stretch of two, the
 * scan covers half as much buffer per grain, so the same material is emitted
 * over twice as long without changing grain size or pitch.
 */
export function scanAdvanceUnit(
  spacingSec: number,
  bufferSeconds: number,
  stretch: number,
): number {
  if (bufferSeconds <= 0) return 0;
  const factor = Math.abs(stretch) < 0.01 ? 0.01 : stretch;
  return (spacingSec / bufferSeconds) / factor;
}

/**
 * A grain cloud, driven by a timer it does not trust.
 *
 * The scheduler owns the scan position because it advances per *scheduled*
 * grain rather than per elapsed second — which is what keeps the texture
 * identical whether the wake interval is 40 ms or, on a struggling page, 400.
 */
export class GrainScheduler {
  private readonly emit: (grain: PlannedGrain) => void;
  private readonly random: () => number;
  private nextGrainAtSec = 0;
  private positionUnit = 0;
  private running = false;
  private grains = 0;

  constructor(emit: (grain: PlannedGrain) => void, random: () => number = Math.random) {
    this.emit = emit;
    this.random = random;
  }

  get isRunning(): boolean {
    return this.running;
  }

  /** Where the scan has reached, 0 to 1. */
  get position(): number {
    return this.positionUnit;
  }

  /** Grains emitted since starting, for tests and for a rate display. */
  get grainCount(): number {
    return this.grains;
  }

  start(nowSec: number, position: number): void {
    this.running = true;
    this.positionUnit = clampUnit(position);
    this.nextGrainAtSec = nowSec;
    this.grains = 0;
  }

  stop(): void {
    this.running = false;
  }

  /**
   * Place every grain that falls inside the lookahead window.
   *
   * Bounded rather than `while (next < horizon)`: a spacing of nearly zero
   * would otherwise emit grains until the tab died, and a runaway control
   * should thin out rather than take everything down with it.
   */
  advance(
    nowSec: number,
    bufferSeconds: number,
    settings: GrainSettings,
    lookaheadSec = GRAIN_LOOKAHEAD_SEC,
    maxGrains = 64,
  ): void {
    if (!this.running || bufferSeconds <= 0) return;
    const size = clampGrainSize(settings.sizeSec);
    const spacing = Math.max(MIN_GRAIN_SEC, settings.spacingSec);
    const horizon = nowSec + lookaheadSec;

    // A scheduler that has been idle — a suspended context, a stalled tab —
    // must not try to place the grains it missed; it starts from now.
    if (this.nextGrainAtSec < nowSec) this.nextGrainAtSec = nowSec;

    let placed = 0;
    while (this.nextGrainAtSec <= horizon && placed < maxGrains) {
      this.emit({
        atSec: this.nextGrainAtSec,
        offsetSec: grainOffsetSec(
          this.positionUnit,
          settings.jitter,
          bufferSeconds,
          size,
          this.random(),
        ),
        durationSec: size,
      });
      this.grains += 1;
      placed += 1;
      this.nextGrainAtSec += spacing;
      if (!settings.freeze) {
        const step = scanAdvanceUnit(spacing, bufferSeconds, settings.stretch);
        this.positionUnit = wrapUnit(this.positionUnit + step);
      }
    }
  }

  /** Jump the scan, for a position control the user is dragging. */
  seek(position: number): void {
    this.positionUnit = clampUnit(position);
  }
}

const clampUnit = (value: number): number =>
  Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;

/** Wraps rather than clamps: a scan that reaches the end starts again. */
const wrapUnit = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  const wrapped = value % 1;
  return wrapped < 0 ? wrapped + 1 : wrapped;
};
