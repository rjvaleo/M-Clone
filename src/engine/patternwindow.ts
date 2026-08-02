import type { ChordMode, InsertMode } from "./types";
import type { MidiInputUse } from "./midiinput";

export type SourceChannel = "all" | number;
export type InputUse = MidiInputUse;

/** Chapter 13's numeric Time Base denominator values; `sa` awaits Input Control. */
export const TIME_BASE_DENOMINATORS = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 13, 15, 16, 24,
] as const;

export function cycleSourceChannel(value: SourceChannel): SourceChannel {
  if (value === "all") return 1;
  return value >= 16 ? "all" : value + 1;
}

export function cycleInputUse(value: InputUse): InputUse {
  const values: InputUse[] = ["disabled", "record", "control", "keyboard-transpose", "echo-map"];
  return values[(values.indexOf(value) + 1) % values.length];
}

export function cycleChordMode(value: ChordMode): ChordMode {
  return value === "single" ? "chord" : value === "chord" ? "build" : "single";
}

export function cycleInsertMode(value: InsertMode): InsertMode {
  return value === "insert" ? "replace" : value === "replace" ? "overdub" : "insert";
}
