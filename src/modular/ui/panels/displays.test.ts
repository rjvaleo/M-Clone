import { describe, expect, it } from "vitest";
import { compressorCurve, filterBankResponse, plateEnvelope, grainWindow } from "./displays";

describe("The compressor's curve", () => {
  // The kernel's own static curve (prism-fx effects/compressor.rs `curve`).
  const settings = { thresholdDb: -18, ratio: 4, kneeDb: 6 };

  it("is unity below the knee", () => {
    expect(compressorCurve(-40, settings)).toBe(-40);
  });

  it("is threshold plus the excess over the ratio above it", () => {
    expect(compressorCurve(-6, settings)).toBeCloseTo(-18 + 12 / 4, 12);
  });

  it("bends through the knee as a quadratic centred on the threshold", () => {
    const x = 0 + 3;
    expect(compressorCurve(-18, settings)).toBeCloseTo(-18 + (1 / 4 - 1) * x * x / 12, 12);
  });

  it("has a hard corner with no knee, and never a ratio under 1:1", () => {
    expect(compressorCurve(-17, { ...settings, kneeDb: 0 })).toBeCloseTo(-18 + 1 / 4, 12);
    expect(compressorCurve(-6, { ...settings, ratio: 0.5 })).toBe(-6);
  });
});

describe("The filter bank's response", () => {
  // Every stage of prism-fx effects/mgl_dattorro_filter_bank.rs: the biquads
  // as `Musical::update` builds them, each blended by its amplitude, then the
  // damping one-pole. All on: the defaults.
  const defaults = {
    notchOn: 1, notchHz: 500, notchQ: 4, notchAmp: 1,
    resonatorOn: 1, resonatorHz: 1200, resonatorQ: 5, resonatorAmp: 0.7,
    regaliaOn: 1, regaliaHz: 3000, regaliaQ: 2, regaliaAmp: 0.7,
    dampingOn: 1, dampingHz: 6000, dampingQ: 0.7, dampingAmp: 1,
  };
  const off = { ...defaults, notchOn: 0, resonatorOn: 0, regaliaOn: 0, dampingOn: 0 };

  it("is flat with every stage switched off", () => {
    for (const hz of [50, 1000, 12000]) expect(filterBankResponse(hz, off, 48000)).toBeCloseTo(0, 9);
  });

  it("cuts to nothing at the notch's centre when it is fully in", () => {
    const only = { ...off, notchOn: 1 };
    expect(filterBankResponse(500, only, 48000)).toBeLessThan(-100);
    expect(filterBankResponse(50, only, 48000)).toBeCloseTo(0, 1);
  });

  it("blends a stage by its amplitude", () => {
    // Half a notch at its centre leaves half the signal: −6 dB.
    const half = { ...off, notchOn: 1, notchAmp: 0.5 };
    expect(filterBankResponse(500, half, 48000)).toBeCloseTo(20 * Math.log10(0.5), 6);
  });

  it("peaks the Regalia-Mitra by 12 dB × amplitude at its centre", () => {
    // Fully mixed, so the stage is the EQ alone; its gain at the centre is a².
    const eq = { ...off, regaliaOn: 1, regaliaAmp: 1 };
    expect(filterBankResponse(3000, eq, 48000)).toBeCloseTo(12, 6);
  });

  it("rolls off above the damping one-pole's cutoff", () => {
    const damping = { ...off, dampingOn: 1 };
    // cutoff · √(Q / 0.7) = 6 kHz at the default Q; the pole is a = 1 − e^(−2πf/fs).
    const a = 1 - Math.exp((-2 * Math.PI * 6000) / 48000);
    const w = (2 * Math.PI * 1000) / 48000;
    const re = 1 - (1 - a) * Math.cos(w);
    const im = (1 - a) * Math.sin(w);
    const expected = 20 * Math.log10(a / Math.hypot(re, im));
    expect(filterBankResponse(1000, damping, 48000)).toBeCloseTo(expected, 9);
    expect(filterBankResponse(18000, damping, 48000)).toBeLessThan(-3);
  });

  it("is the product of the stages", () => {
    const hz = 2000;
    const sum = (["notch", "resonator", "regalia", "damping"] as const)
      .map((stage) => filterBankResponse(hz, { ...off, [`${stage}On`]: 1, [`${stage}Hz`]: defaults[`${stage}Hz`] }, 48000))
      .reduce((a, b) => a + b, 0);
    expect(filterBankResponse(hz, defaults, 48000)).toBeCloseTo(sum, 6);
  });
});

describe("The plate's decay", () => {
  // The tank's loop gain: each half multiplies by decay twice, and a half is
  // its four lines, Dattorro's 672, 4453, 1800 and 3720 at 29 761 Hz.
  const half = (672 + 4453 + 1800 + 3720) / 29761;

  it("falls by decay² every half-loop at low frequencies", () => {
    const envelope = plateEnvelope({ decay: 0.5, damping: 0, predelayMs: 0 });
    expect(envelope.low(half)).toBeCloseTo(0.25, 9);
    expect(envelope.low(2 * half)).toBeCloseTo(0.0625, 9);
  });

  it("waits for the predelay before anything sounds", () => {
    const envelope = plateEnvelope({ decay: 0.5, damping: 0, predelayMs: 100 });
    expect(envelope.low(0.05)).toBe(0);
    expect(envelope.low(0.1 + half)).toBeCloseTo(0.25, 9);
  });

  it("reports the time to 60 dB down", () => {
    const envelope = plateEnvelope({ decay: 0.5, damping: 0, predelayMs: 0 });
    expect(envelope.rt60).toBeCloseTo((half * -3) / (2 * Math.log10(0.5)), 9);
  });

  it("falls faster up high, by the damping one-pole's gain each half", () => {
    const envelope = plateEnvelope({ decay: 0.7, damping: 0.5, predelayMs: 0 });
    const w = (2 * Math.PI * 4000) / 29761;
    const g = 0.5;
    const pole = 1 - g; // damp += (1 − damping)(x − damp)
    const hf = pole / Math.hypot(1 - (1 - pole) * Math.cos(w), (1 - pole) * Math.sin(w));
    expect(envelope.high(half)).toBeCloseTo(0.49 * hf, 9);
    expect(envelope.high(half)).toBeLessThan(envelope.low(half));
  });

  it("never reports a decay at or above 1 as endless nonsense", () => {
    expect(plateEnvelope({ decay: 0.9999, damping: 0, predelayMs: 0 }).rt60).toBeGreaterThan(100);
    expect(plateEnvelope({ decay: 0, damping: 0, predelayMs: 0 }).rt60).toBe(0);
  });
});

describe("The grain engine's window on its sample", () => {
  it("spreads the spray either side of the position, in fractions of the sample", () => {
    // prism-grain offsets each grain by spray × a bipolar random: ± the spray.
    expect(grainWindow({ position: 0.5, sprayMs: 1000 }, 4)).toEqual({ at: 0.5, from: 0.25, to: 0.75 });
  });

  it("clips the spray to the sample and has none without a sample", () => {
    expect(grainWindow({ position: 0, sprayMs: 2000 }, 1)).toEqual({ at: 0, from: 0, to: 1 });
    expect(grainWindow({ position: 0.3, sprayMs: 100 }, 0)).toEqual({ at: 0.3, from: 0.3, to: 0.3 });
  });
});
