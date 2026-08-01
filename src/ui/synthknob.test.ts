import { describe, expect, it } from "vitest";
import { knobValueFromDrag } from "./synthknob";

describe("Synth knob dragging", () => {
  it("maps upward movement to stepped increases and clamps both ends", () => {
    expect(knobValueFromDrag(0.2, 12, 0, 1, 0.1)).toBeCloseTo(0.3);
    expect(knobValueFromDrag(0.5, 120, 0, 1, 0.01)).toBe(1);
    expect(knobValueFromDrag(0.5, -120, 0, 1, 0.01)).toBe(0);
  });
});
