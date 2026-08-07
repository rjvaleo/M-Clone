import { useKit } from "../KitContext";
import { faceFor } from "../registry";
import type { PadProps } from "../types";

export function Pad(props: PadProps) {
  return faceFor(useKit()).pad(props);
}
