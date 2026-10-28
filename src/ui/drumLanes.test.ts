import { describe, expect, it } from "vitest";
import { DEFAULT_PADS, drumLanes, showsDrumLanes } from "./drumLanes";
import type { Pattern } from "../engine/types";

const pattern = (notes: number[][], drumMachine = true) =>
  ({ drumMachine, steps: notes.map((pitches) => ({ pitches })) }) as unknown as Pattern;

describe("drum lanes", () => {
  it("has 16 pads on notes 36–51, kick first", () => {
    expect(DEFAULT_PADS).toHaveLength(16);
    expect(DEFAULT_PADS.map((pad) => pad.note)).toEqual(Array.from({ length: 16 }, (_, i) => 36 + i));
    expect(DEFAULT_PADS[0]).toMatchObject({ note: 36, name: "Kick" });
    expect(DEFAULT_PADS[3]).toMatchObject({ name: "Closed Hat", choke: 3 });
    expect(DEFAULT_PADS[4]).toMatchObject({ name: "Open Hat", choke: 3 });
  });

  it("shows lanes only for a pattern in Drum mode", () => {
    expect(showsDrumLanes(pattern([[36]], true))).toBe(true);
    expect(showsDrumLanes(pattern([[36]], false))).toBe(false);
  });

  it("shows only the pads the pattern uses, in pad order, top to bottom", () => {
    const lanes = drumLanes(pattern([[39, 36], [], [37], [36]]), DEFAULT_PADS);
    expect(lanes.map((lane) => lane.name)).toEqual(["Kick", "Snare", "Closed Hat"]);
    expect(lanes.map((lane) => lane.pitch)).toEqual([36, 37, 39]);
  });

  it("shows every pad when asked, or when the pattern is empty", () => {
    expect(drumLanes(pattern([[36]]), DEFAULT_PADS, true)).toHaveLength(16);
    expect(drumLanes(pattern([]), DEFAULT_PADS)).toHaveLength(16);
  });

  it("keeps notes that no pad answers to, named by pitch, after the pads", () => {
    const lanes = drumLanes(pattern([[36], [60]]), DEFAULT_PADS);
    expect(lanes.map((lane) => lane.pitch)).toEqual([36, 60]);
    expect(lanes[1].name).toBe("C4");
    expect(lanes[1].choke).toBe(0);
  });
});
