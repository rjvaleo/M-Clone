import { describe, expect, it } from "vitest";
import {
  CLASSIC_PANEL_MIN_SIZE,
  CLASSIC_PANEL_SIZE,
  expandedClassicPanel,
  readClassicPanelSize,
  resizeClassicPanel,
} from "./classicPanelGeometry";

describe("Classic M panel geometry", () => {
  it("grows by the pointer's movement in canvas units", () => {
    expect(resizeClassicPanel(CLASSIC_PANEL_SIZE, { x: 100, y: 50 }, 1))
      .toEqual({ width: CLASSIC_PANEL_SIZE.width + 100, height: CLASSIC_PANEL_SIZE.height + 50 });
  });

  it("corrects for the canvas zoom, so the corner stays under the pointer", () => {
    expect(resizeClassicPanel({ width: 800, height: 600 }, { x: 100, y: -50 }, 0.5))
      .toEqual({ width: 1000, height: 500 });
  });

  it("never shrinks below a usable size", () => {
    expect(resizeClassicPanel({ width: 800, height: 600 }, { x: -5000, y: -5000 }, 1))
      .toEqual(CLASSIC_PANEL_MIN_SIZE);
  });

  it("treats a zero zoom as 1 rather than dividing by it", () => {
    expect(resizeClassicPanel({ width: 800, height: 600 }, { x: 10, y: 10 }, 0))
      .toEqual({ width: 810, height: 610 });
  });

  it("restores a saved size, and falls back to the default for anything unusable", () => {
    expect(readClassicPanelSize('{"width":900,"height":700}')).toEqual({ width: 900, height: 700 });
    expect(readClassicPanelSize('{"width":10,"height":10}')).toEqual(CLASSIC_PANEL_MIN_SIZE);
    expect(readClassicPanelSize(null)).toEqual(CLASSIC_PANEL_SIZE);
    expect(readClassicPanelSize("not json")).toEqual(CLASSIC_PANEL_SIZE);
    expect(readClassicPanelSize('{"width":"wide"}')).toEqual(CLASSIC_PANEL_SIZE);
  });
});

describe("Expanding the Classic M panel", () => {
  it("fills the visible canvas, inset by a margin", () => {
    expect(expandedClassicPanel({ x: 100, y: 50, width: 1600, height: 900 }))
      .toEqual({ x: 112, y: 62, width: 1576, height: 876 });
  });

  it("keeps the minimum size in a very small view", () => {
    expect(expandedClassicPanel({ x: 0, y: 0, width: 200, height: 100 }))
      .toMatchObject(CLASSIC_PANEL_MIN_SIZE);
  });
});
