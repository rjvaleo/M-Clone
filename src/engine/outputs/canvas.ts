// M's tracks played on a host's sound modules (idMLab's canvas). The host
// decides which module each track reaches; this only hands the notes over,
// once per voice however many MIDI channels the voice is assigned to.

import type { EngineEvent } from "../events";
import type { OutputSink } from "./types";

export interface CanvasOutput {
  /** Note events in audio-context seconds, carrying their voice. */
  send(events: readonly EngineEvent[]): void;
  /** Silence every module M has played on. */
  panic(): void;
  /** Voices cabled to a module, which M's built-in synth leaves alone. */
  routedVoices(): ReadonlySet<number>;
}

export class CanvasSink implements OutputSink {
  readonly destination = "canvas" as const;

  constructor(private output: CanvasOutput) {}

  scheduleBatch(events: readonly EngineEvent[]): void {
    const seen = new Set<string>();
    const notes = events.filter((event) => {
      if (event.destination !== "canvas") return false;
      if (event.type !== "note-on" && event.type !== "note-off") return false;
      const key = `${event.type}:${event.voice}:${event.note}:${event.atSec}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (notes.length > 0) this.output.send(notes);
  }

  // Notes already handed to a module are the module's; a stop silences them all.
  cancelScheduled(): void {}

  panic(): void {
    this.output.panic();
  }
}
