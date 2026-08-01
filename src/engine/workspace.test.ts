import { describe, expect, it } from "vitest";
import {
  MIN_WORKSPACE_HEIGHT,
  MIN_WORKSPACE_WIDTH,
  clampWorkspaceZoom,
  placeWindow,
  logicalDragDelta,
  windowRectsOverlap,
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

describe("collision-free window placement", () => {
  const size = { width: 100, height: 80 };

  it("stacks a newly opened window below the previous one in the leftmost auxiliary column", () => {
    const occupied = [
      { x: 534, y: 4, width: 100, height: 80 },
    ];
    expect(placeWindow({ x: 534, y: 4 }, size, occupied, 4)).toEqual({
      x: 534, y: 88,
    });
  });

  it("moves an overlapping drag to the nearest padded edge", () => {
    const occupied = [{ x: 100, y: 100, width: 100, height: 80 }];
    const placed = placeWindow({ x: 150, y: 110 }, size, occupied, 4);
    expect(windowRectsOverlap({ ...placed, ...size }, occupied[0], 4)).toBe(false);
    expect(placed).toEqual({ x: 204, y: 110 });
  });

  it("snaps nearby windows into left alignment without changing their vertical order", () => {
    const occupied = [{ x: 534, y: 4, width: 100, height: 80 }];
    expect(placeWindow({ x: 539, y: 92 }, size, occupied, 4)).toEqual({
      x: 534, y: 88,
    });
  });

  it("keeps a free position unchanged", () => {
    expect(placeWindow({ x: 20, y: 30 }, size, [], 4)).toEqual({ x: 20, y: 30 });
  });

  it("chooses the closest of several snap edges", () => {
    expect(placeWindow({ x: 106, y: 300 }, { width: 10, height: 10 }, [
      { x: 100, y: 0, width: 1, height: 1 },
      { x: 108, y: 20, width: 1, height: 1 },
    ], 4)).toEqual({ x: 105, y: 300 });
  });

  it("uses touching rectangles as the zero-gap boundary", () => {
    expect(windowRectsOverlap(
      { x: 0, y: 0, width: 10, height: 10 },
      { x: 9, y: 0, width: 10, height: 10 },
    )).toBe(true);
    expect(windowRectsOverlap(
      { x: 0, y: 0, width: 10, height: 10 },
      { x: 10, y: 0, width: 10, height: 10 },
    )).toBe(false);
  });
});
