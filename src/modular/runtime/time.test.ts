import { describe, expect, it } from "vitest";
import {
  barBeat,
  PPQN,
  secondsPerTick,
  stepTicks,
  TempoMap,
} from "./time";

describe("Modular tick time model", () => {
  it("derives seconds from ticks without accumulating error", () => {
    const map = new TempoMap(120);
    // One quarter note at 120 BPM is exactly half a second.
    expect(map.tickToSeconds(PPQN)).toBeCloseTo(0.5, 12);
    // A position reached by a million steps is identical to the direct answer,
    // which is the property repeated float addition cannot provide.
    const stepped = PPQN * 1_000_000;
    expect(map.tickToSeconds(stepped)).toBe(0.5 * 1_000_000);
  });

  it("round-trips seconds and ticks across tempo changes", () => {
    const map = new TempoMap(120);
    map.setTempoAt(4 * PPQN, 60);
    expect(map.tickToSeconds(4 * PPQN)).toBeCloseTo(2, 12);
    // After the change a quarter note takes a full second.
    expect(map.tickToSeconds(5 * PPQN)).toBeCloseTo(3, 12);
    expect(map.bpmAt(5 * PPQN)).toBe(60);
    expect(map.secondsToTick(3)).toBeCloseTo(5 * PPQN, 6);
    expect(map.secondsToTickFloor(3)).toBe(5 * PPQN);
  });

  it("keeps already-scheduled time fixed when tempo changes later", () => {
    const map = new TempoMap(120);
    const before = map.tickToSeconds(PPQN);
    map.setTempoAt(4 * PPQN, 200);
    expect(map.tickToSeconds(PPQN)).toBe(before);
  });

  it("replaces the origin when tempo changes at tick zero", () => {
    const map = new TempoMap(120, 5);
    map.setTempoAt(0, 60);
    expect(map.snapshot()).toEqual([{ tick: 0, seconds: 5, bpm: 60 }]);
  });

  it("shifts real time on resume without moving musical positions", () => {
    const map = new TempoMap(120);
    map.setTempoAt(4 * PPQN, 90);
    const musical = map.snapshot().map((anchor) => anchor.tick);
    map.shiftSeconds(1.25);
    expect(map.snapshot().map((anchor) => anchor.tick)).toEqual(musical);
    expect(map.tickToSeconds(PPQN)).toBeCloseTo(1.75, 12);
    expect(map.originSec).toBeCloseTo(1.25, 12);
  });

  it("ignores meaningless shifts and re-origins to an absolute time", () => {
    const map = new TempoMap(120, 2);
    map.shiftSeconds(0);
    map.shiftSeconds(Number.NaN);
    expect(map.originSec).toBe(2);
    map.rebaseOrigin(10);
    expect(map.originSec).toBe(10);
  });

  it("clamps tempo to a musically usable range", () => {
    expect(new TempoMap(0).bpmAt(0)).toBe(1);
    expect(new TempoMap(100_000).bpmAt(0)).toBe(999);
    expect(new TempoMap(Number.NaN).bpmAt(0)).toBe(120);
    expect(secondsPerTick(120)).toBeCloseTo(60 / (120 * PPQN), 15);
  });

  it("never returns a zero-length step, so window planners terminate", () => {
    expect(stepTicks(1, 16)).toBe(PPQN / 4);
    expect(stepTicks(3, 8)).toBe((PPQN * 4 * 3) / 8);
    expect(stepTicks(1, 0)).toBe(1);
    expect(stepTicks(0, 4)).toBe(1);
    expect(stepTicks(-1, 4)).toBe(1);
    expect(stepTicks(Number.NaN, 4)).toBe(PPQN);
    expect(stepTicks(1, Number.POSITIVE_INFINITY)).toBe(PPQN);
  });

  it("restores a serialized map and normalizes its origin", () => {
    const map = TempoMap.fromAnchors([
      { tick: 8 * PPQN, seconds: 4, bpm: 90 },
      { tick: 3, seconds: 0, bpm: 120 },
    ]);
    expect(map.snapshot()[0].tick).toBe(0);
    expect(map.bpmAt(8 * PPQN)).toBe(90);
    expect(TempoMap.fromAnchors([]).bpmAt(0)).toBe(120);
  });

  it("reports bar and beat positions for transport display", () => {
    expect(barBeat(0)).toEqual({ bar: 1, beat: 1, tick: 0 });
    expect(barBeat(PPQN * 2 + 10)).toEqual({ bar: 1, beat: 3, tick: 10 });
    expect(barBeat(PPQN * 4)).toEqual({ bar: 2, beat: 1, tick: 0 });
    expect(barBeat(PPQN * 3, 3, 4)).toEqual({ bar: 2, beat: 1, tick: 0 });
    expect(barBeat(-5)).toEqual({ bar: 1, beat: 1, tick: 0 });
    expect(barBeat(PPQN, 4, 0)).toEqual({ bar: 1, beat: 1, tick: PPQN });
  });
});
