import { describe, expect, it } from "vitest";
import {
  crushCurve,
  crushCurveLength,
  impulseFrameCount,
  MAX_PULSE_WIDTH,
  MAX_TAIL_SECONDS,
  MIN_PULSE_WIDTH,
  PULSE_HARMONICS,
  pulseWaveCoefficients,
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

describe("The pulse wave", () => {
  it("is a square when the duty cycle is half", () => {
    // A 50% pulse has no even harmonics — that absence is what a square sounds
    // like, and it is the first thing to go wrong if the series is mis-indexed.
    const { real } = pulseWaveCoefficients(0.5);
    expect(real[0]).toBeCloseTo(0, 12);
    for (let n = 2; n < 16; n += 2) expect(Math.abs(real[n]), `harmonic ${n}`).toBeLessThan(1e-9);
    for (let n = 1; n < 16; n += 2) expect(Math.abs(real[n]), `harmonic ${n}`).toBeGreaterThan(0);
  });

  it("carries a DC offset that follows the duty cycle", () => {
    // The mean of a pulse is what tells the ear the width changed.
    expect(pulseWaveCoefficients(0.5).real[0]).toBeCloseTo(0, 12);
    expect(pulseWaveCoefficients(0.25).real[0]).toBeCloseTo(-0.5, 12);
    expect(pulseWaveCoefficients(0.75).real[0]).toBeCloseTo(0.5, 12);
  });

  it("brings the even harmonics back as the pulse narrows", () => {
    // Sweeping the width is the whole point of PWM: the timbre has to change.
    const square = pulseWaveCoefficients(0.5);
    const narrow = pulseWaveCoefficients(0.2);
    expect(Math.abs(narrow.real[2])).toBeGreaterThan(Math.abs(square.real[2]) + 0.05);
  });

  it("mirrors a pulse about the half-open one", () => {
    // A 70% pulse is a 30% pulse turned upside down and shifted: since
    // sin(nπ(1−w)) = −(−1)^n·sin(nπw), the odd harmonics come out identical
    // and only the even ones invert. That is why a PWM sweep past 50% keeps
    // its square-wave core and changes only the asymmetry.
    const thin = pulseWaveCoefficients(0.3);
    const fat = pulseWaveCoefficients(0.7);
    for (let n = 1; n < 12; n += 2) expect(fat.real[n], `odd ${n}`).toBeCloseTo(thin.real[n], 9);
    for (let n = 2; n < 12; n += 2) expect(fat.real[n], `even ${n}`).toBeCloseTo(-thin.real[n], 9);
    // And the two means are opposite, which is the shift.
    expect(fat.real[0]).toBeCloseTo(-thin.real[0], 9);
  });

  it("has no phase content, so every note starts the same way", () => {
    const { imag } = pulseWaveCoefficients(0.35);
    expect(imag.every((value) => value === 0)).toBe(true);
  });

  it("holds the width inside a range that still makes a sound", () => {
    // 0% and 100% are silence, and a knob must not be able to reach them.
    expect(pulseWaveCoefficients(0).real[1]).toBeCloseTo(pulseWaveCoefficients(MIN_PULSE_WIDTH).real[1], 12);
    expect(pulseWaveCoefficients(1).real[1]).toBeCloseTo(pulseWaveCoefficients(MAX_PULSE_WIDTH).real[1], 12);
    expect(pulseWaveCoefficients(Number.NaN).real[0]).toBeCloseTo(0, 12);
  });

  it("uses enough harmonics to sound like an edge, and the same number every time", () => {
    const { real, imag } = pulseWaveCoefficients(0.5);
    expect(real).toHaveLength(PULSE_HARMONICS);
    expect(imag).toHaveLength(PULSE_HARMONICS);
    expect(PULSE_HARMONICS).toBeGreaterThanOrEqual(256);
  });
});
