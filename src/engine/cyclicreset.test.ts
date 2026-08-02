import { describe, expect, it } from "vitest";
import { cyclicResetVoices } from "./cyclicreset";

describe("Cyclic reset telemetry", () => {
  it("reports Voices whose cyclic cursor crossed its active length", () => {
    expect(cyclicResetVoices([15, 7, 20, 0], [17, 8, 31, 1], [16, 8, 10, 16]))
      .toEqual([0, 1, 2]);
  });
  it("uses safe defaults for missing before/length values", () => {
    expect(cyclicResetVoices([], [17], [])).toEqual([0]);
  });
});
