/**
 * M Conductor's baton: pad 1 of the Triple XY, and what moving it changes.
 * As in M, the baton moves every armed variable along its arrow and, when the
 * clock's tempo is armed to an axis, sweeps the tempo across its Adj Range.
 */

import { clampBaton, type BatonPoint } from "../../engine/conductor";
import type { JsonValue } from "../model/graph";
import { conduct, type VariablesState } from "./variables";

export type Pad = { x: number; y: number; glide: number };

/** A Triple XY pad runs -1 to +1 with up positive; M's baton runs 0 to 1 from the top left. */
export const batonFromPad = (x: number, y: number): BatonPoint => clampBaton({ x: (x + 1) / 2, y: (1 - y) / 2 });

export function conductUpdates(
  pads: readonly Pad[],
  clock: Record<string, JsonValue> | null,
  variables: VariablesState | null,
  x: number,
  y: number,
): { conductor: Record<string, JsonValue>; clock?: Record<string, JsonValue>; variables?: VariablesState } {
  const next = pads.map((pad, i) => (i === 0 ? { ...pad, x, y } : pad));
  const out: { conductor: Record<string, JsonValue>; clock?: Record<string, JsonValue>; variables?: VariablesState } =
    { conductor: { pads: next as unknown as JsonValue } };
  const arrow = clock?.["tempo-arrow"];
  if (clock && (arrow === "x" || arrow === "y")) {
    const range = Number(clock["adj-range"] ?? 5);
    out.clock = { fine: Number(((arrow === "x" ? x : y) * range).toFixed(2)) };
  }
  if (variables) out.variables = conduct(variables, batonFromPad(x, y));
  return out;
}
