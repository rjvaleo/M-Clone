// The Web MIDI output adapter.
//
// Deliberately thin: it converts already-scheduled events into bytes and a
// timestamp, and it remembers what it actually sent. Every musical decision
// happened upstream, and every timing decision belongs to `PresentationClock`,
// which is the single place audio time becomes performance time.
//
// The part that is easy to get wrong and matters most is panic. Tracking
// scheduled notes is not the same as knowing what is sounding, and CC 123 is
// not reliably obeyed, so releases come from the sounding-note shadow and the
// controller messages are the belt-and-braces afterwards.

import type { RuntimeEvent } from "./eventqueue";
import { SoundingNotes } from "./eventqueue";
import type { OutputAdapter } from "./engine";
import type { PresentationClock } from "./skew";

/** The part of `MIDIOutput` this adapter uses. */
export interface MidiPort {
  readonly id: string;
  readonly state?: string;
  send(data: readonly number[] | Uint8Array, timestamp?: number): void;
  clear?(): void;
}

export type MidiAdapterOptions = {
  /** Node id of the MIDI Output module this adapter serves. */
  id: string;
  clock: PresentationClock;
  /** The user's latency control: a trim on top of a correct alignment. */
  latencyMs?: number;
};

export class MidiOutputAdapter implements OutputAdapter {
  readonly id: string;
  private readonly clock: PresentationClock;
  private readonly sounding = new SoundingNotes();
  private ports = new Map<string, MidiPort>();
  private latencyMs: number;

  constructor(options: MidiAdapterOptions) {
    this.id = options.id;
    this.clock = options.clock;
    this.latencyMs = clampLatency(options.latencyMs ?? 0);
  }

  /** Notes believed to be sounding right now, for the node face and tests. */
  get soundingCount(): number {
    return this.sounding.active().length;
  }

  setLatency(ms: number): void {
    this.latencyMs = clampLatency(ms);
  }

  /**
   * Reconcile the selected ports.
   *
   * A port that goes away is silenced from the shadow first: otherwise a
   * device that is unplugged mid-phrase and plugged back in comes back with
   * notes held down.
   */
  setPorts(ports: readonly MidiPort[]): void {
    const next = new Map(ports.map((port) => [port.id, port]));
    for (const [id, previous] of this.ports) {
      if (next.get(id) === previous) continue;
      this.releasePort(previous);
    }
    this.ports = next;
  }

  send(events: readonly RuntimeEvent[], count: number): void {
    if (this.ports.size === 0) return;
    for (let i = 0; i < count; i++) {
      const event = events[i];
      // Each adapter serves one MIDI Output node; anything else is not ours.
      if (event.portId !== this.id) continue;
      const at = this.clock.performanceMsFor(event.atSec, this.latencyMs);
      const channel = Math.min(16, Math.max(1, Math.trunc(event.channel))) - 1;
      for (const port of this.ports.values()) {
        if (event.type === "note-on") {
          port.send([0x90 | channel, event.note & 0x7f, event.velocity & 0x7f], at);
          this.sounding.markOn(port.id, channel + 1, event.note & 0x7f);
        } else if (event.type === "note-off") {
          port.send([0x80 | channel, event.note & 0x7f, 0], at);
          this.sounding.markOff(port.id, channel + 1, event.note & 0x7f);
        } else if (event.type === "program-change") {
          port.send([0xc0 | channel, event.program & 0x7f], at);
        } else {
          port.send([0xb0 | channel, event.controller & 0x7f, event.value & 0x7f], at);
        }
      }
    }
  }

  panic(): void {
    for (const port of this.ports.values()) this.releasePort(port);
  }

  /** Release exactly what this port is sounding, then reset its controllers. */
  private releasePort(port: MidiPort): void {
    // `clear()` is specified but missing from some browsers and type versions.
    port.clear?.();
    for (const note of this.sounding.takeAll(port.id)) {
      port.send([0x80 | (note.channel - 1), note.note & 0x7f, 0]);
    }
    for (let channel = 0; channel < 16; channel++) {
      port.send([0xb0 | channel, 64, 0]); // Sustain off
      port.send([0xb0 | channel, 121, 0]); // Reset all controllers
      port.send([0xb0 | channel, 123, 0]); // All notes off
    }
  }

  dispose(): void {
    this.panic();
    this.ports = new Map();
  }
}

const clampLatency = (ms: number): number =>
  Number.isFinite(ms) ? Math.min(999, Math.max(0, Math.round(ms))) : 0;
