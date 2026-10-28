import { describe, expect, it } from "vitest";
import { SpecContext, SpecParam, specGain } from "./specParam";

describe("SpecParam, the Web Audio timeline", () => {
  it("keeps its intrinsic value whatever is scheduled", () => {
    const param = new SpecParam(1);
    param.setValueAtTime(0.25, 0);
    expect(param.value).toBe(1);
    expect(param.valueAt(0)).toBe(0.25);
  });

  it("holds the default before the first event", () => {
    const param = new SpecParam(1);
    param.setValueAtTime(0.5, 2);
    expect(param.valueAt(1)).toBe(1);
    expect(param.valueAt(2)).toBe(0.5);
  });

  it("approaches a target exponentially from where it was", () => {
    const param = new SpecParam(1);
    param.setValueAtTime(0.8, 1);
    param.setTargetAtTime(0, 1, 0.5);
    expect(param.valueAt(1)).toBeCloseTo(0.8, 12);
    expect(param.valueAt(1.5)).toBeCloseTo(0.8 * Math.exp(-1), 12);
  });

  it("ramps linearly from the previous event", () => {
    const param = new SpecParam(1);
    param.setValueAtTime(0, 1);
    param.linearRampToValueAtTime(0.6, 1.1);
    expect(param.valueAt(1.05)).toBeCloseTo(0.3, 12);
    expect(param.valueAt(2)).toBeCloseTo(0.6, 12);
  });

  it("lets a ramp after a target start from the target's start, as one not yet begun", () => {
    // The specification's other branch depends on the context's current time
    // when the ramp is scheduled, which nothing here has.
    const param = new SpecParam(1);
    param.setValueAtTime(0.4, 0);
    param.setTargetAtTime(0, 0.5, 1);
    param.linearRampToValueAtTime(1, 1.5);
    expect(param.valueAt(1)).toBeCloseTo(0.7, 12);
  });

  it("lets a set end a running target", () => {
    const param = new SpecParam(1);
    param.setTargetAtTime(0, 0, 1);
    param.setValueAtTime(0.3, 1);
    expect(param.valueAt(0.5)).toBeCloseTo(Math.exp(-0.5), 12);
    expect(param.valueAt(1.5)).toBe(0.3);
  });

  it("cancels every event at or after a time, and keeps same-time order", () => {
    const param = new SpecParam(1);
    param.setValueAtTime(0.2, 1);
    param.setValueAtTime(0.4, 1);
    expect(param.valueAt(1)).toBe(0.4);
    param.setValueAtTime(0.1, 0.5);
    param.cancelScheduledValues(1);
    expect(param.valueAt(2)).toBe(0.1);
  });

  it("refuses an exponential ramp rather than modelling it wrongly", () => {
    expect(() => new SpecParam(1).exponentialRampToValueAtTime()).toThrow();
  });

  it("gives SpecContext gains a spec param", () => {
    const gain = new SpecContext().createGain();
    expect(specGain(gain)).toBeInstanceOf(SpecParam);
  });
});
