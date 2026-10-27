import type { CyclicVariable } from "../engine/types";
import { POSITION_LABELS } from "../engine/variables";

export type CyclicSelection = { kind: CyclicVariable; position: number };

const CYCLIC_NAMES: Record<CyclicVariable, string> = {
  accent: "Accent", legato: "Legato", rhythm: "Rhythm",
};

export function ensureCyclicSelection(
  current: CyclicSelection | null,
  activeAccentPosition: number,
): CyclicSelection {
  return current ?? { kind: "accent", position: activeAccentPosition };
}

/** What the Cyclic Editor's title says it is editing: "Rhythm a". */
export function cyclicEditorNote({ kind, position }: CyclicSelection): string {
  return `${CYCLIC_NAMES[kind]} ${POSITION_LABELS[position]}`;
}
