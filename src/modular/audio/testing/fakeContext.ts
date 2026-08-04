// A Web Audio context made of plain objects, for tests.
//
// It lives in a subfolder deliberately. `params.test.ts` scans every `*.ts` in
// the audio folder for direct `.value` assignments, and a fake `AudioParam` has
// to assign to its own `value` to be a useful fake — so putting it beside the
// real sources would either trip the guard or force the guard to grow an
// exception, and a rule with an exception in it is a rule people stop reading.
//
// What the fake records is chosen to make the audio contract checkable rather
// than to imitate Web Audio faithfully: every scheduled write, every connection,
// every disconnect, and how many nodes were ever constructed.

import type { AudioParamLike } from "../params";
import type { AudioNodeLike } from "../graphAdapter";
import type {
  AudioBufferLike,
  AudioBufferSourceNodeLike,
  BiquadFilterKind,
  BiquadFilterNodeLike,
  CompressorNodeLike,
  ConvolverNodeLike,
  DelayNodeLike,
  EffectContext,
  GainNodeLike,
  WaveShaperNodeLike,
} from "../nodes";
import type { EngineContext } from "../audioEngine";

export type ParamCall = {
  method: "set" | "linear" | "exponential" | "target" | "cancel";
  value: number;
  time: number;
};

export class FakeParam implements AudioParamLike {
  value: number;
  readonly calls: ParamCall[] = [];

  constructor(initial = 0) {
    this.value = initial;
  }

  setValueAtTime(value: number, startTime: number): void {
    this.calls.push({ method: "set", value, time: startTime });
    this.value = value;
  }

  linearRampToValueAtTime(value: number, endTime: number): void {
    this.calls.push({ method: "linear", value, time: endTime });
    this.value = value;
  }

  exponentialRampToValueAtTime(value: number, endTime: number): void {
    this.calls.push({ method: "exponential", value, time: endTime });
    this.value = value;
  }

  setTargetAtTime(target: number, startTime: number, timeConstant: number): void {
    this.calls.push({ method: "target", value: target, time: startTime });
    void timeConstant;
    this.value = target;
  }

  cancelScheduledValues(startTime: number): void {
    this.calls.push({ method: "cancel", value: this.value, time: startTime });
  }

  /** Scheduled writes only — the cancel-and-pin preamble is not a move. */
  moves(): ParamCall[] {
    return this.calls.filter((call) => call.method !== "cancel");
  }
}

export class FakeNode implements AudioNodeLike {
  readonly outgoing = new Set<AudioNodeLike>();
  disconnectCalls = 0;

  constructor(readonly kind: string) {}

  connect(destination: AudioNodeLike): void {
    this.outgoing.add(destination);
  }

  disconnect(destination?: AudioNodeLike): void {
    this.disconnectCalls += 1;
    if (destination) this.outgoing.delete(destination);
    else this.outgoing.clear();
  }
}

export class FakeGain extends FakeNode implements GainNodeLike {
  readonly gain = new FakeParam(1);
  constructor() {
    super("gain");
  }
}

export class FakeDelay extends FakeNode implements DelayNodeLike {
  readonly delayTime = new FakeParam(0);
  constructor(readonly maxDelaySeconds: number) {
    super("delay");
  }
}

export class FakeBiquad extends FakeNode implements BiquadFilterNodeLike {
  type: BiquadFilterKind = "lowpass";
  readonly frequency = new FakeParam(350);
  readonly Q = new FakeParam(1);
  readonly gain = new FakeParam(0);
  constructor() {
    super("biquad");
  }
}

export class FakeConvolver extends FakeNode implements ConvolverNodeLike {
  buffer: AudioBufferLike | null = null;
  normalize = true;
  constructor() {
    super("convolver");
  }
}

export class FakeWaveShaper extends FakeNode implements WaveShaperNodeLike {
  curve: Float32Array | null = null;
  oversample: "none" | "2x" | "4x" = "none";
  constructor() {
    super("waveshaper");
  }
}

export class FakeCompressor extends FakeNode implements CompressorNodeLike {
  readonly threshold = new FakeParam(-24);
  readonly knee = new FakeParam(30);
  readonly ratio = new FakeParam(12);
  readonly attack = new FakeParam(0.003);
  readonly release = new FakeParam(0.25);
  readonly reduction = 0;
  constructor() {
    super("compressor");
  }
}

export class FakeBufferSource extends FakeNode implements AudioBufferSourceNodeLike {
  buffer: AudioBufferLike | null = null;
  loop = false;
  loopStart = 0;
  loopEnd = 0;
  readonly playbackRate = new FakeParam(1);
  onended: (() => void) | null = null;
  readonly starts: number[] = [];
  readonly stops: number[] = [];
  private started = false;

  constructor() {
    super("buffer-source");
  }

  start(when = 0): void {
    this.started = true;
    this.starts.push(when);
  }

  stop(when = 0): void {
    // Web Audio throws when a source that never started is stopped, and the
    // audition path depends on that being survivable.
    if (!this.started) throw new Error("cannot stop a source that has not started");
    this.stops.push(when);
  }

  /** Drive the natural-finish path a test cannot wait for. */
  finish(): void {
    this.onended?.();
  }
}

export class FakeBuffer implements AudioBufferLike {
  private readonly channels: Float32Array[];

  constructor(
    readonly numberOfChannels: number,
    readonly length: number,
    readonly sampleRate: number,
  ) {
    this.channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }

  getChannelData(channel: number): Float32Array {
    return this.channels[channel];
  }
}

export class FakeAudioContext implements EffectContext, EngineContext {
  currentTime = 0;
  state: "suspended" | "running" | "closed" = "suspended";
  readonly destination = new FakeNode("destination");
  readonly created: FakeNode[] = [];
  readonly buffers: FakeBuffer[] = [];
  /** Byte lengths handed to the decoder, in order. */
  readonly decoded: number[] = [];
  resumeCalls = 0;
  closeCalls = 0;

  constructor(readonly sampleRate = 48000) {}

  /** How many nodes of a kind exist, for leak and churn assertions. */
  countOf(kind: string): number {
    return this.created.filter((node) => node.kind === kind).length;
  }

  createGain(): GainNodeLike {
    return this.track(new FakeGain());
  }

  createDelay(maxDelaySeconds: number): DelayNodeLike {
    return this.track(new FakeDelay(maxDelaySeconds));
  }

  createBiquadFilter(): BiquadFilterNodeLike {
    return this.track(new FakeBiquad());
  }

  createConvolver(): ConvolverNodeLike {
    return this.track(new FakeConvolver());
  }

  createWaveShaper(): WaveShaperNodeLike {
    return this.track(new FakeWaveShaper());
  }

  createDynamicsCompressor(): CompressorNodeLike {
    return this.track(new FakeCompressor());
  }

  createBuffer(channels: number, frames: number, sampleRate: number): AudioBufferLike {
    const buffer = new FakeBuffer(channels, frames, sampleRate);
    this.buffers.push(buffer);
    return buffer;
  }

  createBufferSource(): AudioBufferSourceNodeLike {
    return this.track(new FakeBufferSource());
  }

  /**
   * Stands in for the real decoder, including the part that matters: it
   * **detaches** the buffer it is handed, so a caller that hashes the same
   * bytes afterwards gets nothing — which is the bug this fake exists to catch.
   */
  async decodeAudioData(data: ArrayBuffer): Promise<AudioBufferLike> {
    const bytes = new Uint8Array(data);
    if (bytes.length < 4) throw new Error("Unrecognised audio format");
    const frames = Math.max(1, bytes.length);
    const buffer = new FakeBuffer(1, frames, this.sampleRate);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < frames; i++) channel[i] = (bytes[i] / 128) - 1;
    this.buffers.push(buffer);
    this.decoded.push(bytes.length);
    // `structuredClone` with a transfer is the only way to genuinely detach a
    // buffer in a test; emptying the caller's view is what a real decode does.
    try {
      structuredClone(data, { transfer: [data] });
      /* v8 ignore next 3 — Node supports transfer, so this never runs here */
    } catch {
      // Environments without transferable support still exercise everything else.
    }
    return buffer;
  }

  async resume(): Promise<void> {
    this.resumeCalls += 1;
    this.state = "running";
  }

  async close(): Promise<void> {
    this.closeCalls += 1;
    this.state = "closed";
  }

  private track<T extends FakeNode>(node: T): T {
    this.created.push(node);
    return node;
  }
}
