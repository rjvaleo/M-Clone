import { describe, expect, it } from "vitest";
import {
  computePeaks,
  isSilent,
  PEAK_SCALE,
  peaksToPath,
  peakToUnit,
  THUMBNAIL_BUCKETS,
} from "./waveform";

const ramp = (length: number): Float32Array =>
  Float32Array.from({ length }, (_, i) => (i / (length - 1)) * 2 - 1);

describe("Waveform peaks", () => {
  it("returns one min/max pair per bucket", () => {
    const peaks = computePeaks([ramp(1000)]);
    expect(peaks).toHaveLength(THUMBNAIL_BUCKETS * 2);
    for (let bucket = 0; bucket < THUMBNAIL_BUCKETS; bucket++) {
      expect(peaks[bucket * 2]).toBeLessThanOrEqual(peaks[bucket * 2 + 1]);
    }
  });

  it("keeps both extremes rather than averaging them away", () => {
    // A transient is what makes a drum recognisable at thumbnail size, and it
    // is the first thing an RMS reduction loses.
    const spiky = new Float32Array(500);
    spiky[10] = 1;
    spiky[11] = -1;
    const peaks = computePeaks([spiky], 4);
    expect(peaks[1]).toBe(PEAK_SCALE);
    expect(peaks[0]).toBe(-PEAK_SCALE);
  });

  it("covers the whole file, with no bucket left short by rounding", () => {
    // 997 frames over 128 buckets does not divide; the end must still be read.
    const tail = new Float32Array(997);
    tail[996] = 1;
    const peaks = computePeaks([tail]);
    expect(peaks[peaks.length - 1]).toBe(PEAK_SCALE);
  });

  it("folds channels by widest excursion, not by first channel", () => {
    const left = new Float32Array(100);
    const right = new Float32Array(100);
    right[50] = 1;
    const peaks = computePeaks([left, right], 1);
    expect(peaks[1]).toBe(PEAK_SCALE);
  });

  it("survives empty, short and non-finite input", () => {
    expect(computePeaks([], 8)).toHaveLength(16);
    expect(computePeaks([new Float32Array(0)], 8).every((value) => value === 0)).toBe(true);
    expect(computePeaks([Float32Array.from([Number.NaN, 2, -9])], 2)
      .every((value) => Number.isFinite(value))).toBe(true);
    // Out-of-range samples clamp rather than producing an off-canvas thumbnail.
    expect(Math.max(...computePeaks([Float32Array.from([5])], 1))).toBe(PEAK_SCALE);
  });

  it("stores peaks as small integers, so a manifest stays small", () => {
    for (const value of computePeaks([ramp(4096)])) {
      expect(Number.isInteger(value)).toBe(true);
      expect(Math.abs(value)).toBeLessThanOrEqual(PEAK_SCALE);
    }
  });

  it("names a decode that produced silence", () => {
    expect(isSilent(computePeaks([new Float32Array(500)]))).toBe(true);
    expect(isSilent(computePeaks([ramp(500)]))).toBe(false);
  });
});

describe("Drawing a thumbnail", () => {
  it("returns a closed path inside the box", () => {
    const path = peaksToPath(computePeaks([ramp(400)], 8), 100, 40);
    expect(path.startsWith("M")).toBe(true);
    expect(path.endsWith("Z")).toBe(true);
    const numbers = path.match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [];
    const ys = numbers.filter((_, index) => index % 2 === 1);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...ys)).toBeLessThanOrEqual(40);
  });

  it("has nothing to draw for an empty or zero-sized thumbnail", () => {
    expect(peaksToPath([], 100, 40)).toBe("");
    expect(peaksToPath([1, 2], 0, 40)).toBe("");
    expect(peaksToPath([1, 2], 100, 0)).toBe("");
  });

  it("maps a stored peak back to the unit range", () => {
    expect(peakToUnit(PEAK_SCALE)).toBe(1);
    expect(peakToUnit(-PEAK_SCALE)).toBe(-1);
    expect(peakToUnit(0)).toBe(0);
    expect(peakToUnit(999)).toBe(1);
  });
});
