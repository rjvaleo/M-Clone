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
