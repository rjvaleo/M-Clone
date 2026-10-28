import { describe, expect, it } from "vitest";
import {
  crossfadeSchedule,
  CROSSFADE_SEC,
  DISPOSE_MARGIN_SEC,
  ManualTransitionScheduler,
  timerTransitionScheduler,
} from "./transitions";

describe("Crossfade timing", () => {
  it("ends the fade a crossfade after it starts", () => {
    const schedule = crossfadeSchedule(10);
    expect(schedule.fadeStartSec).toBe(10);
    expect(schedule.fadeEndSec).toBe(10 + CROSSFADE_SEC);
  });

  it("holds the old nodes past the end of the fade", () => {
    // Disposal runs on a wall clock and the fade on the audio clock; the margin
    // is what keeps a late timer from truncating audio that is still sounding.
    const schedule = crossfadeSchedule(10);
    expect(schedule.disposeAtSec).toBe(10 + CROSSFADE_SEC + DISPOSE_MARGIN_SEC);
    expect(schedule.disposeAtSec).toBeGreaterThan(schedule.fadeEndSec);
    expect(schedule.disposeDelaySec).toBeCloseTo(CROSSFADE_SEC + DISPOSE_MARGIN_SEC, 9);
  });

  it("accepts explicit durations", () => {
    const schedule = crossfadeSchedule(0, 0.5, 0.25);
    expect(schedule.fadeEndSec).toBe(0.5);
    expect(schedule.disposeAtSec).toBe(0.75);
  });

  it("never produces a negative time", () => {
    const schedule = crossfadeSchedule(-5, -1, -1);
    expect(schedule.fadeStartSec).toBe(0);
    expect(schedule.fadeEndSec).toBe(0);
    expect(schedule.disposeAtSec).toBe(0);
  });
});

describe("Manual scheduler", () => {
  it("runs a task only once its delay has elapsed", () => {
    const scheduler = new ManualTransitionScheduler(0);
    const ran: string[] = [];
    scheduler.after(1, () => ran.push("a"));
    scheduler.advance(0.5);
    expect(ran).toEqual([]);
    scheduler.advance(0.6);
    expect(ran).toEqual(["a"]);
    expect(scheduler.pendingCount).toBe(0);
  });

  it("runs due tasks in time order, not submission order", () => {
    const scheduler = new ManualTransitionScheduler(0);
    const ran: string[] = [];
    scheduler.after(2, () => ran.push("late"));
    scheduler.after(1, () => ran.push("early"));
    scheduler.advance(3);
    expect(ran).toEqual(["early", "late"]);
  });

  it("tracks its own clock", () => {
    const scheduler = new ManualTransitionScheduler(5);
    expect(scheduler.now()).toBe(5);
    scheduler.advance(2.5);
    expect(scheduler.now()).toBe(7.5);
  });

  it("drops everything on cancel", () => {
    const scheduler = new ManualTransitionScheduler(0);
    let ran = false;
    scheduler.after(1, () => { ran = true; });
    scheduler.cancelAll();
    scheduler.advance(5);
    expect(ran).toBe(false);
    expect(scheduler.pendingCount).toBe(0);
  });

  it("treats a negative delay as due immediately", () => {
    const scheduler = new ManualTransitionScheduler(0);
    let ran = false;
    scheduler.after(-3, () => { ran = true; });
    scheduler.advance(0);
    expect(ran).toBe(true);
  });
});

describe("Timer scheduler", () => {
  it("reports the clock it was given and cancels cleanly", async () => {
    let clock = 3;
    const scheduler = timerTransitionScheduler(() => clock);
    expect(scheduler.now()).toBe(3);
    clock = 4;
    expect(scheduler.now()).toBe(4);

    let ran = false;
    scheduler.after(0.01, () => { ran = true; });
    scheduler.cancelAll();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(ran).toBe(false);
  });

  it("runs a task that is not cancelled", async () => {
    const scheduler = timerTransitionScheduler(() => 0);
    let ran = false;
    scheduler.after(0.001, () => { ran = true; });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(ran).toBe(true);
  });
});
