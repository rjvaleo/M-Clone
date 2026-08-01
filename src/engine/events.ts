import type { PlannedNote } from "./planner";

export type OutputDestination = "synth" | "midi";

type EventBase = {
  atSec: number;
  atTick: number;
  sequence: number;
  destination: OutputDestination;
  voice: number;
  channel: number;
};

export type NoteOnEvent = EventBase & {
  type: "note-on";
  noteId: number;
  note: number;
  velocity: number;
};

export type NoteOffEvent = EventBase & {
  type: "note-off";
  noteId: number;
  note: number;
  velocity: number;
};

export type ProgramChangeEvent = EventBase & {
  type: "program-change";
  program: number;
};

export type EngineEvent = NoteOnEvent | NoteOffEvent | ProgramChangeEvent;

const priority: Record<EngineEvent["type"], number> = {
  "program-change": 0,
  "note-off": 1,
  "note-on": 2,
};

export function compareEngineEvents(a: EngineEvent, b: EngineEvent): number {
  return a.atSec - b.atSec
    || priority[a.type] - priority[b.type]
    || a.destination.localeCompare(b.destination)
    || a.channel - b.channel
    || a.sequence - b.sequence;
}

type ActiveNote = { noteId: number; offSequence: number };

/**
 * Owns future Note Offs and resolves overlapping notes before they reach an
 * output adapter. Separate owners retrigger cleanly: the old note is released
 * at the replacement timestamp and its stale future Note Off is removed.
 */
export class NoteLifecycle {
  private pending: EngineEvent[] = [];
  private active = new Map<string, ActiveNote>();
  private sequence = 0;
  private noteId = 0;

  private key(destination: OutputDestination, channel: number, note: number): string {
    return `${destination}:${channel}:${note}`;
  }

  ingest(notes: readonly PlannedNote[], destinations: readonly OutputDestination[]): void {
    const sorted = [...notes].sort((a, b) => a.startSec - b.startSec || a.voice - b.voice);
    for (const note of sorted) {
      for (const destination of destinations) this.addNote(note, destination);
    }
  }

  private addNote(note: PlannedNote, destination: OutputDestination): void {
    const key = this.key(destination, note.channel, note.note);
    const previous = this.active.get(key);
    if (previous) {
      this.pending = this.pending.filter((event) => event.sequence !== previous.offSequence);
      this.pending.push({
        type: "note-off", atSec: note.startSec, sequence: this.sequence++,
        atTick: note.atTick ?? 0,
        destination, voice: note.voice, channel: note.channel,
        noteId: previous.noteId, note: note.note, velocity: 0,
      });
    }
    const noteId = this.noteId++;
    const on: NoteOnEvent = {
      type: "note-on", atSec: note.startSec, sequence: this.sequence++, destination,
      atTick: note.atTick ?? 0,
      voice: note.voice, channel: note.channel, noteId,
      note: note.note, velocity: note.velocity,
    };
    const off: NoteOffEvent = {
      type: "note-off", atSec: note.startSec + Math.max(0, note.durationSec),
      atTick: (note.atTick ?? 0) + (note.durationTicks ?? 0),
      sequence: this.sequence++, destination, voice: note.voice,
      channel: note.channel, noteId, note: note.note, velocity: 0,
    };
    this.pending.push(on, off);
    this.active.set(key, { noteId, offSequence: off.sequence });
  }

  addProgramChanges(
    atSec: number,
    atTick: number,
    programs: readonly { voice: number; channel: number; program: number }[],
  ): void {
    for (const item of programs) {
      this.pending.push({
        type: "program-change", atSec, atTick, sequence: this.sequence++, destination: "midi",
        voice: item.voice, channel: item.channel, program: item.program,
      });
    }
  }

  drainBefore(endSec: number): EngineEvent[] {
    const ready: EngineEvent[] = [];
    const future: EngineEvent[] = [];
    for (const event of this.pending) {
      if (event.atSec < endSec) ready.push(event);
      else future.push(event);
    }
    this.pending = future;
    ready.sort(compareEngineEvents);
    for (const event of ready) {
      if (event.type !== "note-off") continue;
      const key = this.key(event.destination, event.channel, event.note);
      if (this.active.get(key)?.noteId === event.noteId) this.active.delete(key);
    }
    return ready;
  }

  pendingCount(): number {
    return this.pending.length;
  }

  reset(): void {
    this.pending = [];
    this.active.clear();
  }
}
