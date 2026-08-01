import { describe, expect, it } from "vitest";
import { EDITOR_NATIVE_SIZES, EDITOR_CONTENT_SCALES, PATTERN_GRID_CELL_SIZE } from "./editorlayout";

describe("640 × 480 native editor sizes", () => {
  it("tracks the current 640×480 logical editor dimensions", () => {
    expect(EDITOR_NATIVE_SIZES).toEqual({
      density: [145, 90], velocityRange: [165, 81], noteOrderMix: [199, 149],
      transposition: [143, 95], cyclic: [275, 222], timeDistort: [185, 155],
      outputChannels: [155, 80],
    });
  });

  it("normalizes the Pattern Editor reference raster to the core-panel scale", () => {
    expect(EDITOR_CONTENT_SCALES.patternEditor).toBe(0.72);
  });

  it("enlarges Cyclic controls without enlarging its rendered typography", () => {
    expect(EDITOR_CONTENT_SCALES.cyclicContent).toBe(0.625);
  });

  it("keeps Pattern Editor notes on the same fixed grid cadence", () => {
    expect(PATTERN_GRID_CELL_SIZE).toEqual([10, 8]);
  });
});
