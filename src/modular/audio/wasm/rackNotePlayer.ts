/**
 * A note player backed by the Rust rack.
 *
 * `PlayerNoteAdapter` finds its destinations through a `lookup` that returns
 * `unknown` and a duck test (`isNotePlayer`). That is the whole seam this
 * needs: a shim satisfying the same four members slots in where a Web Audio
 * player would, and the adapter — which owns the clock conversion and the
 * batching — does not change at all.
 *
 * **The timestamp is dropped, and that is a real limitation.** `RackMessage`
 * carries no time, so a note sounds when the worklet handles its message
 * rather than at `atSec`. The Web Audio path is sample-accurate here and this
 * one is not; closing that gap needs a scheduled-note message in the
 * protocol and a queue on the Rust side, not a change to this file.
 */

import type { NotePlayer } from "../players";

/** The part of `WasmRackNode` a note player uses. */
export interface RackNoteSink {
  noteOn(note: number, velocity: number, detuneCents: number): void;
  noteOff(note: number): void;
  allNotesOff(): void;
}

export class RackNotePlayer implements NotePlayer {
  constructor(
    readonly nodeId: string,
    private readonly rack: RackNoteSink,
  ) {}

  noteOn(note: number, velocity: number, _atSec: number, detuneCents = 0): void {
    this.rack.noteOn(note, velocity, detuneCents);
  }

  noteOff(note: number, _atSec: number): void {
    this.rack.noteOff(note);
  }

  silence(_atSec: number): void {
    this.rack.allNotesOff();
  }
}
