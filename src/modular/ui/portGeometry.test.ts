import { describe, expect, it } from "vitest";
import {
  anchorInCanvas,
  cablePath,
  canInteractAtZoom,
  draggingCablePath,
  fallbackAnchor,
  INTERACTION_ZOOM_FLOOR,
  pointerInCanvas,
  portAnchorKey,
} from "./portGeometry";

const rect = (left: number, top: number, width = 10, height = 10) => ({ left, top, width, height });

describe("Anchoring a cable to a port", () => {
  it("returns the port's centre in canvas units", () => {
    const canvas = rect(0, 0, 1000, 1000);
    expect(anchorInCanvas(rect(100, 200, 20, 10), canvas, 1)).toEqual({ x: 110, y: 205 });
  });

  it("undoes the zoom transform", () => {
    // At half zoom a port drawn 100px down the screen is 200 canvas units in.
    const canvas = rect(0, 0, 1000, 1000);
    expect(anchorInCanvas(rect(100, 100, 20, 20), canvas, 0.5)).toEqual({ x: 220, y: 220 });
  });

  it("removes the canvas's own page offset before scaling", () => {
    // A scrolled or inset canvas must not push the anchor off by its offset —
    // dividing without subtracting first is the classic version of this bug.
    const canvas = rect(300, 50, 1000, 1000);
    expect(anchorInCanvas(rect(400, 150, 20, 20), canvas, 0.5)).toEqual({ x: 220, y: 220 });
  });

  it("treats a nonsense zoom as unscaled rather than dividing by zero", () => {
    const canvas = rect(0, 0, 100, 100);
    expect(anchorInCanvas(rect(10, 10), canvas, 0)).toEqual({ x: 15, y: 15 });
    expect(anchorInCanvas(rect(10, 10), canvas, -1)).toEqual({ x: 15, y: 15 });
  });

  it("converts a pointer position the same way", () => {
    expect(pointerInCanvas(400, 150, rect(300, 50, 1000, 1000), 0.5)).toEqual({ x: 200, y: 200 });
    expect(pointerInCanvas(10, 10, rect(0, 0, 10, 10), 0)).toEqual({ x: 10, y: 10 });
  });

  it("keys anchors so no pair of ids can collide", () => {
    expect(portAnchorKey("a", "b")).toBe(portAnchorKey("a", "b"));
    expect(portAnchorKey("a", "b")).not.toBe(portAnchorKey("ab", ""));
  });
});

describe("Cable paths", () => {
  it("leaves and arrives horizontally", () => {
    const d = cablePath({ x: 0, y: 0 }, { x: 400, y: 100 });
    // Control points share their endpoint's y, which is what makes the curve
    // exit and enter flat instead of cutting a diagonal.
    expect(d).toBe("M 0 0 C 200 0, 200 100, 400 100");
  });

  it("keeps a minimum bend so a backwards cable still loops", () => {
    // Output to the right of its input: without a floor on the bend the curve
    // collapses into a flat overlap and reads as a straight line.
    const d = cablePath({ x: 400, y: 0 }, { x: 390, y: 0 });
    expect(d).toBe("M 400 0 C 480 0, 310 0, 390 0");
  });

  it("rounds to hundredths so measurement noise does not churn the path", () => {
    expect(cablePath({ x: 0.123456, y: 1.987654 }, { x: 10, y: 10 }))
      .toBe("M 0.12 1.99 C 80.12 1.99, -70 10, 10 10");
  });

  it("swaps the ends when dragging backwards from an input", () => {
    const anchor = { x: 500, y: 50 };
    const pointer = { x: 100, y: 200 };
    expect(draggingCablePath(anchor, pointer, "output")).toBe(cablePath(anchor, pointer));
    // From an input, the loose end is the source: the fixed port is arrived at.
    expect(draggingCablePath(anchor, pointer, "input")).toBe(cablePath(pointer, anchor));
  });
});

describe("Fallback anchors", () => {
  it("attaches to the right edge for outputs and the left for inputs", () => {
    const size = { width: 200, height: 100 };
    expect(fallbackAnchor({ x: 10, y: 20 }, size, "output")).toEqual({ x: 210, y: 46 });
    expect(fallbackAnchor({ x: 10, y: 20 }, size, "input")).toEqual({ x: 10, y: 55 });
  });
});

describe("Interaction floor", () => {
  it("locks out only the far end of the zoom range", () => {
    expect(canInteractAtZoom(1)).toBe(true);
    expect(canInteractAtZoom(0.5)).toBe(true);
    expect(canInteractAtZoom(INTERACTION_ZOOM_FLOOR)).toBe(true);
    expect(canInteractAtZoom(0.2)).toBe(false);
    expect(canInteractAtZoom(0.12)).toBe(false);
  });
});
