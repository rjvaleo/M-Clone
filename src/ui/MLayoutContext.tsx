// Hands each M window its place in the M node's layout. A window whose id has
// a place here is put there; dragging it moves it out of the arrangement to
// wherever it is dropped, remembered until Tidy. Outside the provider windows
// keep their old free-floating behaviour.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { M_FITTED_WINDOW_IDS, layoutMNode, type Point, type Rect } from "./mLayout";
import { loadMovedWindows, moveWindowTo, saveMovedWindows, tidyWindows, type MovedWindows } from "./movedWindows";
import { measuredWindowSizes, onWindowMoved } from "./useDraggable";

type Layout = { rects: Partial<Record<string, Rect>>; moveTo: (id: string, at: Point) => void };
const MLayoutContext = createContext<Layout | null>(null);

export function useMLayoutRect(id: string): Rect | null {
  return useContext(MLayoutContext)?.rects[id] ?? null;
}

/** Moves a window out of the arrangement to where it was dropped. */
export function useMLayoutMove(): ((id: string, at: Point) => void) | null {
  return useContext(MLayoutContext)?.moveTo ?? null;
}

/** The width a window is drawn at to fill its column, or null to keep its own. */
export function useMLayoutWidth(id: string): number | null {
  const rect = useMLayoutRect(id);
  return rect && M_FITTED_WINDOW_IDS.has(id) ? rect.width : null;
}

const same = (a: Record<string, Rect>, b: Record<string, Rect>) => {
  const ids = Object.keys(a);
  if (ids.length !== Object.keys(b).length) return false;
  return ids.every((id) => {
    const r = a[id], s = b[id];
    return Boolean(s) && r.x === s.x && r.y === s.y && r.width === s.width && r.height === s.height;
  });
};

/** The windows open now are the ones measured; extra note windows are any "pattern-editor-N". */
function layoutNow(moved: MovedWindows): Record<string, Rect> {
  const sizes = measuredWindowSizes();
  const extras = Object.keys(sizes).filter((id) => /^pattern-editor-\d+$/.test(id))
    .sort((x, y) => Number(x.slice(15)) - Number(y.slice(15)));
  return layoutMNode(sizes, extras, new Set(Object.keys(sizes)), moved);
}

export function MLayoutProvider({ children }: { children: ReactNode }) {
  const moved = useRef<MovedWindows>(loadMovedWindows());
  const [rects, setRects] = useState<Record<string, Rect>>(() => layoutMNode({}, [], undefined, moved.current));
  const relayout = useCallback(() => {
    const next = layoutNow(moved.current);
    setRects((current) => (same(current, next) ? current : next));
  }, []);
  // A drop and its new arrangement land in the same render, so the window never flicks back.
  const setMoved = useCallback((next: MovedWindows) => {
    moved.current = next;
    saveMovedWindows(next);
    relayout();
  }, [relayout]);
  useEffect(() => onWindowMoved(relayout), [relayout]);
  useEffect(() => {
    const tidy = () => setMoved(tidyWindows());
    window.addEventListener("mclone:tidy-windows", tidy);
    return () => window.removeEventListener("mclone:tidy-windows", tidy);
  }, [setMoved]);
  const moveTo = useCallback((id: string, at: Point) => setMoved(moveWindowTo(moved.current, id, at)), [setMoved]);
  const value = useMemo(() => ({ rects, moveTo }), [rects, moveTo]);
  return <MLayoutContext.Provider value={value}>{children}</MLayoutContext.Provider>;
}
