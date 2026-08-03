export type ViewportZoom = {
  scrollLeft: number;
  scrollTop: number;
  pointerX: number;
  pointerY: number;
  oldZoom: number;
  newZoom: number;
};

export const clampZoom = (zoom: number): number =>
  Math.max(0.4, Math.min(1.1, zoom));

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
