import { midiToName } from "./music";
import { PPQN } from "./planner";
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
  /**
   * Position and length on the shared 960 PPQN transport timeline.
   *
   * Optional because `PlannedNote` makes them optional. Seconds drift against
   * the music the moment the tempo moves; the tick is the position the
   * planner actually decided, so the readout places rows by this when it has
   * it and falls back to seconds when it does not.
   */
  atTick?: number;
  durationTicks?: number;
};

export const MIDI_VIEW_LIMIT = 1000;

/** Ticks to beats, at the transport's 960 PPQN. */
export const beatOfTick = (tick: number): number => tick / PPQN;

/**
 * A note's length, as exactly three characters.
 *
 * Fixed width because the readout is a grid: a cell that renders two
 * characters on one row and four on the next stops the columns lining up,
 * which is the only reason to use a monospaced face in the first place.
 *
 * Below a beat the leading zero is dropped — ".25" carries two digits of
 * detail where "0.2" carries one. At ten beats and over the exact length
 * stops being what anyone is reading for, so it collapses to "10+".
 */
export function formatDurationCell(durationTicks: number): string {
  const beats = beatOfTick(durationTicks);
  // A note-off is an instant, not a note of no length, so it stays blank.
  if (!(beats > 0)) return "   ";
  if (beats >= 10) return "10+";
  if (beats >= 1) return beats.toFixed(1).slice(0, 3);
  return beats.toFixed(2).slice(1);
}

/**
 * A transport message, in either direction.
 *
 * Kept beside the notes rather than folded into `MidiViewEvent`: a Start
 * belongs to no Voice and has no pitch, velocity or duration, so every one of
 * that type's fields would be a lie on it.
 *
 * Clock pulses are deliberately absent. At 24 per quarter note a moderate
 * tempo produces around fifty rows a second, which would bury the notes the
 * readout exists to show.
 */
export type MidiViewTransport = {
  id: number;
  atSec: number;
  type: "start" | "stop" | "continue";
  direction: "out" | "in";
};

export type MidiViewRow = {
  atSec: number;
  streams: [MidiViewEvent[], MidiViewEvent[], MidiViewEvent[], MidiViewEvent[]];
  transport: MidiViewTransport[];
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
        // Spread rather than assigned: a note the planner gave no tick keeps
        // the shape it always had, instead of carrying undefined keys.
        ...(note.atTick === undefined ? {} : {
          atTick: note.atTick,
          durationTicks: note.durationTicks ?? 0,
        }),
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
        ...(note.atTick === undefined ? {} : {
          atTick: note.atTick + (note.durationTicks ?? 0),
          durationTicks: 0,
        }),
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
export function groupMidiViewRows(
  events: readonly MidiViewEvent[],
  transport: readonly MidiViewTransport[] = [],
): MidiViewRow[] {
  const rows = new Map<number, MidiViewRow>();
  const rowAt = (atSec: number): MidiViewRow => {
    let row = rows.get(atSec);
    if (!row) {
      row = { atSec, streams: [[], [], [], []], transport: [] };
      rows.set(atSec, row);
    }
    return row;
  };
  for (const event of events) rowAt(event.atSec).streams[event.voice].push(event);
  // A Start and the first note of a run land together, so they share a row.
  for (const mark of transport) rowAt(mark.atSec).transport.push(mark);
  return [...rows.values()].sort((a, b) => a.atSec - b.atSec);
}
