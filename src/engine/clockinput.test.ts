import { describe, expect, it } from "vitest";
import {
  CLOCK_PPQN,
  STALE_TICKS,
  clockContinue,
  clockSongPosition,
  clockStart,
  clockStop,
  clockTick,
  createClockFollower,
  followerTempo,
  isClockStale,
  tempoFromTickInterval,
} from "./clockinput";
import { clockPulseInterval } from "./clockoutput";

/** Feed a run of perfectly even ticks at the given tempo. */
function evenTicks(tempo: number, count: number, ratio = 4, from = 0) {
  const interval = clockPulseInterval(tempo, ratio);
  let follower = createClockFollower();
  for (let i = 0; i < count; i++) {
    follower = clockTick(follower, from + i * interval);
  }
  return follower;
}

describe("the MIDI clock rate", () => {
  it("is 24 pulses per quarter note, as the MIDI spec fixes it", () => {
    expect(CLOCK_PPQN).toBe(24);
  });

  it("inverts the interval this app sends at", () => {
    // Whatever tempo the output side would pulse at, the input side must read
    // back. These two are each other's inverse or the two directions disagree.
    for (const tempo of [40, 60, 120, 137, 240]) {
      const interval = clockPulseInterval(tempo, 4);
      expect(tempoFromTickInterval(interval, 4)).toBeCloseTo(tempo, 6);
    }
  });

  it("reads the ratio, so a non-quarter sync ratio still lands", () => {
    const interval = clockPulseInterval(120, 8);
    expect(tempoFromTickInterval(interval, 8)).toBeCloseTo(120, 6);
  });

  it("refuses a zero or negative interval rather than returning infinity", () => {
    expect(tempoFromTickInterval(0, 4)).toBeNull();
    expect(tempoFromTickInterval(-0.01, 4)).toBeNull();
  });
});

describe("following an incoming clock", () => {
  it("reports no tempo until it has seen two ticks", () => {
    expect(followerTempo(createClockFollower(), 4)).toBeNull();
    expect(followerTempo(clockTick(createClockFollower(), 0), 4)).toBeNull();
  });

  it("locks to a steady clock", () => {
    expect(followerTempo(evenTicks(120, 24), 4)).toBeCloseTo(120, 4);
  });

  it("follows a tempo change rather than averaging it forever", () => {
    // The window is one beat, so a full beat at the new tempo must read as the
    // new tempo and not as a blend with the old one.
    let follower = evenTicks(90, 24);
    let at = 23 * clockPulseInterval(90, 4);
    const faster = clockPulseInterval(160, 4);
    for (let i = 0; i < CLOCK_PPQN; i++) {
      at += faster;
      follower = clockTick(follower, at);
    }
    expect(followerTempo(follower, 4)).toBeCloseTo(160, 3);
  });

  it("rides over jitter instead of chasing it", () => {
    // Scheduling jitter is random and centred on zero, so that is what this
    // feeds: each pulse displaced by up to ±3% of an interval, from a fixed
    // seed so the run is repeatable. Reading a 120 clock to within 1 BPM
    // through that is the bar.
    const interval = clockPulseInterval(120, 4);
    let seed = 0x2f6e2b1;
    const jitter = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return (seed / 0x7fffffff - 0.5) * 0.06 * interval;
    };
    let follower = createClockFollower();
    for (let i = 0; i < 25; i++) follower = clockTick(follower, i * interval + jitter());
    expect(followerTempo(follower, 4)).toBeCloseTo(120, 0);
  });

  it("throws out a single badly displaced pulse", () => {
    // One pulse arriving very late — a stalled tab, a slow interface — must
    // not drag the tempo with it. This is what the trim is for; a plain mean
    // of the gaps is arithmetically just the span over the count, so an
    // outlier at either edge of the window would move the reading directly.
    const interval = clockPulseInterval(120, 4);
    let follower = createClockFollower();
    for (let i = 0; i < 24; i++) follower = clockTick(follower, i * interval);
    follower = clockTick(follower, 23 * interval + interval * 4);
    expect(followerTempo(follower, 4)).toBeCloseTo(120, 0);
  });

  it("keeps only a window of ticks, so it cannot grow without bound", () => {
    const follower = evenTicks(120, 500);
    expect(follower.ticks.length).toBeLessThanOrEqual(CLOCK_PPQN + 1);
  });

  it("reports no tempo when pulses share a timestamp", () => {
    // A burst delivered with one timestamp gives a zero-length gap, which
    // implies an infinite tempo. Better to admit it cannot tell.
    let follower = createClockFollower();
    follower = clockTick(follower, 5);
    follower = clockTick(follower, 5);
    expect(followerTempo(follower, 4)).toBeNull();
  });

  it("clamps to the tempo range the rest of the app accepts", () => {
    // A pathologically fast or slow clock must not push the transport
    // somewhere no other control could return it from.
    expect(followerTempo(evenTicks(2000, 24), 4)!).toBeLessThanOrEqual(999);
    expect(followerTempo(evenTicks(2, 24), 4)!).toBeGreaterThanOrEqual(1);
  });
});

describe("the transport messages", () => {
  it("starts stopped", () => {
    expect(createClockFollower().transport).toBe("stopped");
  });

  it("runs on Start, and rewinds to the top", () => {
    // 0xFA means start from the beginning, unlike Continue.
    const started = clockStart(clockSongPosition(createClockFollower(), 64));
    expect(started.transport).toBe("running");
    expect(started.songPositionSixteenths).toBe(0);
  });

  it("stops on Stop but keeps its place", () => {
    const stopped = clockStop(clockStart(clockSongPosition(createClockFollower(), 32)));
    expect(stopped.transport).toBe("stopped");
  });

  it("resumes on Continue without rewinding", () => {
    const placed = clockSongPosition(createClockFollower(), 48);
    const resumed = clockContinue(clockStop(placed));
    expect(resumed.transport).toBe("running");
    expect(resumed.songPositionSixteenths).toBe(48);
  });

  it("takes a Song Position Pointer in sixteenth notes", () => {
    // The MIDI spec counts SPP in sixteenths, which is six clock pulses each.
    expect(clockSongPosition(createClockFollower(), 16).songPositionSixteenths).toBe(16);
  });

  it("forgets the tick history on Start, so an old tempo cannot leak in", () => {
    expect(clockStart(evenTicks(120, 24)).ticks).toHaveLength(0);
  });
});

describe("losing the clock", () => {
  it("is not stale while ticks are arriving on time", () => {
    const interval = clockPulseInterval(120, 4);
    const follower = evenTicks(120, 24);
    const lastAt = 23 * interval;
    expect(isClockStale(follower, lastAt + interval, 4)).toBe(false);
  });

  it("goes stale once the clock stops arriving", () => {
    // Silence for several pulses means the source is gone; the transport has
    // to fall back to its own tempo rather than freeze at the last one.
    const interval = clockPulseInterval(120, 4);
    const follower = evenTicks(120, 24);
    const lastAt = 23 * interval;
    expect(isClockStale(follower, lastAt + interval * (STALE_TICKS + 1), 4)).toBe(true);
  });

  it("judges a lone pulse against a default tempo", () => {
    // One pulse is not enough to read a tempo from, but it is evidence a
    // source exists, so staleness is measured against a nominal 120 rather
    // than treating it as no clock at all.
    const follower = clockTick(createClockFollower(), 0);
    expect(isClockStale(follower, 0.01, 4)).toBe(false);
    expect(isClockStale(follower, 10, 4)).toBe(true);
  });

  it("counts a follower that has never seen a tick as stale", () => {
    expect(isClockStale(createClockFollower(), 0, 4)).toBe(true);
  });
});
