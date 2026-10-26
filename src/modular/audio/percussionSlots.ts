// A percussion kit's slots, as a document holds them.
//
// Shared by the Web Audio player and the WASM bridge, so a kit read from a
// document is the same kit on both backends: the same defaults, the same pan
// clamp, the same whole-number choke groups.

import { clampPan } from "./voices";

const numberOr = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const stringOr = (value: unknown, fallback: string): string =>
  typeof value === "string" ? value : fallback;

export type PercussionSlot = {
  /** MIDI note that fires this slot. */
  note: number;
  /** Empty means the slot is unassigned and silent. */
  assetId: string;
  /** Slots sharing a non-zero group silence each other — the hihat rule. */
  chokeGroup: number;
  /** Per-slot trim, so a loud snare can be balanced without editing the file. */
  gain: number;
  /**
   * Where this pad sits, −1 to +1, before the module's own pan.
   *
   * `AUDIO_ENGINE_SPEC.md` §4 asks for per-pad pan, and a kit is the one place
   * it genuinely earns its node: hats to one side and a floor tom to the other
   * is most of what makes a programmed kit sound like it was played in a room
   * rather than summed to a point.
   */
  pan: number;
};

export const readPercussionSlots = (value: unknown): PercussionSlot[] => {
  if (!Array.isArray(value)) return [];
  return value.map((raw) => {
    const slot = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
    return {
      note: Math.trunc(numberOr(slot.note, 36)),
      assetId: stringOr(slot.assetId, ""),
      chokeGroup: Math.trunc(numberOr(slot.chokeGroup, 0)),
      gain: numberOr(slot.gain, 1),
      pan: clampPan(numberOr(slot.pan, 0)),
    };
  });
};
