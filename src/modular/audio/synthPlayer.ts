/**
 * The synth module: a `ManagedAudioNode` the graph adapter wires like an effect,
 * and a `NotePlayer` the note adapter drives like a sampler.
 *
 * The voice does the sound (`synthVoice.ts`) and the matrix does the routing
 * (`modMatrix.ts`); this is the part that makes them a module — reading a
 * document's flat parameters into a patch, handing each note its own modulation
 * sources, and holding the bank of voices.
 *
 * ## Why the parameters are flat
 *
 * A face edits one control at a time and a preset slot captures one value at a
 * time, so `osc1-detune` is a number rather than a path into a nested object.
 * The nesting happens here, in `readSynthSettings`, which is also the one place
 * that has to be forgiving: a document may name a wave this build does not have,
 * or carry a value that is not a number, and the right answer to both is the
 * default rather than a patch that will not open.
 */

import type { AudioNodeSpec } from "./audioPlan";
import type { AudioNodeLike, ManagedAudioNode } from "./graphAdapter";
import type { GainNodeLike, SynthContext } from "./nodes";
import type { AudioParamLike } from "./params";
import { rampParam } from "./params";
import type { SmoothingLookup } from "./effects";
import type { NotePlayer, PlayerRuntime } from "./players";
import {
  defaultSynthSettings,
  modulateSettings,
  SynthVoiceBank,
  type OscillatorSettings,
  type SynthSettings,
  type SynthWave,
} from "./synthVoice";
import { readMatrix, type ModMatrix, type ModSourceValues } from "./modMatrix";

const WAVES: readonly SynthWave[] = ["sine", "square", "sawtooth", "triangle", "pulse"];

const numberOr = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const waveOr = (value: unknown, fallback: SynthWave): SynthWave =>
  WAVES.includes(value as SynthWave) ? (value as SynthWave) : fallback;

/** Milliseconds on the face, seconds on the clock. */
const msToSec = (value: unknown, fallbackSec: number): number =>
  typeof value === "number" && Number.isFinite(value) ? value / 1000 : fallbackSec;

/** A patch, plus the matrix that will bend it per note. */
export type SynthPatch = SynthSettings & { matrix: ModMatrix };

/**
 * Assemble a patch from what the document holds.
 *
 * `parameters` are the flat numbers a face edits; `structure` carries the
 * matrix, which is a list rather than a number and so rebuilds the module when
 * it changes rather than ramping.
 */
export function readSynthSettings(
  parameters: Readonly<Record<string, unknown>>,
  structure: Readonly<Record<string, unknown>>,
): SynthPatch {
  const base = defaultSynthSettings();
  const oscillator = (index: 0 | 1 | 2) => {
    const prefix = `osc${index + 1}`;
    const fallback = base.oscillators[index];
    return {
      wave: waveOr(parameters[`${prefix}-wave`], fallback.wave),
      detuneCents: numberOr(parameters[`${prefix}-detune`], fallback.detuneCents),
      level: numberOr(parameters[`${prefix}-level`], fallback.level),
      pulseWidth: numberOr(parameters[`${prefix}-width`], fallback.pulseWidth),
    };
  };

  return {
    oscillators: [oscillator(0), oscillator(1), oscillator(2)],
    amp: {
      attack: msToSec(parameters["amp-attack"], base.amp.attack),
      decay: msToSec(parameters["amp-decay"], base.amp.decay),
      sustain: numberOr(parameters["amp-sustain"], base.amp.sustain),
      release: msToSec(parameters["amp-release"], base.amp.release),
    },
    filter: {
      cutoffHz: numberOr(parameters.cutoff, base.filter.cutoffHz),
      resonance: numberOr(parameters.resonance, base.filter.resonance),
      keyFollow: numberOr(parameters["key-follow"], base.filter.keyFollow),
      envAmountOctaves: numberOr(parameters["filter-amount"], base.filter.envAmountOctaves),
      adsr: {
        attack: msToSec(parameters["filter-attack"], base.filter.adsr.attack),
        decay: msToSec(parameters["filter-decay"], base.filter.adsr.decay),
        sustain: numberOr(parameters["filter-sustain"], base.filter.adsr.sustain),
        release: msToSec(parameters["filter-release"], base.filter.adsr.release),
      },
    },
    level: numberOr(parameters.level, base.level),
    pan: numberOr(parameters.pan, base.pan),
    matrix: readMatrix.fromJson(structure.matrix),
  };
}

/** Default polyphony: enough for both hands, bounded so a stuck patch degrades. */
const DEFAULT_MAX_VOICES = 16;

export class SynthPlayer implements ManagedAudioNode, NotePlayer {
  readonly nodeId: string;
  private readonly inputGain: GainNodeLike;
  private readonly outputGain: GainNodeLike;
  private readonly bank: SynthVoiceBank;
  private readonly random: () => number;
  private parameters: Record<string, unknown>;
  private readonly structure: Readonly<Record<string, unknown>>;
  private patch: SynthPatch;
  private disposed = false;

  constructor(
    context: SynthContext,
    spec: AudioNodeSpec,
    atSec: number,
    runtime: PlayerRuntime,
    // Accepted so every module is built the same way. A synth's own moves are
    // envelopes on the audio clock rather than parameter smoothing.
    _smoothing: SmoothingLookup,
  ) {
    this.nodeId = spec.nodeId;
    this.parameters = { ...spec.parameters };
    this.structure = spec.structure;
    this.random = runtime.random ?? Math.random;

    this.inputGain = context.createGain();
    this.outputGain = context.createGain();
    // Silent until the adapter fades it up, exactly like an effect.
    rampParam(this.outputGain.gain, 0, atSec, "none");

    this.patch = readSynthSettings(this.parameters, this.structure);
    this.bank = new SynthVoiceBank(
      context,
      this.outputGain,
      numberOr(this.parameters["max-voices"], DEFAULT_MAX_VOICES),
    );
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

  /**
   * Take a live edit.
   *
   * It changes the patch the *next* note is built from and leaves sounding
   * notes alone — which is the whole reason the filter lives in the voice.
   */
  setParameter(parameterId: string, value: number, _atSec: number): void {
    this.parameters = { ...this.parameters, [parameterId]: value };
    this.patch = readSynthSettings(this.parameters, this.structure);
  }

  /** Bypass is the adapter's level mute; a synth adds nothing to it. */
  setBypass(_bypass: boolean, _atSec: number): void {
    /* see EffectModule.setBypass — the adapter owns this */
  }

  setWet(_wet: number, _atSec: number): void {
    /* a synth is a source: there is no dry path to balance against */
  }

  noteOn(note: number, velocity: number, atSec: number, detuneCents = 0): void {
    if (this.disposed) return;
    this.bank.noteOn(this.settingsFor(note, velocity, detuneCents), note, velocity, atSec);
  }

  noteOff(note: number, atSec: number): void {
    this.bank.noteOff(note, atSec);
  }

  silence(atSec: number): void {
    this.bank.panic(atSec);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.bank.dispose();
    this.inputGain.disconnect();
    this.outputGain.disconnect();
  }

  /**
   * The patch this note will be built from.
   *
   * Only the per-note sources are folded in here. The envelope amounts are the
   * settings' own, the LFOs are not yet wired, and the mod wheel is a live
   * control — so those four read as zero until they exist.
   */
  private settingsFor(note: number, velocity: number, detuneCents = 0): SynthSettings {
    const sources: ModSourceValues = {
      lfo1: 0,
      lfo2: 0,
      ampEnv: 0,
      filterEnv: 0,
      // Both scaled into −1…+1, which is the only thing the matrix speaks.
      velocity: Math.max(0, Math.min(1, velocity / 127)),
      note: (Math.max(0, Math.min(127, note)) - 64) / 64,
      modWheel: 0,
      random: Math.max(-1, Math.min(1, this.random() * 2 - 1)),
    };
    const settings = modulateSettings(this.patch, this.patch.matrix, sources);
    if (detuneCents === 0) return settings;
    // Added to every oscillator rather than applied once downstream, because
    // the voice has no single pitch to bend — three oscillators each carry
    // their own detune, and the note's own offset belongs on top of all of
    // them. Cents are already this parameter's unit, so it is a sum.
    const shift = (osc: OscillatorSettings): OscillatorSettings =>
      ({ ...osc, detuneCents: osc.detuneCents + detuneCents });
    // Rebuilt as a literal triple rather than mapped: `oscillators` is a fixed
    // three-tuple, and `map` would widen it to an array.
    return {
      ...settings,
      oscillators: [
        shift(settings.oscillators[0]),
        shift(settings.oscillators[1]),
        shift(settings.oscillators[2]),
      ],
    };
  }
}
