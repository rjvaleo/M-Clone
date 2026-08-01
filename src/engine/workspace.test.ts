import { describe, expect, it } from "vitest";
import {
  MIN_WORKSPACE_HEIGHT,
  MIN_WORKSPACE_WIDTH,
  clampWorkspaceZoom,
  logicalDragDelta,
  workspaceLayout,
} from "./workspace";

describe("workspace scaling", () => {
  it("keeps the original 640 × 480 desktop as the smallest the workspace gets", () => {
    expect([MIN_WORKSPACE_WIDTH, MIN_WORKSPACE_HEIGHT]).toEqual([640, 480]);
  });

  it("normalizes arbitrary values to supported 10% increments", () => {
    expect(clampWorkspaceZoom(113)).toBe(110);
    expect(clampWorkspaceZoom(116)).toBe(120);
    expect(clampWorkspaceZoom(-20)).toBe(50);
    expect(clampWorkspaceZoom(900)).toBe(200);
  });

  it("converts physical pointer movement back to logical desktop movement", () => {
    expect(logicalDragDelta(30, 150)).toBe(20);
    expect(logicalDragDelta(-10, 50)).toBe(-20);
  });
});

describe("fluid workspace layout", () => {
  it("grows the logical desktop to fill whatever viewport it is given", () => {
    const layout = workspaceLayout(1600, 900, 100);
    expect(layout.logical).toEqual({ width: 1600, height: 900 });
  });

  it("renders a 100% desktop at exactly the viewport size, so nothing scrolls", () => {
    const layout = workspaceLayout(1600, 900, 100);
    expect(layout.physical).toEqual({ width: 1600, height: 900 });
  });

  it("divides the viewport by the scale, so zooming in shows less desktop", () => {
    // At 200% every logical unit costs two physical pixels, so a 1600 × 1200
    // viewport can only show 800 × 600 logical units of desktop.
    const layout = workspaceLayout(1600, 1200, 200);
    expect(layout.logical).toEqual({ width: 800, height: 600 });
    expect(layout.scale).toBe(2);
  });

  it("zooming out reveals more desktop than the viewport is wide", () => {
    const layout = workspaceLayout(1600, 900, 50);
    expect(layout.logical).toEqual({ width: 3200, height: 1800 });
  });

  it("still fills the viewport exactly at every zoom the floor does not bind", () => {
    // 200% is excluded deliberately: 900 / 2 is 450, below the 480 floor, so
    // the desktop is meant to overflow there. That case is covered below.
    for (const zoom of [50, 80, 100, 130, 180]) {
      const layout = workspaceLayout(1600, 900, zoom);
      expect(layout.physical.width).toBeCloseTo(1600, 5);
      expect(layout.physical.height).toBeCloseTo(900, 5);
    }
  });

  it("never shrinks below 640 × 480, so saved window coordinates always land", () => {
    // A small window at high zoom would otherwise produce a desktop too small
    // to hold the permanent windows at their reference positions.
    const layout = workspaceLayout(400, 300, 200);
    expect(layout.logical).toEqual({ width: 640, height: 480 });
  });

  it("overflows the viewport rather than clipping when the floor applies", () => {
    // 640 logical units at 200% is 1280 physical pixels in a 400px viewport:
    // the desktop is bigger than the window and the viewport must scroll.
    const layout = workspaceLayout(400, 300, 200);
    expect(layout.physical).toEqual({ width: 1280, height: 960 });
  });

  it("normalizes its zoom argument the same way the zoom control does", () => {
    expect(workspaceLayout(1600, 900, 113).scale).toBe(1.1);
    expect(workspaceLayout(1600, 900, 900).scale).toBe(2);
  });

  it("treats a collapsed viewport as the minimum desktop", () => {
    expect(workspaceLayout(0, 0, 100).logical).toEqual({ width: 640, height: 480 });
    expect(workspaceLayout(-50, -50, 100).logical).toEqual({ width: 640, height: 480 });
  });

  it("keeps the logical size exact rather than rounding, so no gap appears", () => {
    // Rounding to whole logical units would leave a sliver of unfilled
    // viewport at awkward zooms; sub-pixel logical sizes cost nothing.
    const layout = workspaceLayout(1601, 901, 130);
    expect(layout.physical.width).toBeCloseTo(1601, 5);
    expect(layout.physical.height).toBeCloseTo(901, 5);
  });
});
