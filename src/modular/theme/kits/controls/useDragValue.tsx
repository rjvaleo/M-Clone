// Wires a pointer drag to a value change. Every kit's knob and vertical
// slider shares this, so "how does turning a knob feel" is answered once —
// see geometry.ts's dragDeltaToValue for the actual math, which is what is
// under test. This file is the thin, untested plumbing around it: capturing
// the pointer, tracking where the drag started, calling back. There is no
// React DOM test harness in this project yet (see MODULAR task #53), so —
// like every other .tsx face in this codebase — it is the documented
// coverage exclusion.

import { useCallback, useRef, useState } from "react";
import { dragDeltaToValue, snap } from "../geometry";

export interface UseDragValueOptions {
  value: number;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
  sensitivity?: number;
  /** `"y"` (default): dragging up increases the value — every knob and
   * vertical slider. `"x"`: dragging right increases it — horizontal
   * sliders. `dragDeltaToValue` is written once, for the "y" convention;
   * the "x" case reuses it by negating the horizontal delta before handing
   * it over, rather than teaching the pure function two conventions. */
  axis?: "x" | "y";
  onChange: (value: number) => void;
}

/** Returns pointer-event handlers to spread onto the draggable element, and
 * whether a drag is currently in progress (for a face to draw a focus ring
 * or a "grabbed" highlight). */
export function useDragValue({
  value,
  min,
  max,
  step,
  disabled,
  sensitivity,
  axis = "y",
  onChange,
}: UseDragValueOptions) {
  const [dragging, setDragging] = useState(false);
  // A ref, not state: the start value must not change mid-drag even though
  // `value` itself updates every frame as onChange fires, or the drag would
  // rebase against its own most recent output and the knob would run away.
  const dragStart = useRef({ value, pos: 0 });

  const pointerPos = (event: React.PointerEvent): number =>
    axis === "y" ? event.clientY : event.clientX;

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      if (disabled) return;
      // Capture is what keeps move events arriving after the pointer leaves
      // a small knob mid-drag — wanted, not required: a browser that
      // refuses it for this pointer (or a synthetic event with no real
      // device backing it) must not stop the drag from starting at all.
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        /* capture unavailable; the drag still works without it */
      }
      dragStart.current = { value, pos: pointerPos(event) };
      setDragging(true);
    },
    [disabled, value, axis],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent) => {
      if (!dragging) return;
      const rawDelta = pointerPos(event) - dragStart.current.pos;
      // dragDeltaToValue is written for the vertical convention (up
      // decreases the raw delta and increases the value); the horizontal
      // case reuses it by negating here rather than teaching the pure
      // function two sign conventions.
      const delta = axis === "y" ? rawDelta : -rawDelta;
      const next = dragDeltaToValue(dragStart.current.value, delta, min, max, sensitivity);
      onChange(snap(next, step, min));
    },
    [dragging, min, max, step, sensitivity, axis, onChange],
  );

  const endDrag = useCallback((event: React.PointerEvent) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDragging(false);
  }, []);

  return {
    dragging,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endDrag,
      onPointerCancel: endDrag,
    },
  };
}
