import { describe, expect, it } from "vitest";
import {
  DEFAULT_SCHEDULING_CONFIG,
  dropLateAttacks,
  SchedulingMonitor,
  TelemetryRing,
} from "./scheduling";

describe("Scheduling policy", () => {
  it("holds the base lookahead while wakes arrive on time", () => {
    const monitor = new SchedulingMonitor();
    const decision = monitor.observeWake(1, 1, 0);
    expect(decision.recover).toBe(false);
    expect(decision.latenessSec).toBe(0);
    expect(decision.lookaheadSec).toBe(DEFAULT_SCHEDULING_CONFIG.baseLookaheadSec);
  });

  it("grows the lookahead under jank and caps it", () => {
    const monitor = new SchedulingMonitor();
    expect(monitor.observeWake(1.1, 1, 0).lookaheadSec).toBeCloseTo(0.17, 12);
    // A very late wake is bounded by the ceiling rather than growing forever.
    expect(monitor.observeWake(10, 1, 0).lookaheadSec)
      .toBe(DEFAULT_SCHEDULING_CONFIG.maxLookaheadSec);
  });

  it("never drops below the floor", () => {
    const monitor = new SchedulingMonitor({ baseLookaheadSec: 0.01 });
    expect(monitor.observeWake(1, 1, 0).lookaheadSec)
      .toBe(DEFAULT_SCHEDULING_CONFIG.minLookaheadSec);
  });

  it("flags a serious stall as needing recovery", () => {
    const monitor = new SchedulingMonitor();
    expect(monitor.observeWake(2, 1, 3).recover).toBe(true);
    const diagnostics = monitor.snapshot();
    expect(diagnostics.recoveries).toBe(1);
    expect(diagnostics.droppedWindows).toBe(1);
    expect(diagnostics.maxQueueDepth).toBe(3);
    expect(diagnostics.maxWakeLatenessSec).toBe(1);
  });

  it("measures submission lead and event lateness", () => {
    const monitor = new SchedulingMonitor();
    monitor.observeBatch([{ atSec: 1.05 }, { atSec: 0.98 }], 1);
    const diagnostics = monitor.snapshot();
    expect(diagnostics.minSubmissionLeadSec).toBeCloseTo(-0.02, 12);
    expect(diagnostics.maxEventLatenessSec).toBeCloseTo(0.02, 12);
  });

  it("counts recoveries, dropped events, and budget overruns", () => {
    const monitor = new SchedulingMonitor({ eventBudgetPerWindow: 16 });
    expect(monitor.eventBudget).toBe(16);
    monitor.recordRecovery();
    monitor.recordDroppedEvents(2.4);
    monitor.recordDroppedEvents(-5);
    monitor.recordBudgetOverrun();
    const diagnostics = monitor.snapshot();
    expect(diagnostics.recoveries).toBe(1);
    expect(diagnostics.droppedEvents).toBe(2);
    expect(diagnostics.budgetOverruns).toBe(1);
    monitor.reset();
    expect(monitor.snapshot().recoveries).toBe(0);
  });

  it("drops stale attacks but keeps releases that repair a device", () => {
    const events = [
      { type: "note-on", atSec: 0.9 },
      { type: "note-on", atSec: 1.2 },
      { type: "note-off", atSec: 0.5 },
      { type: "program-change", atSec: 0.1 },
    ];
    const result = dropLateAttacks(events, 1, 0.02);
    expect(result.dropped).toBe(1);
    expect(result.events.map((event) => event.type))
      .toEqual(["note-on", "note-off", "program-change"]);
    expect(dropLateAttacks(events, 1, -1).dropped).toBe(1);
  });
});

describe("Telemetry ring", () => {
  it("drains oldest first and empties", () => {
    const ring = new TelemetryRing<number>(4);
    for (const value of [1, 2, 3]) ring.push(value);
    expect(ring.size).toBe(3);
    expect(ring.drain()).toEqual([1, 2, 3]);
    expect(ring.size).toBe(0);
    expect(ring.drain()).toEqual([]);
  });

  it("overwrites oldest entries instead of growing", () => {
    const ring = new TelemetryRing<number>(3);
    for (const value of [1, 2, 3, 4, 5]) ring.push(value);
    expect(ring.capacity).toBe(3);
    expect(ring.dropped).toBe(2);
    expect(ring.drain()).toEqual([3, 4, 5]);
    ring.resetDropped();
    expect(ring.dropped).toBe(0);
  });

  it("survives a UI that never drains", () => {
    const ring = new TelemetryRing<number>(8);
    for (let i = 0; i < 100_000; i++) ring.push(i);
    expect(ring.size).toBe(8);
    expect(ring.drain()).toEqual([99_992, 99_993, 99_994, 99_995, 99_996, 99_997, 99_998, 99_999]);
  });

  it("clears and refuses a degenerate capacity", () => {
    const ring = new TelemetryRing<number>(0);
    expect(ring.capacity).toBe(1);
    ring.push(1);
    ring.push(2);
    ring.clear();
    expect(ring.size).toBe(0);
    expect(ring.dropped).toBe(0);
    expect(ring.drain()).toEqual([]);
  });
});
