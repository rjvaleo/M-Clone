import { describe, expect, it } from "vitest";
import { CANVAS_MARGIN, CANVAS_SIZE, canvasExtent, centeringOffset } from "./viewport";

describe("Growing the canvas to fit the patch", () => {
  it("is never smaller than the default", () => {
    expect(canvasExtent([])).toEqual({ width: CANVAS_SIZE.width, height: CANVAS_SIZE.height });
    expect(canvasExtent([{ x: 10, y: 10, width: 100, height: 100 }]))
      .toEqual({ width: CANVAS_SIZE.width, height: CANVAS_SIZE.height });
  });

  it("grows past a module that would otherwise sit against the wall", () => {
    // The bug this prevents: drag a module to the edge and it stops being
    // reachable, because there is nothing beyond it to scroll to.
    const far = { x: CANVAS_SIZE.width - 100, y: 0, width: 520, height: 330 };
    const grown = canvasExtent([far]);
    expect(grown.width).toBe(far.x + far.width + CANVAS_MARGIN);
    expect(grown.width - (far.x + far.width)).toBe(CANVAS_MARGIN);
  });

  it("grows downward too, and takes the furthest module on each axis", () => {
    const beyond = CANVAS_SIZE.width + 500;
    const below = CANVAS_SIZE.height + 500;
    const grown = canvasExtent([
      { x: beyond, y: 0, width: 200, height: 200 },
      { x: 0, y: below, width: 200, height: 200 },
    ]);
    expect(grown.width).toBe(beyond + 200 + CANVAS_MARGIN);
    expect(grown.height).toBe(below + 200 + CANVAS_MARGIN);
  });

  it("ignores a position that is not a number", () => {
    expect(canvasExtent([{ x: Number.NaN, y: 0, width: 100, height: 100 }]).width)
      .toBe(CANVAS_SIZE.width);
  });
});

describe("Centring a patch in the canvas", () => {
  const canvas = { width: 1000, height: 1000 };

  it("puts the bounding box in the middle", () => {
    const { dx, dy } = centeringOffset([{ x: 0, y: 0, width: 200, height: 100 }], canvas);
    expect(dx).toBe(400);
    expect(dy).toBe(450);
  });

  it("centres the whole patch, not each module", () => {
    const boxes = [
      { x: 0, y: 0, width: 100, height: 100 },
      { x: 300, y: 200, width: 100, height: 100 },
    ];
    const { dx, dy } = centeringOffset(boxes, canvas);
    // Spans 400 × 300, so the margins are 300 and 350 on each side.
    expect(dx).toBe(300);
    expect(dy).toBe(350);
  });

  it("accounts for a patch that does not start at the origin", () => {
    const { dx } = centeringOffset([{ x: 500, y: 0, width: 200, height: 100 }], canvas);
    expect(500 + dx).toBe(400);
  });

  it("does nothing to an empty or malformed graph", () => {
    expect(centeringOffset([], canvas)).toEqual({ dx: 0, dy: 0 });
    expect(centeringOffset([{ x: Number.NaN, y: 0, width: 1, height: 1 }], canvas))
      .toEqual({ dx: 0, dy: 0 });
  });
});
