import { describe, expect, it } from "vitest";
import { QUANTISE_CASES } from "./grainTuning.generated";
import { GRAIN_SCALES, pitchText, quantise, scaleDegrees, scaleOf, tuningName } from "./grainTuning";

describe("The Grain Engine's tuning, as prism_grain::tuning", () => {
  it("has the crate's eighty-one scales", () => {
    expect(GRAIN_SCALES).toHaveLength(81);
    expect(GRAIN_SCALES[0].name).toBe("Ionian (Major)");
  });

  it("snaps exactly as the crate's quantise does, every scale and both grids", () => {
    const wrong = QUANTISE_CASES.filter(([shift, scale, step, want]) => quantise(shift, scale, step) !== Math.fround(want));
    expect(wrong).toEqual([]);
    expect(QUANTISE_CASES.length).toBeGreaterThan(1000);
  });

  it("reads and writes as MultiGrainLive's pitch row does", () => {
    expect(scaleOf("free")).toBeNull();
    expect(scaleOf("Dorian")).toBe("Dorian");
    expect(tuningName(null, 0)).toBe("free");
    expect(tuningName(null, 0.5)).toBe("0.5 st grid");
    expect(pitchText(3, null, 1)).toBe("+3.0 st");
    expect(pitchText(-0.255, null, 0)).toBe("-0.26 st · -25¢");
    expect(scaleDegrees(null, 0).cents).toHaveLength(12);
    expect(scaleDegrees(null, 0.5).cents).toHaveLength(24);
    expect(scaleDegrees("Major Pentatonic", 0)).toEqual({ cents: [0, 200, 400, 700, 900], span: 1200 });
  });
});
