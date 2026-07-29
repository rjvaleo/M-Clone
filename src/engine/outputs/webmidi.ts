// Web MIDI output sink — routes M-Clone's generated notes to real MIDI devices
// or virtual ports (a DAW, a hardware synth, plugins hosted elsewhere).

import type { OutputSink, ScheduledNote } from "./types";

export class MidiSink implements OutputSink {
  private ctx: AudioContext;
  private output: MIDIOutput | null = null;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
  }

  setOutput(output: MIDIOutput | null): void {
    this.panic();
    this.output = output;
  }

  hasOutput(): boolean {
    return this.output !== null;
  }

  /** Convert an AudioContext timestamp to the performance.now() domain that
   *  MIDIOutput.send() expects. */
  private toPerf(sec: number): number {
    return performance.now() + (sec - this.ctx.currentTime) * 1000;
  }

  schedule(n: ScheduledNote): void {
    if (!this.output) return;
    const ch = (n.channel - 1) & 0x0f;
    const onAt = this.toPerf(n.startSec);
    const offAt = this.toPerf(n.startSec + n.durationSec);
    this.output.send([0x90 | ch, n.note & 0x7f, n.velocity & 0x7f], onAt);
    this.output.send([0x80 | ch, n.note & 0x7f, 0], offAt);
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
