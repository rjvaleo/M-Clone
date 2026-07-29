import { describe, it, expect } from "vitest";
import {
  makeDefaultPositions,
  applyPosition,
  setSlot,
  POSITION_VARS,
  POSITION_COUNT,
} from "./variables";
import { createDefaultProject } from "./project";

describe("makeDefaultPositions", () => {
  it("creates 6 positions per variable, all active at 0", () => {
    const p = createDefaultProject();
    const pos = makeDefaultPositions(p.voices);
    for (const id of POSITION_VARS) {
      expect(pos[id].active).toBe(0);
      expect(pos[id].slots).toHaveLength(POSITION_COUNT);
      expect(pos[id].slots[0]).toHaveLength(p.voices.length);
    }
  });
  it("seeds every slot from the current voice values", () => {
    const p = createDefaultProject();
    const pos = makeDefaultPositions(p.voices);
    // transposition slot values match each voice's transposition
    for (let s = 0; s < POSITION_COUNT; s++) {
      expect(pos.transposition.slots[s]).toEqual(p.voices.map((v) => v.transposition));
    }
  });
});

describe("applyPosition", () => {
  it("writes a slot's values into the matching voice field", () => {
    const p = createDefaultProject();
    const voices = applyPosition(p.voices, "transposition", [7, -5, 12, 0]);
    expect(voices.map((v) => v.transposition)).toEqual([7, -5, 12, 0]);
    // other fields untouched
    expect(voices[0].density).toBe(p.voices[0].density);
  });
  it("works for note order (string values)", () => {
    const p = createDefaultProject();
    const voices = applyPosition(p.voices, "noteOrder", [
      "random",
      "reverse",
      "original",
      "random-walk",
    ]);
    expect(voices.map((v) => v.noteOrder)).toEqual([
      "random",
      "reverse",
      "original",
      "random-walk",
    ]);
  });
  it("does not mutate the input array", () => {
    const p = createDefaultProject();
    const before = p.voices[0].transposition;
    applyPosition(p.voices, "transposition", [9, 9, 9, 9]);
    expect(p.voices[0].transposition).toBe(before);
  });
});

describe("setSlot", () => {
  it("updates a single cell immutably", () => {
    const p = createDefaultProject();
    const pos = makeDefaultPositions(p.voices);
    const next = setSlot(pos, "density", 2, 1, 0.5);
    expect(next.density.slots[2][1]).toBe(0.5);
    // original untouched
    expect(pos.density.slots[2][1]).not.toBe(0.5);
    // neighbours untouched
    expect(next.density.slots[2][0]).toBe(pos.density.slots[2][0]);
    expect(next.density.slots[3][1]).toBe(pos.density.slots[3][1]);
  });
  it("keeps other variables untouched", () => {
    const p = createDefaultProject();
    const pos = makeDefaultPositions(p.voices);
    const next = setSlot(pos, "velocity", 0, 0, 42);
    expect(next.transposition).toBe(pos.transposition);
  });
});
