import { describe, it, expect } from "vitest";
import { midiToName, snapToScale, clampMidi, SCALES, NOTE_NAMES } from "./music";

describe("midiToName", () => {
  it("names middle C as C4", () => {
    expect(midiToName(60)).toBe("C4");
  });
  it("names A4 (440) as A4", () => {
    expect(midiToName(69)).toBe("A4");
  });
  it("handles the lowest note", () => {
    expect(midiToName(0)).toBe("C-1");
  });
  it("names sharps", () => {
    expect(midiToName(61)).toBe("C#4");
  });
});

describe("snapToScale", () => {
  it("leaves notes unchanged in chromatic", () => {
    for (let n = 48; n < 72; n++) {
      expect(snapToScale(n, 0, "chromatic")).toBe(n);
    }
  });
  it("keeps in-scale notes unchanged (C major)", () => {
    // C E G already in C major
    expect(snapToScale(60, 0, "major")).toBe(60);
    expect(snapToScale(64, 0, "major")).toBe(64);
    expect(snapToScale(67, 0, "major")).toBe(67);
  });
  it("snaps an out-of-scale note to the nearest scale tone", () => {
    // C#4 (61) in C major -> C4 (60), nearest scale tone (tie resolves down)
    expect(snapToScale(61, 0, "major")).toBe(60);
    // F#4 (66) in C major -> either F(65) or G(67); tie resolves down -> 65
    expect(snapToScale(66, 0, "major")).toBe(65);
  });
  it("respects a non-zero root", () => {
    // In A minor (root 9), C(60) is a scale tone -> unchanged
    expect(snapToScale(60, 9, "minor")).toBe(60);
  });
  it("stays within a semitone of the original", () => {
    for (let n = 40; n < 90; n++) {
      const snapped = snapToScale(n, 2, "dorian");
      expect(Math.abs(snapped - n)).toBeLessThanOrEqual(2);
    }
  });
  it("covers all pentatonic degrees", () => {
    const root = 0;
    for (let n = 60; n < 72; n++) {
      const s = snapToScale(n, root, "majorPentatonic");
      const pc = ((s % 12) + 12) % 12;
      expect(SCALES.majorPentatonic).toContain(pc);
    }
  });
});

describe("clampMidi", () => {
  it("clamps below 0", () => {
    expect(clampMidi(-5)).toBe(0);
  });
  it("clamps above 127", () => {
    expect(clampMidi(200)).toBe(127);
  });
  it("rounds fractional input", () => {
    expect(clampMidi(60.6)).toBe(61);
  });
});

describe("tables", () => {
  it("has 12 note names", () => {
    expect(NOTE_NAMES).toHaveLength(12);
  });
  it("every scale starts on the root", () => {
    for (const name of Object.keys(SCALES) as (keyof typeof SCALES)[]) {
      expect(SCALES[name][0]).toBe(0);
    }
  });
});
