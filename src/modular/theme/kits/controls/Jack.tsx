import { useKit } from "../KitContext";
import { faceFor } from "../registry";
import type { JackProps } from "../types";

export function Jack(props: JackProps) {
  return faceFor(useKit()).jack(props);
}
