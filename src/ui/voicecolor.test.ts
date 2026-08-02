import { describe, expect, it } from "vitest";
import { voiceColorClass } from "./voicecolor";

describe("voiceColorClass", () => {
  it("identifies the voice and the colorized editor surface", () => {
    expect(voiceColorClass("velocity-range", 0)).toBe(
      "uvoice uvoice--1 voice-colorized voice-colorized--velocity-range",
    );
    expect(voiceColorClass("note-order", 2)).toBe(
      "uvoice uvoice--3 voice-colorized voice-colorized--note-order",
    );
    expect(voiceColorClass("cyclic", 3)).toBe(
      "uvoice uvoice--4 voice-colorized voice-colorized--cyclic",
    );
    expect(voiceColorClass("density", 1)).toContain("voice-colorized--density");
    expect(voiceColorClass("transposition", 2)).toContain("voice-colorized--transposition");
  });

  it("rejects voice indexes outside the four sequencer streams", () => {
    expect(() => voiceColorClass("cyclic", -1)).toThrow(RangeError);
    expect(() => voiceColorClass("note-order", 4)).toThrow(RangeError);
  });
});
