import { useKit } from "../KitContext";
import { faceFor } from "../registry";
import type { SelectorProps } from "../types";

export function Selector(props: SelectorProps) {
  return faceFor(useKit()).selector(props);
}

// Re-exported from values.ts, next to the cycling math it wraps, so a face
// can advance a selector without importing this shell — which would import
// the registry, which imports every face. Same arrangement as stepperStep.
export { selectorAdvance } from "../values";
