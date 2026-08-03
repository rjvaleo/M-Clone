import { describe, expect, it } from "vitest";
import {
  ClockSkewTracker,
  outputLatencySec,
  PresentationClock,
  type AudioTimingSource,
} from "./skew";

class FakeContext implements AudioTimingSource {
  currentTime = 0;
  outputLatency?: number;
  baseLatency?: number;
  stamp: { contextTime?: number; performanceTime?: number } | null = null;

  constructor(init: Partial<FakeContext> = {}) {
    Object.assign(this, init);
  }

  getOutputTimestamp() {
    if (!this.stamp) return {};
    return this.stamp;
  }
}

describe("Output latency discovery", () => {
  it("prefers outputLatency, falls back to baseLatency, then zero", () => {
    expect(outputLatencySec(new FakeContext({ outputLatency: 0.03, baseLatency: 0.005 }))).toBe(0.03);
    expect(outputLatencySec(new FakeContext({ baseLatency: 0.005 }))).toBe(0.005);
    expect(outputLatencySec(new FakeContext())).toBe(0);
    expect(outputLatencySec(new FakeContext({ outputLatency: Number.NaN, baseLatency: -1 }))).toBe(0);
  });
});

describe("Clock skew tracking", () => {
  it("anchors immediately from a single sample", () => {
    const tracker = new ClockSkewTracker();
    expect(tracker.ready).toBe(false);
    tracker.observe(10, 20_000);
    expect(tracker.ready).toBe(true);
    expect(tracker.slopeMsPerSec).toBe(1000);
    expect(tracker.toPerformanceMs(11)).toBeCloseTo(21_000, 9);
  });

  it("follows a genuine rate difference between the two clocks", () => {
    const tracker = new ClockSkewTracker();
    // The audio hardware runs 200 ppm fast relative to the system clock.
    for (let i = 0; i < 64; i++) tracker.observe(i * 0.025, 5_000 + i * 0.025 * 1000.2);
    expect(tracker.slopeMsPerSec).toBeCloseTo(1000.2, 3);
    expect(tracker.toPerformanceMs(100)).toBeCloseTo(5_000 + 100_020, 3);
  });

  it("averages out render-quantum jitter instead of tracking it", () => {
    const tracker = new ClockSkewTracker();
    const jitter = [0, 2.6, -1.4, 1.1, -2.3, 0.7, 2.9, -0.9];
    for (let i = 0; i < 64; i++) {
      tracker.observe(i * 0.025, 1_000 + i * 25 + jitter[i % jitter.length]);
    }
    // A single noisy sample would be off by up to ~3 ms; the fit is far closer.
    expect(tracker.toPerformanceMs(1)).toBeCloseTo(2_000, 0);
    expect(Math.abs(tracker.toPerformanceMs(1) - 2_000)).toBeLessThan(1);
  });

  it("rejects nonsensical rates rather than propagating them", () => {
    const tracker = new ClockSkewTracker();
    for (let i = 0; i < 8; i++) tracker.observe(i * 0.001, i * 500);
    expect(tracker.slopeMsPerSec).toBeLessThanOrEqual(1100);
    expect(tracker.slopeMsPerSec).toBeGreaterThanOrEqual(900);
  });

  it("holds the nominal rate when samples share one context time", () => {
    const tracker = new ClockSkewTracker();
    tracker.observe(5, 1_000);
    tracker.observe(5, 1_002);
    expect(tracker.slopeMsPerSec).toBe(1000);
  });

  it("bounds its window and ignores non-finite samples", () => {
    const tracker = new ClockSkewTracker(4);
    for (let i = 0; i < 20; i++) tracker.observe(i, i * 1000);
    expect(tracker.sampleCount).toBe(4);
    tracker.observe(Number.NaN, 5);
    tracker.observe(5, Number.POSITIVE_INFINITY);
    expect(tracker.sampleCount).toBe(4);
    tracker.reset();
    expect(tracker.sampleCount).toBe(0);
    expect(tracker.ready).toBe(false);
  });
});

describe("Presentation clock", () => {
  it("uses an output timestamp as-is, since it already includes latency", () => {
    const context = new FakeContext({ currentTime: 2, outputLatency: 0.03 });
    context.stamp = { contextTime: 1.9, performanceTime: 5_000 };
    const clock = new PresentationClock(context, () => 4_900);
    clock.sample();
    // Audio scheduled at 1.9 is heard at performance time 5000, not 5030.
    expect(clock.performanceMsFor(1.9)).toBeCloseTo(5_000, 6);
    expect(clock.nowSec()).toBe(2);
  });

  it("adds output latency when the browser has no output timestamp", () => {
    const context = new FakeContext({ currentTime: 2, outputLatency: 0.03 });
    const clock = new PresentationClock(context, () => 5_000);
    clock.sample();
    // Audio scheduled now is heard 30 ms from now — that is the whole fix.
    expect(clock.performanceMsFor(2)).toBeCloseTo(5_030, 6);
    expect(clock.performanceMsFor(2.5)).toBeCloseTo(5_530, 6);
  });

  it("keeps the two paths agreeing about when a note is heard", () => {
    const withStamp = new FakeContext({ currentTime: 2, outputLatency: 0.03 });
    withStamp.stamp = { contextTime: 2, performanceTime: 5_030 };
    const without = new FakeContext({ currentTime: 2, outputLatency: 0.03 });
    const a = new PresentationClock(withStamp, () => 5_000);
    const b = new PresentationClock(without, () => 5_000);
    a.sample();
    b.sample();
    expect(a.performanceMsFor(2)).toBeCloseTo(b.performanceMsFor(2), 6);
  });

  it("treats the user latency control as a trim on top of alignment", () => {
    const context = new FakeContext({ currentTime: 0 });
    const clock = new PresentationClock(context, () => 1_000);
    clock.sample();
    expect(clock.performanceMsFor(0, 12)).toBeCloseTo(1_012, 6);
  });

  it("samples on demand if asked before the first wake", () => {
    const context = new FakeContext({ currentTime: 1 });
    const clock = new PresentationClock(context, () => 2_000);
    expect(clock.skew.ready).toBe(false);
    expect(clock.performanceMsFor(1)).toBeCloseTo(2_000, 6);
    expect(clock.skew.ready).toBe(true);
  });

  it("ignores a partial output timestamp and resets cleanly", () => {
    const context = new FakeContext({ currentTime: 3 });
    context.stamp = { contextTime: 3 };
    const clock = new PresentationClock(context, () => 7_000);
    clock.sample();
    expect(clock.performanceMsFor(3)).toBeCloseTo(7_000, 6);
    clock.reset();
    expect(clock.skew.ready).toBe(false);
  });
});
