import { describe, expect, it } from "vitest";
import {
  MAX_ZOOM,
  MIN_ZOOM,
  WHEEL_NOTCH_FACTOR,
  centerOn,
  clampCameraZoom,
  fitToBoxes,
  panBy,
  screenToCanvas,
  wheelZoomFactor,
  zoomAround,
} from "./camera";

describe("the canvas camera, as ComfyUI's works", () => {
  it("zooms from a tenth to ten times", () => {
    expect(MIN_ZOOM).toBe(0.1);
    expect(MAX_ZOOM).toBe(10);
    expect(clampCameraZoom(0.01)).toBe(0.1);
    expect(clampCameraZoom(40)).toBe(10);
  });

  it("one mouse-wheel notch is a 1.1× step, in or out", () => {
    expect(WHEEL_NOTCH_FACTOR).toBe(1.1);
    expect(wheelZoomFactor({ deltaY: -100, deltaMode: 0, ctrlKey: false })).toBeCloseTo(1.1);
    expect(wheelZoomFactor({ deltaY: 100, deltaMode: 0, ctrlKey: false })).toBeCloseTo(1 / 1.1);
    expect(wheelZoomFactor({ deltaY: 3, deltaMode: 1, ctrlKey: false })).toBeCloseTo(1 / 1.1);
  });

  it("a trackpad's small deltas zoom smoothly, not a notch at a time", () => {
    const f = wheelZoomFactor({ deltaY: -4, deltaMode: 0, ctrlKey: false });
    expect(f).toBeGreaterThan(1);
    expect(f).toBeLessThan(1.02);
  });

  it("a pinch (ctrl + wheel) zooms in proportion to the pinch", () => {
    const small = wheelZoomFactor({ deltaY: -2, deltaMode: 0, ctrlKey: true });
    const big = wheelZoomFactor({ deltaY: -10, deltaMode: 0, ctrlKey: true });
    expect(small).toBeGreaterThan(1);
    expect(big).toBeGreaterThan(small);
  });

  it("keeps the point under the cursor still while zooming", () => {
    const camera = { left: 300, top: 120, zoom: 0.8 };
    const pointer = { x: 410, y: 260 };
    const before = screenToCanvas(camera, pointer.x, pointer.y);
    const after = zoomAround(camera, pointer, 1.1);
    expect(after.zoom).toBeCloseTo(0.88);
    const still = screenToCanvas(after, pointer.x, pointer.y);
    expect(still.x).toBeCloseTo(before.x);
    expect(still.y).toBeCloseTo(before.y);
  });

  it("stops at the limits without moving the view", () => {
    const camera = { left: 50, top: 50, zoom: 10 };
    expect(zoomAround(camera, { x: 100, y: 100 }, 1.1)).toEqual(camera);
  });

  it("pans with the drag, past any edge — the canvas has none", () => {
    expect(panBy({ left: 10, top: 10, zoom: 1 }, 200, 150)).toEqual({ left: -190, top: -140, zoom: 1 });
  });

  it("fits the patch in view, never zooming past 100%", () => {
    const boxes = [{ x: 1000, y: 1000, width: 400, height: 200 }, { x: 2000, y: 1400, width: 400, height: 200 }];
    const camera = fitToBoxes(boxes, { width: 1000, height: 600 });
    const topLeft = screenToCanvas(camera, 0, 0);
    const bottomRight = screenToCanvas(camera, 1000, 600);
    expect(topLeft.x).toBeLessThanOrEqual(1000);
    expect(topLeft.y).toBeLessThanOrEqual(1000);
    expect(bottomRight.x).toBeGreaterThanOrEqual(2400);
    expect(bottomRight.y).toBeGreaterThanOrEqual(1600);
    expect(fitToBoxes([{ x: 0, y: 0, width: 10, height: 10 }], { width: 1000, height: 600 }).zoom).toBe(1);
  });

  it("centres on a point at the current zoom", () => {
    const camera = centerOn({ x: 500, y: 300 }, { width: 800, height: 400 }, 2);
    expect(screenToCanvas(camera, 400, 200)).toEqual({ x: 500, y: 300 });
  });
});

describe("the canvas camera, given what it cannot use", () => {
  it("reads a zoom that is not a number as 100%", () => {
    expect(clampCameraZoom(Number.NaN)).toBe(1);
  });

  it("does not zoom for a wheel event with no vertical movement", () => {
    expect(wheelZoomFactor({ deltaY: 0, deltaMode: 0, ctrlKey: false })).toBe(1);
    expect(wheelZoomFactor({ deltaY: Number.NaN, deltaMode: 0, ctrlKey: false })).toBe(1);
  });

  it("counts a page-mode wheel event as a whole notch", () => {
    expect(wheelZoomFactor({ deltaY: -1, deltaMode: 2, ctrlKey: false })).toBeCloseTo(WHEEL_NOTCH_FACTOR);
  });

  it("fits nothing, or only unplaced boxes, at 100% from the origin", () => {
    expect(fitToBoxes([], { width: 800, height: 600 })).toEqual({ left: 0, top: 0, zoom: 1 });
    expect(fitToBoxes([{ x: Number.NaN, y: 0, width: 10, height: 10 }], { width: 800, height: 600 })).toEqual({ left: 0, top: 0, zoom: 1 });
  });
});
