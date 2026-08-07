// Following an incoming MIDI clock.
//
// The mirror of `clockoutput.ts`. That side turns a tempo into pulses; this
// side turns pulses back into a tempo, so M can be slaved to a sequencer, a
// drum machine, or the modular rack instead of always being the master.
//
// The manual retired this — "External Clock: This feature is no longer
// available" — so unlike most of the engine there is no printed behaviour to
// quote. The MIDI specification is the authority instead: 24 pulses per
// quarter note, `0xFA` start, `0xFB` continue, `0xFC` stop, and a Song
// Position Pointer counted in sixteenth notes.
//
// Pure and clock-free: every function takes the arrival time it should use, so
// the tests drive it with exact numbers rather than waiting in real time.

import { clockPulseInterval } from "./clockoutput";

/** Pulses per quarter note. Fixed by the MIDI specification. */
export const CLOCK_PPQN = 24;

/**
 * How many missed pulses mean the source has gone away.
 *
 * Long enough to ride out a stalled tab or a slow USB interface, short enough
 * that a stopped clock does not leave the transport stuck at a tempo nobody
 * is sending any more.
 */
export const STALE_TICKS = 8;

/** The tempo range the rest of the app accepts. */
const MIN_TEMPO = 1;
const MAX_TEMPO = 999;

/** One beat of history: long enough to smooth jitter, short enough to follow. */
const WINDOW = CLOCK_PPQN + 1;

export type ClockFollower = {
  /** Pulse arrival times in seconds, oldest first. */
  readonly ticks: readonly number[];
  readonly transport: "stopped" | "running";
  /** Where the source says we are, in sixteenth notes from the top. */
  readonly songPositionSixteenths: number;
};

export function createClockFollower(): ClockFollower {
  return { ticks: [], transport: "stopped", songPositionSixteenths: 0 };
}

/** The tempo a given gap between pulses implies. */
export function tempoFromTickInterval(interval: number, ratio: number): number | null {
  if (!(interval > 0)) return null;
  // The exact inverse of clockPulseInterval, which is 240 / tempo / ratio / 24.
  return 240 / (Math.max(1, ratio) * CLOCK_PPQN * interval);
}

export function clockTick(follower: ClockFollower, atSec: number): ClockFollower {
  const ticks = [...follower.ticks, atSec];
  return {
    ...follower,
    ticks: ticks.length > WINDOW ? ticks.slice(ticks.length - WINDOW) : ticks,
  };
}

/**
 * The tempo the follower currently believes, or null before it can tell.
 *
 * A trimmed mean of the gaps between pulses.
 *
 * Both obvious choices are wrong. A plain mean of the intervals is the same
 * arithmetic as dividing the total span by the number of gaps, so every
 * interior pulse cancels and the reading rests entirely on the first and last
 * — the two most likely to be displaced. A median fixes that but acquires its
 * own bias: transport jitter is often periodic rather than random, and the
 * middle of a repeating pattern of gaps is not the gap that pattern is
 * wobbling around.
 *
 * Dropping the extremes and averaging the rest keeps the mean's freedom from
 * bias under symmetric wobble while discarding the outliers a mean would
 * chase. The window is still one beat, so a real tempo change takes over
 * within a beat.
 */
export function followerTempo(follower: ClockFollower, ratio: number): number | null {
  const { ticks } = follower;
  if (ticks.length < 2) return null;
  const gaps: number[] = [];
  for (let i = 1; i < ticks.length; i++) gaps.push(ticks[i] - ticks[i - 1]);
  gaps.sort((a, b) => a - b);
  // An eighth off each end, but never so much that nothing is left to average.
  const trim = Math.min(gaps.length >> 3, (gaps.length - 1) >> 1);
  const kept = gaps.slice(trim, gaps.length - trim);
  const mean = kept.reduce((sum, gap) => sum + gap, 0) / kept.length;
  const tempo = tempoFromTickInterval(mean, ratio);
  if (tempo === null) return null;
  return Math.min(MAX_TEMPO, Math.max(MIN_TEMPO, tempo));
}

/** `0xFA` — run from the top. */
export function clockStart(_follower: ClockFollower): ClockFollower {
  // The history goes too: pulses from before the start belong to a previous
  // run, and averaging across the join would invent a tempo nobody played.
  return { ticks: [], transport: "running", songPositionSixteenths: 0 };
}

/** `0xFC` — stop, keeping the position for a later Continue. */
export function clockStop(follower: ClockFollower): ClockFollower {
  return { ...follower, transport: "stopped" };
}

/** `0xFB` — resume from wherever Stop left off. */
export function clockContinue(follower: ClockFollower): ClockFollower {
  return { ...follower, transport: "running" };
}

/** `0xF2` — Song Position Pointer, counted in sixteenth notes. */
export function clockSongPosition(
  follower: ClockFollower,
  sixteenths: number,
): ClockFollower {
  return { ...follower, songPositionSixteenths: Math.max(0, Math.round(sixteenths)) };
}

/**
 * Has the source stopped sending?
 *
 * Measured against the tempo the follower itself is reading, so a slow clock
 * gets proportionally longer to arrive than a fast one.
 */
export function isClockStale(
  follower: ClockFollower,
  nowSec: number,
  ratio: number,
): boolean {
  const last = follower.ticks[follower.ticks.length - 1];
  if (last === undefined) return true;
  const tempo = followerTempo(follower, ratio);
  const expected = clockPulseInterval(tempo ?? 120, ratio);
  return nowSec - last > expected * STALE_TICKS;
}
