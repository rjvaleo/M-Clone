/**
 * Classic M as an object on the canvas.
 *
 * It used to be a mode: opening it returned early from `ModularApp` and the
 * patch went away. That is the one thing the shell decision rules out — the
 * canvas is the shell, and everything else is something placed on it. A mixer
 * is a module, a tracker is a face, and M is a panel. Nothing takes the surface
 * away from the patch.
 *
 * The whole application comes across, chrome and menu bar included. `App` is
 * M-Clone's own root component, so the seven menus, the window manager, the
 * store and the generative engine are the code that passes M's own suite —
 * "exactly as it was" stays a fact rather than a claim about a copy.
 *
 * ## It lives inside the canvas transform
 *
 * The panel is positioned in canvas coordinates and rendered inside
 * `.mm-canvas`, so it pans and zooms with the modules around it rather than
 * floating over them in screen space. A patch is a place, and M is somewhere in
 * it.
 *
 * The cost is worth stating plainly: M does its own drag arithmetic against its
 * own workspace scale, and it cannot see the canvas zoom. Dragging one of M's
 * inner windows at a canvas zoom other than 1 therefore moves it by the zoom
 * factor. The panel's own drag corrects for zoom because it is ours; M's inner
 * windows are M's. Until `WorkspaceScaleProvider` is given the outer zoom, work
 * inside M at 100 %.
 */

import { Suspense, lazy, useRef, useState } from "react";
import type { KitId } from "../theme/kits/types";
import type { ThemeId } from "../theme/themes";

const ClassicView = lazy(() =>
  import("./ClassicView").then((module) => ({ default: module.ClassicView })));

/** Big enough for M's 640 × 480 workspace and its window furniture. */
export const CLASSIC_PANEL_SIZE = { width: 1180, height: 760 } as const;

export interface ClassicPanelProps {
  x: number;
  y: number;
  /** The canvas zoom, so a drag moves the panel by the distance the pointer moved. */
  zoom: number;
  stackIndex: number;
  themeId: ThemeId;
  onSelectTheme: (id: ThemeId) => void;
  kitId: KitId;
  onSelectKit: (id: KitId) => void;
  onMove: (x: number, y: number) => void;
  onRaise: () => void;
  onClose: () => void;
}

export function ClassicPanel({
  x, y, zoom, stackIndex, themeId, onSelectTheme, kitId, onSelectKit,
  onMove, onRaise, onClose,
}: ClassicPanelProps) {
  const [dragging, setDragging] = useState(false);
  const origin = useRef({ pointerX: 0, pointerY: 0, x, y });

  const beginDrag = (event: React.PointerEvent<HTMLElement>) => {
    // The close button lives in this bar and must not start a drag.
    if ((event.target as HTMLElement).closest("button")) return;
    event.preventDefault();
    // The canvas viewport pans on a drag of its own. Without this the pan and
    // the panel both follow the pointer and the panel appears to move twice as
    // far as the hand does.
    event.stopPropagation();
    onRaise();
    origin.current = { pointerX: event.clientX, pointerY: event.clientY, x, y };
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const drag = (event: React.PointerEvent<HTMLElement>) => {
    if (!dragging) return;
    event.stopPropagation();
    // Screen pixels divided by zoom are canvas units. Without the divide the
    // panel outruns the pointer as soon as the canvas is zoomed in.
    const scale = zoom === 0 ? 1 : zoom;
    onMove(
      origin.current.x + (event.clientX - origin.current.pointerX) / scale,
      origin.current.y + (event.clientY - origin.current.pointerY) / scale,
    );
  };

  const endDrag = (event: React.PointerEvent<HTMLElement>) => {
    if (!dragging) return;
    setDragging(false);
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  return (
    <section
      className={`mm-classic-panel${dragging ? " is-dragging" : ""}`}
      style={{
        left: x,
        top: y,
        width: CLASSIC_PANEL_SIZE.width,
        height: CLASSIC_PANEL_SIZE.height,
        zIndex: stackIndex,
      }}
      onPointerDown={(event) => {
        // Bubble phase, so everything inside M has already had the event and
        // behaves normally. Stopping it here keeps the canvas from panning
        // underneath: a pointer that lands anywhere on this panel belongs to
        // the panel, and having the whole world slide instead is the thing
        // that made grabbing it feel wrong.
        event.stopPropagation();
        onRaise();
      }}
      aria-label="Classic M"
    >
      <header
        className="mm-classic-panel__bar"
        onPointerDown={beginDrag}
        onPointerMove={drag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <span className="mm-classic-panel__title">Classic M</span>
        <button type="button" onClick={onClose} aria-label="Close Classic M">×</button>
      </header>
      <div className="mm-classic-panel__body">
        <Suspense fallback={<div className="mm-classic-loading">Loading classic M…</div>}>
          <ClassicView
            onExit={onClose}
            themeId={themeId}
            onSelectTheme={onSelectTheme}
            kitId={kitId}
            onSelectKit={onSelectKit}
          />
        </Suspense>
      </div>
    </section>
  );
}
