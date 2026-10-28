import { useKit } from "../KitContext";
import { faceFor } from "../registry";
import type { MeterProps } from "../types";

export function Meter(props: MeterProps) {
  return faceFor(useKit()).meter(props);
}
