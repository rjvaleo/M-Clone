// The one Knob every kit renders through. Owns the drag gesture; a face only
// draws what `dragging` and `value` currently are. This is what keeps six
// kits from needing six copies of "how does dragging a knob feel" — see
// KitContext.tsx and geometry.ts for why the split lands here.

import { useKit } from "../KitContext";
import { faceFor } from "../registry";
import type { KnobProps } from "../types";
import { useDragValue } from "./useDragValue";

export function Knob(props: KnobProps) {
  const kit = useKit();
  const { dragging, handlers } = useDragValue({
    value: props.value,
    min: props.min,
    max: props.max,
    step: props.step,
    disabled: props.disabled,
    onChange: props.onChange,
  });
  return faceFor(kit).knob({ ...props, dragging, dragHandlers: handlers });
}
