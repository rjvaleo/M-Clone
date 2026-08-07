// Playing a sample once, and stopping it politely.
//
// Every sample-based module here is built out of this: a buffer source into a
// gain into wherever the module's output goes. What the module supplies is
// *when*, *which buffer*, and *how loud*; what this file owns is the part that
// is easy to get subtly wrong.
//
// ## Choke groups
//
// The distinctive piece from the AV prototype, and the reason it is worth
// having: an open hihat has to stop the instant a closed hihat is struck,
// because on a real kit they are the same piece of metal. That is a choke
// group — a set of voices where a new one silences the others.
//
// The prototype had the shape right and the execution wrong in two ways. It
// broadcast the choke through a global registry, reaching across every column
// in the app; here a group is a number scoped to one module, so choking is a
// local fact rather than an action at a distance. And it scheduled the actual
// stop with `setTimeout(…, 30)` — a main-thread timer deciding when audio
// stops, which is exactly the wrong clock. Here the fade and the stop are both
// scheduled on the audio clock, so a choke is sample-accurate and survives a
// stalled main thread.
//
// ## Why the fade exists at all
//
// `source.stop()` mid-waveform steps the signal to zero, and a step is a click.
// Twenty milliseconds of exponential fade is short enough to read as an
// immediate cut and long enough to be inaudible as an edge.

import { rampParam } from "./params";
import type {
  AudioBufferLike,
  AudioBufferSourceNodeLike,
  GainNodeLike,
  SampleContext,
  StereoPannerNodeLike,
} from "./nodes";
import type { AudioNodeLike } from "./graphAdapter";

/** How long a choked voice takes to get out of the way. */
export const CHOKE_SEC = 0.02;

/** Ceiling on simultaneous voices in one module, so a runaway patch degrades. */
export const DEFAULT_MAX_VOICES = 32;

export type VoiceOptions = {
  /** Audio-clock time to start. */
  atSec: number;
  /** Peak level, before the module's own output gain. */
  level: number;
  /** 1 is unity; 2 is an octave up. Negative plays backwards. */
  playbackRate?: number;
  /** Seconds into the buffer to begin. */
  offsetSec?: number;
  /** Play only this long. Undefined plays to the end of the buffer. */
  durationSec?: number;
  /** Exponential decay applied over this long. Undefined leaves the sample alone. */
  decaySec?: number;
  /** Fade in over this long, for grains that must not click at the edges. */
  attackSec?: number;
  /** Hold at full level until this far in, then release. Grain windows use it. */
  holdSec?: number;
  loop?: boolean;
  loopStartSec?: number;
  loopEndSec?: number;
  /** Voices sharing a group silence each other. Zero means no choking. */
  chokeGroup?: number;
  /**
   * Where this one voice sits in the field, −1 to +1.
   *
   * Omitted means no panner is built at all, which is the point: a granular
   * cloud fires a voice every few tens of milliseconds, and a node per grain
   * that every grain sets to centre is pure cost. Only Percussion passes this,
   * because only Percussion has a per-pad position to express.
   */
  pan?: number;
};

type Voice = {
  source: AudioBufferSourceNodeLike;
  gain: GainNodeLike;
  /** Built only when the voice was given a pan; see `VoiceOptions.pan`. */
  panner: StereoPannerNodeLike | null;
  chokeGroup: number;
  startedAtSec: number;
};

/**
 * The live voices of one module.
 *
 * Not the shared `voicePool` from the safety contract: that one hands out
 * pre-constructed nodes for a fixed-capacity instrument. A `BufferSource` is
 * single-use by specification — it cannot be restarted — so pooling the source
 * itself is not possible, and what is bounded here is how many may sound at
 * once rather than how many objects exist.
 */
export class VoiceBank {
  private readonly context: SampleContext;
  private readonly destination: AudioNodeLike;
  private readonly maxVoices: number;
  private voices: Voice[] = [];
  private started = 0;
  private disposed = false;

  constructor(context: SampleContext, destination: AudioNodeLike, maxVoices = DEFAULT_MAX_VOICES) {
    this.context = context;
    this.destination = destination;
    this.maxVoices = Math.max(1, maxVoices);
  }

  /** Voices scheduled or sounding right now. */
  get activeCount(): number {
    return this.voices.length;
  }

  /** Lifetime count, for tests that care that something was actually played. */
  get startedCount(): number {
    return this.started;
  }

  /**
   * Schedule one sample.
   *
   * Returns false when there is nothing to play, so a caller can tell a missing
   * sample from a silent one.
   */
  play(buffer: AudioBufferLike | undefined, options: VoiceOptions): boolean {
    // A note can arrive after the node it belongs to has been retired: the
    // crossfade is over, the graph is rebuilt, and one more event was already
    // in flight. Starting a voice on a disconnected chain would leak a source
    // that nothing will ever stop.
    if (this.disposed) return false;
    if (!buffer || buffer.length === 0) return false;
    const at = Math.max(0, options.atSec);
    const chokeGroup = Math.trunc(options.chokeGroup ?? 0);
    if (chokeGroup > 0) this.choke(chokeGroup, at);
    this.enforceCeiling(at);

    const source = this.context.createBufferSource();
    const gain = this.context.createGain();
    source.buffer = buffer;
    rampParam(source.playbackRate, options.playbackRate ?? 1, at, "none");

    if (options.loop) {
      source.loop = true;
      // Only meaningful on a looping source, and only when a region was asked
      // for: leaving them at zero would loop a zero-length region silently.
      if (options.loopStartSec !== undefined) source.loopStart = options.loopStartSec;
      if (options.loopEndSec !== undefined) source.loopEnd = options.loopEndSec;
    }

    this.applyEnvelope(gain, at, options);
    source.connect(gain);

    // The panner, when there is one, sits after the envelope and before the
    // module's own output — so a pad's position is fixed relative to the kit
    // and the kit's position is applied once, downstream, to all of it.
    let panner: StereoPannerNodeLike | null = null;
    if (options.pan !== undefined) {
      panner = this.context.createStereoPanner();
      rampParam(panner.pan, clampPan(options.pan), at, "none");
      gain.connect(panner);
      panner.connect(this.destination);
    } else {
      gain.connect(this.destination);
    }

    const voice: Voice = { source, gain, panner, chokeGroup, startedAtSec: at };
    source.onended = () => this.retire(voice);
    startSource(source, at, options.offsetSec, options.durationSec);

    // A decaying hit is inaudible long before the buffer ends; stopping it when
    // the envelope reaches zero frees the voice instead of leaving it counted.
    const life = envelopeLifeSec(options);
    if (life !== null && !options.loop) stopSource(source, at + life);

    this.voices.push(voice);
    this.started += 1;
    return true;
  }

  /** Silence a group, or everything when no group is given. */
  choke(group: number, atSec = this.context.currentTime): void {
    const at = Math.max(0, atSec);
    const remaining: Voice[] = [];
    for (const voice of this.voices) {
      if (group !== 0 && voice.chokeGroup !== group) {
        remaining.push(voice);
        continue;
      }
      // Cancel first: a voice partway through its own decay must fade from
      // where it actually is, not from where its envelope was headed.
      rampParam(voice.gain.gain, 0, at, "exponential", { durationSec: CHOKE_SEC });
      stopSource(voice.source, at + CHOKE_SEC * 2);
    }
    this.voices = remaining;
  }

  /** Stop everything now, without a click. */
  panic(atSec = this.context.currentTime): void {
    this.choke(0, atSec);
  }

  dispose(): void {
    this.disposed = true;
    for (const voice of this.voices) {
      voice.source.onended = null;
      stopSource(voice.source, 0);
      voice.source.disconnect();
      voice.gain.disconnect();
      voice.panner?.disconnect();
    }
    this.voices = [];
  }

  /**
   * The envelope, in one place because every player wants a different part of
   * it: a drum wants decay, a grain wants attack-hold-release, a loop wants
   * neither and just plays.
   */
  private applyEnvelope(gain: GainNodeLike, at: number, options: VoiceOptions): void {
    const level = Math.max(0, options.level);
    const attack = Math.max(0, options.attackSec ?? 0);

    if (attack > 0) {
      rampParam(gain.gain, 0, at, "none");
      rampParam(gain.gain, level, at, "linear", { durationSec: attack });
    } else {
      rampParam(gain.gain, level, at, "none");
    }

    const hold = options.holdSec;
    if (hold !== undefined && options.decaySec !== undefined) {
      // Grain window: rise, sit still, then fall. The flat middle is what keeps
      // overlapping grains from beating against each other.
      rampParam(gain.gain, level, at + Math.max(attack, hold), "none");
      rampParam(gain.gain, 0, at + Math.max(attack, hold), "exponential", {
        durationSec: Math.max(0.001, options.decaySec),
      });
      return;
    }
    if (options.decaySec !== undefined) {
      rampParam(gain.gain, 0, at + attack, "exponential", {
        durationSec: Math.max(0.001, options.decaySec),
      });
    }
  }

  /** Steal the oldest voice when the ceiling is reached. */
  private enforceCeiling(atSec: number): void {
    while (this.voices.length >= this.maxVoices) {
      let oldestIndex = 0;
      for (let i = 1; i < this.voices.length; i++) {
        if (this.voices[i].startedAtSec < this.voices[oldestIndex].startedAtSec) oldestIndex = i;
      }
      const [victim] = this.voices.splice(oldestIndex, 1);
      rampParam(victim.gain.gain, 0, atSec, "exponential", { durationSec: CHOKE_SEC });
      stopSource(victim.source, atSec + CHOKE_SEC * 2);
    }
  }

  private retire(voice: Voice): void {
    voice.source.onended = null;
    voice.source.disconnect();
    voice.gain.disconnect();
    voice.panner?.disconnect();
    const index = this.voices.indexOf(voice);
    if (index >= 0) this.voices.splice(index, 1);
  }
}

/** Web Audio clamps this itself; doing it here keeps a bad value out of the graph. */
export const clampPan = (value: number): number =>
  Number.isFinite(value) ? Math.min(1, Math.max(-1, value)) : 0;

/**
 * When a voice has become inaudible, or null when it plays to its own end.
 *
 * Exponential decay never mathematically reaches zero, so "finished" is a
 * judgement: three time constants is about −26 dB, past the point where a drum
 * tail is contributing anything but voice count.
 */
export function envelopeLifeSec(options: VoiceOptions): number | null {
  if (options.decaySec === undefined) return options.durationSec ?? null;
  const start = Math.max(options.attackSec ?? 0, options.holdSec ?? 0);
  return start + Math.max(0.001, options.decaySec) * 3;
}

function startSource(
  source: AudioBufferSourceNodeLike,
  atSec: number,
  offsetSec?: number,
  durationSec?: number,
): void {
  try {
    if (durationSec !== undefined) source.start(atSec, Math.max(0, offsetSec ?? 0), durationSec);
    else if (offsetSec !== undefined) source.start(atSec, Math.max(0, offsetSec));
    else source.start(atSec);
    /* v8 ignore next 4 — only a real browser throws here */
  } catch {
    // A source can only be started once, and an offset past the end of a buffer
    // throws. Neither is worth taking the whole scheduling pass down for.
  }
}

function stopSource(source: AudioBufferSourceNodeLike, atSec: number): void {
  try {
    source.stop(Math.max(0, atSec));
    /* v8 ignore next 3 — only a real browser throws here */
  } catch {
    // Already stopped, or never started. Both are the outcome we wanted.
  }
}
