// The runtime glues the pure planner to real time: a Web Audio clock with a
// lookahead scheduler (the "Tale of Two Clocks" pattern) driving the output
// sinks. This is deliberately thin — all musical decisions live in planner.ts,
// which is fully unit-tested. Browser-only, so excluded from coverage.

import { planWindow, makeCursors, type VoiceCursor } from "./planner";
import { Rng } from "./rng";
import type { ProjectState } from "./types";
import type { OutputSink } from "./outputs/types";
import { SynthSink } from "./outputs/synth";
import { MidiSink } from "./outputs/webmidi";

const LOOKAHEAD_SEC = 0.12;
const TICK_MS = 25;

export class MRuntime {
  private getState: () => ProjectState;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private synth: SynthSink | null = null;
  private midi: MidiSink | null = null;
  private cursors: VoiceCursor[] = [];
  private rng = new Rng(1);
  private timer: ReturnType<typeof setInterval> | null = null;
  private synthEnabled = true;

  constructor(getState: () => ProjectState) {
    this.getState = getState;
  }

  /** Create audio graph lazily (must follow a user gesture). */
  private ensure(): AudioContext {
    if (!this.ctx) {
      const ctx = new AudioContext();
      const master = ctx.createGain();
      master.gain.value = 0.8;
      master.connect(ctx.destination);
      this.ctx = ctx;
      this.master = master;
      this.synth = new SynthSink(ctx, master);
      this.midi = new MidiSink(ctx);
    }
    return this.ctx;
  }

  private sinks(): OutputSink[] {
    const list: OutputSink[] = [];
    if (this.synthEnabled && this.synth) list.push(this.synth);
    if (this.midi && this.midi.hasOutput()) list.push(this.midi);
    return list;
  }

  get context(): AudioContext | null {
    return this.ctx;
  }

  get midiSink(): MidiSink | null {
    return this.midi;
  }

  /** Choose a MIDI output port (creates the audio graph if needed). */
  selectMidiOutput(output: MIDIOutput | null): void {
    this.ensure();
    this.midi!.setOutput(output);
  }

  setSynthEnabled(on: boolean): void {
    this.synthEnabled = on;
  }

  setMasterVolume(v: number): void {
    if (this.master) this.master.gain.value = v;
  }

  isRunning(): boolean {
    return this.timer !== null;
  }

  async start(): Promise<void> {
    const ctx = this.ensure();
    if (ctx.state === "suspended") await ctx.resume();
    const state = this.getState();
    this.rng = new Rng(state.seed);
    this.cursors = makeCursors(state, ctx.currentTime + 0.06);
    if (this.timer === null) {
      this.timer = setInterval(() => this.tick(), TICK_MS);
    }
  }

  /** Reset all voices to the top (M's Sync). */
  sync(): void {
    if (!this.ctx) return;
    const state = this.getState();
    this.rng = new Rng(state.seed);
    this.cursors = makeCursors(state, this.ctx.currentTime + 0.06);
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.synth?.panic();
    this.midi?.panic();
  }

  private tick(): void {
    if (!this.ctx) return;
    const state = this.getState();
    const now = this.ctx.currentTime;
    const windowEnd = now + LOOKAHEAD_SEC;
    const { notes, cursors } = planWindow(state, this.cursors, this.rng, now, windowEnd);
    this.cursors = cursors;
    const sinks = this.sinks();
    for (const n of notes) {
      for (const sink of sinks) sink.schedule(n);
    }
  }
}
