import { afterEach, describe, expect, it, vi } from "vitest";
import {
  browserDriverFactories,
  createSchedulerDriver,
  ManualSchedulerDriver,
  quantaPerWake,
  TimerSchedulerDriver,
  type SchedulerDriver,
} from "./clock";

const stubDriver = (kind: SchedulerDriver["kind"]): SchedulerDriver => ({
  kind,
  start: () => undefined,
  stop: () => undefined,
  once: () => 0,
  cancel: () => undefined,
  dispose: () => undefined,
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Manual driver", () => {
  it("delivers scheduling wakes on demand", () => {
    const driver = new ManualSchedulerDriver();
    let wakes = 0;
    driver.start(() => { wakes += 1; }, 25);
    expect(driver.running).toBe(true);
    expect(driver.intervalMs).toBe(25);
    driver.fire(3);
    expect(wakes).toBe(3);
    driver.stop();
    driver.fire();
    expect(wakes).toBe(3);
  });

  it("collects and cancels deferred wakes", () => {
    const driver = new ManualSchedulerDriver();
    const seen: string[] = [];
    driver.once(() => seen.push("a"), 100);
    const handle = driver.once(() => seen.push("b"), 200);
    expect(driver.deferredCount).toBe(2);
    driver.cancel(handle);
    driver.fireDeferred();
    expect(seen).toEqual(["a"]);
    expect(driver.deferredCount).toBe(0);
  });

  it("releases everything on dispose", () => {
    const driver = new ManualSchedulerDriver();
    driver.start(() => undefined, 25);
    driver.once(() => undefined, 1);
    driver.dispose();
    expect(driver.running).toBe(false);
    expect(driver.deferredCount).toBe(0);
  });
});

describe("Timer driver", () => {
  it("repeats, restarts cleanly, and stops", () => {
    vi.useFakeTimers();
    const driver = new TimerSchedulerDriver();
    let wakes = 0;
    driver.start(() => { wakes += 1; }, 25);
    vi.advanceTimersByTime(100);
    expect(wakes).toBe(4);
    // Starting again must not leave the first interval running.
    driver.start(() => { wakes += 1; }, 25);
    vi.advanceTimersByTime(25);
    expect(wakes).toBe(5);
    driver.stop();
    vi.advanceTimersByTime(100);
    expect(wakes).toBe(5);
    driver.stop();
  });

  it("schedules and cancels deferred wakes", () => {
    vi.useFakeTimers();
    const driver = new TimerSchedulerDriver();
    let fired = 0;
    const handle = driver.once(() => { fired += 1; }, 50);
    driver.cancel(handle);
    vi.advanceTimersByTime(100);
    expect(fired).toBe(0);
    driver.once(() => { fired += 1; }, 50);
    vi.advanceTimersByTime(50);
    expect(fired).toBe(1);
    driver.dispose();
  });
});

describe("Driver selection", () => {
  it("prefers the audio worklet", async () => {
    const driver = await createSchedulerDriver({
      audioWorklet: async () => stubDriver("audio-worklet"),
      worker: () => stubDriver("worker"),
      timer: () => stubDriver("timer"),
    });
    expect(driver.kind).toBe("audio-worklet");
  });

  it("falls back to a worker when the worklet is unavailable", async () => {
    const driver = await createSchedulerDriver({
      audioWorklet: async () => null,
      worker: () => stubDriver("worker"),
      timer: () => stubDriver("timer"),
    });
    expect(driver.kind).toBe("worker");
  });

  it("falls back past a worklet that throws", async () => {
    const driver = await createSchedulerDriver({
      audioWorklet: async () => { throw new Error("no AudioWorklet"); },
      worker: () => stubDriver("worker"),
      timer: () => stubDriver("timer"),
    });
    expect(driver.kind).toBe("worker");
  });

  it("falls back to a timer when a CSP blocks blob workers", async () => {
    const driver = await createSchedulerDriver({
      audioWorklet: async () => null,
      worker: () => { throw new Error("blocked by CSP"); },
      timer: () => stubDriver("timer"),
    });
    expect(driver.kind).toBe("timer");
  });

  it("uses the timer when nothing else is offered", async () => {
    const driver = await createSchedulerDriver({ timer: () => stubDriver("timer") });
    expect(driver.kind).toBe("timer");
    const nullWorker = await createSchedulerDriver({
      worker: () => null,
      timer: () => stubDriver("timer"),
    });
    expect(nullWorker.kind).toBe("timer");
  });

  it("omits factories the platform cannot support", () => {
    const factories = browserDriverFactories(null, 25);
    expect(factories.audioWorklet).toBeUndefined();
    // Node has no Worker global, which is exactly the browser-without-Worker case.
    expect(factories.worker).toBeUndefined();
    expect(factories.timer().kind).toBe("timer");
  });
});

describe("Worklet wake interval", () => {
  it("converts a wake interval into render quanta", () => {
    // 25 ms at 48 kHz is 1200 frames, which is between 9 and 10 quanta.
    expect(quantaPerWake(48_000, 25)).toBe(9);
    expect(quantaPerWake(44_100, 25)).toBe(9);
    expect(quantaPerWake(48_000, 100)).toBe(38);
  });

  it("never asks for less than one quantum and survives bad input", () => {
    expect(quantaPerWake(48_000, 0.1)).toBe(1);
    expect(quantaPerWake(0, 25)).toBe(9);
    expect(quantaPerWake(Number.NaN, Number.NaN)).toBe(9);
  });
});
