/**
 * The canvas camera, modelled on ComfyUI's (LiteGraph's DragAndScale).
 *
 * The canvas is drawn through one transform — translate, then scale — inside
 * a window that never scrolls, so there are no scrollbars and no edges: you
 * can pan as far as you like in any direction. The wheel zooms about the
 * cursor, a notch at a time by 1.1×, from 0.1× to 10×.
 *
 * `left` and `top` are where the window's top-left corner sits on the scaled
 * canvas, so a screen point (sx, sy) in the window is the canvas point
 * ((sx + left) / zoom, (sy + top) / zoom).
 */

export type Camera = { left: number; top: number; zoom: number };
export type Box = { x: number; y: number; width: number; height: number };

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 10;
/** LiteGraph's step per wheel notch. */
export const WHEEL_NOTCH_FACTOR = 1.1;

/** Pixels per wheel line, and per notch as a mouse reports it. */
const LINE_PX = 33;
const NOTCH_PX = 100;

export const clampCameraZoom = (zoom: number): number =>
  Number.isFinite(zoom) ? Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom)) : 1;

/**
 * How much one wheel event zooms by.
 *
 * A mouse notch is exactly one 1.1× step. A trackpad sends many small pixel
 * deltas instead, and each is worth its share of a notch, so the zoom glides.
 * A pinch arrives as ctrl + wheel with small deltas and is scaled more
 * strongly, so a pinch feels like it is holding the canvas.
 */
export function wheelZoomFactor(event: { deltaY: number; deltaMode: number; ctrlKey: boolean }): number {
  if (!Number.isFinite(event.deltaY) || event.deltaY === 0) return 1;
  const pixels = event.deltaMode === 1 ? event.deltaY * LINE_PX : event.deltaMode === 2 ? event.deltaY * 800 : event.deltaY;
  if (event.ctrlKey) return Math.max(0.8, Math.min(1.25, Math.exp(-pixels * 0.01)));
  const notches = Math.max(-1, Math.min(1, -pixels / NOTCH_PX));
  return WHEEL_NOTCH_FACTOR ** notches;
}

export const screenToCanvas = (camera: Camera, sx: number, sy: number) => ({
  x: (sx + camera.left) / camera.zoom,
  y: (sy + camera.top) / camera.zoom,
});

/** Zoom by `factor`, keeping the canvas point under `pointer` where it is. */
export function zoomAround(camera: Camera, pointer: { x: number; y: number }, factor: number): Camera {
  const zoom = clampCameraZoom(camera.zoom * factor);
  if (zoom === camera.zoom) return camera;
  const at = screenToCanvas(camera, pointer.x, pointer.y);
  return { zoom, left: at.x * zoom - pointer.x, top: at.y * zoom - pointer.y };
}

/** Drag the canvas with the pointer: it moves as far as the pointer did. */
export const panBy = (camera: Camera, dx: number, dy: number): Camera =>
  ({ ...camera, left: camera.left - dx, top: camera.top - dy });

/** Put a canvas point in the middle of the window at `zoom`. */
export const centerOn = (point: { x: number; y: number }, view: { width: number; height: number }, zoom: number): Camera => ({
  zoom,
  left: point.x * zoom - view.width / 2,
  top: point.y * zoom - view.height / 2,
});

/** The whole patch in view with a margin round it, never magnified past 100%. */
export function fitToBoxes(boxes: readonly Box[], view: { width: number; height: number }, margin = 48): Camera {
  const usable = boxes.filter((b) => [b.x, b.y, b.width, b.height].every(Number.isFinite));
  if (usable.length === 0) return { left: 0, top: 0, zoom: 1 };
  const left = Math.min(...usable.map((b) => b.x));
  const top = Math.min(...usable.map((b) => b.y));
  const right = Math.max(...usable.map((b) => b.x + b.width));
  const bottom = Math.max(...usable.map((b) => b.y + b.height));
  const zoom = clampCameraZoom(Math.min(
    1,
    (view.width - margin * 2) / Math.max(1, right - left),
    (view.height - margin * 2) / Math.max(1, bottom - top),
  ));
  return centerOn({ x: (left + right) / 2, y: (top + bottom) / 2 }, view, zoom);
}
