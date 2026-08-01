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
