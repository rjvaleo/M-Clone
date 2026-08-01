import { describe, expect, it, vi } from "vitest";
import {
  browserScheduler,
  dropLateAttacks,
  SchedulingMonitor,
  type SchedulerDriver,
} from "./scheduler";

describe("bounded scheduling policy", () => {
  it("provides a browser timer adapter", () => {
    vi.useFakeTimers();
    const repeated = vi.fn();
    const once = vi.fn();
    const repeatHandle = browserScheduler.repeat(repeated, 10);
    const onceHandle = browserScheduler.once(once, 15);
    vi.advanceTimersByTime(20);
    expect(repeated).toHaveBeenCalledTimes(2);
    expect(once).toHaveBeenCalledTimes(1);
    browserScheduler.cancel(repeatHandle);
    browserScheduler.cancel(onceHandle);
    vi.useRealTimers();
  });

  it("adapts lookahead within bounds and exposes measured diagnostics", () => {
    const monitor = new SchedulingMonitor({
      baseLookaheadSec: 0.12,
      minLookaheadSec: 0.08,
      maxLookaheadSec: 0.25,
      seriousStallSec: 0.4,
    });

    expect(monitor.observeWake(1.04, 1, 7)).toMatchObject({ recover: false });
    monitor.observeBatch([{ atSec: 1.1 }, { atSec: 0.99 }], 1);
    expect(monitor.snapshot()).toMatchObject({ wakeCount: 1, maxQueueDepth: 7 });
    expect(monitor.snapshot().maxWakeLatenessSec).toBeCloseTo(0.04);
    expect(monitor.snapshot().minSubmissionLeadSec).toBeCloseTo(-0.01);
    expect(monitor.snapshot().maxEventLatenessSec).toBeCloseTo(0.01);
    expect(monitor.snapshot().lookaheadSec).toBeGreaterThanOrEqual(0.12);
    expect(monitor.snapshot().lookaheadSec).toBeLessThanOrEqual(0.25);
  });

  it("counts explicit dropped attacks", () => {
    const monitor = new SchedulingMonitor();
    monitor.recordDroppedEvents(2.4);
    monitor.recordDroppedEvents(-3);
    expect(monitor.snapshot().droppedEvents).toBe(2);
  });

  it("requests one recovery rather than catch-up after a serious stall", () => {
    const monitor = new SchedulingMonitor({ seriousStallSec: 0.4 });
    expect(monitor.observeWake(2.5, 2, 3)).toEqual(expect.objectContaining({
      recover: true,
      latenessSec: 0.5,
    }));
    expect(monitor.snapshot()).toMatchObject({ droppedWindows: 1, recoveries: 1 });
  });

  it("drops overdue attacks but retains releases and state events", () => {
    const events = [
      { type: "note-on", atSec: 0.8 },
      { type: "note-off", atSec: 0.8 },
      { type: "program-change", atSec: 0.8 },
      { type: "note-on", atSec: 0.99 },
    ] as const;
    expect(dropLateAttacks(events, 1, 0.02)).toEqual({
      events: [events[1], events[2], events[3]],
      dropped: 1,
    });
  });

  it("remains bounded over a long-duration conformance trace", () => {
    const monitor = new SchedulingMonitor();
    for (let wake = 0; wake < 100_000; wake++) {
      const expected = wake * 0.025;
      monitor.observeWake(expected + (wake % 10) * 0.001, expected, wake % 64);
    }
    expect(monitor.snapshot()).toMatchObject({
      wakeCount: 100_000,
      recoveries: 0,
      maxQueueDepth: 63,
    });
    expect(monitor.snapshot().lookaheadSec).toBeLessThanOrEqual(0.25);
  });

  it("defines one injectable scheduler contract for repeating and one-shot wakes", () => {
    const callbacks: Array<() => void> = [];
    const driver: SchedulerDriver = {
      repeat: vi.fn((callback) => (callbacks.push(callback), callbacks.length)),
      once: vi.fn((callback) => (callbacks.push(callback), callbacks.length)),
      cancel: vi.fn(),
    };
    const repeated = driver.repeat(() => undefined, 25);
    const once = driver.once(() => undefined, 50);
    driver.cancel(repeated);
    driver.cancel(once);
    expect(driver.repeat).toHaveBeenCalledWith(expect.any(Function), 25);
    expect(driver.once).toHaveBeenCalledWith(expect.any(Function), 50);
    expect(driver.cancel).toHaveBeenCalledTimes(2);
  });
});
