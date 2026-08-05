import { useKit } from "../KitContext";
import { faceFor } from "../registry";
import type { EnvelopeProps } from "../types";

export function Envelope(props: EnvelopeProps) {
  return faceFor(useKit()).envelope(props);
}
