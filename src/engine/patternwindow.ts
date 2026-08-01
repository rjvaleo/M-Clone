import type { ChordMode, InsertMode } from "./types";

export type SourceChannel = "all" | number;
export type InputUse = "disabled" | "record";

export function cycleSourceChannel(value: SourceChannel): SourceChannel {
  if (value === "all") return 1;
  return value >= 16 ? "all" : value + 1;
}

export function cycleInputUse(value: InputUse): InputUse {
  return value === "disabled" ? "record" : "disabled";
}

export function cycleChordMode(value: ChordMode): ChordMode {
  return value === "single" ? "chord" : value === "chord" ? "build" : "single";
}

export function cycleInsertMode(value: InsertMode): InsertMode {
  return value === "insert" ? "replace" : value === "replace" ? "overdub" : "insert";
}
