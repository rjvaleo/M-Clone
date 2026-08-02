import { describe, expect, it } from "vitest";
import { copiedNumericalValue, draggedNumericalValue } from "./numericalgesture";

describe("Shift-click Numerical copy", () => {
  it("copies the latest value within the destination Numerical's limits", () => {
    expect(copiedNumericalValue(90, 0, 127)).toBe(90);
    expect(copiedNumericalValue(200, 0, 127)).toBe(127);
    expect(copiedNumericalValue(-8, 1, 16)).toBe(1);
  });

  it("aligns a copied value to the destination step", () => {
    expect(copiedNumericalValue(1.24, 0, 2, 0.1)).toBeCloseTo(1.2);
  });

  it("steps on upper/lower clicks and changes continuously on horizontal drag", () => {
    expect(draggedNumericalValue(10, 0, true, 0, 20, 1)).toBe(11);
    expect(draggedNumericalValue(10, 0, false, 0, 20, 1)).toBe(9);
    expect(draggedNumericalValue(10, 12, true, 0, 20, 1)).toBe(13);
    expect(draggedNumericalValue(10, -100, false, 0, 20, 1)).toBe(0);
  });
});
