/**
 * One note of the synth, and the bank that holds several at once.
 *
 * ```text
 *   osc 1 ─ gain ─┐
 *   osc 2 ─ gain ─┼─► filter ─► amp env ─► panner ─► the module's output
 *   osc 3 ─ gain ─┘   (its own ADSR)
 * ```
 *
 * A *classic* voice is the same minus its filter and panner: its amp
 * envelope feeds the module's one shared filter, which is how the scale
 * sequencer is built (see `synthPlayer.ts`).
 *
 * ## The filter belongs to the voice
 *
 * This is the one structural departure from both sources this design came from.
 * The AV prototype and the scale sequencer each keep a single `BiquadFilter` for
 * the whole instrument and schedule every note's filter envelope onto its one
 * `frequency` param. Two notes overlapping therefore fight over the sweep, and —
 * worse — a knob touched mid-phrase calls `cancelAndHoldAtTime`, which wipes the
 * envelopes already scheduled for notes that have not sounded yet. That is
 * exactly the scale sequencer's filter knob bug.
 *
 * A filter inside the voice cannot have the problem. Each note owns its sweep,
 * and the knob sets a base value that the *next* note reads.
 *
 * ## Envelopes are scheduled, not ramped
 *
 * The rest of the audio layer moves parameters with `rampParam`, which cancels
 * pending automation and pins the current value first — correct for a knob, and
 * wrong for an envelope, which is several stages scheduled ahead in one go.
 * Cancelling would delete the stage just written, and pinning `param.value`
 * would pin the value *now* rather than the value at the future moment being
 * scheduled. So the envelope writes `setValueAtTime` and
 * `linearRampToValueAtTime` directly. No `.value =` assignment appears here or
 * anywhere else — that is the rule the safety contract actually enforces.
 *
 * They are the scale sequencer's calls (`envelopeEvents` and `releaseEvents`
 * in `synthLaws.ts`). A note starts with its attack, decay and sustain, and
 * the sustain holds: the synth has no gate, so how long a note lasts is
 * decided by whatever sent it. Its release — the sustain set, a ramp down —
 * is written when its note-off arrives, from a sequencer or a key alike,
 * without cancelling what is already there.
 *
 * ## The voice filter follows the knob
 *
 * A voice's filter frequency is the module's cutoff knob — a constant source,
 * gliding as the original's does — plus this note's envelope, written as
 * offsets from the knob. Turning the knob moves a sounding note's filter,
 * exactly as it moves the original's one shared filter.
 */

import type {
  AudioBufferLike,
  BiquadFilterNodeLike,
  OscillatorKind,
  OscillatorNodeLike,
  StereoPannerNodeLike,
  SynthContext,
} from "./nodes";
import type { AudioNodeLike } from "./graphAdapter";
import type { AudioParamLike } from "./params";
import { rampParam } from "./params";
import { pulseWaveCoefficients } from "./dsp";
import { rootHzForMidi } from "../tuning/tuning";
import {
  envelopeEvents,
  filterSweep,
  keyFollowedCutoff,
  KEY_FOLLOW_REFERENCE_MIDI,
  NOTE_TAIL_SEC,
  releaseEvents,
  type EnvelopeEvent,
} from "./synthLaws";
import {
  applyRoutings,
  modulate,
  type ModMatrix,
  type ModSourceValues,
} from "./modMatrix";

/** A wave an oscillator can be set to, plus the one that must be generated. */
export type SynthWave = Exclude<OscillatorKind, "custom"> | "pulse";

export type AdsrSeconds = {
  attack: number;
  decay: number;
  /** A fraction of the peak, held until the key comes up. */
  sustain: number;
  release: number;
};

export type OscillatorSettings = {
  wave: SynthWave;
  /** Tuning, in cents, against the note being played. */
  detuneCents: number;
  level: number;
  /** Duty cycle, consulted only when `wave` is `"pulse"`. */
  pulseWidth: number;
};

export type SynthFilterSettings = {
  cutoffHz: number;
  resonance: number;
  /** 0 ignores the note; 1 doubles the cutoff for every octave played up. */
  keyFollow: number;
  /** Depth of the filter envelope, in octaves, either direction. */
  envAmountOctaves: number;
  /**
   * The scale sequencer's envelope amount, −1…+1, linear in hertz: +1 peaks
   * four octaves up. Added to the octave amount; see `filterSweep`.
   */
  envAmount: number;
  adsr: AdsrSeconds;
};

export type SynthSettings = {
  oscillators: readonly [OscillatorSettings, OscillatorSettings, OscillatorSettings];
  amp: AdsrSeconds;
  filter: SynthFilterSettings;
  level: number;
  pan: number;
};

/** The note key follow measures against — middle C. */
export { KEY_FOLLOW_REFERENCE_MIDI };

/**
 * Where a voice sends itself, and what else reaches its filter.
 *
 * `classic` routes the amp envelope straight to `destination` with no filter
 * or panner of the voice's own — the shared filter is downstream. The two
 * modulation signals are the module's LFOs, summed into the voice filter's
 * frequency and Q while the note sounds. `pitch` is the note's true pitch,
 * microtonal remainder included, which key follow measures.
 */
export type VoiceRouting = {
  classic?: boolean;
  filterFrequencyMod?: AudioNodeLike;
  filterQMod?: AudioNodeLike;
  pitch?: number;
  /**
   * The module's cutoff knob as a signal, summed into the voice filter's
   * frequency; the voice's own automation is then offsets from `knobHz`.
   */
  cutoffBase?: AudioNodeLike;
  knobHz?: number;
};

/** Write an envelope's calls onto a parameter, in the order given. */
export function applyEnvelope(param: AudioParamLike, events: readonly EnvelopeEvent[]): void {
  for (const event of events) {
    if (event.kind === "set") param.setValueAtTime(event.value, event.time);
    else param.linearRampToValueAtTime(event.value, event.time);
  }
}

/** A voice stolen mid-note fades over this rather than clicking. */
const STEAL_FADE_SEC = 0.02;

const clamp = (value: number, low: number, high: number): number =>
  Math.max(low, Math.min(high, value));

const positive = (value: number, fallback: number): number =>
  Number.isFinite(value) && value > 0 ? value : fallback;

/** A serviceable patch: one sawtooth, a gentle filter sweep, medium envelope. */
export function defaultSynthSettings(): SynthSettings {
  return {
    oscillators: [
      { wave: "sawtooth", detuneCents: 0, level: 0.8, pulseWidth: 0.5 },
      { wave: "sawtooth", detuneCents: 7, level: 0.5, pulseWidth: 0.5 },
      { wave: "sine", detuneCents: -1200, level: 0.3, pulseWidth: 0.5 },
    ],
    amp: { attack: 0.01, decay: 0.15, sustain: 0.7, release: 0.25 },
    filter: {
      cutoffHz: 2000,
      resonance: 1,
      keyFollow: 0.25,
      envAmountOctaves: 1.5,
      envAmount: 0,
      adsr: { attack: 0.01, decay: 0.25, sustain: 0.4, release: 0.3 },
    },
    level: 0.8,
    pan: 0,
  };
}

/**
 * Fold the per-note modulation sources into a copy of the settings.
 *
 * Velocity, note number, the random draw and the envelope amounts are all fixed
 * the moment a note starts, so applying them here costs one pass and nothing
 * afterwards. The continuous sources — the LFOs and the mod wheel — are not
 * handled here: they are wired as real nodes, because they have to keep moving
 * while the note sounds.
 */
export function modulateSettings(
  settings: SynthSettings,
  matrix: ModMatrix,
  sources: ModSourceValues,
): SynthSettings {
  const pitch = (["osc1-pitch", "osc2-pitch", "osc3-pitch"] as const)
    .map((destination) => modulate(matrix, destination, sources));
  const level = (["osc1-level", "osc2-level", "osc3-level"] as const)
    .map((destination) => modulate(matrix, destination, sources));

  const oscillators = settings.oscillators.map((osc, index) => ({
    ...osc,
    detuneCents: applyRoutings(
      (["osc1-pitch", "osc2-pitch", "osc3-pitch"] as const)[index],
      osc.detuneCents,
      pitch[index],
    ),
    level: applyRoutings(
      (["osc1-level", "osc2-level", "osc3-level"] as const)[index],
      osc.level,
      level[index],
    ),
  })) as unknown as SynthSettings["oscillators"];

  return {
    ...settings,
    oscillators,
    filter: {
      ...settings.filter,
      cutoffHz: applyRoutings(
        "filter-cutoff",
        settings.filter.cutoffHz,
        modulate(matrix, "filter-cutoff", sources),
      ),
      resonance: applyRoutings(
        "filter-resonance",
        settings.filter.resonance,
        modulate(matrix, "filter-resonance", sources),
      ),
    },
    pan: applyRoutings("pan", settings.pan, modulate(matrix, "pan", sources)),
    level: applyRoutings("volume", settings.level, modulate(matrix, "volume", sources)),
  };
}

/**
 * Stop an oscillator without caring whether it can be stopped.
 *
 * A source that never started, or one whose context has gone, throws — and
 * neither is worth taking a scheduling pass down for. The same guard the sample
 * voices use, for the same reason.
 */
function stopQuietly(oscillator: OscillatorNodeLike, atSec: number): void {
  /* v8 ignore next 5 — only a real browser throws here */
  try {
    oscillator.stop(Math.max(0, atSec));
  } catch {
    // Already stopped, or never started. Both are the outcome we wanted.
  }
}

/** Velocity as a gain, curved so the quiet half of the keyboard is usable. */
const velocityGain = (velocity: number): number => {
  const unit = clamp(velocity / 127, 0, 1);
  return unit * unit;
};

/** One sounding note. */
export class SynthVoice {
  readonly note: number;
  readonly startedAtSec: number;
  private readonly oscillators: OscillatorNodeLike[] = [];
  private readonly ampGain;
  private readonly panner: StereoPannerNodeLike | null;
  private readonly filter: BiquadFilterNodeLike | null;
  private readonly routing: VoiceRouting;
  /** The filter envelope's resting offset from the knob, and its sustain. */
  private filterFromHz = 0;
  private sustainOffsetHz = 0;
  private readonly settings: SynthSettings;
  private released = false;
  private stopped = false;
  /** Called when the note has finished of its own accord. */
  onended: (() => void) | null = null;

  constructor(
    context: SynthContext,
    destination: AudioNodeLike,
    settings: SynthSettings,
    note: number,
    velocity: number,
    atSec: number,
    routing: VoiceRouting = {},
  ) {
    this.note = note;
    this.startedAtSec = atSec;
    this.settings = settings;
    this.routing = routing;

    const classic = routing.classic === true;
    this.filter = classic ? null : context.createBiquadFilter();
    this.ampGain = context.createGain();
    this.panner = classic ? null : context.createStereoPanner();
    // What the oscillators feed: the voice's filter, or straight into the amp
    // when the filter is the module's.
    const mixInto: AudioNodeLike = this.filter ?? this.ampGain;

    const frequency = rootHzForMidi(note);
    for (const osc of settings.oscillators) {
      const oscillator = context.createOscillator();
      if (osc.wave === "pulse") {
        const { real, imag } = pulseWaveCoefficients(osc.pulseWidth);
        oscillator.setPeriodicWave(context.createPeriodicWave(real, imag));
      } else {
        oscillator.type = osc.wave;
      }
      rampParam(oscillator.frequency, frequency, atSec, "none");
      rampParam(oscillator.detune, osc.detuneCents, atSec, "none");

      const gain = context.createGain();
      rampParam(gain.gain, clamp(osc.level, 0, 1), atSec, "none");
      oscillator.connect(gain);
      gain.connect(mixInto);
      this.oscillators.push(oscillator);
    }

    if (this.filter && this.panner) {
      this.filter.type = "lowpass";
      rampParam(this.filter.Q, clamp(settings.filter.resonance, 0.0001, 30), atSec, "none");
      this.filter.connect(this.ampGain);
      this.ampGain.connect(this.panner);
      this.panner.connect(destination);
      rampParam(this.panner.pan, clamp(settings.pan, -1, 1), atSec, "none");
      // The knob and the LFOs add to the scheduled sweep rather than replacing it.
      routing.cutoffBase?.connect(this.filter.frequency as unknown as AudioNodeLike);
      routing.filterFrequencyMod?.connect(this.filter.frequency as unknown as AudioNodeLike);
      routing.filterQMod?.connect(this.filter.Q as unknown as AudioNodeLike);
    } else {
      this.ampGain.connect(destination);
    }

    this.scheduleEnvelopes(atSec, velocity, routing.pitch ?? note);

    this.oscillators[0].onended = () => this.finish();
    for (const oscillator of this.oscillators) oscillator.start(atSec);
  }

  /** Whether the note has been let go. */
  get isReleased(): boolean {
    return this.released;
  }

  /**
   * Let the note go: the sustain set now and a ramp down, written over what
   * is scheduled rather than cancelling it, then the oscillators stop.
   */
  release(atSec: number): void {
    if (this.released) return;
    this.released = true;
    applyEnvelope(this.ampGain.gain, releaseEvents(atSec, this.sustainLevel, 0, this.settings.amp.release));
    if (this.filter) {
      applyEnvelope(
        this.filter.frequency,
        releaseEvents(atSec, this.sustainOffsetHz, this.filterFromHz, this.settings.filter.adsr.release),
      );
    }
    this.stopAt(this.stopTime(atSec));
  }

  /** The original stops a note 50 ms after its amp release ends. */
  private stopTime(releasedAtSec: number): number {
    return releasedAtSec + Math.max(0, this.settings.amp.release) + NOTE_TAIL_SEC;
  }

  /** Cut the note short to make room for another, without a click. */
  steal(atSec: number): void {
    this.released = true;
    rampParam(this.ampGain.gain, 0, atSec, "exponential", { durationSec: STEAL_FADE_SEC });
    this.stopAt(atSec + STEAL_FADE_SEC * 2);
  }

  /** Drop the nodes. Safe to call more than once. */
  dispose(): void {
    this.onended = null;
    for (const oscillator of this.oscillators) {
      oscillator.onended = null;
      stopQuietly(oscillator, 0);
      oscillator.disconnect();
    }
    if (this.filter) {
      this.routing.cutoffBase?.disconnect(this.filter.frequency as unknown as AudioNodeLike);
      this.routing.filterFrequencyMod?.disconnect(this.filter.frequency as unknown as AudioNodeLike);
      this.routing.filterQMod?.disconnect(this.filter.Q as unknown as AudioNodeLike);
      this.filter.disconnect();
    }
    this.ampGain.disconnect();
    this.panner?.disconnect();
  }

  private sustainLevel = 0;

  private scheduleEnvelopes(atSec: number, velocity: number, pitch: number): void {
    const peak = clamp(this.settings.level, 0, 1) * velocityGain(velocity);
    this.sustainLevel = peak * clamp(this.settings.amp.sustain, 0, 1);
    applyEnvelope(
      this.ampGain.gain,
      envelopeEvents(atSec, 0, peak, this.sustainLevel, this.settings.amp),
    );

    if (!this.filter) return;
    // Key follow before the envelope, so the sweep starts from the pitch-
    // corrected cutoff rather than sweeping away from it — the scale
    // sequencer's laws, both of them (`synthLaws.ts`). Written as offsets
    // from the knob when the knob arrives as a signal.
    const { filter } = this.settings;
    const knob = this.routing.cutoffBase ? (this.routing.knobHz ?? 0) : 0;
    const base = keyFollowedCutoff(positive(filter.cutoffHz, 2000), pitch, filter.keyFollow);
    const sweep = filterSweep(base, filter.envAmountOctaves, filter.envAmount, filter.adsr.sustain);
    this.filterFromHz = sweep.base - knob;
    this.sustainOffsetHz = sweep.sustain - knob;
    applyEnvelope(
      this.filter.frequency,
      envelopeEvents(atSec, this.filterFromHz, sweep.peak - knob, this.sustainOffsetHz, filter.adsr),
    );
  }

  private stopAt(atSec: number): void {
    if (this.stopped) return;
    this.stopped = true;
    for (const oscillator of this.oscillators) stopQuietly(oscillator, atSec);
  }

  private finish(): void {
    const ended = this.onended;
    this.onended = null;
    this.dispose();
    ended?.();
  }
}

/**
 * The voices of one synth module.
 *
 * Bounded, like the sample voice bank, and for the same reason: a stuck note or
 * a runaway pattern must degrade rather than allocate without limit.
 */
export class SynthVoiceBank {
  /** Notes still held: what the ceiling counts and a key-up releases. */
  private voices: SynthVoice[] = [];
  /** Notes let go, ringing out their release until they end. */
  private ringing: SynthVoice[] = [];
  /** Notes stolen or silenced, fading out; no longer counted. */
  private fading: SynthVoice[] = [];
  private disposed = false;
  private readonly maxVoices: number;

  constructor(
    private readonly context: SynthContext,
    private readonly destination: AudioNodeLike,
    maxVoices = 16,
  ) {
    this.maxVoices = Math.max(1, Math.round(maxVoices));
  }

  /** Notes sounding: held, or ringing out their release. */
  get activeCount(): number {
    return this.voices.length + this.ringing.length;
  }

  /** Notes still held — what the ceiling limits. */
  get heldCount(): number {
    return this.voices.length;
  }

  noteOn(
    settings: SynthSettings,
    note: number,
    velocity: number,
    atSec: number,
    routing: VoiceRouting & { destination?: AudioNodeLike } = {},
  ): void {
    if (this.disposed) return;
    // The same key struck again is the same voice, not a second one stacked on
    // top: a repeated note should retrigger, not accumulate.
    this.release(note, atSec);
    this.enforceCeiling(atSec);

    const voice = new SynthVoice(
      this.context, routing.destination ?? this.destination, settings, note, velocity, atSec, routing,
    );
    voice.onended = () => this.forget(voice);
    // Held until its note-off, whatever sent it; only then does it ring out,
    // no longer counted against the ceiling.
    this.voices.push(voice);
  }

  noteOff(note: number, atSec: number): void {
    this.release(note, atSec);
  }

  /** Everything off, now. */
  panic(atSec: number): void {
    for (const voice of [...this.voices, ...this.ringing]) voice.steal(atSec);
    this.fading.push(...this.voices, ...this.ringing);
    this.voices = [];
    this.ringing = [];
  }

  dispose(): void {
    this.disposed = true;
    for (const voice of [...this.voices, ...this.ringing, ...this.fading]) voice.dispose();
    this.voices = [];
    this.ringing = [];
    this.fading = [];
  }

  private release(note: number, atSec: number): void {
    const remaining: SynthVoice[] = [];
    for (const voice of this.voices) {
      if (voice.note === note) {
        voice.release(atSec);
        this.ringing.push(voice);
      } else {
        remaining.push(voice);
      }
    }
    this.voices = remaining;
  }

  private enforceCeiling(atSec: number): void {
    while (this.voices.length >= this.maxVoices) {
      let oldest = 0;
      for (let i = 1; i < this.voices.length; i++) {
        if (this.voices[i].startedAtSec < this.voices[oldest].startedAtSec) oldest = i;
      }
      const [victim] = this.voices.splice(oldest, 1);
      victim.steal(atSec);
      this.fading.push(victim);
    }
  }

  private forget(voice: SynthVoice): void {
    this.voices = this.voices.filter((candidate) => candidate !== voice);
    this.ringing = this.ringing.filter((candidate) => candidate !== voice);
    this.fading = this.fading.filter((candidate) => candidate !== voice);
  }
}

/** Unused import guard: the buffer type travels with `SynthContext`. */
export type { AudioBufferLike };
