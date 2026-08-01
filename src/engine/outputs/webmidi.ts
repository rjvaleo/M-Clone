// Web MIDI output sink — routes M-Clone's generated notes to real MIDI devices
// or virtual ports (a DAW, a hardware synth, plugins hosted elsewhere).

import type { EngineEvent } from "../events";
import type { OutputSink } from "./types";

export class MidiSink implements OutputSink {
  readonly destination = "midi" as const;
  private ctx: AudioContext;
  private outputs = new Map<string, MIDIOutput>();

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
  }

  setOutput(output: MIDIOutput | null): void {
    this.setOutputs(output ? new Map([[output.id || "default", output]]) : new Map());
  }

  /** Reconcile ports without disturbing destinations that remain connected. */
  setOutputs(outputs: ReadonlyMap<string, MIDIOutput>): void {
    for (const [id, oldOutput] of this.outputs) {
      if (outputs.get(id) === oldOutput) continue;
      this.cancelPort(oldOutput);
      this.panicPort(oldOutput);
    }
    this.outputs = new Map(outputs);
  }

  outputIds(): string[] {
    return [...this.outputs.keys()].sort();
  }

  hasOutput(): boolean {
    return this.outputs.size > 0;
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
    if (this.outputs.size === 0) return;
    const anchor = this.clockAnchor();
    const toPerf = (sec: number) =>
      anchor.performanceMs + (sec - anchor.contextSec) * 1000;
    for (const output of this.outputs.values()) {
      for (const event of events) {
        if (event.destination !== this.destination) continue;
        const ch = Math.min(16, Math.max(1, Math.trunc(event.channel))) - 1;
        const at = toPerf(event.atSec);
        if (event.type === "note-on") {
          output.send([0x90 | ch, event.note & 0x7f, event.velocity & 0x7f], at);
        } else if (event.type === "note-off") {
          output.send([0x80 | ch, event.note & 0x7f, event.velocity & 0x7f], at);
        } else {
          output.send([0xc0 | ch, event.program & 0x7f], at);
        }
      }
    }
  }

  cancelScheduled(): void {
    for (const output of this.outputs.values()) this.cancelPort(output);
  }

  private cancelPort(output: MIDIOutput): void {
    // clear() is in the Web MIDI specification but is missing from some
    // TypeScript DOM library versions.
    (output as MIDIOutput & { clear?: () => void }).clear?.();
  }

  panic(): void {
    for (const output of this.outputs.values()) this.panicPort(output);
  }

  private panicPort(output: MIDIOutput): void {
    for (let ch = 0; ch < 16; ch++) {
      output.send([0xb0 | ch, 64, 0]); // Sustain Off
      output.send([0xb0 | ch, 121, 0]); // Reset All Controllers
      output.send([0xb0 | ch, 123, 0]); // All Notes Off
    }
  }
}

type AccessRequest = () => Promise<MIDIAccess>;

/** Retains MIDIAccess and selected physical IDs across loss/reconnect. */
export class MidiPortRegistry {
  private sink: MidiSink;
  private access: MIDIAccess | null = null;
  private selected = new Set<string>();
  private listeners = new Set<(outputs: MIDIOutput[]) => void>();
  private onStateChange = () => this.reconcile();

  constructor(sink: MidiSink) {
    this.sink = sink;
  }

  async enable(request: AccessRequest = requestMidiAccess): Promise<MIDIOutput[]> {
    if (!this.access) {
      this.access = await request();
      this.access.addEventListener("statechange", this.onStateChange);
    }
    this.reconcile();
    return this.available();
  }

  available(): MIDIOutput[] {
    return this.access ? Array.from(this.access.outputs.values()) : [];
  }

  select(ids: readonly string[]): void {
    this.selected = new Set(ids);
    this.reconcile();
  }

  selectedIds(): string[] {
    return [...this.selected];
  }

  subscribe(listener: (outputs: MIDIOutput[]) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private reconcile(): void {
    const connected = new Map<string, MIDIOutput>();
    if (this.access) {
      for (const id of this.selected) {
        const output = this.access.outputs.get(id);
        if (output && output.state !== "disconnected") connected.set(id, output);
      }
    }
    this.sink.setOutputs(connected);
    const outputs = this.available();
    for (const listener of this.listeners) listener(outputs);
  }

  dispose(): void {
    this.access?.removeEventListener("statechange", this.onStateChange);
    this.listeners.clear();
  }
}

let retainedAccess: MIDIAccess | null = null;

async function requestMidiAccess(): Promise<MIDIAccess> {
  if (retainedAccess) return retainedAccess;
  if (typeof navigator === "undefined" || !navigator.requestMIDIAccess) {
    throw new Error("Web MIDI is unavailable");
  }
  retainedAccess = await navigator.requestMIDIAccess({ sysex: false });
  return retainedAccess;
}

/** List available MIDI output ports (empty if Web MIDI is unavailable/denied). */
export async function listMidiOutputs(): Promise<MIDIOutput[]> {
  try {
    return Array.from((await requestMidiAccess()).outputs.values());
  } catch {
    return [];
  }
}
