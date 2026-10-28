/**
 * M Conductor's baton: pad 1, and what moving it changes. As in M, the baton
 * moves every armed Variable along its arrow and, when the tempo is armed,
 * sweeps the tempo across its range — the 110 · 120 · 130 bar of M's
 * Conducting window.
 */

import { axisValue, clampBaton, conductedTempo, type BatonPoint } from "../../engine/conductor";
import type { ArrowDir } from "../../engine/snapshot";
import type { JsonValue } from "../model/graph";
import { conduct, type VariablesState } from "./variables";

export type Pad = { x: number; y: number; glide: number };

/** A pad runs -1 to +1 with up positive; M's baton runs 0 to 1 from the top left. */
export const batonFromPad = (x: number, y: number): BatonPoint => clampBaton({ x: (x + 1) / 2, y: (1 - y) / 2 });

export function conductUpdates(
  pads: readonly Pad[],
  conductor: Record<string, JsonValue>,
  variables: VariablesState | null,
  x: number,
  y: number,
): { conductor: Record<string, JsonValue>; variables?: VariablesState } {
  const next = pads.map((pad, i) => (i === 0 ? { ...pad, x, y } : pad));
  const updates: Record<string, JsonValue> = { pads: next as unknown as JsonValue };
  const arrow = conductor["tempo-arrow"];
  const baton = batonFromPad(x, y);
  if (typeof arrow === "string" && arrow !== "off") {
    const range = { low: Number(conductor["tempo-low"] ?? 110), high: Number(conductor["tempo-high"] ?? 130) };
    updates.tempo = conductedTempo(range, axisValue(baton, arrow as ArrowDir));
  }
  return variables ? { conductor: updates, variables: conduct(variables, baton) } : { conductor: updates };
}
