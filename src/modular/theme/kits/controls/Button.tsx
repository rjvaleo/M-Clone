import { useKit } from "../KitContext";
import { faceFor } from "../registry";
import type { ButtonProps } from "../types";

export function Button(props: ButtonProps) {
  return faceFor(useKit()).button(props);
}
