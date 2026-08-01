// Makes a panel draggable by its title bar and remembers where it was left —
// the classic M behaviour where every window can be repositioned on the canvas.

import { useCallback, useState } from "react";
import { useWorkspaceScale } from "./WorkspaceScale";

export type Pos = { x: number; y: number };

// Shared stacking counter: whichever window was clicked last gets the highest
// z-index and therefore sits in front of the others.
let zCounter = 10;

// Absolutely positioned windows don't extend their container, so the stage has
// no way to know a window was dragged past its edge — the page would simply
// refuse to scroll there. Windows announce every move and the stage re-measures.
const moveListeners = new Set<() => void>();

/** Subscribe to "some window moved". Returns an unsubscribe function. */
export function onWindowMoved(fn: () => void): () => void {
  moveListeners.add(fn);
  return () => {
    moveListeners.delete(fn);
  };
}

export function useDraggable(id: string, def: Pos) {
  const scale = useWorkspaceScale();
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
    try {
      const raw = typeof localStorage !== "undefined" ? localStorage.getItem(key) : null;
      if (raw) return JSON.parse(raw) as Pos;
    } catch {
      // ignore malformed storage
    }
    return def;
  });

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
        setPos(latest);
        moveListeners.forEach((fn) => fn());
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        try {
          localStorage.setItem(key, JSON.stringify(latest));
        } catch {
          // ignore storage failures (private mode, etc.)
        }
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
    [pos, key, scale],
  );

  return { pos, z, onPointerDown, bringToFront };
}
