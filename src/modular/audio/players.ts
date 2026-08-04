// The three sample players: Percussion, Looper, Granular.
//
// These are the first modules that *make* sound rather than shape it, and the
// first that both live in the audio plan and listen to the event runtime. That
// dual nature is the whole design problem, and it is resolved by keeping the
// two halves apart: a player is an ordinary `ManagedAudioNode` — built, faded,
// rebuilt and disposed by `AudioGraphAdapter` like any effect — that also
// implements `NotePlayer`, which is the only surface the note adapter touches.
//
// ## What changed on the way over from the AV prototype
//
// The signal designs are the prototype's and they were good: choke groups on
// percussion, a grain window that rises over its first fifth and releases
// exponentially, a stretch factor that decouples scan speed from grain rate.
// Three things about how they were *driven* did not come across.
//
// **Nothing reaches through a global.** The prototype's percussion engine
// choked by walking `window.AudioManager.columns`; here a choke group is a
// number inside one module, so it is a local fact rather than an action at a
// distance across the app.
//
// **Nothing schedules audio on a main-thread timer.** Grains are placed ahead
// on the audio clock by `GrainScheduler`; the timer only decides how often to
// think. A busy page changes nothing audible.
//
// **Nothing is triggered by a built-in sequencer.** The prototype's percussion
// engine owned a 16-step grid. In a node graph that is somebody else's job —
// the cyclic modules, Note Order, the whole event side — so a player here is
// driven by note events and maps note numbers to slots.

import { rampParam, type AudioParamLike } from "./params";
import type { AudioNodeLike, ManagedAudioNode } from "./graphAdapter";
import type { AudioNodeSpec } from "./audioPlan";
import type { AudioBufferLike, GainNodeLike, SampleContext } from "./nodes";
import { VoiceBank } from "./voices";
import { GRAIN_WAKE_MS, GrainScheduler, type GrainSettings } from "./grains";
import type { SmoothingLookup } from "./effects";

/** Everything a player needs that is not a Web Audio node. */
export type PlayerRuntime = {
  /** The sound pool, as a lookup. */
  samples: (assetId: string) => AudioBufferLike | undefined;
  /** A repeating wake, returning its own cancel. Injected so tests need no timers. */
  schedule?: (intervalMs: number, task: () => void) => () => void;
  random?: () => number;
};

/** The surface the note adapter uses. Deliberately tiny. */
export interface NotePlayer {
  readonly nodeId: string;
  noteOn(note: number, velocity: number, atSec: number): void;
  noteOff(note: number, atSec: number): void;
  /** Silence everything sounding, without a click. */
  silence(atSec: number): void;
}

export const isNotePlayer = (node: unknown): node is NotePlayer =>
  typeof node === "object" && node !== null
  && typeof (node as NotePlayer).noteOn === "function"
  && typeof (node as NotePlayer).noteOff === "function";

const numberOr = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const stringOr = (value: unknown, fallback: string): string =>
  typeof value === "string" ? value : fallback;

/** Booleans arrive from the compiler as 0 or 1, because parameters are numbers. */
const isOn = (value: number | undefined): boolean => (value ?? 0) >= 0.5;

/** Velocity as a gain. Squared, because loudness is not linear in velocity. */
const velocityGain = (velocity: number): number => {
  const unit = Math.min(1, Math.max(0, velocity / 127));
  return unit * unit;
};

const semitonesToRate = (semitones: number): number => Math.pow(2, semitones / 12);

/**
 * What every player shares: an output gain that is also the crossfade handle.
 *
 * The `input` is real but unconnected — players have no audio input, and their
 * descriptors declare none, so nothing can patch into it. It exists because
 * `ManagedAudioNode` is one shape for everything the adapter manages, and a
 * uniform shape is what lets the adapter fade a player in and out without
 * knowing it is a player.
 */
abstract class PlayerModule implements ManagedAudioNode, NotePlayer {
  readonly nodeId: string;
  protected readonly context: SampleContext;
  protected readonly runtime: PlayerRuntime;
  protected readonly bank: VoiceBank;
  protected readonly parameters: Record<string, number>;
  protected readonly structure: Readonly<Record<string, unknown>>;
  private readonly inputGain: GainNodeLike;
  private readonly outputGain: GainNodeLike;
  private readonly smoothing: SmoothingLookup;
  private disposed = false;

  constructor(
    context: SampleContext,
    spec: AudioNodeSpec,
    atSec: number,
    runtime: PlayerRuntime,
    smoothing: SmoothingLookup,
  ) {
    this.nodeId = spec.nodeId;
    this.context = context;
    this.runtime = runtime;
    this.smoothing = smoothing;
    this.structure = spec.structure;
    this.parameters = { ...spec.parameters };

    this.inputGain = context.createGain();
    this.outputGain = context.createGain();
    // Silent until the adapter fades it up, exactly like an effect.
    rampParam(this.outputGain.gain, 0, atSec, "none");
    this.bank = new VoiceBank(context, this.outputGain);
  }

  get input(): AudioNodeLike {
    return this.inputGain;
  }

  get output(): AudioNodeLike {
    return this.outputGain;
  }

  get level(): AudioParamLike {
    return this.outputGain.gain;
  }

  /** Voices sounding right now, for the node face. */
  get activeVoices(): number {
    return this.bank.activeCount;
  }

  setParameter(parameterId: string, value: number, atSec: number): void {
    this.parameters[parameterId] = value;
    this.onParameter(parameterId, value, atSec);
  }

  /** Bypass is the adapter's level mute; a player adds nothing to it. */
  setBypass(): void {
    /* see EffectModule.setBypass — the adapter owns this */
  }

  setWet(): void {
    /* players are sources: there is no dry path to balance against */
  }

  silence(atSec: number): void {
    this.bank.panic(atSec);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.onDispose();
    this.bank.dispose();
    this.inputGain.disconnect();
    this.outputGain.disconnect();
  }

  abstract noteOn(note: number, velocity: number, atSec: number): void;

  noteOff(_note: number, _atSec: number): void {
    /* one-shot players ignore releases; gated ones override */
  }

  protected param(id: string, fallback: number): number {
    return numberOr(this.parameters[id], fallback);
  }

  /** Ramp a real `AudioParam` per the registry's declared policy. */
  protected ramp(target: AudioParamLike, id: string, value: number, atSec: number): void {
    rampParam(target, value, atSec, this.smoothing(id));
  }

  protected onParameter(_id: string, _value: number, _atSec: number): void {}

  protected onDispose(): void {}
}

// ---- Percussion -------------------------------------------------------------

export type PercussionSlot = {
  /** MIDI note that fires this slot. */
  note: number;
  /** Empty means the slot is unassigned and silent. */
  assetId: string;
  /** Slots sharing a non-zero group silence each other — the hihat rule. */
  chokeGroup: number;
  /** Per-slot trim, so a loud snare can be balanced without editing the file. */
  gain: number;
};

export const readPercussionSlots = (value: unknown): PercussionSlot[] => {
  if (!Array.isArray(value)) return [];
  return value.map((raw) => {
    const slot = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
    return {
      note: Math.trunc(numberOr(slot.note, 36)),
      assetId: stringOr(slot.assetId, ""),
      chokeGroup: Math.trunc(numberOr(slot.chokeGroup, 0)),
      gain: numberOr(slot.gain, 1),
    };
  });
};

class PercussionPlayer extends PlayerModule {
  private slots: PercussionSlot[];

  constructor(...args: ConstructorParameters<typeof PlayerModule>) {
    super(...args);
    this.slots = readPercussionSlots(this.structure.slots);
  }

  /**
   * Fire every slot mapped to this note.
   *
   * Every, not the first: two slots on one note is a legitimate layer — a kick
   * and a click, say — and silently playing only one would be a rule nobody
   * asked for.
   */
  noteOn(note: number, velocity: number, atSec: number): void {
    const pitch = semitonesToRate(this.param("pitch-semitones", 0));
    const decay = this.param("decay-seconds", 0.5);
    const level = this.param("level", 0.8);
    for (const slot of this.slots) {
      if (slot.note !== note || slot.assetId === "") continue;
      this.bank.play(this.runtime.samples(slot.assetId), {
        atSec,
        level: level * slot.gain * velocityGain(velocity),
        playbackRate: pitch,
        decaySec: Math.max(0.02, decay),
        chokeGroup: slot.chokeGroup,
      });
    }
  }
}

// ---- Looper -----------------------------------------------------------------

class LooperPlayer extends PlayerModule {
  private stretch: GrainScheduler | null = null;
  private cancelWake: (() => void) | null = null;

  /**
   * Start the loop, replacing whatever was playing.
   *
   * Two quite different engines behind one control. Plain playback changes
   * pitch with rate, the way a tape does. Time-stretch re-emits overlapping
   * grains at a fixed pitch while the scan moves at the rate — so speed and
   * pitch become separate, which is the reason the mode exists.
   */
  noteOn(_note: number, velocity: number, atSec: number): void {
    const buffer = this.buffer();
    if (!buffer) return;
    this.stopEverything(atSec);

    if (isOn(this.parameters["time-stretch"])) {
      this.startStretch(atSec, velocity);
      return;
    }
    const seconds = bufferSeconds(buffer);
    const startUnit = Math.min(this.param("loop-start", 0), this.param("loop-end", 1));
    const endUnit = Math.max(this.param("loop-start", 0), this.param("loop-end", 1));
    const reverse = isOn(this.parameters.reverse) ? -1 : 1;
    this.bank.play(buffer, {
      atSec,
      level: this.param("level", 0.8) * velocityGain(velocity),
      playbackRate: this.param("rate", 1) * reverse,
      offsetSec: startUnit * seconds,
      loop: isOn(this.parameters.loop),
      loopStartSec: startUnit * seconds,
      loopEndSec: endUnit * seconds,
    });
  }

  noteOff(_note: number, atSec: number): void {
    // Held rather than gated by default: a loop that stops when the triggering
    // note ends is a one-shot, and the module would not be a looper.
    if (isOn(this.parameters.gate)) this.stopEverything(atSec);
  }

  private startStretch(atSec: number, velocity: number): void {
    const level = this.param("level", 0.8) * velocityGain(velocity);
    const scheduler = new GrainScheduler((grain) => {
      const buffer = this.buffer();
      if (!buffer) return;
      const seconds = bufferSeconds(buffer);
      const startUnit = Math.min(this.param("loop-start", 0), this.param("loop-end", 1));
      const endUnit = Math.max(this.param("loop-start", 0), this.param("loop-end", 1));
      // Grains read from inside the loop region, so shortening the region
      // shortens what is heard rather than scanning silently past it.
      const span = Math.max(0.01, (endUnit - startUnit) * seconds);
      this.bank.play(buffer, {
        atSec: grain.atSec,
        level,
        // Pitch is the *only* thing the shift control moves: the scan rate is
        // handled by the scheduler, which is what decouples the two.
        playbackRate: semitonesToRate(this.param("pitch-shift", 0)),
        offsetSec: startUnit * seconds + (grain.offsetSec % span),
        durationSec: grain.durationSec,
        attackSec: grain.durationSec * 0.2,
        holdSec: grain.durationSec * 0.8,
        decaySec: grain.durationSec * 0.2,
      });
    }, this.runtime.random);
    scheduler.start(atSec, this.param("loop-start", 0));
    this.stretch = scheduler;
    this.cancelWake = (this.runtime.schedule ?? intervalSchedule)(GRAIN_WAKE_MS, () => {
      const buffer = this.buffer();
      if (!buffer || !this.stretch) return;
      this.stretch.advance(this.context.currentTime, bufferSeconds(buffer), {
        sizeSec: 0.15,
        spacingSec: 0.08,
        position: this.stretch.position,
        jitter: 0,
        stretch: 1 / Math.max(0.01, this.param("rate", 1)),
        freeze: false,
      });
    });
  }

  private stopEverything(atSec: number): void {
    this.stretch?.stop();
    this.stretch = null;
    this.cancelWake?.();
    this.cancelWake = null;
    this.bank.panic(atSec);
  }

  private buffer(): AudioBufferLike | undefined {
    return this.runtime.samples(stringOr(this.structure["asset-id"], ""));
  }

  protected onDispose(): void {
    this.stretch?.stop();
    this.cancelWake?.();
    this.cancelWake = null;
  }
}

// ---- Granular ---------------------------------------------------------------

class GranularPlayer extends PlayerModule {
  private readonly scheduler: GrainScheduler;
  private cancelWake: (() => void) | null = null;
  private grainLevel = 0.8;

  constructor(...args: ConstructorParameters<typeof PlayerModule>) {
    super(...args);
    this.scheduler = new GrainScheduler((grain) => {
      this.bank.play(this.buffer(), {
        atSec: grain.atSec,
        level: this.grainLevel,
        offsetSec: grain.offsetSec,
        durationSec: grain.durationSec,
        // The prototype's window, which is the part worth keeping: rise over
        // the first fifth, hold, then release. The flat middle is what stops
        // overlapping grains beating against each other.
        attackSec: grain.durationSec * 0.2,
        holdSec: grain.durationSec * 0.8,
        decaySec: grain.durationSec * 0.2,
      });
    }, this.runtime.random);
    if (isOn(this.parameters["free-run"])) this.startCloud(this.context.currentTime, 100);
  }

  get isRunning(): boolean {
    return this.scheduler.isRunning;
  }

  get scanPosition(): number {
    return this.scheduler.position;
  }

  noteOn(_note: number, velocity: number, atSec: number): void {
    this.startCloud(atSec, velocity);
  }

  noteOff(_note: number, atSec: number): void {
    if (isOn(this.parameters["free-run"])) return;
    this.stopCloud();
    this.bank.panic(atSec);
  }

  protected onParameter(id: string, value: number, _atSec: number): void {
    // Dragging the position control moves the scan immediately rather than
    // waiting for it to arrive there, which is what makes it feel like a handle
    // on the sample instead of a target the cloud drifts toward.
    if (id === "position") this.scheduler.seek(value);
    if (id === "free-run") {
      if (isOn(value)) this.startCloud(this.context.currentTime, 100);
      else this.stopCloud();
    }
  }

  private startCloud(atSec: number, velocity: number): void {
    this.grainLevel = this.param("level", 0.8) * velocityGain(velocity);
    if (this.scheduler.isRunning) return;
    this.scheduler.start(atSec, this.param("position", 0.5));
    this.cancelWake = (this.runtime.schedule ?? intervalSchedule)(GRAIN_WAKE_MS, () => {
      const buffer = this.buffer();
      if (!buffer) return;
      this.scheduler.advance(this.context.currentTime, bufferSeconds(buffer), this.settings());
    });
  }

  private stopCloud(): void {
    this.scheduler.stop();
    this.cancelWake?.();
    this.cancelWake = null;
  }

  private settings(): GrainSettings {
    return {
      sizeSec: this.param("grain-size", 0.2),
      spacingSec: this.param("grain-spacing", 0.08),
      position: this.scheduler.position,
      jitter: this.param("jitter", 0.1),
      stretch: this.param("stretch", 1),
      freeze: isOn(this.parameters.freeze),
    };
  }

  private buffer(): AudioBufferLike | undefined {
    return this.runtime.samples(stringOr(this.structure["asset-id"], ""));
  }

  protected onDispose(): void {
    this.stopCloud();
  }
}

// ---- construction -----------------------------------------------------------

const bufferSeconds = (buffer: AudioBufferLike): number =>
  buffer.length / Math.max(1, buffer.sampleRate);

/** The browser wake. Approximate by nature, which is why grains are placed ahead. */
const intervalSchedule = (intervalMs: number, task: () => void): (() => void) => {
  const handle = setInterval(task, intervalMs);
  return () => clearInterval(handle);
};

type PlayerConstructor = new (
  context: SampleContext,
  spec: AudioNodeSpec,
  atSec: number,
  runtime: PlayerRuntime,
  smoothing: SmoothingLookup,
) => PlayerModule;

export const PLAYER_BUILDERS: Readonly<Record<string, PlayerConstructor>> = {
  "m.percussion": PercussionPlayer,
  "m.looper": LooperPlayer,
  "m.granular": GranularPlayer,
};

export const isPlayerModule = (moduleType: string): boolean => moduleType in PLAYER_BUILDERS;

export function createPlayer(
  context: SampleContext,
  spec: AudioNodeSpec,
  atSec: number,
  runtime: PlayerRuntime,
  smoothing: SmoothingLookup,
): ManagedAudioNode & NotePlayer {
  const Player = PLAYER_BUILDERS[spec.moduleType];
  if (!Player) throw new Error(`No player for module type: ${spec.moduleType}`);
  return new Player(context, spec, atSec, runtime, smoothing);
}
