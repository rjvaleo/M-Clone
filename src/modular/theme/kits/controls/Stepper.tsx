// Click-based, unlike Knob/Slider — no drag gesture to own, so this shell
// does nothing but hand props straight to the active kit's face.

import { useKit } from "../KitContext";
import { faceFor } from "../registry";
import type { StepperProps } from "../types";

export { stepperStep } from "../geometry";

export function Stepper(props: StepperProps) {
  return faceFor(useKit()).stepper(props);
}
