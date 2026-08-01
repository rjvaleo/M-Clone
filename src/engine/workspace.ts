export const WORKSPACE_WIDTH = 640;
export const WORKSPACE_HEIGHT = 480;
export const MIN_WORKSPACE_ZOOM = 50;
export const MAX_WORKSPACE_ZOOM = 200;
export const WORKSPACE_ZOOM_STEP = 10;

export function clampWorkspaceZoom(value: number): number {
  const rounded = Math.round(value / WORKSPACE_ZOOM_STEP) * WORKSPACE_ZOOM_STEP;
  return Math.max(MIN_WORKSPACE_ZOOM, Math.min(MAX_WORKSPACE_ZOOM, rounded));
}

export function scaledWorkspaceSize(zoom: number) {
  const scale = clampWorkspaceZoom(zoom) / 100;
  return {
    width: WORKSPACE_WIDTH * scale,
    height: WORKSPACE_HEIGHT * scale,
  };
}

export function logicalDragDelta(physicalDelta: number, zoom: number): number {
  return physicalDelta / (clampWorkspaceZoom(zoom) / 100);
}

export function fitWorkspaceZoom(width: number, height: number): number {
  const raw = Math.min(width / WORKSPACE_WIDTH, height / WORKSPACE_HEIGHT) * 100;
  return clampWorkspaceZoom(Math.floor(raw / WORKSPACE_ZOOM_STEP) * WORKSPACE_ZOOM_STEP);
}
