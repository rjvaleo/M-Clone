// The slice of Web Audio this codebase actually touches.
//
// Nothing here imports from `lib.dom`. Every audio construction goes through a
// context described by this file, which buys two things: the tests run under
// Node with hand-written fakes and no browser shim, and the surface an effect
// may reach for is small enough to read in one screen. If a topology needs a
// node type that is not listed, that is a deliberate decision to make, not
// something that arrives by autocomplete.

import type { AudioParamLike } from "./params";
import type { AudioNodeLike } from "./graphAdapter";

export type BiquadFilterKind =
  | "lowpass"
  | "highpass"
  | "bandpass"
  | "lowshelf"
  | "highshelf"
  | "peaking"
  | "notch"
  | "allpass";

export interface GainNodeLike extends AudioNodeLike {
  readonly gain: AudioParamLike;
}

export interface DelayNodeLike extends AudioNodeLike {
  readonly delayTime: AudioParamLike;
}

export interface BiquadFilterNodeLike extends AudioNodeLike {
  type: BiquadFilterKind;
  readonly frequency: AudioParamLike;
  readonly Q: AudioParamLike;
  readonly gain: AudioParamLike;
}

export interface AudioBufferLike {
  readonly sampleRate: number;
  readonly length: number;
  readonly numberOfChannels: number;
  getChannelData(channel: number): Float32Array;
}

export interface ConvolverNodeLike extends AudioNodeLike {
  buffer: AudioBufferLike | null;
  normalize: boolean;
}

export interface WaveShaperNodeLike extends AudioNodeLike {
  curve: Float32Array | null;
  oversample: "none" | "2x" | "4x";
}

export interface AudioBufferSourceNodeLike extends AudioNodeLike {
  buffer: AudioBufferLike | null;
  loop: boolean;
  /** Only consulted while `loop` is true. */
  loopStart: number;
  loopEnd: number;
  readonly playbackRate: AudioParamLike;
  onended: (() => void) | null;
  start(when?: number, offset?: number, duration?: number): void;
  stop(when?: number): void;
}

/** The wave shapes an oscillator can take without being handed coefficients. */
export type OscillatorKind = "sine" | "square" | "sawtooth" | "triangle" | "custom";

/** A Fourier series an oscillator can be tuned to; see `pulseWaveCoefficients`. */
export interface PeriodicWaveLike {
  readonly real: Float32Array;
  readonly imag: Float32Array;
}

/**
 * A pitch generator.
 *
 * `frequency` and `detune` are two inputs to the same pitch — hertz and cents —
 * and both are `AudioParam`s, which is what lets a scale, an envelope and an LFO
 * all reach the same note without any of them recomputing the others' work.
 *
 * Like a buffer source, an oscillator is single-use: it cannot be restarted, and
 * stopping one that never started throws.
 */
export interface OscillatorNodeLike extends AudioNodeLike {
  type: OscillatorKind;
  readonly frequency: AudioParamLike;
  /** Cents, added to `frequency`. The tuning library speaks this. */
  readonly detune: AudioParamLike;
  onended: (() => void) | null;
  setPeriodicWave(wave: PeriodicWaveLike): void;
  start(when?: number): void;
  stop(when?: number): void;
}

/** Places a signal in the stereo field; −1 is hard left, +1 hard right. */
export interface StereoPannerNodeLike extends AudioNodeLike {
  readonly pan: AudioParamLike;
}

/**
 * Takes one multi-channel signal apart into one output per channel.
 *
 * Connect *from* an indexed output: `splitter.connect(destination, channel)`.
 * Web Audio's default up-mixing means a mono source arriving here appears on
 * both outputs, which is what makes a widener safe to put in front of anything.
 */
export interface ChannelSplitterNodeLike extends AudioNodeLike {
  readonly numberOfOutputs: number;
}

/**
 * Puts channels back together into one multi-channel signal.
 *
 * Connect *to* an indexed input: `source.connect(merger, 0, channel)`. The
 * third argument is the reason `AudioNodeLike.connect` grew its two optional
 * indices — without them there is no way to address a specific side.
 */
export interface ChannelMergerNodeLike extends AudioNodeLike {
  readonly numberOfInputs: number;
}

export interface CompressorNodeLike extends AudioNodeLike {
  readonly threshold: AudioParamLike;
  readonly knee: AudioParamLike;
  readonly ratio: AudioParamLike;
  readonly attack: AudioParamLike;
  readonly release: AudioParamLike;
  /** Negative decibels of gain reduction currently applied. */
  readonly reduction?: number;
}

/**
 * Everything an effect may build. Deliberately short.
 *
 * `createOscillator` was added when the Blackhole and DP/4 tanks arrived, and
 * it is worth saying why rather than letting it look like scope creep. A
 * feedback reverb rings: its delay lines are fixed lengths, so a sustained tone
 * excites the same modes forever and the tail acquires a metallic pitch. Every
 * serious reverb answers this the same way — modulate the line lengths slightly
 * so no mode can settle. Both machines document exactly that (`Mod Depth`,
 * `Detune Rate`/`Detune Depth`), and both describe what happens without it in
 * the same word: *metallic*.
 *
 * Modulating a `DelayNode` means driving its `delayTime` from an audio-rate
 * signal, and the only source of one is an oscillator. There is no way to do it
 * from the control side — `rampParam` schedules a value, it does not oscillate.
 * So the choice was between widening this interface by one method or shipping
 * reverbs with a known ring, and the ring is not a defensible default.
 *
 * The fake context in `testing/fakeContext.ts` already implemented it for the
 * synth path, so nothing else had to change.
 */
export interface EffectContext {
  readonly sampleRate: number;
  readonly currentTime: number;
  createGain(): GainNodeLike;
  createDelay(maxDelaySeconds: number): DelayNodeLike;
  createBiquadFilter(): BiquadFilterNodeLike;
  createConvolver(): ConvolverNodeLike;
  createWaveShaper(): WaveShaperNodeLike;
  createDynamicsCompressor(): CompressorNodeLike;
  createBuffer(channels: number, frames: number, sampleRate: number): AudioBufferLike;
  /** An LFO source for modulated delay lines. See the note above. */
  createOscillator(): OscillatorNodeLike;
  /**
   * Stereo placement. Promoted here from `SynthContext` when the sample
   * players and the mixer gained pan: putting a signal somewhere in the field
   * is not a synthesis concern, and a drum that cannot be panned is a drum in
   * the middle of every mix it appears in.
   */
  createStereoPanner(): StereoPannerNodeLike;
  /** Take a stereo signal apart. Sides are addressed by output index. */
  createChannelSplitter(numberOfOutputs: number): ChannelSplitterNodeLike;
  /** Put one back together. Sides are addressed by input index. */
  createChannelMerger(numberOfInputs: number): ChannelMergerNodeLike;
}

/** What playing a sample needs, on top of what building an effect needs. */
export interface SampleContext extends EffectContext {
  createBufferSource(): AudioBufferSourceNodeLike;
  /**
   * Note that this **detaches** the buffer it is given: the caller keeps no
   * usable copy afterwards, so anything else that needs the bytes must read
   * them first or hand over a copy.
   */
  decodeAudioData(data: ArrayBuffer): Promise<AudioBufferLike>;
}

/**
 * What generating a pitch needs, on top of what playing a sample needs.
 *
 * Kept as its own step rather than folded into `EffectContext` so the
 * distinction stays visible: an effect processes a signal it is given, and only
 * a synth conjures one out of nothing.
 */
export interface SynthContext extends SampleContext {
  // `createOscillator` is inherited from EffectContext, where the reverb tanks
  // need it as an LFO. A synth wants it as a voice — same node, different job.
  // `createStereoPanner` is inherited too, for the same kind of reason: the
  // synth was its first caller, and it stopped being its only one.
  createPeriodicWave(real: Float32Array, imag: Float32Array): PeriodicWaveLike;
}
