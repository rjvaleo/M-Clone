import { describe, expect, it } from "vitest";
import {
  allpassTrain, boomerangRead, chamberlinResponse, combTails, convolutionWindow, crush, dampingResponse, dcResponse,
  decimatorTransfer, dopplerPath, echoTrain, eqResponse, fitSteady, gateSteady, leslieRotor, lengthUsed, lfsrStep,
  matrixFor, maximizerSteady, modDelaySweep, monoCutResponse, multiTapTrain, musicalResponse, phaserResponse,
  pitchSwing, pitchTaps, pnRms, pnShape, pnSteps, rappifyRange, rappifyResponse, ringSweep, spectralBands,
  spectralSteady, tremoloGains, type Matrix,
} from "./curves";

// Each display is checked against the kernel it draws (prism-fx
// crates/prism-fx/src/effects/). For the filters the kernel's `tick` is
// transcribed below, sample for sample, and a quiet sine is run through it: the
// curve must give the level the kernel does.

const FS = 48000;

/** The steady gain, in dB, a per-sample process gives a sine at `hz`. */
function measured(process: (x: number) => number, hz: number, fs = FS): number {
  const settle = 4 * fs;
  const length = fs;
  // Its amplitude by correlation over whole cycles: a second of a whole
  // number of hertz. (The largest sample misses the crest between samples.)
  let re = 0;
  let im = 0;
  for (let n = 0; n < settle + length; n++) {
    const phase = (2 * Math.PI * hz * n) / fs;
    const y = process(Math.sin(phase) * 1e-3);
    if (n >= settle) {
      re += y * Math.cos(phase);
      im += y * Math.sin(phase);
    }
  }
  return 20 * Math.log10(((2 / length) * Math.hypot(re, im)) / 1e-3);
}

describe("The Dattorro notch, resonator and Regalia-Mitra", () => {
  // Musical::update and Musical::run in mgl_dattorro_common.rs.
  const kernel = (mode: "notch" | "resonator" | "regalia", p: { frequency: number; bandwidth: number; gainDb: number; mix: number }) => {
    const f = Math.min(Math.max(p.frequency, 1), FS * 0.49);
    const q = Math.max(f / Math.max(p.bandwidth, 0.1), 0.025);
    const w = (2 * Math.PI * f) / FS;
    const alpha = Math.sin(w) / (2 * q);
    const c = Math.cos(w);
    const a = Math.pow(10, p.gainDb / 40);
    const [b0, b1, b2, a0, a1, a2] = mode === "notch" ? [1, -2 * c, 1, 1 + alpha, -2 * c, 1 - alpha]
      : mode === "resonator" ? [alpha, 0, -alpha, 1 + alpha, -2 * c, 1 - alpha]
        : [1 + alpha * a, -2 * c, 1 - alpha * a, 1 + alpha / a, -2 * c, 1 - alpha / a];
    let z1 = 0;
    let z2 = 0;
    return (x: number) => {
      const y = (b0 / a0) * x + z1;
      z1 = (b1 / a0) * x - (a1 / a0) * y + z2;
      z2 = (b2 / a0) * x - (a2 / a0) * y;
      return x + (y - x) * p.mix;
    };
  };

  it("is the kernel's biquad, blended by the mix", () => {
    const p = { frequency: 1000, bandwidth: 200, gainDb: 6, mix: 0.7 };
    for (const mode of ["notch", "resonator", "regalia"] as const) {
      for (const hz of [300, 1000, 1500]) {
        expect(musicalResponse(mode, p, hz, FS), `${mode} ${hz}`).toBeCloseTo(measured(kernel(mode, p), hz), 3);
      }
    }
  });

  it("boosts the Regalia-Mitra by its gain at the centre, and cuts the notch to nothing there", () => {
    expect(musicalResponse("regalia", { frequency: 1000, bandwidth: 200, gainDb: 6, mix: 1 }, 1000, FS)).toBeCloseTo(6, 6);
    expect(musicalResponse("notch", { frequency: 1000, bandwidth: 200, gainDb: 0, mix: 1 }, 1000, FS)).toBeLessThan(-100);
  });
});

describe("The damping filter", () => {
  it("is the one-pole z += a(x − z), wet and dry", () => {
    const p = { cutoffHz: 2000, wet: 0.8, dry: 0.3 };
    const a = 1 - Math.exp((-2 * Math.PI * p.cutoffHz) / FS);
    let z = 0;
    const tick = (x: number) => { z += a * (x - z); return x * p.dry + z * p.wet; };
    for (const hz of [100, 2000, 9000]) expect(dampingResponse(p, hz, FS)).toBeCloseTo(measured(tick, hz), 3);
  });
});

describe("The DC filter", () => {
  it("takes its one-pole low pass away from the signal", () => {
    const k = Math.min((2 * Math.PI * 30) / FS, 0.5);
    let state = 0;
    const tick = (x: number) => { state += k * (x - state); return x - state; };
    for (const hz of [10, 30, 200]) expect(dcResponse(30, hz, FS)).toBeCloseTo(measured(tick, hz), 3);
  });
});

describe("The Chamberlin filter, small-signal", () => {
  const kernel = (p: number[]) => {
    const sr = FS;
    const modes = [0, 1, 2, 3].map((m) => {
      const base = m * 4;
      const f = Math.min(2 * Math.sin((Math.PI * Math.min(p[base + 1], sr * 0.45)) / (2 * sr)), 0.99);
      const r = Math.min(Math.max((p[base + 2] - 0.2) / 9.8, 0), 1);
      return { on: !(p[base] < 0.5 || p[base + 3] <= 0.0001), f, damp: Math.min(2 * Math.max(1 - r, 0.02), 2 / f - f * 0.5), amp: p[base + 3] };
    });
    const low = [0, 0, 0, 0];
    const band = [0, 0, 0, 0];
    return (input: number) => {
      const x = Math.tanh(input * p[16]);
      let sum = 0;
      modes.forEach((m, i) => {
        if (!m.on) return;
        let hi = 0;
        for (let k = 0; k < 2; k++) {
          low[i] += m.f * band[i];
          hi = x - low[i] - m.damp * band[i];
          band[i] += m.f * hi;
        }
        sum += (i === 0 ? low[i] : i === 1 ? band[i] : i === 2 ? hi : hi + low[i]) * m.amp;
      });
      return Math.tanh(sum);
    };
  };
  const values = (p: number[]) => ({
    lowOn: p[0], lowFreq: p[1], lowQ: p[2], lowAmp: p[3], bandOn: p[4], bandFreq: p[5], bandQ: p[6], bandAmp: p[7],
    highOn: p[8], highFreq: p[9], highQ: p[10], highAmp: p[11], notchOn: p[12], notchFreq: p[13], notchQ: p[14], notchAmp: p[15], drive: p[16],
  });

  it("is each state-variable filter iterated twice a sample, summed by level, times the drive", () => {
    const all = [1, 800, 2, 0.6, 1, 2000, 4, 0.5, 1, 5000, 1, 0.4, 1, 1200, 3, 0.3, 1.5];
    for (const hz of [200, 900, 3000, 9000]) {
      expect(chamberlinResponse(values(all), hz, FS), `${hz}`).toBeCloseTo(measured(kernel(all), hz), 3);
    }
  });

  it("skips a filter that is off or at no level, and is silent with none", () => {
    const one = [1, 1000, 0.7, 1, 0, 1000, 1, 0, 0, 1000, 0.7, 0.00005, 1, 1000, 1, 0, 1];
    expect(chamberlinResponse(values(one), 100, FS)).toBeCloseTo(measured(kernel(one), 100), 3);
    const none = [0, 1000, 0.7, 1, 0, 1000, 1, 0, 0, 1000, 0.7, 0, 0, 1000, 1, 0, 1];
    expect(chamberlinResponse(values(none), 100, FS)).toBe(-240);
  });
});

describe("The rack EQ", () => {
  const defaults: Record<string, number> = {
    "band.0.freq": 10, "band.0.enabled": 1, "band.0.mode": 0,
    "band.1.freq": 100, "band.1.q": 0.7, "band.1.gainDb": 0, "band.1.enabled": 1, "band.1.mode": 1,
    "band.2.freq": 1000, "band.2.q": 1, "band.2.gainDb": 0, "band.2.enabled": 1, "band.2.mode": 2,
    "band.3.freq": 250, "band.3.q": 1, "band.3.gainDb": 0, "band.3.enabled": 0, "band.3.mode": 2,
    "band.4.freq": 500, "band.4.q": 1, "band.4.gainDb": 0, "band.4.enabled": 0, "band.4.mode": 2,
    "band.5.freq": 2000, "band.5.q": 1, "band.5.gainDb": 0, "band.5.enabled": 0, "band.5.mode": 2,
    "band.6.freq": 8000, "band.6.q": 0.7, "band.6.gainDb": 0, "band.6.enabled": 1, "band.6.mode": 4,
    "band.7.freq": 20000, "band.7.enabled": 0, "band.7.mode": 5,
  };

  it("passes everything untouched while no node has anything to do", () => {
    for (const hz of [20, 1000, 18000]) expect(eqResponse(defaults, hz, FS)).toBe(0);
    // A pass out of the way, and a low-pass at 20 kHz, are nothing to do.
    expect(eqResponse({ ...defaults, "band.0.freq": 20, "band.7.enabled": 1 }, 19000, FS)).toBe(0);
  });

  it("is the RBJ biquads in series, each as the kernel builds it", () => {
    // Direct form I, as State::step runs it, with the coefficients worked out
    // by hand from the cookbook for a 6 dB bell at 1 kHz, Q 2.
    const w0 = (2 * Math.PI * 1000) / FS;
    const alpha = Math.sin(w0) / (2 * 2);
    const A = Math.pow(10, 6 / 40);
    const a0 = 1 + alpha / A;
    const c = [(1 + alpha * A) / a0, (-2 * Math.cos(w0)) / a0, (1 - alpha * A) / a0, (-2 * Math.cos(w0)) / a0, (1 - alpha / A) / a0];
    let [x1, x2, y1, y2] = [0, 0, 0, 0];
    const bell = (x: number) => {
      const y = c[0] * x + c[1] * x1 + c[2] * x2 - c[3] * y1 - c[4] * y2;
      [x2, x1, y2, y1] = [x1, x, y1, y];
      return y;
    };
    const one = { ...defaults, "band.2.gainDb": 6, "band.2.q": 2 };
    for (const hz of [300, 1000, 3000]) expect(eqResponse(one, hz, FS)).toBeCloseTo(measured(bell, hz), 3);
    expect(eqResponse(one, 1000, FS)).toBeCloseTo(6, 6);
  });

  it("draws every node type the kernel offers", () => {
    const at = (band: number, mode: number, extra: Record<string, number> = {}) =>
      ({ ...defaults, [`band.${band}.mode`]: mode, [`band.${band}.gainDb`]: 6, [`band.${band}.enabled`]: 1, ...extra });
    // A high-pass on the first node, once above 20 Hz, at the end nodes' Q 0.707.
    expect(eqResponse({ ...defaults, "band.0.freq": 200 }, 200, FS)).toBeCloseTo(20 * Math.log10(0.707), 2);
    expect(eqResponse(at(1, 1), 10, FS)).toBeCloseTo(6, 0);
    expect(eqResponse(at(3, 3), 250, FS)).toBeCloseTo(6, 4);
    expect(eqResponse(at(6, 4), 20000, FS)).toBeCloseTo(6, 0);
    expect(eqResponse({ ...defaults, "band.7.freq": 2000, "band.7.enabled": 1 }, 2000, FS)).toBeCloseTo(20 * Math.log10(0.707), 2);
    // A middle node set to pass, which takes no gain.
    expect(eqResponse(at(2, 0, { "band.2.freq": 500, "band.2.q": 0.707 }), 500, FS)).toBeCloseTo(20 * Math.log10(0.707), 2);
    // A node that is off is a wire.
    expect(eqResponse(at(2, 2, { "band.2.enabled": 0, "band.6.gainDb": 3 }), 1000, FS)).toBeCloseTo(eqResponse({ ...defaults, "band.6.gainDb": 3 }, 1000, FS), 9);
  });
});

describe("The phaser", () => {
  const kernel = (v: Record<string, number>, lfo: number) => {
    const count = Math.min(Math.max(Math.round(v.notches), 1), 8);
    const shift = Math.pow(2, lfo * v.sweep * 0.5);
    const sections = Array.from({ length: count }, (_, i) => {
      const hz = Math.min(Math.max(v.centreHz * Math.pow(v.spread, i) * shift, 20), FS * 0.49);
      const theta = Math.min(Math.max((2 * Math.PI * hz) / FS, 1e-4), Math.PI - 1e-4);
      const r = Math.min(Math.max(v.resonance, 0), 0.9995);
      return { a1: -2 * r * Math.cos(theta), a2: r * r, x1: 0, x2: 0, y1: 0, y2: 0 };
    });
    let fb = 0;
    return (x: number) => {
      let s = x + fb * v.feedback;
      for (const q of sections) {
        const y = q.a2 * s + q.a1 * q.x1 + q.x2 - q.a1 * q.y1 - q.a2 * q.y2;
        [q.x2, q.x1, q.y2, q.y1] = [q.x1, s, q.y1, y];
        s = y;
      }
      fb = s;
      return x * v.dry + (x + s * v.depth) * v.wet;
    };
  };
  const v = { notches: 4, centreHz: 500, spread: 1.8, resonance: 0.7, depth: 0.7, sweep: 1.5, feedback: 0.4, wet: 0.5, dry: 1 };

  it("is the all-pass chain with its feedback, frozen where the LFO is", () => {
    for (const lfo of [-1, 0, 1]) {
      for (const hz of [200, 700, 2500]) expect(phaserResponse(v, hz, FS, lfo), `${lfo} ${hz}`).toBeCloseTo(measured(kernel(v, lfo), hz), 3);
    }
  });
});

describe("Rappify", () => {
  const kernel = (p: { amount: number; hz: number }, open: number) => {
    const a = p.amount;
    const q = 0.05 + (1 - a) * 0.9;
    const fc = Math.min(Math.max(p.hz * Math.pow(2, (open * 2 - 1) * 2 * a), 20), FS * 0.45);
    const g = Math.min(Math.max(Math.tan((Math.PI * fc) / FS), 1e-4), 1);
    let lp = 0;
    let bp = 0;
    return (x: number) => {
      const hp = (x - lp - bp * q * 2) / (1 + g * q * 2 + g * g);
      bp += g * hp;
      lp += g * bp;
      return x * (1 - a) + bp * (1 + a * 2) * a;
    };
  };

  it("is its state-variable band pass with the envelope held, blended by the amount", () => {
    const p = { amount: 0.6, hz: 400 };
    for (const open of [0, 1]) {
      for (const hz of [100, 400, 1600]) expect(rappifyResponse(p, open, hz, FS)).toBeCloseTo(measured(kernel(p, open), hz), 3);
    }
  });

  it("does nothing at no amount, and swings two octaves either way at full", () => {
    expect(rappifyResponse({ amount: 0, hz: 400 }, 1, 400, FS)).toBe(0);
    expect(rappifyRange({ amount: 1, hz: 400 })).toEqual({ low: 100, high: 1600 });
  });
});

describe("The stereo matrices", () => {
  const apply = (m: Matrix, [l, r]: [number, number]) => [m[0][0] * l + m[0][1] * r, m[1][0] * l + m[1][1] * r];

  it("flips both sides for Invert and trades them for Swap", () => {
    expect(apply(matrixFor("invert", {}), [1, 0.5])).toEqual([-1, -0.5]);
    expect(apply(matrixFor("swap", {}), [1, 0.5])).toEqual([0.5, 1]);
  });

  it("scales the side for Width: mono at 0, untouched at 1", () => {
    expect(apply(matrixFor("width", { width: 0 }), [1, 0])).toEqual([0.5, 0.5]);
    expect(apply(matrixFor("width", { width: 1 }), [1, 0])).toEqual([1, 0]);
  });

  it("runs Utility's gain, invert, swap and width in its order", () => {
    const m = matrixFor("utility", { gainDb: 20 * Math.log10(2), invert: 1, swap: 1, width: 1 });
    expect(apply(m, [1, 0]).map((v) => Number(v.toFixed(9)))).toEqual([0, -2]);
    expect(apply(matrixFor("utility", { gainDb: 0, invert: 0, swap: 0, width: 0 }), [1, 0])).toEqual([0.5, 0.5]);
  });

  it("is the Stereo Matrix's chain: mid and side gains, the rotation, then pan and gain", () => {
    // The kernel's tick with the side passed whole, written out.
    const p = { pan: 0.4, gainDb: -6, midGain: 1.2, sideGain: 0.7, rotate: 30 };
    const tick = (l: number, r: number) => {
      const mid = 0.5 * (l + r) * p.midGain;
      const side = 0.5 * (l - r) * p.sideGain;
      const [s, c] = [Math.sin((p.rotate * Math.PI) / 180), Math.cos((p.rotate * Math.PI) / 180)];
      const [m2, s2] = [mid * c - side * s, mid * s + side * c];
      const g = Math.pow(10, p.gainDb / 20);
      return [(m2 + s2) * Math.min(1 - p.pan, 1) * g, (m2 - s2) * Math.min(1 + p.pan, 1) * g];
    };
    const m = matrixFor("matrix", p);
    for (const input of [[1, 0], [0, 1], [1, 1], [1, -1]] as [number, number][]) {
      const got = apply(m, input);
      const want = tick(...input);
      expect(got[0]).toBeCloseTo(want[0], 12);
      expect(got[1]).toBeCloseTo(want[1], 12);
    }
  });

  it("cuts the side's low end with its 0.707-Q high pass, and is off at 20 Hz", () => {
    expect(monoCutResponse(20, 30, FS)).toBe(0);
    expect(monoCutResponse(200, 200, FS)).toBeCloseTo(20 * Math.log10(Math.SQRT1_2), 4);
    expect(monoCutResponse(200, 20, FS)).toBeLessThan(-30);
  });
});

describe("The gate, Amp fit and Maximizer, held at a steady level", () => {
  it("gates below the threshold by the depth, and passes at or above it", () => {
    expect(gateSteady({ thresholdDb: -40, depth: 0.5 }, -20)).toBe(-20);
    expect(gateSteady({ thresholdDb: -40, depth: 0.5 }, -50)).toBeCloseTo(-50 + 20 * Math.log10(0.5), 9);
    expect(gateSteady({ thresholdDb: -40, depth: 1 }, -50)).toBe(-Infinity);
  });

  it("fits a level above the floor to 0.9 of full scale, blended by the amount", () => {
    const fit = { amount: 1, floorDb: -50 };
    expect(fitSteady(fit, -20)).toBeCloseTo(20 * Math.log10(0.9), 9);
    expect(fitSteady(fit, -60)).toBe(-60);
    // The gain is held to 32 at most.
    expect(fitSteady({ amount: 1, floorDb: -80 }, -70)).toBeCloseTo(-70 + 20 * Math.log10(32), 9);
    const half = Math.pow(10, -20 / 20);
    expect(fitSteady({ amount: 0.5, floorDb: -50 }, -20)).toBeCloseTo(20 * Math.log10(half * (1 + (0.9 / half - 1) * 0.5)), 9);
    expect(fitSteady({ amount: 0, floorDb: -50 }, -20)).toBe(-20);
  });

  // Maximizer::tick held long enough at a steady peak, written out.
  const steady = (v: { amount: number; ceilingDb: number; autoLevel: number; autoComp: number }, level: number) => {
    const a = v.amount;
    const ratio = Math.pow(20, a);
    const knee = 9 * (1 - a) + 1;
    const curve = (l: number, t: number) => {
      const over = l - t;
      if (over > -knee / 2 && over < knee / 2) return l + ((1 / ratio - 1) * (over + knee / 2) ** 2) / (2 * knee);
      return over <= 0 ? l : t + over / ratio;
    };
    const t = v.autoComp ? Math.min(Math.max(level + 6 - 21 * a, -60), 0) : -24 * a;
    const env = Math.min(curve(level, t) - level, 0);
    const makeup = v.autoLevel ? Math.min(Math.max(v.ceilingDb - (level + env), 0), 30) : Math.min(Math.max(-curve(0, t), 0), 30);
    return Math.min(level + env + makeup, v.ceilingDb);
  };

  it("settles the Maximizer where its curve, threshold and makeup put a steady level", () => {
    for (const autoLevel of [0, 1]) {
      for (const autoComp of [0, 1]) {
        const v = { amount: 0.7, ceilingDb: -0.3, autoLevel, autoComp };
        for (const level of [-50, -20, -6, 0]) expect(maximizerSteady(v, level), `${autoLevel}${autoComp} ${level}`).toBeCloseTo(steady(v, level), 9);
      }
    }
  });

  it("leaves the level alone at no amount", () => {
    expect(maximizerSteady({ amount: 0, ceilingDb: -0.3, autoLevel: 1, autoComp: 1 }, -12)).toBe(-12);
  });
});

describe("Spectral Dynamics, one band held at a steady level", () => {
  const base = { mode: 0, ratio: 2, reductionDb: -60, smoothed: 0, affect: 0, thresholdDb: -40 };

  it("gates or ducks a band past its threshold by the reduction", () => {
    expect(spectralSteady(base, -50)).toBeCloseTo(-110, 9);
    expect(spectralSteady(base, -30)).toBe(-30);
    expect(spectralSteady({ ...base, affect: 1 }, -30)).toBeCloseTo(-90, 9);
  });

  it("expands or compresses about the threshold: T·(a/T)^state", () => {
    expect(spectralSteady({ ...base, mode: 1 }, -50)).toBeCloseTo(-40 - 20, 9);
    expect(spectralSteady({ ...base, mode: 2, affect: 1 }, -20)).toBeCloseTo(-40 + 10, 9);
  });

  it("follows a soft knee when smoothed", () => {
    const a = Math.pow(10, -40 / 20);
    // At the threshold x = ½: a gate's state is halfway to the amount.
    const amount = Math.pow(10, -60 / 20);
    expect(spectralSteady({ ...base, smoothed: 1 }, -40)).toBeCloseTo(20 * Math.log10(a * (amount + 0.5 * (1 - amount))), 9);
    // Expanding by 2 there: 1 / (½·(1 − ½) + ½) = 4/3.
    expect(spectralSteady({ ...base, smoothed: 1, mode: 1, affect: 1 }, -40)).toBeCloseTo(-40, 9);
    const t = Math.pow(10, -40 / 20);
    const b = Math.pow(10, -20 / 20);
    const x = t / (b + t);
    const state = 1 / (x * (1 - 1 / 2) + 1 / 2);
    expect(spectralSteady({ ...base, smoothed: 1, mode: 1, affect: 1 }, -20)).toBeCloseTo(20 * Math.log10(t * Math.pow(b / t, state)), 9);
  });

  it("finds the band range and the analysis it runs at", () => {
    expect(spectralBands({ bands: 6, lowHz: 20, highHz: 20000 }, FS)).toEqual({ n: 1024, bins: 513, perBin: 46.875, low: 0, high: 512, windowMs: 1024 / 48 });
    expect(spectralBands({ bands: 0, lowHz: 1000, highHz: 5000 }, FS)).toMatchObject({ n: 16, low: 1, high: 1 });
  });
});

describe("The decimator", () => {
  it("rounds down to 2^bits levels set midway between steps", () => {
    expect(crush(0.3, 1)).toBe(0.5);
    expect(crush(-0.3, 1)).toBe(-0.5);
    expect(crush(0.3, 2)).toBe(0.25);
    expect(crush(1, 2)).toBe(0.75);
    expect(crush(0.123, 24)).toBe(0.123);
  });

  it("blends the crushed sample with the dry one by the mix", () => {
    expect(decimatorTransfer(0.3, { bits: 1, mix: 0.5 })).toBeCloseTo(0.4, 12);
  });
});

describe("The modulated delays", () => {
  it("sweeps the chorus's delay about its centre, the right side stereo·π round", () => {
    const p = { delayMs: 14, depthMs: 7, rateHz: 0.5, stereo: 0.5 };
    expect(modDelaySweep(p, 0.5, 0, FS)).toBeCloseTo(14 + 7 * Math.sin(Math.PI * 0.5), 9);
    expect(modDelaySweep(p, 0.5, 1, FS)).toBeCloseTo(14 + 7 * Math.sin(Math.PI * 0.5 + Math.PI * 0.5), 9);
    // Never under 0.05 ms.
    expect(modDelaySweep({ ...p, delayMs: 1, depthMs: 10 }, 1.5, 0, FS)).toBe(0.05);
  });

  it("gives the doubler its 1.7-radian offset and 1 ms floor", () => {
    const p = { delayMs: 32, variationMs: 3, rateHz: 0.35 };
    expect(modDelaySweep({ ...p, depthMs: 3 }, 0, 1, FS, { offset: 1.7, floor: 1 })).toBeCloseTo(32 + 3 * Math.sin(1.7), 9);
  });

  it("swings the pitch by the delay's steepest rate", () => {
    const { up, down } = pitchSwing(2, 1);
    const dev = (2 / 1000) * 2 * Math.PI;
    expect(up).toBeCloseTo(1200 * Math.log2(1 + dev), 9);
    expect(down).toBeCloseTo(1200 * Math.log2(1 - dev), 9);
    expect(pitchSwing(50, 20).down).toBe(-Infinity);
  });

  it("reads the Leslie's line at distance + doppler·(1 + osc), one sample less as it is written first, scaled by its AM", () => {
    const p = { rateHz: 1, depthMs: 2, amDepth: 0.4, width: 1, baseMs: 3 };
    const left = leslieRotor(p, 0, 0, FS);
    const osc = Math.sin(-Math.PI / 2);
    expect(left.delayMs).toBeCloseTo(3 + 2 * (1 + osc) - 1000 / FS, 9);
    expect(left.gain).toBeCloseTo(1 - 0.4 + 0.4 * (0.5 + 0.5 * osc), 12);
    // The longest settings read round the 50 ms line.
    expect(leslieRotor({ ...p, baseMs: 40, depthMs: 8, width: 0 }, 0.25, 0, FS).delayMs).toBeCloseTo(40 + 16 - 1000 / FS - 50, 6);
  });
});

describe("The pitch shifters", () => {
  it("sweeps two taps half a window apart at 1 − ratio windows a sample, from a quarter in", () => {
    const taps = pitchTaps({ ratio: 2, windowMs: 60 }, 0, FS);
    const win = 0.06 * FS;
    expect(taps.a).toBeCloseTo(0.25 * win, 9);
    expect(taps.b).toBeCloseTo(0.75 * win, 9);
    expect(taps.wa).toBeCloseTo(0.5, 12);
    const later = pitchTaps({ ratio: 2, windowMs: 60 }, 100, FS);
    expect(later.a).toBeCloseTo((0.25 - 100 / win) * win, 6);
    expect(taps.period).toBeCloseTo(win, 9);
    expect(pitchTaps({ ratio: 1, windowMs: 0.1 }, 0, FS)).toMatchObject({ period: Infinity, win: 32 });
  });
});

describe("The Doppler's source", () => {
  it("starts at the distance and travels velocity / speed of sound samples a sample", () => {
    const p = { distanceMs: 40, velocityMps: 34.3, speedMps: 343 };
    const path = dopplerPath(p, FS);
    expect(path.at(0)).toBeCloseTo(40, 9);
    expect(path.at(1)).toBeCloseTo(40 + 0.1 * 1000, 6);
    expect(path.ratio).toBeCloseTo(0.9, 12);
    expect(path.stopsAt).toBeCloseTo(((2 * FS - 2) - 0.04 * FS) / 0.1 / FS, 9);
    // It stops at the end of the line.
    expect(path.at(100)).toBeCloseTo(((2 * FS - 2) / FS) * 1000, 6);
  });

  it("comes back toward one sample when the velocity is negative, and stays put at none", () => {
    expect(dopplerPath({ distanceMs: 40, velocityMps: -34.3, speedMps: 343 }, FS).stopsAt).toBeCloseTo((0.04 * FS - 1) / 0.1 / FS, 9);
    expect(dopplerPath({ distanceMs: 40, velocityMps: 0, speedMps: 343 }, FS)).toMatchObject({ ratio: 1, stopsAt: Infinity });
  });
});

describe("The tremolo", () => {
  it("is full level at the top of its cycle and 1 − depth at the bottom, for every shape", () => {
    for (const shape of [0, 1, 2]) {
      expect(tremoloGains({ rateHz: 4, depth: 0.5, shape, stereo: 0 }, 0).left).toBeCloseTo(1, 9);
      expect(tremoloGains({ rateHz: 4, depth: 0.5, shape, stereo: 0 }, 0.5).left).toBeCloseTo(0.5, 9);
    }
  });

  it("runs the right side half a cycle behind at a stereo phase of 1, so the two sum level", () => {
    const g = tremoloGains({ rateHz: 4, depth: 1, shape: 1, stereo: 1 }, 0.1);
    expect(g.left + g.right).toBeCloseTo(1, 9);
    expect(tremoloGains({ rateHz: 4, depth: 1, shape: 0, stereo: 0.5 }, 0.5).right).toBeCloseTo(tremoloGains({ rateHz: 4, depth: 1, shape: 0, stereo: 0 }, 0.25).left, 9);
  });

  it("draws the sine as sin²(π·d), the triangle as 2d and the square with a 2 ms edge", () => {
    expect(tremoloGains({ rateHz: 1, depth: 1, shape: 0, stereo: 0 }, 0.25).left).toBeCloseTo(0.5, 9);
    expect(tremoloGains({ rateHz: 1, depth: 1, shape: 1, stereo: 0 }, 0.125).left).toBeCloseTo(0.75, 9);
    expect(tremoloGains({ rateHz: 1, depth: 1, shape: 2, stereo: 0 }, 0.1).left).toBe(1);
    expect(tremoloGains({ rateHz: 1, depth: 1, shape: 2, stereo: 0 }, 0.4).left).toBe(0);
  });
});

describe("The ring modulator's sweep", () => {
  it("adds the sweep's hertz a second until it leaves 0.01 Hz…45 % of the rate, then starts again", () => {
    const sweep = ringSweep({ hz: 1000, sweep: 2000 }, FS);
    expect(sweep.at(0)).toBe(1000);
    expect(sweep.at(1)).toBeCloseTo(3000, 6);
    expect(sweep.period).toBeCloseTo((Math.floor((0.45 * FS - 1000) / (2000 / FS)) + 1) / FS, 9);
    expect(sweep.at(sweep.period + 0.5)).toBeCloseTo(2000, 2);
    const down = ringSweep({ hz: 100, sweep: -50 }, FS);
    expect(down.period).toBeCloseTo((Math.floor((100 - 0.01) / (50 / FS)) + 1) / FS, 9);
    expect(ringSweep({ hz: 220, sweep: 0 }, FS)).toMatchObject({ period: Infinity });
  });
});

describe("Boomerang's read", () => {
  it("walks back two frames a frame to the throw, and fades where it meets the write head", () => {
    const throwMs = 400;
    const frames = Math.floor(0.4 * FS);
    expect(boomerangRead({ throwMs }, 0, FS)).toEqual({ lag: 0, fade: 0, throwFrames: frames });
    expect(boomerangRead({ throwMs }, 100, FS).lag).toBe(200);
    expect(boomerangRead({ throwMs }, frames / 2, FS).lag).toBe(0);
    const edge = Math.max(Math.floor(frames / 16), 32);
    expect(boomerangRead({ throwMs }, 2000, FS).fade).toBe(1);
    expect(boomerangRead({ throwMs }, 100, FS).fade).toBeCloseTo(200 / edge, 12);
  });
});

describe("The echo trains", () => {
  it("repeats the echo at its delay, each repeat the feedback times the damping one-pole", () => {
    const train = echoTrain({ delayMs: 100, feedback: 0.5, damping: 0.4, wet: 0.8, dry: 1 }, FS, 4000);
    expect(train[0]).toEqual({ t: 0, low: 1, high: 1 });
    expect(train[1].t).toBeCloseTo(0.1, 12);
    expect(train[1].low).toBeCloseTo(0.8, 12);
    expect(train[2].low).toBeCloseTo(0.4, 12);
    const w = (2 * Math.PI * 4000) / FS;
    const lp = 0.6 / Math.hypot(1 - 0.4 * Math.cos(w), 0.4 * Math.sin(w));
    expect(train[2].high).toBeCloseTo(0.4 * lp, 9);
    expect(train[3].low).toBeCloseTo(0.2, 12);
    expect(train.length).toBeLessThan(40);
  });

  it("gives the all-pass diffuser −g first, then (1 − g²)·g^(k−1) at every delay", () => {
    const train = allpassTrain({ delayMs: 10, coefficient: 0.5, wet: 1, dry: 0 }, FS);
    expect(train[0]).toEqual({ t: 0, level: -0.5 });
    expect(train[1].t).toBeCloseTo(0.01, 12);
    expect(train[1].level).toBeCloseTo(0.75, 12);
    expect(train[2].level).toBeCloseTo(0.375, 12);
    expect(allpassTrain({ delayMs: 0.01, coefficient: 0, wet: 1, dry: 0 }, FS)[1].t).toBeCloseTo(1 / FS, 12);
  });

  it("brings the multi delay's taps back through each other at every sum of the two times", () => {
    const p = { delay1Ms: 100, delay2Ms: 150, feedback: 0.5, spread: 1, wet: 1 };
    const train = multiTapTrain(p, FS, 2);
    const at = (t: number) => train.find((s) => Math.abs(s.t - t) < 1e-9);
    expect(at(0.1)).toEqual({ t: 0.1, left: 1, right: 0 });
    expect(at(0.15)).toEqual({ t: 0.15, left: 0, right: 1 });
    // Into the line again at 0.25 and out of both taps: the first through the
    // second and the second through the first, each by a quarter.
    expect(at(0.2)?.left).toBeCloseTo(0.25, 12);
    expect(at(0.25)?.left).toBeCloseTo(0.25, 12);
    expect(at(0.25)?.right).toBeCloseTo(0.25, 12);
    expect(train.every((s) => s.t <= 2)).toBe(true);
    // Spread 0 puts both taps in the middle.
    expect(multiTapTrain({ ...p, spread: 0 }, FS, 2)[0]).toEqual({ t: 0.1, left: 0.5, right: 0.5 });
  });
});

describe("The comb reverbs' tails", () => {
  it("falls by the decay every pass of each Schroeder comb, the right side's spread longer", () => {
    const tails = combTails("schroeder", { decay: 0.8, size: 1, spread: 0.05, predelayMs: 10, freeze: 0, damping: 1 }, FS);
    expect(tails.combs[0]).toMatchObject({ side: 0, passSec: Math.floor(29.7 * 0.001 * FS) / FS, low: 0.8, high: 0.8 });
    expect(tails.combs[4].passSec).toBe(Math.floor(29.7 * 1.05 * 0.001 * FS) / FS);
    expect(tails.preSec).toBe(480 / FS);
    const longest = Math.floor(43.7 * 1.05 * 0.001 * FS) / FS;
    expect(tails.rt60).toBeCloseTo(480 / FS + longest * (1 + 3 / -Math.log10(0.8)), 9);
  });

  it("damps each Moorer comb by its table entry, read between 25 and 50 kHz by the rate", () => {
    const tails = combTails("moorer", { decay: 0.8, size: 1, spread: 0, predelayMs: 0, freeze: 0, damping: 1 }, FS);
    const t = (FS - 25000) / 25000;
    const g1 = 0.24 + (0.46 - 0.24) * t;
    const w = (2 * Math.PI * 4000) / FS;
    expect(tails.combs[0].low).toBeCloseTo(0.8, 12);
    expect(tails.combs[0].high).toBeCloseTo((0.8 * (1 - g1)) / Math.hypot(1 - g1 * Math.cos(w), g1 * Math.sin(w)), 6);
    expect(tails.combs).toHaveLength(12);
    expect(tails.preSec).toBe(1 / FS);
  });

  it("holds a frozen tank at unity forever", () => {
    const tails = combTails("moorer", { decay: 0.8, size: 1, spread: 0, predelayMs: 0, freeze: 1, damping: 1 }, FS);
    expect(tails.combs.every((c) => c.low === 1 && c.high === 1)).toBe(true);
    expect(tails.rt60).toBe(Infinity);
    // With no decay each comb sounds once: the tail ends with the longest's first arrival.
    expect(combTails("schroeder", { decay: 0, size: 1, spread: 0, predelayMs: 0, freeze: 0, damping: 1 }, FS).rt60)
      .toBeCloseTo((1 + Math.floor(43.7 * 0.001 * FS)) / FS, 12);
  });
});

describe("The PN generators", () => {
  it("never leaves its register at zero, and runs the full 2²⁴ − 1 before it repeats", () => {
    expect(lfsrStep(0)).toBe(1);
    let reg = 1;
    let steps = 0;
    do {
      reg = lfsrStep(reg);
      steps += 1;
    } while (reg !== 1 && steps < 1 << 25);
    // A maximal-length sequence: its bits are white, which the spectra assume.
    expect(steps).toBe(2 ** 24 - 1);
  });

  it("reads the whole register as a weighted sum of the last 24 bits, tilting the spectrum down", () => {
    expect(pnShape("single", 1)).toBe(1);
    // At DC the multibit gain is Σ 2^(23−j) / (2²⁴ − 1) = 1.
    expect(pnShape("multibit", 0)).toBeCloseTo(1, 9);
    expect(pnShape("multibit", Math.PI)).toBeCloseTo((1 / 3) ** 2, 4);
    // The equaliser takes the low end out.
    expect(pnShape("equalised", 0)).toBeCloseTo(0, 12);
    expect(pnShape("equalised", Math.PI)).toBeGreaterThan(pnShape("multibit", Math.PI));
  });

  it("gives each generator's level as its power over the whole sequence", () => {
    expect(pnRms("single")).toBe(1);
    expect(pnRms("multibit")).toBeCloseTo(Math.sqrt(1 / 3), 6);
    // Parseval: the equalised sequence's power is the mean of its spectrum.
    const n = 4096;
    let sum = 0;
    for (let k = 0; k < n; k++) sum += pnShape("equalised", (2 * Math.PI * k) / n);
    expect(pnRms("equalised")).toBeCloseTo(Math.sqrt(sum / n), 6);
  });

  it("steps at the clock, at most once a sample, and repeats after 2²⁴ − 1 steps", () => {
    expect(pnSteps(1000, FS)).toEqual({ perSec: 1000, repeatSec: (2 ** 24 - 1) / 1000 });
    expect(pnSteps(48000, 44100).perSec).toBe(44100);
  });
});

describe("The convolution's window", () => {
  it("draws SoundHack's windows as its code does", () => {
    expect(convolutionWindow(0, 0, 11)).toBeCloseTo(0.08, 6);
    expect(convolutionWindow(0, 5, 11)).toBeCloseTo(1, 6);
    expect(convolutionWindow(1, 0, 11)).toBe(0);
    expect(convolutionWindow(1, 5, 11)).toBeCloseTo(1, 6);
    expect(convolutionWindow(2, 5, 10)).toBe(0.5);
    expect(convolutionWindow(3, 7, 10)).toBe(1);
    expect(convolutionWindow(4, 5, 10)).toBe(1);
    expect(convolutionWindow(4, 0, 10)).toBeCloseTo(0, 6);
    expect(convolutionWindow(5, 5, 10)).toBe(1);
    expect(convolutionWindow(6, 0, 11)).toBe(0);
    expect(convolutionWindow(6, 0, 1)).toBe(1);
  });

  it("uses the length asked for, held to the impulse and to four seconds", () => {
    expect(lengthUsed(100, FS, 96000)).toBe(4800);
    expect(lengthUsed(100, FS, 1000)).toBe(1000);
    expect(lengthUsed(4000, FS, 10 * FS)).toBe(4 * FS);
    expect(lengthUsed(100, FS, 0)).toBe(1);
  });
});

describe("A modulated delay with no stereo setting", () => {
  it("sweeps both sides together", () => {
    const p = { delayMs: 14, depthMs: 7, rateHz: 0.5 };
    expect(modDelaySweep(p, 0.5, 1, FS)).toBe(modDelaySweep(p, 0.5, 0, FS));
    expect(modDelaySweep(p, 0.5, 1, FS)).toBeCloseTo(14 + 7 * Math.sin(Math.PI * 0.5), 9);
  });
});
