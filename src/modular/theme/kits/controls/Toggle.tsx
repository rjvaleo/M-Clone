import { useKit } from "../KitContext";
import { faceFor } from "../registry";
import type { ToggleProps } from "../types";

export function Toggle(props: ToggleProps) {
  return faceFor(useKit()).toggle(props);
}
