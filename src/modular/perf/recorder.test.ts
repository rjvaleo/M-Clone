import { describe, expect, it } from "vitest";
import { PerfRecorder } from "./recorder";

describe("the performance recorder", () => {
  it("keeps count, total, average and worst time per name, within a recent window", () => {
    let now = 0;
    const perf = new PerfRecorder({ windowMs: 1000, clock: () => now });
    perf.record("render:noteseq", 4);
    perf.record("render:noteseq", 8);
    perf.record("measure ports", 1);
    const rows = perf.report();
    expect(rows[0]).toEqual({ name: "render:noteseq", calls: 2, totalMs: 12, avgMs: 6, maxMs: 8 });
    expect(rows[1].name).toBe("measure ports");
    now = 1500;
    perf.record("measure ports", 2);
    expect(perf.report()).toEqual([{ name: "measure ports", calls: 1, totalMs: 2, avgMs: 2, maxMs: 2 }]);
  });

  it("times a function and still returns what it returns", () => {
    let now = 0;
    const perf = new PerfRecorder({ clock: () => now });
    const value = perf.time("status poll", () => { now += 3; return 42; });
    expect(value).toBe(42);
    expect(perf.report()[0]).toMatchObject({ name: "status poll", calls: 1, totalMs: 3 });
  });

  it("reports frames: how many, the slow ones, and the 95th percentile", () => {
    let now = 0;
    const perf = new PerfRecorder({ clock: () => now });
    for (const gap of [16, 16, 17, 16, 50]) { now += gap; perf.frame(gap); }
    expect(perf.frames()).toEqual({ count: 5, slow: 1, p95Ms: 50, fps: 5 / (115 / 1000) });
  });

  it("does nothing while switched off", () => {
    const perf = new PerfRecorder({ clock: () => 0 });
    perf.enabled = false;
    perf.record("x", 5);
    expect(perf.report()).toEqual([]);
  });
});

describe("the performance recorder's edges", () => {
  it("reads the page clock when none is given", () => {
    const perf = new PerfRecorder();
    const before = performance.now();
    perf.time("default clock", () => 0);
    const [row] = perf.report();
    expect(row.name).toBe("default clock");
    expect(row.totalMs).toBeGreaterThanOrEqual(0);
    expect(row.totalMs).toBeLessThanOrEqual(performance.now() - before);
  });

  it("reports no frames as zeros, and ignores frames while switched off", () => {
    const perf = new PerfRecorder({ clock: () => 0 });
    expect(perf.frames()).toEqual({ count: 0, slow: 0, p95Ms: 0, fps: 0 });
    perf.enabled = false;
    perf.frame(40);
    expect(perf.frames().count).toBe(0);
    expect(perf.time("off", () => 7)).toBe(7);
    expect(perf.report()).toEqual([]);
  });

  it("clear forgets every timing and every frame", () => {
    const perf = new PerfRecorder({ clock: () => 0 });
    perf.record("render", 3);
    perf.frame(16);
    perf.clear();
    expect(perf.report()).toEqual([]);
    expect(perf.frames().count).toBe(0);
  });
});
