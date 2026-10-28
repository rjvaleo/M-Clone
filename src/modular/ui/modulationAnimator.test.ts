import { describe, expect, it } from "vitest";
import { knobAngle, liveText } from "./modulationAnimator";

describe("The modulated pointer", () => {
  it("turns as the knob's own pointer does", () => {
    expect(knobAngle(0, 0, 1)).toBe(-135);
    expect(knobAngle(0.5, 0, 1)).toBe(0);
    expect(knobAngle(20000, 20, 20000)).toBe(135);
  });

  it("prints a live value to the knob's step", () => {
    expect(liveText(0.4567, 0.01)).toBe("0.46");
    expect(liveText(123.4, 1)).toBe("123");
    expect(liveText(0.5, 0.001)).toBe("0.500");
  });
});
