import { describe, expect, it } from "vitest";
import {
  MAX_PRESETS,
  PRESET_SLOTS,
  deletePreset,
  firstFree,
  movePreset,
  recallSlot,
  renamePreset,
  snapshotOf,
  storePreset,
} from "./presets";

const params = { tempo: 120, pads: [{ x: 0 }], comment: "...", collapsed: false, presets: [], "preset-slot": -1 };

describe("a module's preset manager", () => {
  it("holds up to 99 presets; the first six are the slots a–f on the page", () => {
    expect(MAX_PRESETS).toBe(99);
    expect(PRESET_SLOTS).toBe(6);
  });

  it("snapshots every setting but its header, its view and its presets", () => {
    expect(snapshotOf(params)).toEqual({ tempo: 120, pads: [{ x: 0 }] });
  });

  it("stores, renames and deletes presets by number", () => {
    let presets = storePreset([], 4, "Verse", { tempo: 90 });
    expect(presets[4]).toEqual({ name: "Verse", values: { tempo: 90 } });
    expect(presets.slice(0, 4).every((p) => p === null)).toBe(true);
    presets = renamePreset(presets, 4, "Chorus");
    expect(presets[4]?.name).toBe("Chorus");
    expect(deletePreset(presets, 4)[4]).toBeNull();
    expect(storePreset([], 99, "x", {})).toEqual([]);
  });

  it("finds the first free number", () => {
    expect(firstFree([])).toBe(0);
    expect(firstFree(storePreset(storePreset([], 0, "a", {}), 1, "b", {}))).toBe(2);
  });

  it("moves a preset to another place, the rest closing up behind it — which is how a–f are chosen", () => {
    let presets = ["A", "B", "C", "D"].reduce((list, name, i) => storePreset(list, i, name, { n: i }), [] as ReturnType<typeof storePreset>);
    presets = movePreset(presets, 3, 0);
    expect(presets.map((p) => p?.name)).toEqual(["D", "A", "B", "C"]);
    presets = movePreset(presets, 0, 8);
    expect(presets.map((p) => p?.name ?? null)).toEqual(["A", "B", "C", null, null, null, null, null, "D"]);
    expect(movePreset(presets, 2, 2)).toBe(presets);
  });

  it("slot n recalls preset n, and nothing when that place is empty", () => {
    const presets = storePreset([], 1, "Break", { tempo: 140 });
    expect(recallSlot(presets, 1)).toEqual({ tempo: 140 });
    expect(recallSlot(presets, 0)).toBeNull();
    expect(recallSlot(presets, 6)).toBeNull();
  });
});
