import { describe, expect, it } from "vitest";
import { arcPath, dragValue, fromFraction, knobAngle, padPoint, padValues, toFraction, travelFor } from "./travel";

describe("A control's travel", () => {
  it("is straight on a linear control", () => {
    expect(toFraction(25, 0, 100, "linear")).toBeCloseTo(0.25, 12);
    expect(fromFraction(0.25, 0, 100, "linear")).toBeCloseTo(25, 12);
  });

  it("is even in octaves on a logarithmic control", () => {
    // 20 Hz to 20 kHz: 632 Hz is halfway, by ratio.
    expect(toFraction(Math.sqrt(20 * 20000), 20, 20000, "log")).toBeCloseTo(0.5, 12);
    expect(fromFraction(0.5, 20, 20000, "log")).toBeCloseTo(Math.sqrt(20 * 20000), 9);
  });

  it("follows JUCE's skew on a SoundHack dial", () => {
    // proportion = ((v − min) / (max − min)) ^ skew — ++delay's time at 80 ms.
    expect(toFraction(80, 1, 10000, { skew: 0.3 })).toBeCloseTo(Math.pow(79 / 9999, 0.3), 12);
    expect(fromFraction(Math.pow(79 / 9999, 0.3), 1, 10000, { skew: 0.3 })).toBeCloseTo(80, 9);
  });

  it("holds every travel to its ends", () => {
    for (const travel of ["linear", "log", { skew: 0.3 }] as const) {
      expect(toFraction(-1e9, 1, 100, travel)).toBe(0);
      expect(toFraction(1e9, 1, 100, travel)).toBe(1);
      expect(fromFraction(-1, 1, 100, travel)).toBeCloseTo(1, 12);
      expect(fromFraction(2, 1, 100, travel)).toBeCloseTo(100, 9);
    }
  });

  it("treats a logarithmic range that reaches zero as linear rather than dividing by it", () => {
    expect(toFraction(50, 0, 100, "log")).toBeCloseTo(0.5, 12);
  });

  it("moves a knob by its travel, 150 pixels end to end, snapped to the step", () => {
    const spec = { min: 20, max: 20000, travel: "log" as const, step: 1 };
    // Half the drag from the bottom lands halfway by ratio.
    expect(dragValue(20, 75, spec)).toBe(Math.round(Math.sqrt(20 * 20000)));
    expect(dragValue(20000, 1000, spec)).toBe(20000);
    expect(dragValue(20, -1000, spec)).toBe(20);
  });

  it("drags finely while held with shift", () => {
    const spec = { min: 0, max: 1, travel: "linear" as const, step: 0.001 };
    expect(dragValue(0.5, 15, spec)).toBeCloseTo(0.6, 9);
    expect(dragValue(0.5, 15, spec, true)).toBeCloseTo(0.51, 9);
  });

  it("turns a fraction into the knob's angle and arc", () => {
    expect(knobAngle(0)).toBe(-135);
    expect(knobAngle(0.5)).toBe(0);
    expect(knobAngle(1)).toBe(135);
    expect(arcPath(20, 20, 15, -135, -135)).toMatch(/^M /);
    // More than half a turn takes the large arc.
    expect(arcPath(20, 20, 15, -135, 135)).toContain(" 0 1 1 ");
    expect(arcPath(20, 20, 15, -135, 0)).toContain(" 0 0 1 ");
  });

  it("reads a logarithmic control from the step prism-gen gives it", () => {
    expect(travelFor({ minimum: 20, maximum: 20000, step: 0.2 })).toBe("log");
    expect(travelFor({ minimum: 20, maximum: 20000, step: 1 })).toBe("linear");
    expect(travelFor({ minimum: 0, maximum: 1, step: 0.001 })).toBe("linear");
    expect(travelFor({})).toBe("linear");
  });

  it("has nowhere to go on an empty range, and drags unsnapped without a step", () => {
    expect(toFraction(5, 1, 1, "linear")).toBe(0);
    expect(dragValue(0, 75, { min: 0, max: 1, travel: "linear" })).toBeCloseTo(0.5, 12);
  });

  it("reads a point on Hyperprism's pad as both its values, linear, Y up", () => {
    const x = { min: 0, max: 20000, step: 1 };
    const y = { min: 0, max: 10, step: 0.01 };
    // A quarter across from the left, a quarter down from the top.
    expect(padValues(0.25, 0.25, x, y)).toEqual([5000, 7.5]);
    expect(padValues(-1, 2, x, y)).toEqual([0, 0]);
    expect(padPoint(5000, 7.5, x, y)).toEqual([0.25, 0.25]);
  });
});

describe("MultiGrainLive's logarithmic slider, a range of ticks", () => {
  it("lands each tick on min·(max/min)^(tick/log), rounded where its handler rounds", () => {
    // Four ticks from 1 to 10 000: one per decade.
    expect(fromFraction(0.5, 1, 10_000, { log: 4 })).toBeCloseTo(100, 9);
    // 0.6 of four ticks is the nearest tick, 2.4 → 2.
    expect(fromFraction(0.6, 1, 10_000, { log: 4 })).toBeCloseTo(100, 9);
    expect(fromFraction(1 / 3, 1, 8, { log: 3, round: true })).toBe(2);
    expect(fromFraction(0.5, 1, 10, { log: 1, round: true })).toBe(10);
    expect(toFraction(100, 1, 10_000, { log: 4 })).toBeCloseTo(0.5, 12);
  });

  it("runs straight when its range reaches zero", () => {
    expect(fromFraction(0.5, 0, 100, { log: 4 })).toBe(50);
  });

  it("drags from tick to tick, never snapped to the step", () => {
    // Half the travel up from the bottom: two decades.
    expect(dragValue(1, 75, { min: 1, max: 10_000, travel: { log: 4 }, step: 7 })).toBeCloseTo(100, 9);
  });

  it("leaves a pad axis with no step unsnapped", () => {
    expect(padValues(0.3, 0.5, { min: 0, max: 1 }, { min: 0, max: 1, step: 0 })).toEqual([0.3, 0.5]);
  });
});
