// Web MIDI output sink — routes M-Clone's generated notes to real MIDI devices
// or virtual ports (a DAW, a hardware synth, plugins hosted elsewhere).

import type { EngineEvent } from "../events";
import type { OutputSink } from "./types";

export class MidiSink implements OutputSink {
  readonly destination = "midi" as const;
  private ctx: AudioContext;
  private output: MIDIOutput | null = null;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
  }

  setOutput(output: MIDIOutput | null): void {
    this.cancelScheduled();
    this.panic();
    this.output = output;
  }

  hasOutput(): boolean {
    return this.output !== null;
  }

  /** Convert an AudioContext timestamp to the performance.now() domain that
   *  MIDIOutput.send() expects. */
  private clockAnchor(): { contextSec: number; performanceMs: number } {
    const stamp = this.ctx.getOutputTimestamp?.();
    if (stamp
      && typeof stamp.contextTime === "number"
      && typeof stamp.performanceTime === "number"
      && Number.isFinite(stamp.contextTime)
      && Number.isFinite(stamp.performanceTime)) {
      return { contextSec: stamp.contextTime, performanceMs: stamp.performanceTime };
    }
    return { contextSec: this.ctx.currentTime, performanceMs: performance.now() };
  }

  scheduleBatch(events: readonly EngineEvent[]): void {
    if (!this.output) return;
    const anchor = this.clockAnchor();
    const toPerf = (sec: number) =>
      anchor.performanceMs + (sec - anchor.contextSec) * 1000;
    for (const event of events) {
      if (event.destination !== this.destination) continue;
      const ch = Math.min(16, Math.max(1, Math.trunc(event.channel))) - 1;
      const at = toPerf(event.atSec);
      if (event.type === "note-on") {
        this.output.send([0x90 | ch, event.note & 0x7f, event.velocity & 0x7f], at);
      } else if (event.type === "note-off") {
        this.output.send([0x80 | ch, event.note & 0x7f, event.velocity & 0x7f], at);
      } else {
        this.output.send([0xc0 | ch, event.program & 0x7f], at);
      }
    }
  }

  cancelScheduled(): void {
    // clear() is in the Web MIDI specification but is missing from some
    // TypeScript DOM library versions.
    (this.output as (MIDIOutput & { clear?: () => void }) | null)?.clear?.();
  }

  panic(): void {
    if (!this.output) return;
    for (let ch = 0; ch < 16; ch++) {
      this.output.send([0xb0 | ch, 123, 0]); // All Notes Off
    }
  }
}

/** List available MIDI output ports (empty if Web MIDI is unavailable/denied). */
export async function listMidiOutputs(): Promise<MIDIOutput[]> {
  if (typeof navigator === "undefined" || !navigator.requestMIDIAccess) return [];
  const access = await navigator.requestMIDIAccess({ sysex: false });
  return Array.from(access.outputs.values());
}
