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

export interface CompressorNodeLike extends AudioNodeLike {
  readonly threshold: AudioParamLike;
  readonly knee: AudioParamLike;
  readonly ratio: AudioParamLike;
  readonly attack: AudioParamLike;
  readonly release: AudioParamLike;
  /** Negative decibels of gain reduction currently applied. */
  readonly reduction?: number;
}

/** Everything an effect may build. Deliberately short. */
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
