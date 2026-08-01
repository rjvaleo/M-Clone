// Variable Positions — M's defining idea. Each transform holds six snapshot-able
// "positions" (a–f); selecting one instantly swaps that group of settings.
//
// We model only the sound-affecting variables here and apply a position by
// writing its values into the live per-voice fields the engine already reads,
// so the audio engine needs no changes.

import type { VoiceState, NoteOrderMix, VelocityRange } from "./types";
import { type TimeMap, neutralTimeMap, cloneTimeMap } from "./timemap";

/** Variables that participate in the position system (map 1:1 to VoiceState keys). */
export type PositionVarId =
  | "noteOrderMix"
  | "transposition"
  | "density"
  | "velocityRange"
  | "timeDistort"
  | "outputChannels";

export const POSITION_VARS: PositionVarId[] = [
  "noteOrderMix",
  "transposition",
  "density",
  "velocityRange",
  "timeDistort",
  "outputChannels",
];

export const POSITION_COUNT = 6;
export const POSITION_LABELS = ["a", "b", "c", "d", "e", "f"] as const;

/** A slot value matches the type of its VoiceState field. */
export type PositionValue =
  | number
  | NoteOrderMix
  | VelocityRange
  | TimeMap
  | number[];

/** True for a Time Distortion Map, whose nested points need a deep copy. */
function isTimeMap(value: PositionValue): value is TimeMap {
  return typeof value === "object" && value !== null && "points" in value;
}

/**
 * Copy a slot value deeply enough that nothing is shared between Positions.
 * Shallow-spreading a Time Distortion Map would leave two Positions pointing at
 * the same `points` array, so editing one would silently edit the other.
 */
export function clonePositionValue(value: PositionValue): PositionValue {
  if (Array.isArray(value)) return [...value];
  if (isTimeMap(value)) return cloneTimeMap(value);
  if (typeof value === "object") return { ...value };
  return value;
}

/** One variable's six positions, each with a value per voice. */
export type PositionData = {
  active: number;
  slots: PositionValue[][]; // [positionIndex][voiceIndex]
};

export type VariablePositions = Record<PositionVarId, PositionData>;

/** Seed all six positions of every variable from the current voice values. */
export function makeDefaultPositions(voices: VoiceState[]): VariablePositions {
  const build = (id: PositionVarId): PositionData => {
    const slots: PositionValue[][] = [];
    for (let p = 0; p < POSITION_COUNT; p++) {
      slots.push(voices.map((v) => clonePositionValue(v[id])));
    }
    return { active: 0, slots };
  };
  return {
    noteOrderMix: build("noteOrderMix"),
    transposition: build("transposition"),
    density: build("density"),
    velocityRange: build("velocityRange"),
    timeDistort: build("timeDistort"),
    outputChannels: build("outputChannels"),
  };
}

/**
 * The Positions the app boots with, read off the Variables Window screenshot in
 * `reference/`. Six *distinct* presets per Variable is the whole point of the
 * position system — shipping six identical copies, as this used to, leaves the
 * window looking inert and gives you nothing to conduct between.
 *
 * Provenance differs per row, and it is worth being straight about it:
 *
 *  - Exact, read off the edit-window screenshots in `reference/`: Note Density
 *    `a`, Velocity Range `a`, Note Order `e`. Those windows show their
 *    numericals, so these are the original's real values.
 *  - Exact, read off the Variables Window: Note Order `a`/`b`/`c` (solid /
 *    dithered / open bars are unambiguously Original / Cyclic / Utterly), and
 *    all six Time Distortion cells, which are identical upright slashes.
 *  - Shaped, not exact: the remaining Note Density, Velocity Range and
 *    Transposition positions. Their miniatures show which voices sit high or
 *    low, and which positions are columns versus spread chords, but a 1-bit
 *    thumbnail carries no recoverable numbers. These follow that shape and are
 *    otherwise chosen to be musically useful.
 */
const PRESETS: Record<PositionVarId, PositionValue[][]> = {
  // `a` is exact: the Note Density edit window reads 57 / 100 / 100 / 100.
  // The rest thin out and stagger across the voices, as their miniatures do.
  density: [
    [0.57, 1, 1, 1],
    [0.55, 0.7, 0.8, 0.95],
    [0.3, 0.45, 0.6, 0.75],
    [0.45, 0.6, 0.7, 0.85],
    [1, 0.8, 0.6, 0.9],
    [0.35, 0.5, 0.3, 0.45],
  ],
  // `a` is exact: the Velocity Range edit window reads 48-110, 84-107,
  // 84-104, 85-108. Then narrow, bright, dynamic, soft, and loud.
  velocityRange: [
    [
      { low: 48, high: 110 }, { low: 84, high: 107 },
      { low: 84, high: 104 }, { low: 85, high: 108 },
    ],
    [
      { low: 80, high: 110 }, { low: 70, high: 100 },
      { low: 60, high: 95 }, { low: 50, high: 90 },
    ],
    [
      { low: 96, high: 112 }, { low: 96, high: 112 },
      { low: 92, high: 108 }, { low: 92, high: 108 },
    ],
    [
      { low: 24, high: 127 }, { low: 32, high: 120 },
      { low: 24, high: 127 }, { low: 32, high: 120 },
    ],
    [
      { low: 16, high: 72 }, { low: 20, high: 80 },
      { low: 16, high: 72 }, { low: 20, high: 80 },
    ],
    [
      { low: 64, high: 127 }, { low: 64, high: 127 },
      { low: 72, high: 127 }, { low: 72, high: 127 },
    ],
  ],
  // a/b/c are the three schemes pure, exactly as the miniatures show them.
  // `e` is exact: the Note Order edit window reads 50/4/46, 38/47/15,
  // 3/10/87, 10/15/75 down the four voices.
  noteOrderMix: [
    Array.from({ length: 4 }, () => ({ original: 100, cyclic: 0, utterly: 0 })),
    Array.from({ length: 4 }, () => ({ original: 0, cyclic: 100, utterly: 0 })),
    Array.from({ length: 4 }, () => ({ original: 0, cyclic: 0, utterly: 100 })),
    Array.from({ length: 4 }, () => ({ original: 50, cyclic: 50, utterly: 0 })),
    [
      { original: 50, cyclic: 4, utterly: 46 },
      { original: 38, cyclic: 47, utterly: 15 },
      { original: 3, cyclic: 10, utterly: 87 },
      { original: 10, cyclic: 15, utterly: 75 },
    ],
    Array.from({ length: 4 }, () => ({ original: 0, cyclic: 50, utterly: 50 })),
  ],
  // Columns where the voices agree, spread chords where they don't.
  transposition: [
    [0, 0, 0, 0],
    [0, 12, -12, 0],
    [0, 7, -5, 12],
    [0, 4, 7, 12], // major triad
    [0, 3, 7, 10], // minor seventh
    [0, -12, 0, -24], // bass doubling
  ],
  // All six cells in the reference are the same straight diagonals, and the
  // manual advises keeping a Position "free of maps, so that you have a
  // rhythmically neutral setting available".
  timeDistort: Array.from({ length: POSITION_COUNT }, () =>
    Array.from({ length: 4 }, () => neutralTimeMap()),
  ),
  // Orchestration isn't in the Variables Window; one voice per channel.
  outputChannels: Array.from({ length: POSITION_COUNT }, () => [[1], [2], [3], [4]]),
};

/**
 * Which Position each Variable starts on. Note Density and Note Order sit on
 * `e` in the screenshot; the rest sit on `a`.
 */
const ACTIVE: Record<PositionVarId, number> = {
  density: 4,
  velocityRange: 0,
  noteOrderMix: 4,
  transposition: 0,
  timeDistort: 0,
  outputChannels: 0,
};

/** Build the shipped Positions. Deep-copied so callers can mutate freely. */
export function makePresetPositions(): VariablePositions {
  const build = (id: PositionVarId): PositionData => ({
    active: ACTIVE[id],
    slots: PRESETS[id].map((row) => row.map(clonePositionValue)),
  });
  return {
    noteOrderMix: build("noteOrderMix"),
    transposition: build("transposition"),
    density: build("density"),
    velocityRange: build("velocityRange"),
    timeDistort: build("timeDistort"),
    outputChannels: build("outputChannels"),
  };
}

/** Push every Variable's active Position into the live voice fields. */
export function applyActivePositions(
  voices: VoiceState[],
  positions: VariablePositions,
): VoiceState[] {
  return POSITION_VARS.reduce(
    (acc, id) => applyPosition(acc, id, positions[id].slots[positions[id].active]),
    voices,
  );
}

/** Return a new voices array with `id`'s field set from `slot` (one per voice). */
export function applyPosition(
  voices: VoiceState[],
  id: PositionVarId,
  slot: PositionValue[],
): VoiceState[] {
  return voices.map((v, i) => ({ ...v, [id]: clonePositionValue(slot[i]) }));
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
