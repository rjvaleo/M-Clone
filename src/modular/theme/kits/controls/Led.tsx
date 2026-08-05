import { useKit } from "../KitContext";
import { faceFor } from "../registry";
import type { LedProps } from "../types";

export function Led(props: LedProps) {
  return faceFor(useKit()).led(props);
}
