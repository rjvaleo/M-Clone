// Drum lanes: a note window whose Pattern is in Drum mode shows named pad
// lanes instead of a keyboard. A lane is still a pitch, so painting and every
// Pattern command work unchanged; only the drawing differs.
//
// The pad names come from the default 16-pad map on notes 36–51 until the
// Drum Player exists; then they will come from the player the track feeds.

import { midiToName } from "../engine/music";
import type { Pattern } from "../engine/types";

export type Pad = { note: number; name: string; choke: number };
export type DrumLane = { pitch: number; name: string; choke: number };

const NAMES = [
  "Kick", "Snare", "Clap", "Closed Hat", "Open Hat", "Tom Low", "Tom Mid", "Tom High",
  "Rim", "Cowbell", "Shaker", "Crash", "Ride", "Perc 1", "Perc 2", "FX",
];
const CHOKES: Record<string, number> = { "Closed Hat": 3, "Open Hat": 3, Crash: 5, Ride: 5 };

export const DEFAULT_PADS: readonly Pad[] = NAMES.map((name, i) => ({
  note: 36 + i, name, choke: CHOKES[name] ?? 0,
}));

export function showsDrumLanes(pattern: Pattern): boolean {
  return pattern.drumMachine;
}

/** The lanes to draw, top to bottom: pads in pad order, then any other notes. */
export function drumLanes(pattern: Pattern, pads: readonly Pad[], showAll = false): DrumLane[] {
  const used = new Set(pattern.steps.flatMap((step) => step.pitches));
  const all = showAll || used.size === 0;
  const lanes: DrumLane[] = pads
    .filter((pad) => all || used.has(pad.note))
    .map((pad) => ({ pitch: pad.note, name: pad.name, choke: pad.choke }));
  const padNotes = new Set(pads.map((pad) => pad.note));
  const strays = [...used].filter((pitch) => !padNotes.has(pitch)).sort((a, b) => a - b);
  return [...lanes, ...strays.map((pitch) => ({ pitch, name: midiToName(pitch), choke: 0 }))];
}
