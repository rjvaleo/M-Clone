/**
 * Where a cable actually starts and ends.
 *
 * Cable endpoints used to be guessed from the node's box — a fixed fraction of
 * its height for the output side and another for the input side. That is right
 * for exactly one port per side and wrong for every node with more, which is
 * most of them: a Note Order has four inputs, and three of its cables pointed
 * at empty chrome.
 *
 * The fix is to measure. Ports are real elements with real positions, so the
 * cable asks them where they are. The only complication is coordinate space:
 * `getBoundingClientRect` reports screen pixels on a canvas that is scaled by
 * the zoom transform, so every measurement is divided back out before it can be
 * used as an SVG coordinate.
 *
 * Everything here is pure. The measuring is done by the component; this decides
 * what the numbers mean.
 */

export type Point = { x: number; y: number };

/** The part of `DOMRect` that matters, so tests need no DOM. */
export type RectLike = { left: number; top: number; width: number; height: number };

export const portAnchorKey = (nodeId: string, portId: string): string =>
  `${nodeId}\u0000${portId}`;

/**
 * The centre of a port, in canvas coordinates.
 *
 * `canvasRect` is the scaled canvas's own box, so subtracting it moves the
 * point into canvas space and dividing by zoom undoes the transform. Both steps
 * are needed: dividing alone leaves the canvas's page offset in the answer.
 */
export function anchorInCanvas(port: RectLike, canvas: RectLike, zoom: number): Point {
  const scale = zoom > 0 ? zoom : 1;
  return {
    x: (port.left + port.width / 2 - canvas.left) / scale,
    y: (port.top + port.height / 2 - canvas.top) / scale,
  };
}

/** A pointer position in canvas coordinates, for the cable being dragged. */
export function pointerInCanvas(
  clientX: number,
  clientY: number,
  canvas: RectLike,
  zoom: number,
): Point {
  const scale = zoom > 0 ? zoom : 1;
  return { x: (clientX - canvas.left) / scale, y: (clientY - canvas.top) / scale };
}

/**
 * A cubic bezier that leaves an output horizontally and arrives at an input
 * horizontally, so a cable reads as a cable rather than as a diagonal line.
 *
 * The control-point offset grows with the horizontal gap but never collapses,
 * which is what keeps a backwards connection — an output to the right of its
 * input — looping out and back instead of folding into a flat overlap.
 */
export function cablePath(from: Point, to: Point): string {
  const bend = Math.max(80, Math.abs(to.x - from.x) * 0.5);
  return `M ${round(from.x)} ${round(from.y)} C ${round(from.x + bend)} ${round(from.y)}, ${round(to.x - bend)} ${round(to.y)}, ${round(to.x)} ${round(to.y)}`;
}

/**
 * The path for a cable still being dragged.
 *
 * Dragging backwards from an input is the same curve with its ends swapped —
 * the loose end is the one that has to arrive horizontally at the fixed port,
 * or the cable appears to grow out of the wrong side of the cursor.
 */
export function draggingCablePath(
  anchor: Point,
  pointer: Point,
  direction: "output" | "input",
): string {
  return direction === "output" ? cablePath(anchor, pointer) : cablePath(pointer, anchor);
}

/**
 * Where a cable attaches before its ports have been measured — on the first
 * render, or for a node scrolled far enough out that it has no box yet.
 *
 * Deliberately the old approximation: it is wrong by a few pixels, but it is
 * wrong in a stable way, so a cable never springs from the origin while the
 * measurement catches up.
 */
export function fallbackAnchor(
  position: Point,
  size: { width: number; height: number },
  direction: "output" | "input",
): Point {
  return direction === "output"
    ? { x: position.x + size.width, y: position.y + size.height * 0.26 }
    : { x: position.x, y: position.y + size.height * 0.35 };
}

/**
 * Below this zoom, controls are too small to aim at and stop taking pointers.
 *
 * Low enough to leave a usable band between "reading the patch" and "editing
 * it": at 0.4 a knob is still hittable, and only the far end of the range —
 * where a node is a coloured smudge — locks out.
 */
export const INTERACTION_ZOOM_FLOOR = 0.35;

export const canInteractAtZoom = (zoom: number): boolean => zoom >= INTERACTION_ZOOM_FLOOR;

const round = (value: number): number => Math.round(value * 100) / 100;
