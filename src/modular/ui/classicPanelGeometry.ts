/**
 * The Classic M panel's size on the canvas.
 *
 * The panel is resizable from its lower-right corner, so M's desktop can be
 * given room for the 2x view or kept small beside the patch. Pointer movement
 * arrives in screen pixels and the panel lives in canvas units, hence the zoom.
 */

export type PanelSize = { width: number; height: number };

/** Big enough for M's 640 x 480 workspace and its window furniture at 1x. */
export const CLASSIC_PANEL_SIZE: PanelSize = { width: 1180, height: 760 };
/** Room for the menu bar and at least one window. */
export const CLASSIC_PANEL_MIN_SIZE: PanelSize = { width: 360, height: 240 };

export const CLASSIC_PANEL_SIZE_KEY = "idmlab.classicPanel.size";

const atLeastMinimum = (size: PanelSize): PanelSize => ({
  width: Math.max(CLASSIC_PANEL_MIN_SIZE.width, Math.round(size.width)),
  height: Math.max(CLASSIC_PANEL_MIN_SIZE.height, Math.round(size.height)),
});

export function resizeClassicPanel(
  start: PanelSize,
  pointerDelta: { x: number; y: number },
  zoom: number,
): PanelSize {
  const scale = zoom === 0 ? 1 : zoom;
  return atLeastMinimum({
    width: start.width + pointerDelta.x / scale,
    height: start.height + pointerDelta.y / scale,
  });
}

/** A saved size, or the default when nothing usable was saved. */
export function readClassicPanelSize(saved: string | null): PanelSize {
  if (saved === null) return { ...CLASSIC_PANEL_SIZE };
  try {
    const value = JSON.parse(saved) as Partial<PanelSize>;
    if (typeof value.width === "number" && typeof value.height === "number") {
      return atLeastMinimum({ width: value.width, height: value.height });
    }
  } catch {
    // Unreadable storage falls through to the default.
  }
  return { ...CLASSIC_PANEL_SIZE };
}

const EXPAND_MARGIN = 12;

/**
 * Expand: the panel fills the part of the canvas currently on screen, inset a
 * little so its edges stay visible. `visible` is in canvas units.
 */
export function expandedClassicPanel(
  visible: { x: number; y: number; width: number; height: number },
): { x: number; y: number } & PanelSize {
  return {
    x: Math.round(visible.x + EXPAND_MARGIN),
    y: Math.round(visible.y + EXPAND_MARGIN),
    ...atLeastMinimum({
      width: visible.width - EXPAND_MARGIN * 2,
      height: visible.height - EXPAND_MARGIN * 2,
    }),
  };
}
