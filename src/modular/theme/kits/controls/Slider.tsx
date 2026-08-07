// The shared Slider — same shape as Knob.tsx: owns the drag, hands the
// active kit's face a value and a drag state to draw.

import { useKit } from "../KitContext";
import { faceFor } from "../registry";
import type { SliderProps } from "../types";
import { useDragValue } from "./useDragValue";

const SENSITIVITY = 150;

export function Slider(props: SliderProps) {
  const kit = useKit();
  const orientation = props.orientation ?? "vertical";
  const { dragging, handlers } = useDragValue({
    value: props.value,
    min: props.min,
    max: props.max,
    step: props.step,
    disabled: props.disabled,
    sensitivity: SENSITIVITY,
    axis: orientation === "vertical" ? "y" : "x",
    onChange: props.onChange,
  });
  return faceFor(kit).slider({ ...props, orientation, dragging, dragHandlers: handlers });
}
