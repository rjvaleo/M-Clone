// The Modular time model.
//
// Classic M-Clone represented musical time as accumulated floating-point
// seconds: each voice carried a `clockSec` that grew by `stepDur * rhythm`
// every step, and pause/resume/stall-recovery shifted every cursor by hand.
// With four hardwired voices that is invisible. With N independently wired
// streams that must stay phase-locked for a whole performance it is drift.
//
// Here, integer ticks are the only canonical musical time. A tick at 960 PPQN
// stays exact in a JS number for centuries of music, so tick arithmetic never
// loses precision. Seconds are *derived* from a tempo map by a single multiply
// against the nearest anchor — never accumulated — which means:
//
//   - two nodes asking for the same tick always get bit-identical seconds;
//   - a tempo change appends one anchor instead of re-basing every cursor;
//   - pause/resume/stall recovery shifts one map, not N cursors;
//   - elapsed real time cannot drift away from elapsed musical time.

/** Ticks per quarter note. Fixed for schema v1; ports declare it explicitly. */
export const PPQN = 960;

/** Musical position in whole ticks. Fractional ticks are never scheduled. */
export type Tick = number;

/**
 * A point where the tempo map is pinned: musical position, the real time it
 * occurs at, and the tempo in force from there until the next anchor.
 */
export type TempoAnchor = {
  readonly tick: Tick;
  readonly seconds: number;
  readonly bpm: number;
};

/** Seconds occupied by one tick at a given tempo. */
export const secondsPerTick = (bpm: number): number => 60 / (normalizeBpm(bpm) * PPQN);

const MIN_BPM = 1;
const MAX_BPM = 999;

function normalizeBpm(bpm: number): number {
  if (!Number.isFinite(bpm)) return 120;
  return Math.min(MAX_BPM, Math.max(MIN_BPM, bpm));
}

/**
 * Ticks spanned by one step of a time base such as 1/16 or 3/8.
 *
 * Always at least one tick: a user-wired control source can drive a time base
 * to zero, and a zero-length step is an infinite loop in any window planner.
 * Clamping here means the runtime cannot hang; the compiler separately reports
 * the degenerate value so the user sees why.
 */
export function stepTicks(numerator: number, denominator: number): Tick {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) return PPQN;
  if (denominator <= 0 || numerator <= 0) return 1;
  return Math.max(1, Math.round((PPQN * 4 * numerator) / denominator));
}

/**
 * A piecewise-constant-tempo map from ticks to real seconds.
 *
 * Anchors are sorted by tick and by seconds simultaneously (tempo is always
 * positive, so the mapping is strictly increasing and invertible).
 */
export class TempoMap {
  private anchors: TempoAnchor[];

  constructor(bpm = 120, originSec = 0) {
    this.anchors = [{ tick: 0, seconds: originSec, bpm: normalizeBpm(bpm) }];
  }

  /** The anchor list, for serialization and tests. */
  snapshot(): readonly TempoAnchor[] {
    return this.anchors.slice();
  }

  /** Real time of the musical origin. */
  get originSec(): number {
    return this.anchors[0].seconds;
  }

  /** Index of the last anchor at or before `tick`. */
  private anchorIndexForTick(tick: Tick): number {
    let low = 0;
    let high = this.anchors.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (this.anchors[mid].tick <= tick) low = mid;
      else high = mid - 1;
    }
    return low;
  }

  /** Index of the last anchor at or before `seconds`. */
  private anchorIndexForSeconds(seconds: number): number {
    let low = 0;
    let high = this.anchors.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (this.anchors[mid].seconds <= seconds) low = mid;
      else high = mid - 1;
    }
    return low;
  }

  /** Tempo in force at a musical position. */
  bpmAt(tick: Tick): number {
    return this.anchors[this.anchorIndexForTick(tick)].bpm;
  }

  /**
   * Real time of a musical position. One multiply from the nearest anchor —
   * no accumulation, so repeated calls never drift relative to each other.
   */
  tickToSeconds(tick: Tick): number {
    const anchor = this.anchors[this.anchorIndexForTick(tick)];
    return anchor.seconds + (tick - anchor.tick) * secondsPerTick(anchor.bpm);
  }

  /** Musical position of a real time, as an exact fractional tick. */
  secondsToTick(seconds: number): number {
    const anchor = this.anchors[this.anchorIndexForSeconds(seconds)];
    return anchor.tick + (seconds - anchor.seconds) / secondsPerTick(anchor.bpm);
  }

  /** Musical position of a real time, floored to a schedulable whole tick. */
  secondsToTickFloor(seconds: number): Tick {
    return Math.floor(this.secondsToTick(seconds));
  }

  /**
   * Change tempo from `tick` onward. The anchor's real time is computed from
   * the existing map, so everything already scheduled before `tick` keeps the
   * exact time it was given.
   */
  setTempoAt(tick: Tick, bpm: number): void {
    const at = Math.max(0, Math.round(tick));
    const seconds = this.tickToSeconds(at);
    const kept = this.anchors.filter((anchor) => anchor.tick < at);
    const next: TempoAnchor = { tick: at, seconds, bpm: normalizeBpm(bpm) };
    // Replacing the origin keeps the map anchored at tick 0.
    this.anchors = kept.length === 0 ? [{ ...next, tick: 0 }] : [...kept, next];
  }

  /**
   * Slide the whole map along real time without touching musical positions.
   * This is the entire implementation of resume-after-pause and recovery from
   * a scheduling stall: one map moves, every node stays exactly in phase.
   */
  shiftSeconds(deltaSec: number): void {
    if (!Number.isFinite(deltaSec) || deltaSec === 0) return;
    this.anchors = this.anchors.map((anchor) => ({
      ...anchor,
      seconds: anchor.seconds + deltaSec,
    }));
  }

  /** Re-origin the map so tick 0 falls at `seconds`. */
  rebaseOrigin(seconds: number): void {
    this.shiftSeconds(seconds - this.anchors[0].seconds);
  }

  /** Restore a serialized map. */
  static fromAnchors(anchors: readonly TempoAnchor[]): TempoMap {
    const map = new TempoMap();
    if (anchors.length > 0) {
      map.anchors = anchors
        .map((anchor) => ({
          tick: Math.max(0, Math.round(anchor.tick)),
          seconds: anchor.seconds,
          bpm: normalizeBpm(anchor.bpm),
        }))
        .sort((a, b) => a.tick - b.tick);
      if (map.anchors[0].tick !== 0) map.anchors[0] = { ...map.anchors[0], tick: 0 };
    }
    return map;
  }
}

export type BarBeat = { bar: number; beat: number; tick: Tick };

/**
 * Bar/beat/tick display position. Bars and beats are one-based, as musicians
 * count them; `tick` is the remainder inside the beat.
 */
export function barBeat(tick: Tick, beatsPerBar = 4, beatUnit = 4): BarBeat {
  const ticksPerBeat = Math.max(1, Math.round((PPQN * 4) / Math.max(1, beatUnit)));
  const ticksPerBar = ticksPerBeat * Math.max(1, Math.round(beatsPerBar));
  const position = Math.max(0, Math.floor(tick));
  const bar = Math.floor(position / ticksPerBar);
  const inBar = position - bar * ticksPerBar;
  const beat = Math.floor(inBar / ticksPerBeat);
  return { bar: bar + 1, beat: beat + 1, tick: inBar - beat * ticksPerBeat };
}
