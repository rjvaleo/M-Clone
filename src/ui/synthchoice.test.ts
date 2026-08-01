import { describe, expect, it } from "vitest";
import { synthChoiceText, synthChoiceWidthCh } from "./synthchoice";

describe("compact synth choices", () => {
  it("abbreviates values and reserves exactly one character per border side", () => {
    expect(synthChoiceText("sawtooth")).toBe("SAW");
    expect(synthChoiceText("filter")).toBe("FILT");
    expect(synthChoiceWidthCh(["sine", "triangle", "sawtooth", "square"])).toBe(5);
    expect(synthChoiceWidthCh(["pitch", "filter", "amp"])).toBe(7);
    expect(synthChoiceWidthCh(["lowpass", "highpass", "bandpass"])).toBe(4);
    expect(synthChoiceWidthCh([-2, -1, 0, 1, 2])).toBe(4);
  });
});
