// Variable Positions — M's defining idea. Each transform holds six snapshot-able
// "positions" (a–f); selecting one instantly swaps that group of settings.
//
// We model only the sound-affecting variables here and apply a position by
// writing its values into the live per-voice fields the engine already reads,
// so the audio engine needs no changes.

import type { VoiceState, NoteOrder } from "./types";

/** Variables that participate in the position system (map 1:1 to VoiceState keys). */
export type PositionVarId = "noteOrder" | "transposition" | "density" | "velocity";

export const POSITION_VARS: PositionVarId[] = [
  "noteOrder",
  "transposition",
  "density",
  "velocity",
];

export const POSITION_COUNT = 6;
export const POSITION_LABELS = ["a", "b", "c", "d", "e", "f"] as const;

/** A slot value matches the type of its VoiceState field. */
export type PositionValue = number | NoteOrder;

/** One variable's six positions, each with a value per voice. */
export type PositionData = {
  active: number;
  slots: PositionValue[][]; // [positionIndex][voiceIndex]
};

export type VariablePositions = Record<PositionVarId, PositionData>;

/** Seed all six positions of every variable from the current voice values. */
export function makeDefaultPositions(voices: VoiceState[]): VariablePositions {
  const build = (id: PositionVarId): PositionData => {
    const current: PositionValue[] = voices.map((v) => v[id]);
    const slots: PositionValue[][] = [];
    for (let p = 0; p < POSITION_COUNT; p++) slots.push([...current]);
    return { active: 0, slots };
  };
  return {
    noteOrder: build("noteOrder"),
    transposition: build("transposition"),
    density: build("density"),
    velocity: build("velocity"),
  };
}

/** Return a new voices array with `id`'s field set from `slot` (one per voice). */
export function applyPosition(
  voices: VoiceState[],
  id: PositionVarId,
  slot: PositionValue[],
): VoiceState[] {
  return voices.map((v, i) => ({ ...v, [id]: slot[i] }));
}

/** Immutably set a single slot cell. */
export function setSlot(
  positions: VariablePositions,
  id: PositionVarId,
  posIndex: number,
  voiceIndex: number,
  value: PositionValue,
): VariablePositions {
  const data = positions[id];
  const slots = data.slots.map((row, p) =>
    p !== posIndex ? row : row.map((cell, v) => (v !== voiceIndex ? cell : value)),
  );
  return { ...positions, [id]: { ...data, slots } };
}
