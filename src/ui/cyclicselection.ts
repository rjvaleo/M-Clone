import type { CyclicVariable } from "../engine/types";

export type CyclicSelection = { kind: CyclicVariable; position: number };

export function ensureCyclicSelection(
  current: CyclicSelection | null,
  activeAccentPosition: number,
): CyclicSelection {
  return current ?? { kind: "accent", position: activeAccentPosition };
}
