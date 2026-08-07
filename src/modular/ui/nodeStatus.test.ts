import { describe, expect, it } from "vitest";
import { IDLE_STATUSES, isLiveStatus, statusLevel } from "./nodeStatus";

describe("isLiveStatus", () => {
  it("is false for every way a module says it is doing nothing", () => {
    for (const idle of IDLE_STATUSES) expect(isLiveStatus(idle)).toBe(false);
  });

  it("ignores case and surrounding space", () => {
    expect(isLiveStatus("  idle ")).toBe(false);
    expect(isLiveStatus("STOPPED")).toBe(false);
  });

  it("is false for nothing at all", () => {
    expect(isLiveStatus(undefined)).toBe(false);
    expect(isLiveStatus("")).toBe(false);
    expect(isLiveStatus("   ")).toBe(false);
  });

  it("is false for a zero count, whatever follows it", () => {
    // "0 accepted · 0 rejected" and "0 voices" are a module reporting that it
    // is idle in a longer sentence. Lighting an LED for those would mean the
    // LED is always on.
    expect(isLiveStatus("0")).toBe(false);
    expect(isLiveStatus("0 accepted · 0 rejected")).toBe(false);
    expect(isLiveStatus("0 voices")).toBe(false);
  });

  it("is true for a running module", () => {
    expect(isLiveStatus("Playing · 3.2")).toBe(true);
    expect(isLiveStatus("3 voices")).toBe(true);
    expect(isLiveStatus("Step 4")).toBe(true);
  });
});

describe("statusLevel", () => {
  it("reads the leading count as a fraction of the maximum", () => {
    expect(statusLevel("4 voices", 8)).toBeCloseTo(0.5);
    expect(statusLevel("8", 8)).toBe(1);
    expect(statusLevel("0 voices", 8)).toBe(0);
  });

  it("clamps a count above the maximum", () => {
    expect(statusLevel("99 voices", 8)).toBe(1);
  });

  it("is zero when there is no number to read", () => {
    expect(statusLevel("Playing", 8)).toBe(0);
    expect(statusLevel(undefined, 8)).toBe(0);
    expect(statusLevel("", 8)).toBe(0);
  });

  it("is zero rather than infinite for a zero or negative maximum", () => {
    expect(statusLevel("4 voices", 0)).toBe(0);
    expect(statusLevel("4 voices", -8)).toBe(0);
  });

  it("reads a count that is not at the very start", () => {
    expect(statusLevel("Step 4", 8)).toBeCloseTo(0.5);
  });
});
