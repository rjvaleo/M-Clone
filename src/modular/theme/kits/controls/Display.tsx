import { useKit } from "../KitContext";
import { faceFor } from "../registry";
import type { DisplayProps } from "../types";

export function Display(props: DisplayProps) {
  return faceFor(useKit()).display(props);
}
