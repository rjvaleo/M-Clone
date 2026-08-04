import { describe, expect, it } from "vitest";
import {
  crushCurve,
  crushCurveLength,
  impulseFrameCount,
  MAX_TAIL_SECONDS,
  renderPlateImpulse,
} from "./dsp";

const render = (seed: number, channels = 2, frames = 2048, rate = 48000): Float32Array[] => {
  const buffers = Array.from({ length: channels }, () => new Float32Array(frames));
  renderPlateImpulse(buffers, rate, { tailSeconds: frames / rate, decayRate: 2.5, seed });
  return buffers;
};

const rms = (values: Float32Array, from: number, to: number): number => {
  let sum = 0;
  for (let i = from; i < to; i++) sum += values[i] * values[i];
  return Math.sqrt(sum / Math.max(1, to - from));
};

describe("Generated plate impulse", () => {
  it("renders the same tail for the same seed, and a different one otherwise", () => {
    // A reverb rebuilds whenever its decay changes. If the tail were drawn from
    // Math.random, a saved project would not reproduce the sound it saved.
    expect([...render(4)[0]]).toEqual([...render(4)[0]]);
    expect([...render(4)[0]]).not.toEqual([...render(5)[0]]);
  });

  it("decorrelates the two channels, so the tail is genuinely stereo", () => {
    const [left, right] = render(9);
    expect([...left]).not.toEqual([...right]);
  });

  it("decays", () => {
    const [left] = render(1, 1, 48000);
    expect(rms(left, 0, 4800)).toBeGreaterThan(rms(left, 43200, 48000) * 4);
  });

  it("stays inside full scale and straddles zero", () => {
    const [left] = render(2, 1);
    let minimum = 1;
    let maximum = -1;
    for (const sample of left) {
      minimum = Math.min(minimum, sample);
      maximum = Math.max(maximum, sample);
    }
    expect(minimum).toBeLessThan(0);
    expect(maximum).toBeGreaterThan(0);
    expect(Math.max(Math.abs(minimum), maximum)).toBeLessThanOrEqual(1);
  });

  it("bounds the buffer a tail may ask for", () => {
    expect(impulseFrameCount(1, 48000)).toBe(48000);
    // An unbounded tail is an unbounded allocation on a control the user drags.
    expect(impulseFrameCount(1000, 48000)).toBe(MAX_TAIL_SECONDS * 48000);
    expect(impulseFrameCount(0, 48000)).toBeGreaterThan(0);
    expect(impulseFrameCount(-5, 48000)).toBeGreaterThan(0);
  });
});

/** How many distinct output levels a curve actually produces. */
const levels = (curve: Float32Array): number => new Set([...curve]).size;

describe("Bit-crush transfer curve", () => {
  it("quantises to roughly two-to-the-bits levels", () => {
    expect(levels(crushCurve(2))).toBeLessThanOrEqual(2 ** 2 * 2 + 1);
    expect(levels(crushCurve(4))).toBeGreaterThan(levels(crushCurve(2)));
    expect(levels(crushCurve(8))).toBeGreaterThan(levels(crushCurve(4)));
  });

  it("maps the full input range and never inverts it", () => {
    const curve = crushCurve(6);
    expect(curve[0]).toBeCloseTo(-1, 5);
    expect(curve[curve.length - 1]).toBeCloseTo(1, 5);
    for (let i = 1; i < curve.length; i++) {
      expect(curve[i]).toBeGreaterThanOrEqual(curve[i - 1]);
    }
  });

  it("is symmetric about zero, so silence does not acquire a DC offset", () => {
    const curve = crushCurve(5);
    const middle = (curve.length - 1) / 2;
    expect(curve[Math.floor(middle)] + curve[Math.ceil(middle)]).toBeCloseTo(0, 6);
  });

  it("sizes itself by quantisation step, and caps", () => {
    // The prototype used a flat 44,100 samples at every depth: wasteful when
    // coarse, and the wrong quantity to hold constant when fine.
    expect(crushCurveLength(2)).toBeLessThan(crushCurveLength(10));
    expect(crushCurveLength(16)).toBeLessThanOrEqual(1 << 16);
    expect(crushCurveLength(1)).toBeGreaterThanOrEqual(512);
  });

  it("clamps a depth outside the sane range instead of allocating wildly", () => {
    expect(crushCurve(0).length).toBe(crushCurve(1).length);
    expect(crushCurve(64).length).toBe(crushCurve(16).length);
    expect(crushCurve(Number.NaN).length).toBe(crushCurve(16).length);
  });
});
