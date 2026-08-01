// Desktop geometry.
//
// The original ran on a fixed 640 × 480 Mac desktop. The browser build keeps
// those numbers only as a *floor*: the desktop grows to fill whatever window
// it is given, so modules can be dragged anywhere the viewport reaches, while
// layouts saved against the original 640 × 480 grid still land.
//
// Zoom stays, because 1-bit controls drawn at their original size are tiny on
// a modern display. Zoom scales the desktop's contents; it no longer decides
// how much desktop there is.

export const MIN_WORKSPACE_WIDTH = 640;
export const MIN_WORKSPACE_HEIGHT = 480;
export const MIN_WORKSPACE_ZOOM = 50;
export const MAX_WORKSPACE_ZOOM = 200;
export const WORKSPACE_ZOOM_STEP = 10;

export function clampWorkspaceZoom(value: number): number {
  const rounded = Math.round(value / WORKSPACE_ZOOM_STEP) * WORKSPACE_ZOOM_STEP;
  return Math.max(MIN_WORKSPACE_ZOOM, Math.min(MAX_WORKSPACE_ZOOM, rounded));
}

export function logicalDragDelta(physicalDelta: number, zoom: number): number {
  return physicalDelta / (clampWorkspaceZoom(zoom) / 100);
}

export type WorkspaceLayout = {
  scale: number;
  /** Desktop size in the coordinate system window positions are stored in. */
  logical: { width: number; height: number };
  /** The room that desktop takes up on screen once scaled. */
  physical: { width: number; height: number };
};

export type WorkspacePoint = { x: number; y: number };
export type WorkspaceSize = { width: number; height: number };
export type WorkspaceRect = WorkspacePoint & WorkspaceSize;

export function windowRectsOverlap(
  a: WorkspaceRect,
  b: WorkspaceRect,
  gap = 0,
): boolean {
  return a.x < b.x + b.width + gap
    && a.x + a.width + gap > b.x
    && a.y < b.y + b.height + gap
    && a.y + a.height + gap > b.y;
}

/**
 * Snap a window to nearby peers, then move an overlap to the closest padded
 * edge. Candidate coordinates include every useful left/right/top/bottom edge,
 * so repeated opens form tidy columns without prescribing a window order.
 */
export function placeWindow(
  preferred: WorkspacePoint,
  size: WorkspaceSize,
  occupied: WorkspaceRect[],
  gap = 4,
  snapDistance = 8,
): WorkspacePoint {
  const clamp = (value: number) => Math.max(0, value);
  const nearX = occupied.flatMap((rect) => [
    rect.x,
    rect.x + rect.width + gap,
    rect.x - size.width - gap,
  ]).filter((value) => value >= 0 && Math.abs(value - preferred.x) <= snapDistance);
  const nearY = occupied.flatMap((rect) => [
    rect.y,
    rect.y + rect.height + gap,
    rect.y - size.height - gap,
  ]).filter((value) => value >= 0 && Math.abs(value - preferred.y) <= snapDistance);
  const closest = (values: number[], origin: number) => values.length === 0
    ? origin
    : values.reduce(
      (best, value) => Math.abs(value - origin) < Math.abs(best - origin) ? value : best,
      values[0],
    );
  const snapped = {
    x: clamp(closest(nearX, preferred.x)),
    y: clamp(closest(nearY, preferred.y)),
  };
  const isFree = (point: WorkspacePoint) => occupied.every((rect) =>
    !windowRectsOverlap({ ...point, ...size }, rect, gap));
  if (isFree(snapped)) return snapped;

  const xs = new Set([snapped.x, 0]);
  const ys = new Set([snapped.y, 0]);
  for (const rect of occupied) {
    xs.add(clamp(rect.x + rect.width + gap));
    xs.add(clamp(rect.x - size.width - gap));
    ys.add(clamp(rect.y + rect.height + gap));
    ys.add(clamp(rect.y - size.height - gap));
  }
  const candidates = [...xs].flatMap((x) => [...ys].map((y) => ({ x, y })))
    .filter(isFree)
    .sort((a, b) => {
      const da = (a.x - snapped.x) ** 2 + (a.y - snapped.y) ** 2;
      const db = (b.x - snapped.x) ** 2 + (b.y - snapped.y) ** 2;
      return da - db;
    });
  return candidates[0]!;
}

/**
 * Size the desktop for a viewport.
 *
 * Above the floor the physical size equals the viewport exactly, so the
 * desktop fills the window with nothing left over. Below it the desktop
 * overflows and the viewport scrolls rather than clipping the layout.
 */
export function workspaceLayout(
  viewportWidth: number,
  viewportHeight: number,
  zoom: number,
): WorkspaceLayout {
  const scale = clampWorkspaceZoom(zoom) / 100;
  const logical = {
    width: Math.max(MIN_WORKSPACE_WIDTH, Math.max(0, viewportWidth) / scale),
    height: Math.max(MIN_WORKSPACE_HEIGHT, Math.max(0, viewportHeight) / scale),
  };
  return {
    scale,
    logical,
    physical: {
      width: logical.width * scale,
      height: logical.height * scale,
    },
  };
}
