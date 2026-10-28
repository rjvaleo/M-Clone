import { describe, expect, it } from "vitest";
import {
  basicCoefficient,
  basicCoefficients,
  clampFrequency,
  discreteTimeConstant,
  lowpassCoefficients,
  numberOfRanges,
  orderTimeline,
  partialsForRange,
  periodicWaveSize,
  periodicWaveTable,
  renderOscillator,
  renderSetTarget,
  selectTables,
  setTargetConverged,
  timelineValueAt,
  type BasicShape,
} from "./webAudioLaws";
import { pulseWaveCoefficients } from "./dsp";

// Every number here is pinned again in rust/dsp-core/src/webaudio.rs, where
// the Rust engine computes it its own way (tables by inverse FFT rather than
// by the partial sums used here).

const SR = 48000;

const tableCache = new Map<string, { table: Float32Array; scale: number }>();
const table = (shape: BasicShape, range: number) => {
  const key = `${shape}:${range}`;
  if (!tableCache.has(key)) {
    const { real, imag } = basicCoefficients(shape, 4096);
    tableCache.set(key, periodicWaveTable(real, imag, range, SR));
  }
  return tableCache.get(key)!;
};

describe("band-limited tables", () => {
  it("are as long as the sample rate asks, three ranges an octave", () => {
    expect([24000, 44100, 48000, 88200, 96000].map(periodicWaveSize)).toEqual([2048, 4096, 4096, 4096, 16384]);
    expect([2048, 4096, 16384].map(numberOfRanges)).toEqual([33, 36, 42]);
  });

  it("keep the partials Chromium keeps in each range", () => {
    expect([0, 1, 2, 3, 4, 9, 10, 16, 17, 33, 34, 35].map((r) => partialsForRange(r, 4096)))
      .toEqual([2048, 1625, 1290, 1024, 812, 256, 203, 50, 40, 1, 0, 0]);
  });

  it("are chosen by pitch, the fuller one and the next", () => {
    expect(selectTables(440, SR, 4096)).toEqual({ higher: 16, lower: 17, factor: Math.fround(0.6918373107910156) });
    expect(selectTables(5, SR, 4096)).toEqual({ higher: 0, lower: 1, factor: 0 });
    expect(selectTables(0, SR, 4096)).toEqual({ higher: 0, lower: 1, factor: 0 });
    expect(selectTables(24000, SR, 4096)).toEqual({ higher: 34, lower: 35, factor: 0 });
    expect(selectTables(1e9, SR, 4096)).toEqual({ higher: 35, lower: 35, factor: 0 });
  });

  it("start from the spec's Fourier coefficients", () => {
    expect(basicCoefficient("sine", 1)).toBe(1);
    expect(basicCoefficient("sine", 2)).toBe(0);
    expect(basicCoefficient("square", 1)).toBeCloseTo(4 / Math.PI, 6);
    expect(basicCoefficient("square", 2)).toBe(0);
    expect(basicCoefficient("sawtooth", 1)).toBeCloseTo(2 / Math.PI, 6);
    expect(basicCoefficient("sawtooth", 2)).toBeCloseTo(-1 / Math.PI, 6);
    expect(basicCoefficient("triangle", 3)).toBeCloseTo(-8 / (9 * Math.PI ** 2), 6);
    expect(basicCoefficient("triangle", 4)).toBe(0);
    expect(basicCoefficient("triangle", 5)).toBeGreaterThan(0);
  });

  it("are the normalised partial sums", () => {
    const saw = table("sawtooth", 0).table;
    expect(saw[0]).toBe(0);
    expect([1, 512, 1024, 2047].map((k) => saw[k]))
      .toEqual([0.000414428737713024, 0.21208098530769348, 0.4241393506526947, 1]);
    const sparse = table("sawtooth", 16).table;
    expect([1, 1024].map((k) => sparse[k])).toEqual([4.142136731388746e-7, 0.4296710789203644]);
    expect(table("square", 0).table[1024]).toBe(0.8479272723197937);
    expect(table("triangle", 0).table[512]).toBe(0.5000989437103271);
    const sine = table("sine", 0).table;
    expect(sine[1024]).toBeCloseTo(1, 6);
    expect(sine[512]).toBeCloseTo(Math.SQRT1_2, 6);
  });

  it("make the original's pulse from its 256 cosines, its DC dropped", () => {
    const { real, imag } = pulseWaveCoefficients(0.1);
    expect(real[0]).toBeCloseTo(-0.8, 6);
    expect(real[1]).toBe(0.19672632217407227);
    const { table: pulse, scale } = periodicWaveTable(real, imag, 16, SR);
    expect(scale).toBe(0.506470263004303);
    expect([0, 100, 2048].map((k) => pulse[k])).toEqual([0.9520429968833923, 0.9172765016555786, -0.10231518745422363]);
    // A silent wave keeps Chromium's default scale.
    expect(periodicWaveTable(new Float32Array(4), new Float32Array(4), 0, SR).scale).toBe(0.5);
  });
});

describe("the oscillator", () => {
  const tables = (shape: BasicShape) => (range: number) => table(shape, range).table;

  it("reads two tables and blends them, linearly in each", () => {
    const saw = renderOscillator(tables("sawtooth"), 440, SR, 100);
    expect([0, 1, 10, 54, 99].map((k) => saw[k]))
      .toEqual([0, 0.01184000913053751, 0.1614956110715866, 0.6560238599777222, -0.16330930590629578]);
  });

  it("interpolates by Lagrange when it moves slowly, as an LFO does", () => {
    // Five points under 0.16 entries a sample.
    expect(renderOscillator(tables("sine"), 1, SR, 12001)[12000]).toBe(1);
    // Three between 0.16 and 0.3.
    const tri = renderOscillator(tables("triangle"), 2.5, SR, 2400);
    expect([100, 1000, 2399].map((k) => tri[k])).toEqual([0.020837457850575447, 0.20837457478046417, 0.49989059567451477]);
  });

  it("holds its frequency to Nyquist", () => {
    expect(clampFrequency(Number.NaN, SR)).toBe(24000);
    expect(clampFrequency(-1e6, SR)).toBe(-24000);
    expect(clampFrequency(440, SR)).toBe(440);
  });
});

describe("setTargetAtTime", () => {
  it("steps by the discrete time constant and lands at a quantum", () => {
    expect(discreteTimeConstant(0.015, SR)).toBe(0.001387924887239933);
    const glide = renderSetTarget(1000, 2000, 0.015, SR, 1, 48000);
    expect(glide[0]).toBe(1000);
    expect(glide[1]).toBe(1001.387939453125);
    expect(glide[719]).toBe(1631.60986328125);
    expect(glide.findIndex((v) => v === 2000) + 1).toBe(6784);
  });

  it("converges by time or by ratio", () => {
    expect(setTargetConverged(0, 0, 0, 0, 1)).toBe(true);
    expect(setTargetConverged(0.1, 0, 0, 0, 1)).toBe(false);
    expect(setTargetConverged(1000, 1000.01, 0, 0, 1)).toBe(true);
    expect(setTargetConverged(1000, 1001, 0, 0, 1)).toBe(false);
    expect(setTargetConverged(1000, 1001, 11, 0, 1)).toBe(true);
    // Already there when it starts.
    expect(renderSetTarget(5, 5, 0.015, SR, 0, 2)).toEqual(Float32Array.from([5, 5]));
  });
});

describe("the lowpass", () => {
  it("is the spec's, Q in decibels", () => {
    expect(lowpassCoefficients(1000, 6, SR)).toEqual({
      b0: 0.004142085705032131,
      b1: 0.008284171410064262,
      b2: 0.004142085705032131,
      a1: -1.9200855846110763,
      a2: 0.9366539274312046,
    });
    expect(lowpassCoefficients(30000, 0, SR)).toEqual({ b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 });
    expect(lowpassCoefficients(-5, 0, SR)).toEqual({ b0: 0, b1: 0, b2: 0, a1: 0, a2: 0 });
    expect(lowpassCoefficients(Number.NaN, 0, SR)).toEqual({ b0: 0, b1: 0, b2: 0, a1: 0, a2: 0 });
    expect(lowpassCoefficients(1000, Number.NaN, SR)).toEqual(lowpassCoefficients(1000, 0, SR));
  });
});

describe("an automation timeline", () => {
  it("orders events by time, each after any at its time, and cancels from a time", () => {
    const events = orderTimeline([
      { kind: "set", value: 0, time: 0 },
      { kind: "linear", value: 1, time: 0.1 },
      { kind: "set", value: 9, time: 0.3 },
      { kind: "cancel", time: 0.3 },
      { kind: "linear", value: 0.5, time: 0.2 },
      { kind: "set", value: 0.5, time: 0.05 },
      { kind: "linear", value: 0, time: 0.25 },
    ]);
    expect(events.map((event) => event.time)).toEqual([0, 0.05, 0.1, 0.2, 0.25]);
  });

  it("holds a set, runs a ramp from the event before it", () => {
    // The original's envelope with its gate inside the attack.
    const events = orderTimeline([
      { kind: "set", value: 0, time: 0 },
      { kind: "linear", value: 1, time: 0.1 },
      { kind: "linear", value: 0.5, time: 0.2 },
      { kind: "set", value: 0.5, time: 0.05 },
      { kind: "linear", value: 0, time: 0.25 },
    ]);
    const at = (frame: number) => timelineValueAt(events, frame, 1000, 7);
    expect([10, 49, 50, 75, 100, 150, 225, 300].map(at)).toEqual([0, 0, 0.5, 0.75, 1, 0.75, 0.25, 0]);
    expect(timelineValueAt(events, 0, 1000, 7)).toBe(0);
    expect(timelineValueAt([], 0, 1000, 7)).toBe(7);
    // A ramp at the moment of the event before it is a step.
    expect(timelineValueAt(orderTimeline([
      { kind: "set", value: 2, time: 1 },
      { kind: "linear", value: 4, time: 1 },
    ]), 1000, 1000)).toBe(4);
    // A ramp too short for a float to divide by holds where it starts.
    expect(timelineValueAt([
      { kind: "set", value: 3, time: 0 },
      { kind: "linear", value: 5, time: 1e-40 },
    ], 0, 1000)).toBe(3);
  });
});
