import { describe, expect, it } from "vitest";
import { CANVAS_MARGIN, CANVAS_SIZE, WHEEL_LINE_PX, WHEEL_MAX_STEP_PX, ZOOM_MAX_FRAME_PX, canvasExtent, clampFramePixels, centeringOffset, clampZoom, stageSize, wheelDeltaPixels, zoomByWheel, zoomScrollPosition, easeZoom } from "./viewport";

describe("modular canvas viewport", () => {
  it("clamps zoom to the documented canvas range", () => {
    expect(clampZoom(0.01)).toBe(0.12);
    expect(clampZoom(0.75)).toBe(0.75);
    expect(clampZoom(2)).toBe(1.1);
  });

  it("zooms out far enough to see a whole patch", () => {
    // The canvas is deliberately far larger than any patch now, so the property
    // worth holding is about the *patch*: the starter chain runs past x = 6800,
    // and the widest view has to fit that into a laptop window.
    expect(7000 * clampZoom(0.01)).toBeLessThan(1000);
  });

  it("gives a centred patch room on every side", () => {
    // The thing that was wrong: a patch at the origin has no canvas above it or
    // to its left, so the hand tool can only ever drag toward more canvas.
    const patch = [{ x: 0, y: 0, width: 7000, height: 1500 }];
    const { dx, dy } = centeringOffset(patch, CANVAS_SIZE);
    expect(dx).toBeGreaterThan(1000);
    expect(dy).toBeGreaterThan(1000);
    // And as much room past the far side as before the near one.
    expect(CANVAS_SIZE.width - (dx + 7000)).toBe(dx);
    expect(CANVAS_SIZE.height - (dy + 1500)).toBe(dy);
  });

  it("keeps the graph point beneath the pointer stationary", () => {
    const next = zoomScrollPosition({
      scrollLeft: 200,
      scrollTop: 100,
      pointerX: 300,
      pointerY: 250,
      oldZoom: 0.5,
      newZoom: 1,
    });
    expect(next).toEqual({ left: 700, top: 450 });
    expect((next.left + 300) / 1).toBe((200 + 300) / 0.5);
    expect((next.top + 250) / 1).toBe((100 + 250) / 0.5);
  });
});

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

describe("A world that does not shrink when you pull back", () => {
  const canvas = { width: 8000, height: 3000 };

  it("stays the same size at every zoom below 1", () => {
    // The bug: sizing the stage as canvas × zoom means zooming out ends with
    // the patch fitting on screen and nothing left to pan across.
    expect(stageSize(canvas, 1)).toEqual(canvas);
    expect(stageSize(canvas, 0.5)).toEqual(canvas);
    expect(stageSize(canvas, 0.12)).toEqual(canvas);
  });

  it("grows past 1, where the content really does need the room", () => {
    expect(stageSize(canvas, 2)).toEqual({ width: 16000, height: 6000 });
  });

  it("survives a nonsense zoom", () => {
    expect(stageSize(canvas, Number.NaN)).toEqual(canvas);
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

describe("Wheel zoom", () => {
  it("reads pixels, lines and pages as the same unit", () => {
    // A trackpad reports pixels, a mouse notch reports lines, and treating the
    // two numbers alike is why zoom lurches on one device and creeps on another.
    expect(wheelDeltaPixels(10, 0, 800)).toBe(10);
    expect(wheelDeltaPixels(3, 1, 800)).toBe(3 * WHEEL_LINE_PX);
    expect(wheelDeltaPixels(1, 2, 800)).toBe(WHEEL_MAX_STEP_PX);
  });

  it("caps a single event, so one notch is a step and not a leap", () => {
    expect(wheelDeltaPixels(120, 0, 800)).toBe(WHEEL_MAX_STEP_PX);
    expect(wheelDeltaPixels(-120, 0, 800)).toBe(-WHEEL_MAX_STEP_PX);
  });

  it("ignores a delta that is not a number", () => {
    expect(wheelDeltaPixels(Number.NaN, 0, 800)).toBe(0);
  });

  it("changes scale by a ratio, so a flick feels the same at any zoom", () => {
    const ratioAt = (zoom: number) => zoomByWheel(zoom, -20) / zoom;
    expect(ratioAt(0.25)).toBeCloseTo(ratioAt(0.9), 6);
  });

  it("goes up when the wheel goes up, and stays inside the range", () => {
    expect(zoomByWheel(0.5, -20)).toBeGreaterThan(0.5);
    expect(zoomByWheel(0.5, 20)).toBeLessThan(0.5);
    expect(zoomByWheel(1.1, -1000)).toBe(clampZoom(Number.POSITIVE_INFINITY));
    expect(zoomByWheel(0.12, 1000)).toBe(clampZoom(0));
  });

  it("accumulates as one gesture rather than several", () => {
    // Two events in a frame must land where one event of their sum would.
    const once = zoomByWheel(0.6, -30);
    const twice = zoomByWheel(zoomByWheel(0.6, -15), -15);
    expect(once).toBeCloseTo(twice, 9);
  });
});

describe("A stalled frame does not teleport the zoom", () => {
  it("bounds what one drain may apply", () => {
    expect(clampFramePixels(5000)).toBe(ZOOM_MAX_FRAME_PX);
    expect(clampFramePixels(-5000)).toBe(-ZOOM_MAX_FRAME_PX);
    expect(clampFramePixels(20)).toBe(20);
  });

  it("keeps a starved frame to a fast zoom rather than a jump across the range", () => {
    const after = zoomByWheel(0.5, clampFramePixels(-2000));
    expect(after / 0.5).toBeLessThan(1.3);
  });
});

describe("Zoom travels rather than jumping", () => {
  it("moves part of the way each frame", () => {
    // The point: a wheel notch is a discrete event from the hardware, so the
    // only thing that can make it read as motion is easing between them.
    const first = easeZoom(0.5, 1);
    expect(first).toBeGreaterThan(0.5);
    expect(first).toBeLessThan(1);
    expect(easeZoom(first, 1)).toBeGreaterThan(first);
  });

  it("arrives, and stops there", () => {
    let zoom = 0.4;
    for (let frame = 0; frame < 60; frame++) zoom = easeZoom(zoom, 0.9);
    expect(zoom).toBe(0.9);
    // Settled: another frame is a no-op, which is what ends the animation.
    expect(easeZoom(zoom, 0.9)).toBe(zoom);
  });

  it("settles in about a sixth of a second", () => {
    let zoom = 0.3;
    let frames = 0;
    while (zoom !== 1 && frames < 600) {
      zoom = easeZoom(zoom, 1);
      frames += 1;
    }
    expect(frames).toBeLessThanOrEqual(30);
  });

  it("eases downward too", () => {
    expect(easeZoom(1, 0.3)).toBeLessThan(1);
    expect(easeZoom(1, 0.3)).toBeGreaterThan(0.3);
  });
});
