// Built-in WebAudio synth adapter for explicit portable engine events.

import type { EngineEvent, NoteOnEvent } from "../events";
import type { OutputSink } from "./types";

function midiToFreq(note: number): number {
  return 440 * Math.pow(2, (note - 69) / 12);
}

export class SynthSink implements OutputSink {
  readonly destination = "synth" as const;
  private active = new Set<OscillatorNode>();
  private notes = new Map<number, { osc: OscillatorNode; gain: GainNode }>();

  constructor(private ctx: AudioContext, private master: GainNode) {}

  private noteOn(event: NoteOnEvent): void {
    const start = Math.max(event.atSec, this.ctx.currentTime);
    const level = (event.velocity / 127) * 0.25;
    const osc = this.ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.value = midiToFreq(event.note);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(Math.max(level, 0.0002), start + 0.006);
    osc.connect(gain).connect(this.master);
    osc.start(start);
    this.active.add(osc);
    this.notes.set(event.noteId, { osc, gain });
    osc.onended = () => {
      gain.disconnect();
      osc.disconnect();
      this.active.delete(osc);
      this.notes.delete(event.noteId);
    };
  }

  scheduleBatch(events: readonly EngineEvent[]): void {
    for (const event of events) {
      if (event.destination !== this.destination || event.type === "program-change") continue;
      if (event.type === "note-on") {
        this.noteOn(event);
        continue;
      }
      const active = this.notes.get(event.noteId);
      if (!active) continue;
      const at = Math.max(event.atSec, this.ctx.currentTime);
      active.gain.gain.cancelScheduledValues(at);
      active.gain.gain.setValueAtTime(Math.max(active.gain.gain.value, 0.0002), at);
      active.gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.01);
      active.osc.stop(at + 0.02);
    }
  }

  cancelScheduled(): void {
    this.panic();
  }

  panic(): void {
    for (const osc of this.active) {
      try { osc.stop(); } catch { /* already stopped */ }
    }
    this.active.clear();
    this.notes.clear();
  }
}
