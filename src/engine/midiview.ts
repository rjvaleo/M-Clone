import { midiToName } from "./music";
import type { PlannedNote } from "./planner";

export type MidiViewEvent = {
  id: number;
  atSec: number;
  voice: number;
  channel: number;
  type: "note-on" | "note-off";
  note: number;
  noteName: string;
  velocity: number;
  durationSec: number;
};

export const MIDI_VIEW_LIMIT = 1000;

export type MidiViewRow = {
  atSec: number;
  streams: [MidiViewEvent[], MidiViewEvent[], MidiViewEvent[], MidiViewEvent[]];
};

export function eventsForPlannedNotes(
  notes: readonly PlannedNote[],
  firstId: number,
): MidiViewEvent[] {
  const events = notes.flatMap((note, index) => {
    const noteName = midiToName(note.note);
    return [
      {
        id: firstId + index * 2,
        atSec: note.startSec,
        voice: note.voice,
        channel: note.channel,
        type: "note-on" as const,
        note: note.note,
        noteName,
        velocity: note.velocity,
        durationSec: note.durationSec,
      },
      {
        id: firstId + index * 2 + 1,
        atSec: note.startSec + note.durationSec,
        voice: note.voice,
        channel: note.channel,
        type: "note-off" as const,
        note: note.note,
        noteName,
        velocity: 0,
        durationSec: 0,
      },
    ];
  });
  return events.sort((a, b) => a.atSec - b.atSec || a.id - b.id);
}

export function mergeMidiViewEvents(
  current: readonly MidiViewEvent[],
  incoming: readonly MidiViewEvent[],
  limit = MIDI_VIEW_LIMIT,
): MidiViewEvent[] {
  const keep = Math.max(0, limit);
  if (keep === 0) return [];
  return [...current, ...incoming]
    .sort((a, b) => a.atSec - b.atSec || a.id - b.id)
    .slice(-keep);
}

/** Align all four Voices on one tracker timeline, preserving chords per cell. */
export function groupMidiViewRows(events: readonly MidiViewEvent[]): MidiViewRow[] {
  const rows = new Map<number, MidiViewRow>();
  for (const event of events) {
    let row = rows.get(event.atSec);
    if (!row) {
      row = { atSec: event.atSec, streams: [[], [], [], []] };
      rows.set(event.atSec, row);
    }
    row.streams[event.voice].push(event);
  }
  return [...rows.values()].sort((a, b) => a.atSec - b.atSec);
}
