import { describe, expect, it } from "vitest";
import { clockToReal, isNeutralTimeMap } from "../../engine/timemap";
import { MAX_WARP_OFFSET, defaultWarpBanks, setWarpOffset, warpToTimeMap, zeroWarp, invertWarp } from "./warpSteps";

describe("M Time Warp as a CV Sequencer: one offset per step", () => {
  it("starts straight: every bank a neutral map", () => {
    const banks = defaultWarpBanks();
    expect(banks).toHaveLength(6);
    expect(isNeutralTimeMap(warpToTimeMap(banks[0]))).toBe(true);
  });

  it("lands each step boundary where its offset says, step 1 fixed", () => {
    const bank = { offsets: [0, 0.25, 0, -0.25], length: 4, denominator: 16 };
    const map = warpToTimeMap(bank);
    expect(map.length).toBe(4);
    expect(map.denominator).toBe(16);
    expect(clockToReal(map, 0.25)).toBeCloseTo((1 + 0.25) / 4);
    expect(clockToReal(map, 0.5)).toBeCloseTo(0.5);
    expect(clockToReal(map, 0.75)).toBeCloseTo((3 - 0.25) / 4);
  });

  it("keeps offsets inside half a step so time never runs backwards", () => {
    const bank = setWarpOffset(defaultWarpBanks()[0], 2, 3);
    expect(bank.offsets[2]).toBe(MAX_WARP_OFFSET);
    expect(setWarpOffset(bank, 0, 0.3).offsets[0]).toBe(0);
  });

  it("Zero All and Invert", () => {
    const bank = { offsets: [0, 0.2, -0.1], length: 3, denominator: 8 };
    expect(zeroWarp(bank).offsets).toEqual([0, 0, 0]);
    expect(invertWarp(bank).offsets).toEqual([0, -0.2, 0.1]);
  });
});
