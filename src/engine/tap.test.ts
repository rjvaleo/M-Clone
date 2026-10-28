import { describe, expect, it } from "vitest";
import { tapOffset, tapTempo, tappedTempo } from "./tap";

describe("tap tempo", () => {
  it("reads the interval between taps as one Sync Ratio unit, as M does", () => {
    expect(tapTempo(0.5, 4)).toEqual({ tempo: 120, beatSec: 0.5 });
    expect(tapTempo(0.5, 8).tempo).toBe(60);
  });

  it("holds the interval to 59 ms..1.5 s", () => {
    expect(tapTempo(0.01, 4).beatSec).toBe(0.059);
    expect(tapTempo(5, 4)).toEqual({ tempo: 40, beatSec: 1.5 });
  });

  it("gives each tap's key velocity as a velocity offset", () => {
    expect(tapOffset(100)).toBe(18);
    expect(tapOffset(30)).toBe(-17);
  });

  it("averages the last four intervals of a run of taps", () => {
    expect(tappedTempo([0, 0.5, 1.0, 1.5, 2.0])).toBe(120);
    expect(tappedTempo([0, 0.9, 1.4, 2.0, 2.4, 2.9])).toBe(120);
  });

  it("starts a new count after a pause of more than two seconds", () => {
    expect(tappedTempo([0, 0.5, 1.0, 4.0, 4.4])).toBe(150);
  });

  it("needs two taps", () => {
    expect(tappedTempo([3])).toBeNull();
    expect(tappedTempo([])).toBeNull();
  });
});
