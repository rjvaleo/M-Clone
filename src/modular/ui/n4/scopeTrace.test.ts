import { describe, expect, it } from "vitest";
import { triggerIndex } from "./scopeTrace";

describe("the scope's trigger", () => {
  it("starts the trace at the first rising zero crossing, so a steady wave stands still", () => {
    expect(triggerIndex(Float32Array.from([0.5, 0.2, -0.3, -0.1, 0.2, 0.6]), 6)).toBe(4);
  });
  it("starts at the beginning when the signal never rises through zero", () => {
    expect(triggerIndex(Float32Array.from([0, 0, 0, 0]), 4)).toBe(0);
  });
});
