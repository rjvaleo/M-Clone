import { describe, expect, it, vi } from "vitest";
import { cycleIndex, detentSnap, formatValue, selectorAdvance } from "./values";

describe("formatValue", () => {
  it("infers no decimals for a whole number and one for a fraction", () => {
    expect(formatValue(2)).toBe("2");
    expect(formatValue(1.5)).toBe("1.5");
  });

  it("honours an explicit decimal count over the inferred one", () => {
    expect(formatValue(2, undefined, 2)).toBe("2.00");
    expect(formatValue(3.14159, undefined, 2)).toBe("3.14");
    expect(formatValue(1.5, undefined, 0)).toBe("2");
  });

  it("attaches a percent sign directly but spaces every other unit", () => {
    // CATALOG.md #19 prints "0%" and #26 prints "0.0 dB" / "222 s" — the
    // panels are consistent about percent hugging its number and unrelated
    // units standing off it.
    expect(formatValue(0, "%")).toBe("0%");
    expect(formatValue(100, "%")).toBe("100%");
    expect(formatValue(0, "dB", 1)).toBe("0.0 dB");
    expect(formatValue(222, "s")).toBe("222 s");
    expect(formatValue(0, "cents")).toBe("0 cents");
  });

  it("attaches a degree sign directly, like percent", () => {
    expect(formatValue(45, "°")).toBe("45°");
  });

  it("keeps a signed zero visible, the way a gain readout does", () => {
    // The ADSR Drum Machine's Gain reads "-0.0" at a hair below unity;
    // rounding that to a bare "0.0" would hide which side of zero it is on.
    expect(formatValue(-0.04, undefined, 1)).toBe("-0.0");
    expect(formatValue(0.04, undefined, 1)).toBe("0.0");
  });

  it("shows an em dash rather than NaN when there is no value to read", () => {
    expect(formatValue(Number.NaN)).toBe("—");
    expect(formatValue(Number.NaN, "dB")).toBe("—");
  });

  it("shows an em dash for a non-finite value", () => {
    expect(formatValue(Number.POSITIVE_INFINITY)).toBe("—");
    expect(formatValue(Number.NEGATIVE_INFINITY)).toBe("—");
  });
});

describe("cycleIndex", () => {
  it("steps forward through the options", () => {
    expect(cycleIndex(0, 3, 1)).toBe(1);
    expect(cycleIndex(1, 3, 1)).toBe(2);
  });

  it("wraps past the last option back to the first", () => {
    expect(cycleIndex(2, 3, 1)).toBe(0);
  });

  it("wraps below the first option round to the last", () => {
    expect(cycleIndex(0, 3, -1)).toBe(2);
  });

  it("stays put when there is only one option", () => {
    expect(cycleIndex(0, 1, 1)).toBe(0);
    expect(cycleIndex(0, 1, -1)).toBe(0);
  });

  it("returns 0 for an empty or negative option list", () => {
    expect(cycleIndex(0, 0, 1)).toBe(0);
    expect(cycleIndex(3, -2, 1)).toBe(0);
  });

  it("pulls an out-of-range starting index back into the list", () => {
    expect(cycleIndex(-5, 3, 1)).toBe(2);
    expect(cycleIndex(9, 3, 1)).toBe(1);
  });
});

describe("selectorAdvance", () => {
  const options = [
    { value: "lp", label: "Low pass" },
    { value: "bp", label: "Band pass" },
    { value: "hp", label: "High pass" },
  ];

  it("moves to the next option", () => {
    const onChange = vi.fn();
    selectorAdvance({ options, value: "lp", onChange }, 1);
    expect(onChange).toHaveBeenCalledWith("bp");
  });

  it("wraps from the last option round to the first", () => {
    const onChange = vi.fn();
    selectorAdvance({ options, value: "hp", onChange }, 1);
    expect(onChange).toHaveBeenCalledWith("lp");
  });

  it("moves backwards, wrapping to the last option", () => {
    const onChange = vi.fn();
    selectorAdvance({ options, value: "lp", onChange }, -1);
    expect(onChange).toHaveBeenCalledWith("hp");
  });

  it("lands on the first option when the current value is unknown", () => {
    // A stale value saved in a document shouldn't wedge the control — the
    // next press has to go somewhere sensible.
    const onChange = vi.fn();
    selectorAdvance({ options, value: "gone", onChange }, 1);
    expect(onChange).toHaveBeenCalledWith("lp");
  });

  it("does nothing at all when there are no options", () => {
    const onChange = vi.fn();
    selectorAdvance({ options: [], value: "lp", onChange }, 1);
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("detentSnap", () => {
  it("pulls a value inside the tolerance onto the detent", () => {
    expect(detentSnap(50.5, 50, 2)).toBe(50);
    expect(detentSnap(48, 50, 2)).toBe(50);
  });

  it("leaves a value outside the tolerance alone", () => {
    expect(detentSnap(55, 50, 2)).toBe(55);
    expect(detentSnap(47.9, 50, 2)).toBe(47.9);
  });

  it("snaps only on an exact hit when the tolerance is zero or negative", () => {
    expect(detentSnap(50, 50, 0)).toBe(50);
    expect(detentSnap(50.1, 50, 0)).toBe(50.1);
    expect(detentSnap(50.1, 50, -5)).toBe(50.1);
  });

  it("treats the tolerance as a radius on both sides", () => {
    expect(detentSnap(52, 50, 2)).toBe(50);
    expect(detentSnap(52.01, 50, 2)).toBe(52.01);
  });
});
