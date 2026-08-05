/**
 * A note player backed by the Rust rack.
 *
 * `PlayerNoteAdapter` finds its destinations through a `lookup` that returns
 * `unknown` and a duck test (`isNotePlayer`). That is the whole seam this
 * needs: a shim satisfying the same four members slots in where a Web Audio
 * player would, and the adapter — which owns the clock conversion and the
 * batching — does not change at all.
 *
 * **The time is kept.** Every event goes into the rack's schedule against
 * `atSec` on the audio clock rather than being played the moment its message
 * lands, which is what makes this path as sample-accurate as the Web Audio one
 * it replaces. The worklet holds each event until its frame and breaks the
 * render quantum around it — see `noteSchedule.ts` and `process_range` in
 * `rust/wasm/src/lib.rs`.
 */

import type { NotePlayer } from "../players";
import type { ScheduledEvent } from "./rackProtocol";

/** The part of `WasmRackNode` a note player uses. */
export interface RackNoteSink {
  schedule(atSec: number, events: ScheduledEvent[]): void;
}

export class RackNotePlayer implements NotePlayer {
  constructor(
    readonly nodeId: string,
    private readonly rack: RackNoteSink,
  ) {}

  noteOn(note: number, velocity: number, atSec: number, detuneCents = 0): void {
    this.rack.schedule(atSec, [{ type: "note-on", note, velocity, detuneCents }]);
  }

  noteOff(note: number, atSec: number): void {
    this.rack.schedule(atSec, [{ type: "note-off", note }]);
  }

  silence(atSec: number): void {
    this.rack.schedule(atSec, [{ type: "all-notes-off" }]);
  }
}
