// Makes a panel draggable by its title bar. Permanent panels remember where
// they were left; auxiliary panels find a fresh non-overlapping slot whenever
// they open. Every drag release aligns and resolves collisions.

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { placeWindow, type WorkspaceRect, type WorkspaceSize } from "../engine/workspace";
import { useWorkspaceScale } from "./WorkspaceScale";

export type Pos = { x: number; y: number };

// Shared stacking counter: whichever window was clicked last gets the highest
// z-index and therefore sits in front of the others.
let zCounter = 10;

// Absolutely positioned windows don't extend their container, so the stage has
// no way to know a window was dragged past its edge — the page would simply
// refuse to scroll there. Windows announce every move and the stage re-measures.
const moveListeners = new Set<() => void>();
const WINDOW_GAP = 4;
type WindowRegistration = WorkspaceRect & { autoPlace: boolean };
const registeredWindows = new Map<string, WindowRegistration>();

/** Subscribe to "some window moved". Returns an unsubscribe function. */
export function onWindowMoved(fn: () => void): () => void {
  moveListeners.add(fn);
  return () => {
    moveListeners.delete(fn);
  };
}

export function useDraggable(id: string, def: Pos, options: { autoPlace?: boolean } = {}) {
  const scale = useWorkspaceScale();
  const autoPlace = options.autoPlace ?? false;
  const elementRef = useRef<HTMLElement | null>(null);
  const ref = useCallback((element: HTMLElement | null) => {
    elementRef.current = element;
  }, []);
  const positioned = useRef(false);
  // v2 stores positions in the 640×480 logical coordinate system. Old saved
  // positions were physical pixels from the oversized canvas and cannot be
  // migrated without preserving the very layout this refactor replaces.
  const key = `mclone.v2.panel.${id}`;

  const [z, setZ] = useState(1);
  const bringToFront = useCallback(() => {
    zCounter += 1;
    setZ(zCounter);
  }, []);

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
  const posRef = useRef(pos);
  posRef.current = pos;

  const elementSize = useCallback((): WorkspaceSize => {
    const rect = elementRef.current?.getBoundingClientRect();
    return rect
      ? { width: rect.width / scale, height: rect.height / scale }
      : { width: 0, height: 0 };
  }, [scale]);

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
      const originX = pos.x;
      const originY = pos.y;
      let latest: Pos = pos;
      const move = (ev: PointerEvent) => {
        // Clamped at the stage origin only, which is now the page's top-left
        // corner — a window dragged into negative space would be unreachable,
        // because browsers don't scroll above or left of the document.
        latest = {
          x: Math.max(0, originX + (ev.clientX - startX) / scale),
          y: Math.max(0, originY + (ev.clientY - startY) / scale),
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
        latest = placeWindow(latest, size, occupiedRects(), WINDOW_GAP);
        posRef.current = latest;
        setPos(latest);
        registeredWindows.set(id, { ...latest, ...size, autoPlace });
        moveListeners.forEach((fn) => fn());
        try {
          localStorage.setItem(key, JSON.stringify(latest));
        } catch {
          // ignore storage failures (private mode, etc.)
        }
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
    [autoPlace, elementSize, id, key, occupiedRects, pos, scale],
  );

  return { ref, pos, z, onPointerDown, bringToFront };
}
