import { describe, expect, it } from "vitest";
import { PRESET_SLOTS, SLOT_GAP_PX, SLOT_PX, presetColumns } from "./PresetPad";

const wideEnough = PRESET_SLOTS * SLOT_PX + (PRESET_SLOTS - 1) * SLOT_GAP_PX;

describe("How the preset pad wraps", () => {
  it("is one row when the module is wide enough", () => {
    expect(presetColumns(wideEnough)).toBe(PRESET_SLOTS);
    expect(presetColumns(wideEnough + 200)).toBe(PRESET_SLOTS);
  });

  it("wraps to two rows of eight, never to an arbitrary count", () => {
    // Eleven on one line and five on the next tells you nothing about which
    // slot is which; two shapes is the whole point.
    expect(presetColumns(wideEnough - 1)).toBe(PRESET_SLOTS / 2);
    expect(presetColumns(200)).toBe(PRESET_SLOTS / 2);
    expect(presetColumns(0)).toBe(PRESET_SLOTS / 2);
  });

  it("only ever answers with one of the two shapes", () => {
    for (let width = 0; width <= 800; width += 7) {
      expect([PRESET_SLOTS, PRESET_SLOTS / 2]).toContain(presetColumns(width));
    }
  });

  it("falls back to the narrow shape on a measurement it cannot use", () => {
    expect(presetColumns(Number.NaN)).toBe(PRESET_SLOTS / 2);
  });
});
