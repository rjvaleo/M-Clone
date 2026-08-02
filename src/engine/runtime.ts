// The runtime glues the pure planner to real time: a Web Audio clock with a
// lookahead scheduler (the "Tale of Two Clocks" pattern) driving the output
// sinks. This is deliberately thin — all musical decisions live in planner.ts,
// which is fully unit-tested. Platform seams are injected and adapter behavior
// is exercised with fake clocks, schedulers, contexts, and ports.

import { planWindow, makeCursors, type VoiceCursor } from "./planner";
import { Rng } from "./rng";
import type { ProjectState } from "./types";
import type { OutputSink } from "./outputs/types";
import { SynthSink } from "./outputs/synth";
import { MidiPortRegistry, MidiSink, type MidiChannelMode } from "./outputs/webmidi";
import { NoteLifecycle, type OutputDestination } from "./events";
import {
  browserScheduler,
  dropLateAttacks,
  type ClockDriver,
  SchedulingMonitor,
  type SchedulerDriver,
  type SchedulerHandle,
  type SchedulingDiagnostics,
} from "./scheduler";
import {
  rebaseChangedTimelines,
  timingFingerprints,
  type TimingFingerprint,
} from "./transport";
import {
  createDefaultSynthSettings,
  normalizeSynthSettings,
  type SynthSettings,
} from "./synth";
import { cyclicResetVoices } from "./cyclicreset";
import { clockPulseInterval, metronomeInterval } from "./clockoutput";

const LOOKAHEAD_SEC = 0.12;
const TICK_MS = 25;

export class MRuntime {
  private getState: () => ProjectState;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private synth: SynthSink | null = null;
  private midi: MidiSink | null = null;
  private midiRegistry: MidiPortRegistry | null = null;
  private cursors: VoiceCursor[] = [];
  private rngs: Rng[] = [];
  private lifecycle = new NoteLifecycle();
  private programs = "";
  private timer: SchedulerHandle | null = null;
  private auditionWakes = new Set<SchedulerHandle>();
  private pausedAt: number | null = null;
  private synthEnabled = true;
  private synthSettings = createDefaultSynthSettings();
  private timing: TimingFingerprint[] = [];
  private onPlannedNotes: ((notes: readonly import("./planner").PlannedNote[]) => void) | null;
  private scheduler: SchedulerDriver;
  private scheduling = new SchedulingMonitor();
  private expectedWakeSec = 0;
  private clock: ClockDriver | null;
  private suspended = false;
  private onCyclicReset: ((voices: readonly number[]) => void) | null;
  private onPlannedSteps: ((steps: readonly import("./planner").PlannedStep[]) => void) | null;
  private onMidiMessage: ((event: MIDIMessageEvent) => void) | null;
  private getPerformanceSettings: () => {
    useMetronome: boolean; sendClock: boolean; syncRatio: number; syncRatioDirection: "out" | "in";
  };
  private nextClockAt = 0;
  private nextMetronomeAt = 0;

  constructor(
    getState: () => ProjectState,
    onPlannedNotes: ((notes: readonly import("./planner").PlannedNote[]) => void) | null = null,
    options: {
      scheduler?: SchedulerDriver;
      clock?: ClockDriver;
      onCyclicReset?: (voices: readonly number[]) => void;
      onMidiMessage?: (event: MIDIMessageEvent) => void;
      onPlannedSteps?: (steps: readonly import("./planner").PlannedStep[]) => void;
      getPerformanceSettings?: () => {
        useMetronome: boolean; sendClock: boolean; syncRatio: number; syncRatioDirection: "out" | "in";
      };
    } = {},
  ) {
    this.getState = getState;
    this.onPlannedNotes = onPlannedNotes;
    this.scheduler = options.scheduler ?? browserScheduler;
    this.clock = options.clock ?? null;
    this.onCyclicReset = options.onCyclicReset ?? null;
    this.onMidiMessage = options.onMidiMessage ?? null;
    this.onPlannedSteps = options.onPlannedSteps ?? null;
    this.getPerformanceSettings = options.getPerformanceSettings ?? (() => ({
      useMetronome: false, sendClock: false, syncRatio: 4, syncRatioDirection: "out",
    }));
  }

  private nowSec(): number {
    return this.clock?.nowSec() ?? this.ctx?.currentTime ?? 0;
  }

  /** Create audio graph lazily (must follow a user gesture). */
  private ensure(): AudioContext {
    if (!this.ctx) {
      const ctx = new AudioContext();
      const master = ctx.createGain();
      master.gain.value = 1;
      master.connect(ctx.destination);
      this.ctx = ctx;
      this.master = master;
      this.synth = new SynthSink(ctx, master);
      this.synth.setSettings(this.synthSettings);
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

  private destinations(): OutputDestination[] {
    return this.sinks().map((sink) => sink.destination);
  }

  private resetRandom(seed: number, voices: number): void {
    this.rngs = Array.from({ length: voices }, (_, voice) =>
      new Rng((seed ^ Math.imul(voice + 1, 0x9e3779b1)) >>> 0));
  }

  private programKey(state: ProjectState): string {
    return state.voices.map((voice) => `${voice.program}:${voice.outputChannels.join(",")}`).join("|");
  }

  private enqueuePrograms(state: ProjectState, atSec: number): void {
    const key = this.programKey(state);
    if (key === this.programs || !this.midi?.hasOutput()) return;
    this.programs = key;
    this.lifecycle.addProgramChanges(atSec, this.cursors[0]?.transportTick ?? 0,
      state.voices.flatMap((voice, voiceIndex) =>
      voice.outputChannels.map((channel) => ({
        voice: voiceIndex, channel, program: voice.program,
      }))));
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
    this.programs = "";
  }

  selectMidiOutputs(outputs: ReadonlyMap<string, MIDIOutput>): void {
    this.ensure();
    this.midi!.setOutputs(outputs);
    this.programs = "";
  }

  midiPorts(): MidiPortRegistry {
    this.ensure();
    if (!this.midiRegistry) this.midiRegistry = new MidiPortRegistry(this.midi!, this.onMidiMessage);
    return this.midiRegistry;
  }

  sendMidiChannelMode(mode: MidiChannelMode, channels?: readonly number[]): void {
    this.ensure();
    this.midi!.sendChannelMode(mode, channels);
  }

  setMidiLatency(ms: number): void {
    this.ensure();
    this.midi!.setLatency(ms);
  }

  setMidiOutputAssignments(assignments: readonly { deviceId: string | null; channel: number }[]): void {
    this.ensure();
    this.midi!.setChannelAssignments(assignments);
  }

  setSynthEnabled(on: boolean): void {
    this.synthEnabled = on;
  }

  setSynthSettings(settings: readonly SynthSettings[]): void {
    this.synthSettings = settings.map(normalizeSynthSettings);
    this.synthEnabled = this.synthSettings.some((patch) => patch.enabled);
    this.synth?.setSettings(this.synthSettings);
  }

  setMasterVolume(v: number): void {
    if (this.master) this.master.gain.value = v;
  }

  isRunning(): boolean {
    return this.timer !== null;
  }

  /** Seconds since the current transport origin, for musical quantization. */
  transportElapsedSec(): number {
    const origin = this.cursors[0]?.originSec;
    return origin === undefined ? 0 : Math.max(0, this.nowSec() - origin);
  }

  schedulingDiagnostics(): SchedulingDiagnostics {
    return this.scheduling.snapshot();
  }

  /**
   * Play a one-shot chord straight to the sinks — what M calls Editor Sound:
   * clicking a Reference Keyboard key, adding a note to a step, or dragging the
   * MIDI Edit Counter. Bypasses the planner entirely; this is monitoring, not
   * musical output, so it never touches the cursors.
   */
  audition(
    pitches: number[],
    velocity: number,
    channels: number[],
    durationSec = 0.35,
    voice = 0,
  ): void {
    if (pitches.length === 0 || channels.length === 0) return;
    const ctx = this.ensure();
    if (ctx.state === "suspended") void ctx.resume();
    const startSec = this.nowSec() + 0.005;
    const notes = pitches.flatMap((note) => channels.map((channel) => ({
      voice, note, velocity, channel, startSec, durationSec,
      atTick: this.cursors[0]?.transportTick ?? 0,
      durationTicks: 0,
    })));
    this.lifecycle.ingest(notes, this.destinations());
    this.submitEvents(startSec + 0.01);
    const delay = Math.max(0, (durationSec - LOOKAHEAD_SEC) * 1000);
    let handle: SchedulerHandle;
    handle = this.scheduler.once(() => {
      this.auditionWakes.delete(handle);
      this.submitEvents(this.nowSec() + this.scheduling.snapshot().lookaheadSec);
    }, delay);
    this.auditionWakes.add(handle);
  }

  async start(): Promise<void> {
    if (this.timer !== null) return;
    const ctx = this.ensure();
    if (ctx.state === "suspended") await ctx.resume();
    const state = this.getState();
    this.resetRandom(state.seed, state.voices.length);
    this.lifecycle.reset();
    this.cursors = makeCursors(state, this.nowSec() + 0.06);
    this.timing = timingFingerprints(state);
    this.programs = "";
    this.enqueuePrograms(state, this.cursors[0]?.nextTimeSec ?? ctx.currentTime);
    this.pausedAt = null;
    this.nextClockAt = this.cursors[0]?.nextTimeSec ?? this.nowSec();
    this.nextMetronomeAt = this.nextClockAt;
    if (this.getPerformanceSettings().sendClock) this.midi?.sendRealtime(0xfa);
    if (this.timer === null) {
      this.expectedWakeSec = this.nowSec() + TICK_MS / 1000;
      this.timer = this.scheduler.repeat(() => this.tick(), TICK_MS);
    }
  }

  /** Pause scheduling without discarding the musical cursor. */
  pause(): void {
    if (this.timer === null || !this.ctx) return;
    this.scheduler.cancel(this.timer);
    this.timer = null;
    this.pausedAt = this.nowSec();
    this.synth?.panic();
    this.midi?.cancelScheduled();
    this.midi?.panic();
    this.lifecycle.reset();
  }

  /** Continue from the paused cursor instead of restarting at step one. */
  async resume(): Promise<void> {
    if (this.pausedAt === null) {
      await this.start();
      return;
    }
    const ctx = this.ensure();
    if (ctx.state === "suspended") await ctx.resume();
    const shift = this.nowSec() - this.pausedAt;
    this.cursors = this.cursors.map((cursor) => ({
      ...cursor,
      nextTimeSec: cursor.nextTimeSec + shift,
      originSec: cursor.originSec + shift,
    }));
    this.pausedAt = null;
    if (this.timer === null) {
      this.expectedWakeSec = this.nowSec() + TICK_MS / 1000;
      this.timer = this.scheduler.repeat(() => this.tick(), TICK_MS);
    }
  }

  /** Reset all voices to the top (M's Sync). */
  sync(): void {
    if (!this.ctx) return;
    this.synth?.cancelScheduled();
    this.midi?.cancelScheduled();
    this.midi?.panic();
    const state = this.getState();
    this.resetRandom(state.seed, state.voices.length);
    this.lifecycle.reset();
    this.cursors = makeCursors(state, this.nowSec() + 0.06);
    this.timing = timingFingerprints(state);
    this.programs = "";
    this.enqueuePrograms(state, this.cursors[0]?.nextTimeSec ?? this.ctx.currentTime);
  }

  stop(): void {
    if (this.timer !== null) {
      this.scheduler.cancel(this.timer);
      this.timer = null;
    }
    for (const handle of this.auditionWakes) this.scheduler.cancel(handle);
    this.auditionWakes.clear();
    this.synth?.cancelScheduled();
    this.midi?.cancelScheduled();
    this.midi?.panic();
    this.lifecycle.reset();
    this.pausedAt = null;
    if (this.getPerformanceSettings().sendClock) this.midi?.sendRealtime(0xfc);
  }

  private tick(): void {
    if (!this.ctx) return;
    const now = this.nowSec();
    if (this.ctx.state !== "running") {
      if (!this.suspended) {
        this.synth?.cancelScheduled();
        this.midi?.cancelScheduled();
        this.midi?.panic();
        this.lifecycle.reset();
        this.suspended = true;
      }
      this.expectedWakeSec = now + TICK_MS / 1000;
      return;
    }
    if (this.suspended) {
      this.recoverFromStall(now);
      this.scheduling.recordRecovery();
      this.suspended = false;
      this.expectedWakeSec = now;
    }
    const decision = this.scheduling.observeWake(
      now,
      this.expectedWakeSec,
      this.lifecycle.pendingCount(),
    );
    this.expectedWakeSec = now + TICK_MS / 1000;
    if (decision.recover) this.recoverFromStall(now);
    const state = this.getState();
    const timing = timingFingerprints(state);
    this.cursors = rebaseChangedTimelines(this.cursors, this.timing, timing);
    this.timing = timing;
    const windowEnd = now + decision.lookaheadSec;
    this.scheduleClockOutputs(state.tempo, windowEnd);
    this.enqueuePrograms(state, this.cursors[0]?.nextTimeSec ?? now);
    const previousCyclic = this.cursors.map((cursor) => cursor.cyclicPos);
    const { notes, cursors, steps } = planWindow(state, this.cursors, this.rngs, now, windowEnd);
    const resets = cyclicResetVoices(
      previousCyclic,
      cursors.map((cursor) => cursor.cyclicPos),
      state.cyclicLengths.rhythm,
    );
    this.cursors = cursors;
    this.lifecycle.ingest(notes, this.destinations());
    this.submitEvents(windowEnd);
    // UI recording is intentionally after time-critical output submission.
    if (notes.length > 0) this.onPlannedNotes?.(notes);
    if (steps.length > 0) this.onPlannedSteps?.(steps);
    if (resets.length > 0) this.onCyclicReset?.(resets);
  }

  private scheduleClockOutputs(tempo: number, windowEnd: number): void {
    const settings = this.getPerformanceSettings();
    if (settings.syncRatioDirection !== "out") return;
    if (settings.sendClock) {
      const interval = clockPulseInterval(tempo, settings.syncRatio);
      while (this.nextClockAt < windowEnd) {
        if (this.nextClockAt >= this.nowSec()) this.midi?.sendRealtime(0xf8, this.nextClockAt);
        this.nextClockAt += interval;
      }
    } else this.nextClockAt = windowEnd;
    if (settings.useMetronome) {
      const interval = metronomeInterval(tempo, settings.syncRatio);
      while (this.nextMetronomeAt < windowEnd) {
        if (this.nextMetronomeAt >= this.nowSec()) this.synth?.metronome(this.nextMetronomeAt);
        this.nextMetronomeAt += interval;
      }
    } else this.nextMetronomeAt = windowEnd;
  }

  private submitEvents(windowEnd: number): void {
    const events = this.lifecycle.drainBefore(windowEnd);
    if (events.length === 0) return;
    const now = this.nowSec();
    const filtered = dropLateAttacks(events, now, 0.02);
    this.scheduling.recordDroppedEvents(filtered.dropped);
    this.scheduling.observeBatch(filtered.events, now);
    for (const sink of this.sinks()) sink.scheduleBatch(filtered.events);
  }

  private recoverFromStall(now: number): void {
    this.synth?.cancelScheduled();
    this.midi?.cancelScheduled();
    this.midi?.panic();
    this.lifecycle.reset();
    const boundary = now + 0.06;
    this.cursors = this.cursors.map((cursor) => {
      const shift = Math.max(0, boundary - cursor.nextTimeSec);
      return {
        ...cursor,
        nextTimeSec: cursor.nextTimeSec + shift,
        originSec: cursor.originSec + shift,
      };
    });
    this.programs = "";
  }
}
