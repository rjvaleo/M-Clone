import { describe, expect, it } from "vitest";
import { formatValue } from "./format";

describe("a tight module's printed value", () => {
  it("prints whole numbers whole and fractions to two places", () => {
    expect(formatValue(16, { step: 1 })).toBe("16");
    expect(formatValue(0.8, { step: 0.01 })).toBe("0.80");
    expect(formatValue(-0.5, {})).toBe("-0.50");
  });

  it("keeps its unit, short, with no space", () => {
    expect(formatValue(671, { unit: "Hz", step: 1 })).toBe("671Hz");
    expect(formatValue(10, { unit: "ms", step: 1 })).toBe("10ms");
    expect(formatValue(1, { unit: "Q", step: 0.1 })).toBe("1.0Q");
    expect(formatValue(-1200, { unit: "¢", step: 1 })).toBe("-1200¢");
  });

  it("folds thousands of hertz into k and thousands of milliseconds into seconds", () => {
    expect(formatValue(2000, { unit: "Hz", step: 1 })).toBe("2.0k");
    expect(formatValue(12500, { unit: "Hz", step: 1 })).toBe("13k");
    expect(formatValue(1500, { unit: "ms", step: 1 })).toBe("1.5s");
  });
});
