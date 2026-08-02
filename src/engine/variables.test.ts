import { describe, it, expect } from "vitest";
import {
  makeDefaultPositions,
  makePresetPositions,
  applyActivePositions,
  applyPosition,
  setSlot,
  transferPosition,
  transferPositionVoice,
  POSITION_VARS,
  POSITION_COUNT,
} from "./variables";
import type { NoteOrderMix, VelocityRange } from "./types";
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
  it("works for note-order probability mixes", () => {
    const p = createDefaultProject();
    const mixes = [
      { original: 100, cyclic: 0, utterly: 0 },
      { original: 0, cyclic: 100, utterly: 0 },
      { original: 0, cyclic: 0, utterly: 100 },
      { original: 50, cyclic: 25, utterly: 25 },
    ];
    const voices = applyPosition(p.voices, "noteOrderMix", mixes);
    expect(voices.map((v) => v.noteOrderMix)).toEqual(mixes);
  });
  it("applies an Orchestration position with multiple channels per Voice", () => {
    const p = createDefaultProject();
    const routing = [[1, 5], [2], [], [4, 16]];
    const voices = applyPosition(p.voices, "outputChannels", routing);
    expect(voices.map((v) => v.outputChannels)).toEqual(routing);
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
    const next = setSlot(pos, "velocityRange", 0, 0, { low: 42, high: 96 });
    expect(next.transposition).toBe(pos.transposition);
  });
  it("stores Orchestration channel arrays immutably", () => {
    const p = createDefaultProject();
    const pos = makeDefaultPositions(p.voices);
    const next = setSlot(pos, "outputChannels", 3, 0, [1, 7, 12]);
    expect(next.outputChannels.slots[3][0]).toEqual([1, 7, 12]);
    expect(pos.outputChannels.slots[3][0]).toEqual([1]);
  });
});

describe("makePresetPositions", () => {
  it("gives every variable six positions", () => {
    const pos = makePresetPositions();
    for (const id of POSITION_VARS) {
      expect(pos[id].slots).toHaveLength(POSITION_COUNT);
      for (const slot of pos[id].slots) expect(slot).toHaveLength(4);
    }
  });

  it("ships six distinct presets rather than six copies", () => {
    const pos = makePresetPositions();
    // Time Distortion is deliberately uniform; everything else must vary.
    for (const id of POSITION_VARS) {
      if (id === "timeDistort" || id === "outputChannels") continue;
      const shapes = new Set(pos[id].slots.map((s) => JSON.stringify(s)));
      expect(shapes.size).toBeGreaterThan(1);
    }
  });

  it("carries the exact values read off the edit-window screenshots", () => {
    const pos = makePresetPositions();
    expect(pos.density.slots[0]).toEqual([0.57, 1, 1, 1]);
    expect(pos.velocityRange.slots[0]).toEqual([
      { low: 48, high: 110 }, { low: 84, high: 107 },
      { low: 84, high: 104 }, { low: 85, high: 108 },
    ]);
    expect(pos.noteOrderMix.slots[4]).toEqual([
      { original: 50, cyclic: 4, utterly: 46 },
      { original: 38, cyclic: 47, utterly: 15 },
      { original: 3, cyclic: 10, utterly: 87 },
      { original: 10, cyclic: 15, utterly: 75 },
    ]);
  });

  it("keeps every Note Order mix summing to 100", () => {
    const pos = makePresetPositions();
    for (const slot of pos.noteOrderMix.slots) {
      for (const value of slot) {
        const mix = value as NoteOrderMix;
        expect(mix.original + mix.cyclic + mix.utterly).toBe(100);
      }
    }
  });

  it("keeps every velocity range ordered and in MIDI bounds", () => {
    const pos = makePresetPositions();
    for (const slot of pos.velocityRange.slots) {
      for (const value of slot) {
        const range = value as VelocityRange;
        expect(range.low).toBeLessThanOrEqual(range.high);
        expect(range.low).toBeGreaterThanOrEqual(0);
        expect(range.high).toBeLessThanOrEqual(127);
      }
    }
  });

  it("starts Note Density and Note Order on e, the rest on a", () => {
    const pos = makePresetPositions();
    expect(pos.density.active).toBe(4);
    expect(pos.noteOrderMix.active).toBe(4);
    expect(pos.velocityRange.active).toBe(0);
    expect(pos.transposition.active).toBe(0);
    expect(pos.timeDistort.active).toBe(0);
  });

  it("deep-copies, so editing one build cannot leak into another", () => {
    const a = makePresetPositions();
    const b = makePresetPositions();
    (a.velocityRange.slots[0][0] as VelocityRange).low = 1;
    (a.outputChannels.slots[0][0] as number[]).push(9);
    expect((b.velocityRange.slots[0][0] as VelocityRange).low).toBe(48);
    expect(b.outputChannels.slots[0][0]).toEqual([1]);
  });
});

describe("applyActivePositions", () => {
  it("pushes each variable's active position into the voices", () => {
    const project = createDefaultProject();
    const pos = makePresetPositions();
    const voices = applyActivePositions(project.voices, pos);
    expect(voices[0].density).toBe(pos.density.slots[4][0]);
    expect(voices[2].noteOrderMix).toEqual(pos.noteOrderMix.slots[4][2]);
    expect(voices[1].velocityRange).toEqual(pos.velocityRange.slots[0][1]);
    expect(voices[3].transposition).toBe(pos.transposition.slots[0][3]);
  });

  it("does not mutate the voices it was given", () => {
    const project = createDefaultProject();
    const before = project.voices[0].density;
    applyActivePositions(project.voices, makePresetPositions());
    expect(project.voices[0].density).toBe(before);
  });
});

describe("classic Variable drag transfer", () => {
  it("swaps Positions by default and copies with Option", () => {
    const positions = makePresetPositions();
    const a = positions.transposition.slots[0];
    const b = positions.transposition.slots[1];
    const swapped = transferPosition(positions, "transposition", 0, 1, false);
    expect(swapped.transposition.slots[0]).toEqual(b);
    expect(swapped.transposition.slots[1]).toEqual(a);
    const copied = transferPosition(positions, "transposition", 0, 1, true);
    expect(copied.transposition.slots[0]).toEqual(a);
    expect(copied.transposition.slots[1]).toEqual(a);
  });

  it("swaps or copies one Voice inside a Position", () => {
    const positions = makePresetPositions();
    const row = positions.velocityRange.slots[0];
    const swapped = transferPositionVoice(positions, "velocityRange", 0, 0, 1, false);
    expect(swapped.velocityRange.slots[0][0]).toEqual(row[1]);
    expect(swapped.velocityRange.slots[0][1]).toEqual(row[0]);
    const copied = transferPositionVoice(positions, "velocityRange", 0, 0, 1, true);
    expect(copied.velocityRange.slots[0][1]).toEqual(row[0]);
  });

  it("treats transfers onto the same Position or Voice as no-ops", () => {
    const positions = makePresetPositions();
    expect(transferPosition(positions, "density", 2, 2, false)).toBe(positions);
    expect(transferPositionVoice(positions, "density", 2, 1, 1, false)).toBe(positions);
  });
});
