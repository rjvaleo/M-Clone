export type ViewportZoom = {
  scrollLeft: number;
  scrollTop: number;
  pointerX: number;
  pointerY: number;
  oldZoom: number;
  newZoom: number;
};

/**
 * The patch area, in canvas units.
 *
 * Large and fixed, and deliberately far bigger than any patch. A new stage puts
 * its modules in the *middle* of this, not at the origin, because a patch at the
 * origin has no canvas above it or to its left — you can only ever drag toward
 * more canvas, never into empty space on the other two sides. The room to work
 * has to exist in all four directions before anything is placed on it.
 */
export const CANVAS_SIZE = { width: 16000, height: 8000 } as const;

/** Empty canvas kept beyond the outermost module, so there is room to work. */
export const CANVAS_MARGIN = 1200;

export type PlacedBox = { x: number; y: number; width: number; height: number };

/**
 * The stage's size on screen, which is **not** the canvas times zoom.
 *
 * Multiplying by zoom makes the world shrink as you pull back, so zooming out
 * ends with the whole patch fitting on screen and nothing left to pan — the
 * scrollbars vanish and the canvas stops being a place you can move around in.
 * The world is a fixed extent instead: pulling back shows more of the patch and
 * the surface stays exactly as large and exactly as pannable as it was.
 *
 * Zoom still enlarges it past 1, because at that point the content genuinely
 * needs more room than the world's own size and would otherwise be clipped.
 */
export function stageSize(
  canvas: { width: number; height: number },
  zoom: number,
): { width: number; height: number } {
  const scale = Math.max(1, Number.isFinite(zoom) ? zoom : 1);
  return {
    width: Math.round(canvas.width * scale),
    height: Math.round(canvas.height * scale),
  };
}

/**
 * How far to move a patch so it sits in the middle of the canvas.
 *
 * Applied to node positions rather than to a view transform: the canvas is the
 * document's coordinate space, and shifting the view instead would leave every
 * saved position describing a patch jammed against the origin.
 */
export function centeringOffset(
  boxes: readonly PlacedBox[],
  canvas: { width: number; height: number },
): { dx: number; dy: number } {
  const usable = boxes.filter((box) =>
    Number.isFinite(box.x) && Number.isFinite(box.y)
    && Number.isFinite(box.width) && Number.isFinite(box.height));
  if (usable.length === 0) return { dx: 0, dy: 0 };

  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const box of usable) {
    left = Math.min(left, box.x);
    top = Math.min(top, box.y);
    right = Math.max(right, box.x + box.width);
    bottom = Math.max(bottom, box.y + box.height);
  }
  return {
    dx: Math.round((canvas.width - (right - left)) / 2 - left),
    dy: Math.round((canvas.height - (bottom - top)) / 2 - top),
  };
}

/**
 * Where to scroll so the patch is in the middle of the window.
 *
 * Centring the patch *in the canvas* is only half the job: the scrollport still
 * opens at the world's top-left corner, which — now that the patch sits in the
 * middle — is empty. This is the other half, and it is why a new project shows
 * modules rather than an empty grid.
 */
export function scrollToCenter(
  boxes: readonly PlacedBox[],
  view: { width: number; height: number },
  zoom: number,
): { left: number; top: number } {
  const usable = boxes.filter((box) => Number.isFinite(box.x) && Number.isFinite(box.y));
  if (usable.length === 0) return { left: 0, top: 0 };
  const scale = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;

  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const box of usable) {
    left = Math.min(left, box.x);
    top = Math.min(top, box.y);
    right = Math.max(right, box.x + (Number.isFinite(box.width) ? box.width : 0));
    bottom = Math.max(bottom, box.y + (Number.isFinite(box.height) ? box.height : 0));
  }
  return {
    left: Math.max(0, Math.round(((left + right) / 2) * scale - view.width / 2)),
    top: Math.max(0, Math.round(((top + bottom) / 2) * scale - view.height / 2)),
  };
}

/**
 * The canvas, never smaller than the default and never smaller than its content.
 *
 * The default is already far larger than any patch, so this is a backstop for
 * one case only: a module dragged out past the edge. It grows the far side, not
 * the origin — moving the origin would shift every other module on screen.
 */
export function canvasExtent(boxes: readonly PlacedBox[]): { width: number; height: number } {
  let width: number = CANVAS_SIZE.width;
  let height: number = CANVAS_SIZE.height;
  for (const box of boxes) {
    if (Number.isFinite(box.x) && Number.isFinite(box.width)) {
      width = Math.max(width, box.x + box.width + CANVAS_MARGIN);
    }
    if (Number.isFinite(box.y) && Number.isFinite(box.height)) {
      height = Math.max(height, box.y + box.height + CANVAS_MARGIN);
    }
  }
  return { width: Math.round(width), height: Math.round(height) };
}

/**
 * The zoom range.
 *
 * The floor is deliberately far below the old 0.4: a patch this wide is only
 * comprehensible if you can pull back far enough to see its shape, and reading
 * the shape is a different task from reading a control.
 */
export const clampZoom = (zoom: number): number =>
  Math.max(0.12, Math.min(1.1, zoom));

export const zoomScrollPosition = ({
  scrollLeft,
  scrollTop,
  pointerX,
  pointerY,
  oldZoom,
  newZoom,
}: ViewportZoom): { left: number; top: number } => ({
  left: ((scrollLeft + pointerX) / oldZoom) * newZoom - pointerX,
  top: ((scrollTop + pointerY) / oldZoom) * newZoom - pointerY,
});

/**
 * A wheel event's delta, in pixels, whatever the device meant by it.
 *
 * `deltaY` is only meaningful alongside `deltaMode`: a trackpad reports pixels
 * a few at a time, a mouse notch reports *lines* — usually 3 — and some report
 * pages. Treating those three numbers as the same unit is why zoom feels
 * feathery on one device and lurches on another.
 *
 * The magnitude is also capped. A single notch that arrives as 120 pixels would
 * otherwise be a 16% jump in scale, which reads as a chunky step rather than a
 * zoom; clamping makes the coarsest device behave like a firm trackpad swipe.
 */
export const WHEEL_LINE_PX = 16;
export const WHEEL_MAX_STEP_PX = 48;

export function wheelDeltaPixels(
  deltaY: number,
  deltaMode: number,
  viewportHeight: number,
): number {
  if (!Number.isFinite(deltaY)) return 0;
  const pixels = deltaMode === 1
    ? deltaY * WHEEL_LINE_PX
    : deltaMode === 2
      ? deltaY * Math.max(1, viewportHeight)
      : deltaY;
  return Math.max(-WHEEL_MAX_STEP_PX, Math.min(WHEEL_MAX_STEP_PX, pixels));
}

/** How much scale one pixel of wheel travel is worth. */
export const ZOOM_SENSITIVITY = 0.0022;

/**
 * The most wheel travel one frame may spend.
 *
 * Events accumulate between frames, so a stalled frame — a busy tab, a
 * backgrounded window — can hand the next drain a second's worth of scrolling
 * at once and jump the scale halfway across its range. Bounding what a single
 * frame applies turns that into a fast zoom rather than a teleport.
 */
export const ZOOM_MAX_FRAME_PX = WHEEL_MAX_STEP_PX * 2;

export const clampFramePixels = (pixels: number): number =>
  Math.max(-ZOOM_MAX_FRAME_PX, Math.min(ZOOM_MAX_FRAME_PX, pixels));

/**
 * Zoom is exponential in wheel travel, not linear.
 *
 * Equal travel has to mean equal *ratio*, or the same flick of the wheel barely
 * moves anything at 20% and overshoots at 100%.
 */
export const zoomByWheel = (zoom: number, pixels: number): number =>
  clampZoom(zoom * Math.exp(-pixels * ZOOM_SENSITIVITY));

/**
 * How fast the scale catches up to where the wheel asked it to go.
 *
 * The step size was never the problem. A notch that *jumps* the scale by a
 * tenth reads as chunky however small the tenth is, because nothing travelled —
 * the canvas was one size and then it was another. Easing toward a target over
 * a few frames is what turns the same notch into a zoom.
 *
 * A quarter of the remaining distance per frame settles in about ten frames,
 * roughly a sixth of a second: fast enough to feel direct, slow enough to read
 * as motion.
 */
export const ZOOM_EASING = 0.25;

/** Close enough that another frame would not be visible. */
export const ZOOM_EPSILON = 0.0005;

export const easeZoom = (current: number, target: number): number =>
  Math.abs(target - current) < ZOOM_EPSILON
    ? target
    : current + (target - current) * ZOOM_EASING;
