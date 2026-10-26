/**
 * The synth module: a `ManagedAudioNode` the graph adapter wires like an effect,
 * and a `NotePlayer` the note adapter drives like a sampler.
 *
 * The voice does the sound (`synthVoice.ts`) and the matrix does the routing
 * (`modMatrix.ts`); this is the part that makes them a module — reading a
 * document's flat parameters into a patch, handing each note its own modulation
 * sources, holding the bank of voices, and the scale sequencer's parts that
 * belong to the whole instrument rather than to a note.
 *
 * ## After the voices: the scale sequencer's chain
 *
 * ```text
 *  voices ──────────────────────┐
 *  classic voices ─► filter ────┴─► bus ─┬─► dry (1 − wet) ─────────────┐
 *            ▲ cutoff + env + LFO        └─► mono ─► ping-pong delay ─► wet ─┴─► volume ─► out
 * ```
 *
 * Built exactly as `scale-sequencer/app.js` builds it (`initAudio`): the
 * classic filter's frequency is the sum of two constant sources — the knob's
 * base and a per-note envelope offset — so turning the knob never cancels a
 * sweep; the delay is one ping-pong loop of two 4 s lines with a hi-cut in
 * each feedback leg, panned apart by the spread; and its time is a tape
 * transport that glides when retimed (`synthLaws.ts`). The three LFOs are
 * oscillators through gains into their targets, the original's own wiring.
 *
 * ## Classic
 *
 * With *classic* on, a note's voice has no filter of its own: it feeds the
 * one shared filter, and every note retriggers that filter's envelope, which
 * the most recent note then owns until its key comes up. That is the
 * original's sound — overlapping notes and all — and turning classic off is
 * idMLab's filter per voice.
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
import type {
  BiquadFilterNodeLike,
  ConstantSourceNodeLike,
  DelayNodeLike,
  GainNodeLike,
  OscillatorNodeLike,
  StereoPannerNodeLike,
  SynthContext,
} from "./nodes";
import type { AudioParamLike } from "./params";
import { rampParam } from "./params";
import type { SmoothingLookup } from "./effects";
import type { NotePlayer, PlayerRuntime } from "./players";
import {
  applyEnvelope,
  defaultSynthSettings,
  modulateSettings,
  SynthVoiceBank,
  type OscillatorSettings,
  type SynthSettings,
  type SynthWave,
} from "./synthVoice";
import { readMatrix, type ModMatrix, type ModSourceValues } from "./modMatrix";
import {
  DELAY_HICUT_Q,
  DELAY_NOTES,
  LFO_TARGETS,
  LFO_WAVES,
  MAX_DELAY_S,
  ORIGINAL_GATE,
  TAPE_SPEEDS,
  TEMPO_GLIDE_DELAY_S,
  delaySeconds,
  envelopeEvents,
  filterSweep,
  gateReleaseSec,
  keyFollowedCutoff,
  lfoTargetGain,
  modulatedPulseWidth,
  planTapeGlide,
  pulseAdvanceSec,
  pulseWidthSwing,
  releaseEvents,
  tapeGlideCurve,
  tapeGlideValueAt,
  type LfoTarget,
  type LfoWave,
  type PulseStep,
  type TapeGlide,
} from "./synthLaws";

const WAVES: readonly SynthWave[] = ["sine", "square", "sawtooth", "triangle", "pulse"];

const numberOr = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const waveOr = (value: unknown, fallback: SynthWave): SynthWave =>
  WAVES.includes(value as SynthWave) ? (value as SynthWave) : fallback;

/** Milliseconds on the face, seconds on the clock. */
const msToSec = (value: unknown, fallbackSec: number): number =>
  typeof value === "number" && Number.isFinite(value) ? value / 1000 : fallbackSec;

/**
 * A choice, as the plan sends it (its option's index) or as a document holds
 * it (the option's name). Anything else is the fallback.
 */
const choiceOf = <T extends string>(value: unknown, options: readonly T[], fallback: T): T => {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value < options.length) {
    return options[value];
  }
  return options.includes(value as T) ? (value as T) : fallback;
};

/** A switch, as the plan sends it (0 or 1) or as a document holds it. */
const switchOf = (value: unknown): boolean => value === true || (typeof value === "number" && value >= 0.5);

const positive = (value: number, fallback: number): number =>
  Number.isFinite(value) && value > 0 ? value : fallback;

/** One of the scale sequencer's LFOs: a wave at a rate, scaled into one target. */
export type SynthLfo = { rate: number; depth: number; wave: LfoWave; target: LfoTarget };

/** The ping-pong delay, as the original's controls describe it. */
export type SynthDelay = {
  beats: number;
  feedback: number;
  wet: number;
  spread: number;
  hiCutHz: number;
  ips: number;
  tempo: number;
};

/** A patch, plus the matrix that will bend it per note, plus the module's chain. */
export type SynthPatch = SynthSettings & {
  matrix: ModMatrix;
  classic: boolean;
  /** How much of a sequenced note's step it holds: the original's 85 %. */
  gate: number;
  /** The master after the delay. */
  volume: number;
  lfos: readonly [SynthLfo, SynthLfo, SynthLfo];
  delay: SynthDelay;
};

const LFO_IDS = ["a", "b", "c"] as const;
const LFO_DEFAULTS: readonly SynthLfo[] = [
  { rate: 1, depth: 0, wave: "sine", target: "filter" },
  { rate: 0.05 * 400 ** 0.4, depth: 0, wave: "sine", target: "pw" },
  { rate: 0.05 * 400 ** 0.4, depth: 0, wave: "sine", target: "none" },
];
const DELAY_LABELS = DELAY_NOTES.map((note) => note.label);
const TAPE_LABELS = TAPE_SPEEDS.map((speed) => speed.label);

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
  const lfo = (index: 0 | 1 | 2): SynthLfo => {
    const id = `lfo-${LFO_IDS[index]}`;
    const fallback = LFO_DEFAULTS[index];
    return {
      rate: numberOr(parameters[`${id}-rate`], fallback.rate),
      depth: numberOr(parameters[`${id}-depth`], fallback.depth),
      wave: choiceOf(parameters[`${id}-wave`], LFO_WAVES, fallback.wave),
      target: choiceOf(parameters[`${id}-target`], LFO_TARGETS, fallback.target),
    };
  };
  const note = choiceOf(parameters["delay-note"], DELAY_LABELS, "1/8");
  const tape = choiceOf(parameters.tape, TAPE_LABELS, "7.5 IPS");

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
      envAmount: numberOr(parameters["filter-env"], base.filter.envAmount),
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
    classic: switchOf(parameters.classic),
    gate: numberOr(parameters.gate, ORIGINAL_GATE),
    volume: numberOr(parameters.volume, 1),
    lfos: [lfo(0), lfo(1), lfo(2)],
    delay: {
      beats: DELAY_NOTES[DELAY_LABELS.indexOf(note)].beats,
      feedback: numberOr(parameters["delay-feedback"], 0.35),
      wet: numberOr(parameters["delay-wet"], 0),
      spread: numberOr(parameters["delay-spread"], 1),
      hiCutHz: numberOr(parameters["delay-hicut"], 200 * 100 ** 0.75),
      ips: TAPE_SPEEDS[TAPE_LABELS.indexOf(tape)].ips,
      tempo: positive(numberOr(parameters.tempo, 120), 120),
    },
  };
}

/** Default polyphony: enough for both hands, bounded so a stuck patch degrades. */
const DEFAULT_MAX_VOICES = 16;

/**
 * How the cutoff follows the knob: the original's `setTargetAtTime` time
 * constant. The knob is one constant source feeding the classic filter and
 * every voice filter alike, so every note follows it the same way.
 */
export const CUTOFF_GLIDE_SEC = 0.015;

/** An LFO's own controls: touching one rescales its volume and wet swing. */
const LFO_CONTROL = /^lfo-([abc])-(rate|depth|wave|target)$/;
/** A preset load or morph frame, which touches all three (`synthPresets.ts`). */
const LFO_TOUCH = "lfo-touch";

/** The levels a volume or delay-wet LFO swings around, as of its last touch. */
type LfoLevels = { volume: number; delayWet: number };

/** One LFO's nodes, and where its gain is plugged in now. */
type LfoNodes = { osc: OscillatorNodeLike; gain: GainNodeLike; target: LfoTarget | null };

/** The note that owns the classic filter's envelope, and where it releases to. */
type ClassicHold = { note: number; sustainDelta: number; baseDelta: number; releaseSec: number };

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

  // The chain after the voices, named as `initAudio` names it.
  private readonly master: GainNodeLike;
  private readonly bus: GainNodeLike;
  private readonly dry: GainNodeLike;
  private readonly mono: GainNodeLike;
  private readonly delayL: DelayNodeLike;
  private readonly delayR: DelayNodeLike;
  private readonly panL: StereoPannerNodeLike;
  private readonly panR: StereoPannerNodeLike;
  private readonly wetGain: GainNodeLike;
  private readonly hiCutLR: BiquadFilterNodeLike;
  private readonly hiCutRL: BiquadFilterNodeLike;
  private readonly fbLR: GainNodeLike;
  private readonly fbRL: GainNodeLike;
  private readonly classicIn: GainNodeLike;
  private readonly classicFilter: BiquadFilterNodeLike;
  private readonly cutoffBase: ConstantSourceNodeLike;
  private readonly filterEnv: ConstantSourceNodeLike;
  /** What the LFOs add to every filter's frequency and Q. */
  private readonly lfoFilterBus: GainNodeLike;
  private readonly lfoQBus: GainNodeLike;
  private readonly lfoNodes: LfoNodes[];

  /** Pulse LFO phases in radians, advanced from note to note. */
  private readonly pwPhases = [0, 0, 0];
  /** The last note's place on the step grid; `null` at the start of a run. */
  private pwLast: PulseStep | null = null;
  /** Each LFO's volume and wet, as of the last time its controls moved. */
  private readonly lfoLevels: LfoLevels[];
  /** When each LFO was last touched: a level set in the same moment counts. */
  private readonly lfoTouchedAt: number[];
  private glide: TapeGlide | null = null;
  private readonly delayAtBuild: number;
  private classicHold: ClassicHold | null = null;

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
    this.patch = readSynthSettings(this.parameters, this.structure);
    // `initAudio` connects each LFO with the levels of the moment.
    this.lfoLevels = LFO_IDS.map(() => this.levels());
    this.lfoTouchedAt = LFO_IDS.map(() => atSec);

    this.inputGain = context.createGain();
    this.outputGain = context.createGain();
    // Silent until the adapter fades it up, exactly like an effect.
    rampParam(this.outputGain.gain, 0, atSec, "none");

    this.master = context.createGain();
    this.bus = context.createGain();
    this.dry = context.createGain();
    this.mono = context.createGain();
    // The delay hears one channel, as the original's mono filter fed it.
    this.mono.channelCount = 1;
    this.mono.channelCountMode = "explicit";
    this.mono.channelInterpretation = "speakers";
    this.delayL = context.createDelay(MAX_DELAY_S);
    this.delayR = context.createDelay(MAX_DELAY_S);
    this.panL = context.createStereoPanner();
    this.panR = context.createStereoPanner();
    this.wetGain = context.createGain();
    this.hiCutLR = context.createBiquadFilter();
    this.hiCutRL = context.createBiquadFilter();
    this.fbLR = context.createGain();
    this.fbRL = context.createGain();
    this.classicIn = context.createGain();
    this.classicFilter = context.createBiquadFilter();
    this.cutoffBase = context.createConstantSource();
    this.filterEnv = context.createConstantSource();
    this.lfoFilterBus = context.createGain();
    this.lfoQBus = context.createGain();

    for (const filter of [this.hiCutLR, this.hiCutRL, this.classicFilter]) filter.type = "lowpass";
    rampParam(this.hiCutLR.Q, DELAY_HICUT_Q, atSec, "none");
    rampParam(this.hiCutRL.Q, DELAY_HICUT_Q, atSec, "none");

    // The classic filter's frequency is driven entirely by what is summed in.
    rampParam(this.classicFilter.frequency, 0, atSec, "none");
    rampParam(this.cutoffBase.offset, this.patch.filter.cutoffHz, atSec, "none");
    rampParam(this.filterEnv.offset, 0, atSec, "none");
    this.cutoffBase.connect(this.classicFilter.frequency as unknown as AudioNodeLike);
    this.filterEnv.connect(this.classicFilter.frequency as unknown as AudioNodeLike);
    this.lfoFilterBus.connect(this.classicFilter.frequency as unknown as AudioNodeLike);
    this.lfoQBus.connect(this.classicFilter.Q as unknown as AudioNodeLike);
    this.classicIn.connect(this.classicFilter);
    this.classicFilter.connect(this.bus);

    this.bus.connect(this.dry);
    this.dry.connect(this.master);
    this.bus.connect(this.mono);
    // input → delayL → panL → wet
    //         delayL → hiCut → fb → delayR → panR → wet
    //         delayR → hiCut → fb → delayL   (the ping-pong loop)
    this.mono.connect(this.delayL);
    this.delayL.connect(this.panL);
    this.panL.connect(this.wetGain);
    this.delayL.connect(this.hiCutLR);
    this.hiCutLR.connect(this.fbLR);
    this.fbLR.connect(this.delayR);
    this.delayR.connect(this.panR);
    this.panR.connect(this.wetGain);
    this.delayR.connect(this.hiCutRL);
    this.hiCutRL.connect(this.fbRL);
    this.fbRL.connect(this.delayL);
    this.wetGain.connect(this.master);
    this.master.connect(this.outputGain);

    this.delayAtBuild = delaySeconds(this.patch.delay.tempo, this.patch.delay.beats);
    rampParam(this.delayL.delayTime, this.delayAtBuild, atSec, "none");
    rampParam(this.delayR.delayTime, this.delayAtBuild, atSec, "none");

    this.lfoNodes = LFO_IDS.map(() => {
      const osc = context.createOscillator();
      const gain = context.createGain();
      osc.connect(gain);
      return { osc, gain, target: null };
    });
    this.applyChain(atSec);
    this.cutoffBase.start(atSec);
    this.filterEnv.start(atSec);
    for (const lfo of this.lfoNodes) lfo.osc.start(atSec);

    this.bank = new SynthVoiceBank(
      context,
      this.bus,
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
   * A voice's own settings change for the *next* note and leave sounding
   * notes alone — which is the reason the filter lives in the voice. The
   * module's chain moves now: the classic filter's base glides to a new
   * cutoff, the delay retimes itself on tape, and the LFOs follow at once.
   */
  setParameter(parameterId: string, value: number, atSec: number): void {
    const before = this.patch;
    this.parameters = { ...this.parameters, [parameterId]: value };
    this.patch = readSynthSettings(this.parameters, this.structure);
    if (parameterId === "cutoff") {
      // `cancelAndHoldAtTime(now)` then `setTargetAtTime(cutoff, now, 0.015)`.
      const offset = this.cutoffBase.offset;
      if (offset.cancelAndHoldAtTime) offset.cancelAndHoldAtTime(atSec);
      else offset.cancelScheduledValues(atSec);
      offset.setTargetAtTime(this.patch.filter.cutoffHz, atSec, CUTOFF_GLIDE_SEC);
    }
    // A touched LFO takes the levels of the moment — the whole moment, so a
    // preset's volume lands on its LFOs whichever order its values arrive in,
    // as it does on the Rust engine, where a moment is one sample.
    const lfo = LFO_CONTROL.exec(parameterId);
    if (lfo) this.touchLfo(LFO_IDS.indexOf(lfo[1] as (typeof LFO_IDS)[number]), atSec);
    if (parameterId === LFO_TOUCH) LFO_IDS.forEach((_, index) => this.touchLfo(index, atSec));
    if (parameterId === "volume" || parameterId === "delay-wet") {
      this.lfoTouchedAt.forEach((touched, index) => {
        if (touched === atSec) this.lfoLevels[index] = this.levels();
      });
    }
    // A new note value glides at once; a new tempo after the original's
    // pause, which lets a dragged tempo knob settle before the tape follows.
    if (parameterId === "delay-note" && this.patch.delay.beats !== before.delay.beats) this.retime(atSec, 0);
    if (parameterId === "tempo") this.retime(atSec, TEMPO_GLIDE_DELAY_S);
    this.applyChain(atSec);
  }

  /** Bypass is the adapter's level mute; a synth adds nothing to it. */
  setBypass(_bypass: boolean, _atSec: number): void {
    /* see EffectModule.setBypass — the adapter owns this */
  }

  setWet(_wet: number, _atSec: number): void {
    /* a synth is a source: there is no dry path to balance against */
  }

  /**
   * A note. `stepSec` is its step as sequenced, when it has one: the note
   * then releases at the gate — 85 % of the step, as the original's do — with
   * its release written when it starts, and its note-off changes nothing.
   */
  noteOn(note: number, velocity: number, atSec: number, detuneCents = 0, stepSec?: number): void {
    if (this.disposed) return;
    const pitch = note + detuneCents / 100;
    const sequenced = stepSec !== undefined && Number.isFinite(stepSec) && stepSec > 0;
    const releaseAtSec = sequenced ? gateReleaseSec(atSec, stepSec, this.patch.gate) : undefined;
    const settings = this.settingsFor(note, velocity, detuneCents, this.pulseSwing(atSec, stepSec));
    if (this.patch.classic) {
      this.bank.noteOn(settings, note, velocity, atSec, {
        classic: true, destination: this.classicIn, pitch, releaseAtSec,
      });
      this.triggerClassicFilter(settings, note, pitch, atSec, releaseAtSec);
    } else {
      this.bank.noteOn(settings, note, velocity, atSec, {
        filterFrequencyMod: this.lfoFilterBus,
        filterQMod: this.lfoQBus,
        cutoffBase: this.cutoffBase,
        knobHz: positive(this.patch.filter.cutoffHz, 2000),
        pitch,
        releaseAtSec,
      });
    }
  }

  noteOff(note: number, atSec: number): void {
    this.bank.noteOff(note, atSec);
    // Only the note that last struck the shared filter releases it: in the
    // original each note cancels the release the one before it scheduled.
    // Written over what is there, as the original's release is.
    const hold = this.classicHold;
    if (hold?.note !== note) return;
    applyEnvelope(this.filterEnv.offset, releaseEvents(atSec, hold.sustainDelta, hold.baseDelta, hold.releaseSec));
    this.classicHold = null;
  }

  /** Everything off — the end of a run, so the next note starts the step grid again. */
  silence(atSec: number): void {
    this.bank.panic(atSec);
    this.classicHold = null;
    this.pwLast = null;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.bank.dispose();
    for (const source of [this.cutoffBase, this.filterEnv, ...this.lfoNodes.map((lfo) => lfo.osc)]) {
      /* v8 ignore next 5 — only a real browser throws here */
      try {
        source.stop(0);
      } catch {
        // Already stopped. The outcome wanted.
      }
    }
    for (const node of [
      this.inputGain, this.outputGain, this.master, this.bus, this.dry, this.mono,
      this.delayL, this.delayR, this.panL, this.panR, this.wetGain, this.hiCutLR, this.hiCutRL,
      this.fbLR, this.fbRL, this.classicIn, this.classicFilter, this.cutoffBase, this.filterEnv,
      this.lfoFilterBus, this.lfoQBus, ...this.lfoNodes.flatMap((lfo) => [lfo.osc, lfo.gain]),
    ]) {
      node.disconnect();
    }
  }

  /** Where the delay's time is now: on a glide, or where it was built. */
  delayTimeAt(atSec: number): number {
    return this.glide ? tapeGlideValueAt(this.glide, atSec) : this.delayAtBuild;
  }

  /** Every control of the chain, at once — the original sets these as values. */
  private applyChain(atSec: number): void {
    const { delay, volume } = this.patch;
    const set = (param: AudioParamLike, value: number) => rampParam(param, value, atSec, "none");
    set(this.classicFilter.Q, this.patch.filter.resonance);
    set(this.master.gain, volume);
    set(this.dry.gain, 1 - delay.wet);
    set(this.wetGain.gain, delay.wet);
    set(this.fbLR.gain, delay.feedback);
    set(this.fbRL.gain, delay.feedback);
    set(this.panL.pan, -delay.spread);
    set(this.panR.pan, delay.spread);
    set(this.hiCutLR.frequency, delay.hiCutHz);
    set(this.hiCutRL.frequency, delay.hiCutHz);
    this.patch.lfos.forEach((lfo, index) => {
      const nodes = this.lfoNodes[index];
      nodes.osc.type = lfo.wave;
      set(nodes.osc.frequency, lfo.rate);
      const scales = { cutoffHz: this.patch.filter.cutoffHz, ...this.lfoLevels[index] };
      set(nodes.gain.gain, lfoTargetGain(lfo.target, lfo.depth, scales));
      if (nodes.target === lfo.target) return;
      if (nodes.target !== null) nodes.gain.disconnect();
      const destination = this.lfoDestination(lfo.target);
      if (destination) nodes.gain.connect(destination);
      nodes.target = lfo.target;
    });
  }

  /** The volume and wet now, for an LFO touched now. */
  private levels(): LfoLevels {
    return { volume: this.patch.volume, delayWet: this.patch.delay.wet };
  }

  private touchLfo(index: number, atSec: number): void {
    this.lfoLevels[index] = this.levels();
    this.lfoTouchedAt[index] = atSec;
  }

  private lfoDestination(target: LfoTarget): AudioNodeLike | undefined {
    switch (target) {
      case "filter":
        return this.lfoFilterBus;
      case "resonance":
        return this.lfoQBus;
      case "volume":
        return this.master.gain as unknown as AudioNodeLike;
      case "delay-wet":
        return this.wetGain.gain as unknown as AudioNodeLike;
      default:
        return undefined;
    }
  }

  /**
   * The pulse-width swing this note is built with.
   *
   * Each pulse LFO's phase moves on by its rate through the steps since the
   * last note's, this note's own included — the original advances it a step
   * at a time, before the step plays (`pulseAdvanceSec`) — and is read as a
   * sine.
   */
  private pulseSwing(atSec: number, stepSec: number | undefined): number {
    const step: PulseStep = { onsetSec: atSec, stepSec };
    const elapsed = pulseAdvanceSec(this.pwLast, step);
    this.pwLast = step;
    const swinging: { phase: number; depth: number }[] = [];
    this.patch.lfos.forEach((lfo, index) => {
      if (lfo.target !== "pw") return;
      this.pwPhases[index] += lfo.rate * elapsed * 2 * Math.PI;
      swinging.push({ phase: this.pwPhases[index], depth: lfo.depth });
    });
    return pulseWidthSwing(swinging);
  }

  /**
   * Retrigger the shared filter's envelope, as `playNote` does: cancel what
   * is scheduled from this note on, then the offset from the knob's cutoff
   * jumps to this note's key-followed base, sweeps to the peak and settles on
   * the sustain — and a sequenced note writes its release at the gate too.
   */
  private triggerClassicFilter(
    settings: SynthSettings, note: number, pitch: number, atSec: number, releaseAtSec: number | undefined,
  ): void {
    const knob = positive(this.patch.filter.cutoffHz, 2000);
    const { filter } = settings;
    const base = keyFollowedCutoff(positive(filter.cutoffHz, 2000), pitch, filter.keyFollow);
    const sweep = filterSweep(base, filter.envAmountOctaves, filter.envAmount, filter.adsr.sustain);
    const offset = this.filterEnv.offset;
    offset.cancelScheduledValues(atSec);
    applyEnvelope(
      offset,
      envelopeEvents(atSec, sweep.base - knob, sweep.peak - knob, sweep.sustain - knob, filter.adsr, releaseAtSec),
    );
    this.classicHold = releaseAtSec === undefined
      ? { note, sustainDelta: sweep.sustain - knob, baseDelta: sweep.base - knob, releaseSec: Math.max(0, filter.adsr.release) }
      : null;
  }

  /** Glide the delay to the time the tempo and note value now ask for. */
  private retime(atSec: number, startDelaySec: number): void {
    const { delay } = this.patch;
    const dNow = this.delayTimeAt(atSec);
    const glide = planTapeGlide(atSec, startDelaySec, dNow, delaySeconds(delay.tempo, delay.beats), delay.ips);
    if (!glide) return;
    const curve = tapeGlideCurve(glide);
    for (const line of [this.delayL, this.delayR]) {
      const time = line.delayTime;
      if (time.cancelAndHoldAtTime) time.cancelAndHoldAtTime(atSec);
      else time.cancelScheduledValues(atSec);
      time.setValueAtTime(dNow, atSec);
      time.setValueCurveAtTime(curve, glide.start, glide.T);
    }
    this.glide = glide;
  }

  /**
   * The patch this note will be built from.
   *
   * Only the per-note sources are folded in here. The envelope amounts are the
   * settings' own, the matrix LFOs are not wired on this backend, and the mod
   * wheel is a live control — so those four read as zero. The pulse swing is
   * the scale sequencer's pulse LFOs, read for this note.
   */
  private settingsFor(note: number, velocity: number, detuneCents: number, pulseSwing: number): SynthSettings {
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
    // Added to every oscillator rather than applied once downstream, because
    // the voice has no single pitch to bend — three oscillators each carry
    // their own detune, and the note's own offset belongs on top of all of
    // them. Cents are already this parameter's unit, so it is a sum.
    const shift = (osc: OscillatorSettings): OscillatorSettings => ({
      ...osc,
      detuneCents: osc.detuneCents + detuneCents,
      pulseWidth: modulatedPulseWidth(osc.pulseWidth, pulseSwing),
    });
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
