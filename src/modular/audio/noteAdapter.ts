// Where the event runtime meets the audio graph.
//
// This is the audio counterpart of `MidiOutputAdapter`, and it has the same
// shape for the same reason: the runtime has already decided *what* happens and
// *when*, in ticks converted to its own seconds, and an adapter's only job is
// to deliver that to a device without making any further musical decisions.
//
// The one thing it must get right is the clock. A `RuntimeEvent.atSec` is in
// the runtime's timing domain — `performance.now()` in the browser — and
// `AudioBufferSourceNode.start()` takes `AudioContext.currentTime`. Those are
// different clocks on different hardware. `AudioClockBridge` holds the offset;
// this file is the only place it is applied, so a note cannot be scheduled
// against the wrong one by accident.
//
// Sampling happens once per batch rather than once per event: every note in a
// scheduling window should be placed against one consistent view of the two
// clocks, or a chord scheduled for a single tick could smear across it.

import type { RuntimeEvent } from "../runtime/eventqueue";
import type { OutputAdapter } from "../runtime/engine";
import type { AudioClockBridge } from "./clockBridge";
import { isNotePlayer, type NotePlayer } from "./players";

/** Finds the live player for a node id, or nothing when it is not built yet. */
export type PlayerLookup = (nodeId: string) => unknown;

export type NoteAdapterOptions = {
  lookup: PlayerLookup;
  bridge: AudioClockBridge;
  /** Current audio time. */
  audioNow: () => number;
  /** Current runtime time, in the same domain as `RuntimeEvent.atSec`. */
  runtimeNow: () => number;
  /** A trim, in milliseconds, for a user who wants to nudge the audio path. */
  latencyMs?: number;
};

export class PlayerNoteAdapter implements OutputAdapter {
  readonly id = "audio-players";
  private readonly options: NoteAdapterOptions;
  private latencySec: number;
  /** Players that have been given a note and not yet been silenced. */
  private readonly touched = new Set<NotePlayer>();
  private delivered = 0;
  private dropped = 0;

  constructor(options: NoteAdapterOptions) {
    this.options = options;
    this.latencySec = (options.latencyMs ?? 0) / 1000;
  }

  /** Note events actually handed to a player. */
  get deliveredCount(): number {
    return this.delivered;
  }

  /** Events whose destination node was not a live player. */
  get droppedCount(): number {
    return this.dropped;
  }

  setLatency(ms: number): void {
    this.latencySec = (Number.isFinite(ms) ? ms : 0) / 1000;
  }

  send(events: readonly RuntimeEvent[], count: number): void {
    if (count <= 0) return;
    // One reading for the whole batch. Both clocks are read together, which is
    // the only way the offset between them means anything.
    this.options.bridge.sample(this.options.audioNow(), this.options.runtimeNow());

    for (let i = 0; i < count; i++) {
      const event = events[i];
      if (event.type !== "note-on" && event.type !== "note-off") continue;
      const target = this.options.lookup(event.portId);
      if (!isNotePlayer(target)) {
        this.dropped += 1;
        continue;
      }
      const at = this.options.bridge.toAudioTime(event.atSec) + this.latencySec;
      // A note whose time has already passed is played now rather than dropped:
      // the alternative is a silent gap whenever a scheduling wake runs late,
      // and a few milliseconds early is far less noticeable than a missing hit.
      const when = Math.max(this.options.audioNow(), at);
      if (event.type === "note-on") target.noteOn(event.note, event.velocity, when);
      else target.noteOff(event.note, when);
      this.touched.add(target);
      this.delivered += 1;
    }
  }

  /**
   * Silence every player that has been sent anything.
   *
   * Tracked rather than enumerated from the graph, because panic has to work
   * when the graph is mid-edit — including for a player that has just been
   * removed from the plan but is still fading out with voices in it.
   */
  panic(): void {
    const now = this.options.audioNow();
    for (const player of this.touched) player.silence(now);
    this.touched.clear();
  }

  dispose(): void {
    this.panic();
  }
}
