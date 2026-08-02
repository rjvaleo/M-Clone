import { describe, expect, it } from "vitest";
import { clockPulseInterval, metronomeInterval } from "./clockoutput";

describe("Sync Ratio output timing", () => {
  it("uses ratio 4 as the normal quarter-note reference", () => {
    expect(metronomeInterval(120, 4)).toBeCloseTo(0.5);
    expect(clockPulseInterval(120, 4)).toBeCloseTo(0.5 / 24);
  });
  it("runs ratio 8 twice as fast and ratio 1 four times slower", () => {
    expect(metronomeInterval(120, 8)).toBeCloseTo(0.25);
    expect(metronomeInterval(120, 1)).toBeCloseTo(2);
  });
});
