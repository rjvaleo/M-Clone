/**
 * The M node's face: the whole of M — menu bar, windows, store and composing
 * runtime — inside the node, sized by hand from its lower-right corner.
 *
 * Pointer events stop at the face. A press anywhere inside M belongs to M:
 * without this the node would drag, or the canvas pan, whenever one of M's
 * windows was touched. The node moves by its header, like every other node.
 */

import { Suspense, createContext, lazy, useContext, useRef, useState } from "react";
import type { KitId } from "../theme/kits/types";
import type { ThemeId } from "../theme/themes";
import { type PanelSize, readClassicPanelSize, resizeClassicPanel } from "./classicPanelGeometry";

const ClassicView = lazy(() =>
  import("./ClassicView").then((module) => ({ default: module.ClassicView })));

/** What the canvas lends M's face: its theme and kit pickers, and its zoom for resizing. */
export type MFaceHost = {
  themeId: ThemeId;
  onSelectTheme: (id: ThemeId) => void;
  kitId: KitId;
  onSelectKit: (id: KitId) => void;
  zoom: number;
};

export const MFaceHostContext = createContext<MFaceHost | null>(null);

const SIZE_KEY = "idmlab.mNode.size";

/** The M face's size in canvas units, as last left, or the default. */
export function readMNodeSize(): PanelSize {
  try {
    return readClassicPanelSize(localStorage.getItem(SIZE_KEY));
  } catch {
    return readClassicPanelSize(null);
  }
}

export function MNodeFace() {
  const host = useContext(MFaceHostContext);
  const [size, setSize] = useState<PanelSize>(readMNodeSize);
  const resizeFrom = useRef<{ pointerX: number; pointerY: number; size: PanelSize } | null>(null);

  const beginResize = (event: React.PointerEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    resizeFrom.current = { pointerX: event.clientX, pointerY: event.clientY, size };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const resize = (event: React.PointerEvent<HTMLElement>) => {
    const from = resizeFrom.current;
    if (!from) return;
    setSize(resizeClassicPanel(from.size, {
      x: event.clientX - from.pointerX,
      y: event.clientY - from.pointerY,
    }, host?.zoom ?? 1));
  };
  const endResize = (event: React.PointerEvent<HTMLElement>) => {
    if (!resizeFrom.current) return;
    resizeFrom.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
    try {
      localStorage.setItem(SIZE_KEY, JSON.stringify(size));
    } catch {
      // A size that cannot be stored is only lost on reload.
    }
  };

  return (
    <div className="mm-m-face" style={{ width: size.width, height: size.height }}
      onPointerDown={(event) => event.stopPropagation()}>
      <div className="mm-m-face__body">
        <Suspense fallback={<div className="mm-classic-loading">Loading M…</div>}>
          {host && <ClassicView themeId={host.themeId} onSelectTheme={host.onSelectTheme}
            kitId={host.kitId} onSelectKit={host.onSelectKit} />}
        </Suspense>
      </div>
      <div className="mm-m-face__resize" role="separator" aria-label="Resize M"
        title="Drag to resize"
        onPointerDown={beginResize} onPointerMove={resize}
        onPointerUp={endResize} onPointerCancel={endResize} />
    </div>
  );
}
