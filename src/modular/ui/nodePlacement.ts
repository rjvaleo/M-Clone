/**
 * Where a newly created module lands.
 *
 * A node used to appear exactly where the menu was opened, which is wrong
 * often enough to be a real annoyance: right-click near the right edge and most
 * of the module is off-screen; right-click over an existing node and the new
 * one is buried behind it; right-click near the top and its header is under the
 * toolbar. In every case the user has to go and find the thing they just made.
 *
 * The rule this implements: **a new module is always fully visible and never
 * overlapping anything.** The requested position is only a preference — it is
 * honoured when it satisfies both, and otherwise the nearest position that does
 * is used instead.
 */

export type Box = { x: number; y: number; width: number; height: number };

export type PlacementRequest = {
  /** Where the user asked for it — a right-click point, usually. */
  desired: { x: number; y: number };
  size: { width: number; height: number };
  /** Boxes already on the canvas. */
  existing: readonly Box[];
  /** The part of the canvas on screen right now, in canvas units. */
  visible: Box;
  /** The whole patch area, which nothing may leave. */
  canvas: { width: number; height: number };
  /** Clearance kept from the viewport edges and from other modules. */
  margin?: number;
};

const DEFAULT_MARGIN = 24;
/** Search granularity. Fine enough to find a gap, coarse enough to stay quick. */
const STEP = 40;

const overlaps = (a: Box, b: Box, margin: number): boolean =>
  a.x < b.x + b.width + margin &&
  a.x + a.width + margin > b.x &&
  a.y < b.y + b.height + margin &&
  a.y + a.height + margin > b.y;

/**
 * The region a module may occupy: on screen, inside the canvas, and clear of
 * the edges. When the viewport is smaller than the module — a big editor face
 * on a small window — the visible region wins over the margin, because a
 * position that is merely close to right beats refusing to place at all.
 */
function allowedRegion(request: PlacementRequest, margin: number) {
  const { visible, canvas, size } = request;
  const left = Math.max(visible.x + margin, 0);
  const top = Math.max(visible.y + margin, 0);
  const right = Math.min(visible.x + visible.width - margin, canvas.width);
  const bottom = Math.min(visible.y + visible.height - margin, canvas.height);
  return {
    minX: left,
    minY: top,
    maxX: Math.max(left, right - size.width),
    maxY: Math.max(top, bottom - size.height),
  };
}

const clamp = (value: number, low: number, high: number): number =>
  Math.min(high, Math.max(low, value));

/**
 * Find a spot for a new module.
 *
 * Tries the requested point first, then scans the visible region in reading
 * order for the first free slot. If the view is genuinely full, it cascades
 * from the top-left by a fixed offset per existing node so successive modules
 * at least stagger instead of stacking exactly.
 */
export function placeNode(request: PlacementRequest): { x: number; y: number } {
  const margin = request.margin ?? DEFAULT_MARGIN;
  const region = allowedRegion(request, margin);
  const { size, existing } = request;

  const free = (x: number, y: number): boolean => {
    const candidate = { x, y, width: size.width, height: size.height };
    return !existing.some((box) => overlaps(candidate, box, margin));
  };

  // 1. The requested position, pulled inside the allowed region.
  const wanted = {
    x: clamp(request.desired.x, region.minX, region.maxX),
    y: clamp(request.desired.y, region.minY, region.maxY),
  };
  if (free(wanted.x, wanted.y)) return wanted;

  // 2. The first free slot, scanning the visible area in reading order.
  for (let y = region.minY; y <= region.maxY; y += STEP) {
    for (let x = region.minX; x <= region.maxX; x += STEP) {
      if (free(x, y)) return { x, y };
    }
  }

  // 3. Nothing is free: stagger rather than stack, so the new module is at
  // least distinguishable from the one under it.
  const offset = (existing.length % 8) * STEP;
  return {
    x: clamp(region.minX + offset, region.minX, region.maxX),
    y: clamp(region.minY + offset, region.minY, region.maxY),
  };
}

/** The visible slice of the canvas, in canvas units, from the scroll position. */
export type MenuBox = { width: number; height: number };

/** The part of the scrollable canvas the user can currently see. */
export type VisibleWindow = { left: number; top: number; width: number; height: number };

/**
 * Keep a pop-up menu wholly on screen.
 *
 * A context menu opens at the pointer, which near the right or bottom edge puts
 * most of it off screen — and a menu you have to scroll the page to reach is a
 * menu you cannot use. So it flips to the other side of the cursor first, which
 * is what every native menu does and what keeps the pointer next to the items
 * rather than halfway across them, and only clamps if flipping is not enough
 * either — the case where the menu is simply taller than the window.
 */
export function menuPlacement(
  anchor: { x: number; y: number },
  menu: MenuBox,
  window: VisibleWindow,
  margin = 8,
): { x: number; y: number } {
  const place = (
    at: number,
    size: number,
    start: number,
    extent: number,
  ): number => {
    const low = start + margin;
    const high = start + extent - margin;
    // Flip to the other side of the pointer when it does not fit past it.
    let value = at + size > high ? at - size : at;
    // Then clamp, for a menu too large to fit on either side.
    if (value + size > high) value = high - size;
    return Math.max(low, value);
  };
  return {
    x: place(anchor.x, menu.width, window.left, window.width),
    y: place(anchor.y, menu.height, window.top, window.height),
  };
}

export function visibleRegion(
  scroll: { left: number; top: number; width: number; height: number },
  zoom: number,
): Box {
  const scale = zoom > 0 ? zoom : 1;
  return {
    x: scroll.left / scale,
    y: scroll.top / scale,
    width: scroll.width / scale,
    height: scroll.height / scale,
  };
}

/**
 * Whether a pointer event should start a module drag.
 *
 * Modules are draggable from anywhere on their face, which means the drag has
 * to yield to every control that lives there — otherwise turning a knob would
 * move the module instead. Rather than listing what is draggable, this lists
 * what is not: anything interactive, and anything that runs its own pointer
 * gesture.
 */
export function isDragSurface(target: Element | null): boolean {
  if (!target) return false;
  return !target.closest(
    "button, input, select, textarea, label, a, [role='slider'], [contenteditable='true']",
  );
}
