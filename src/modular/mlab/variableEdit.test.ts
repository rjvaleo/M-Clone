import { describe, expect, it } from "vitest";
import { densityAt, dragVelocityRange, transpositionLabel, transposeBy } from "./variableEdit";

describe("M's Variable edit windows", () => {
  it("Note Density: the square sits where the pointer is along 0–100", () => {
    expect(densityAt(57, 100)).toBe(0.57);
    expect(densityAt(-5, 100)).toBe(0);
    expect(densityAt(130, 100)).toBe(1);
  });

  it("Velocity Range: drag an end, or the band itself to move both", () => {
    const range = { low: 48, high: 110 };
    expect(dragVelocityRange(range, "low", 30, 0)).toEqual({ low: 30, high: 110 });
    expect(dragVelocityRange(range, "high", 120, 0)).toEqual({ low: 48, high: 120 });
    expect(dragVelocityRange(range, "low", 115, 0)).toEqual({ low: 110, high: 110 });
    expect(dragVelocityRange(range, "band", 0, 10)).toEqual({ low: 58, high: 120 });
    expect(dragVelocityRange(range, "band", 0, 40)).toEqual({ low: 65, high: 127 });
    expect(dragVelocityRange(range, "band", 0, -60)).toEqual({ low: 1, high: 63 });
  });

  it("Transposition: shown as M shows it, the note and octave Middle C lands on", () => {
    expect(transpositionLabel(0)).toEqual({ note: "C", octave: 3 });
    expect(transpositionLabel(15)).toEqual({ note: "D#", octave: 4 });
    expect(transpositionLabel(-1)).toEqual({ note: "B", octave: 2 });
  });

  it("Transposition: the note cell moves a semitone, the octave cell an octave, within ±48", () => {
    expect(transposeBy(0, "note", 2)).toBe(2);
    expect(transposeBy(0, "octave", -1)).toBe(-12);
    expect(transposeBy(46, "octave", 1)).toBe(48);
  });
});
