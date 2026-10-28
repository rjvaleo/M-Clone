// Makes a panel draggable by its title bar. Permanent panels remember where
// they were left; auxiliary panels find a fresh non-overlapping slot whenever
// they open. Every drag release aligns and resolves collisions.

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { placeWindow, type WorkspaceRect, type WorkspaceSize } from "../engine/workspace";
import { useWorkspaceScale } from "./WorkspaceScale";
import { useMLayoutMove, useMLayoutRect } from "./MLayoutContext";

export type Pos = { x: number; y: number };

// Shared stacking counter: whichever window was clicked last gets the highest
// z-index and therefore sits in front of the others.
let zCounter = 10;
let zBackCounter = 0;

// Absolutely positioned windows don't extend their container, so the stage has
// no way to know a window was dragged past its edge — the page would simply
// refuse to scroll there. Windows announce every move and the stage re-measures.
const moveListeners = new Set<() => void>();
const WINDOW_GAP = 4;
type WindowRegistration = WorkspaceRect & { autoPlace: boolean };
const registeredWindows = new Map<string, WindowRegistration>();

/** The size every open window was last measured at, in logical pixels. */
export function measuredWindowSizes(): Record<string, WorkspaceSize> {
  return Object.fromEntries([...registeredWindows.entries()]
    .map(([id, rect]) => [id, { width: Math.round(rect.width), height: Math.round(rect.height) }]));
}

/** Subscribe to "some window moved". Returns an unsubscribe function. */
export function onWindowMoved(fn: () => void): () => void {
  moveListeners.add(fn);
  return () => {
    moveListeners.delete(fn);
  };
}

export function useDraggable(id: string, def: Pos, options: { autoPlace?: boolean } = {}) {
  const scale = useWorkspaceScale();
  // Inside the M node every window has a fixed place, so it is placed, not dragged.
  const placed = useMLayoutRect(id);
  const moveTo = useMLayoutMove();
  // While a placed window is being dragged it follows the pointer, not its place.
  const [dragging, setDragging] = useState(false);
  const autoPlace = !placed && (options.autoPlace ?? false);
  const elementRef = useRef<HTMLElement | null>(null);
  const ref = useCallback((element: HTMLElement | null) => {
    elementRef.current = element;
  }, []);
  const positioned = useRef(false);
  // v3 stores positions in the 640×480 logical coordinate system, laid out for
  // windows at the original's exact sizes. v2 positions were arranged around
  // the older, smaller windows and would now overlap, so they are not reused.
  const key = `mclone.v3.panel.${id}`;

  const [z, setZ] = useState(1);
  const bringToFront = useCallback(() => {
    zCounter += 1;
    setZ(zCounter);
  }, []);

  useLayoutEffect(() => {
    const sendToBack = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== id) return;
      zBackCounter -= 1;
      setZ(zBackCounter);
    };
    window.addEventListener("mclone:send-window-back", sendToBack);
    return () => window.removeEventListener("mclone:send-window-back", sendToBack);
  }, [id]);

  const [pos, setPos] = useState<Pos>(() => {
    if (autoPlace) return def;
    try {
      const raw = typeof localStorage !== "undefined" ? localStorage.getItem(key) : null;
      if (raw) return JSON.parse(raw) as Pos;
    } catch {
      // ignore malformed storage
    }
    return def;
  });
  const livePos = placed && !dragging ? { x: placed.x, y: placed.y } : pos;
  const posRef = useRef(livePos);
  posRef.current = livePos;

  // Layout size, not on-screen size: the M node sits inside the idMLab canvas,
  // whose zoom would otherwise make every window measure smaller than it is.
  const elementSize = useCallback((): WorkspaceSize => {
    const element = elementRef.current;
    return element
      ? { width: element.offsetWidth, height: element.offsetHeight }
      : { width: 0, height: 0 };
  }, []);

  const occupiedRects = useCallback(() => [...registeredWindows.entries()]
    .filter(([otherId]) => otherId !== id)
    .map(([, rect]) => ({ x: rect.x, y: rect.y, width: rect.width, height: rect.height })), [id]);

  useLayoutEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    const size = elementSize();
    let next = posRef.current;
    if (autoPlace && !positioned.current) {
      const fixedRight = [...registeredWindows.values()]
        .filter((entry) => !entry.autoPlace)
        .reduce((right, entry) => Math.max(right, entry.x + entry.width), 0);
      next = placeWindow(
        { x: Math.max(def.x, fixedRight + WINDOW_GAP), y: 4 },
        size,
        occupiedRects(),
        WINDOW_GAP,
      );
      posRef.current = next;
      setPos(next);
    }
    positioned.current = true;
    registeredWindows.set(id, { ...next, ...size, autoPlace });
    moveListeners.forEach((fn) => fn());

    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => {
      const resized = elementSize();
      registeredWindows.set(id, { ...posRef.current, ...resized, autoPlace });
      moveListeners.forEach((fn) => fn());
    });
    observer?.observe(element);
    return () => {
      observer?.disconnect();
      registeredWindows.delete(id);
      moveListeners.forEach((fn) => fn());
    };
  }, [autoPlace, def.x, elementSize, id, occupiedRects]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      // Don't start a drag when grabbing an interactive control in the title bar.
      if ((e.target as HTMLElement).closest("button, input, select, textarea, a, label")) {
        return;
      }
      e.preventDefault();
      const startX = e.clientX;
      const startY = e.clientY;
      // Screen pixels per layout pixel, counting every zoom above the window
      // (the idMLab canvas as well as the workspace), so it stays under the pointer.
      const element = elementRef.current;
      const onScreen = element?.getBoundingClientRect().width ?? 0;
      const ratio = element && element.offsetWidth && onScreen ? onScreen / element.offsetWidth : scale;
      const originX = livePos.x;
      const originY = livePos.y;
      let latest: Pos = livePos;
      if (placed) {
        setPos(livePos);
        setDragging(true);
      }
      const move = (ev: PointerEvent) => {
        // Clamped at the stage origin only, which is now the page's top-left
        // corner — a window dragged into negative space would be unreachable,
        // because browsers don't scroll above or left of the document.
        latest = {
          x: Math.max(0, originX + (ev.clientX - startX) / ratio),
          y: Math.max(0, originY + (ev.clientY - startY) / ratio),
        };
        posRef.current = latest;
        setPos(latest);
        const size = elementSize();
        registeredWindows.set(id, { ...latest, ...size, autoPlace });
        moveListeners.forEach((fn) => fn());
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        const size = elementSize();
        // A dropped window stays exactly where it was dropped.
        //
        // Release used to run `placeWindow`, which snapped to nearby edges and
        // pushed an overlap to the nearest free gap. Tidy in the abstract, and
        // wrong in practice: you cannot deliberately overlap two windows, and a
        // window you placed carefully jumps as you let go. Depth is what
        // resolves overlap here — the window you touched comes to the front —
        // so the geometry does not need to as well.
        posRef.current = latest;
        setPos(latest);
        registeredWindows.set(id, { ...latest, ...size, autoPlace });
        if (placed && moveTo) {
          // In the M node the window leaves the arrangement and keeps this spot until Tidy.
          moveTo(id, latest);
          setDragging(false);
        } else {
          try {
            localStorage.setItem(key, JSON.stringify(latest));
          } catch {
            // ignore storage failures (private mode, etc.)
          }
        }
        moveListeners.forEach((fn) => fn());
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
    [autoPlace, elementSize, id, key, livePos, moveTo, placed, scale],
  );

  return { ref, pos: livePos, z, onPointerDown, bringToFront };
}
