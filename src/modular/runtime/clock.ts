// The scheduling wake-up driver.
//
// Classic drove its lookahead scheduler from a main-thread `setInterval`. That
// is the weakest link in the whole timing chain for Modular, for two reasons:
//
//   - browsers throttle main-thread timers to once per second (or stop them
//     entirely) in a background tab, so a patch left running while the user
//     switches away stops receiving windows and the music tears;
//   - the Modular UI is a pannable, zoomable canvas with many live node faces.
//     A layout pass or a React commit blocks the timer for as long as it takes,
//     and the lookahead has to absorb every one of those stalls.
//
// So the wake comes from somewhere the main thread cannot block:
//
//   1. an AudioWorklet that counts render quanta on the audio thread — the
//      same clock the music is scheduled against, immune to tab throttling;
//   2. a Web Worker timer, which keeps running when a background tab throttles
//      the main thread;
//   3. a main-thread timer, only when neither of the above can be constructed.
//
// The driver is an interface throughout, so tests drive windows by hand and
// the runtime never knows or cares which one it got.

export type WakeHandle = unknown;

export type SchedulerDriverKind = "audio-worklet" | "worker" | "timer" | "manual";

export interface SchedulerDriver {
  /** Which mechanism this is, for diagnostics and the transport tooltip. */
  readonly kind: SchedulerDriverKind;
  /** Begin waking `callback` roughly every `intervalMs`. */
  start(callback: () => void, intervalMs: number): void;
  /** Stop waking. Safe to call when not started. */
  stop(): void;
  /** One deferred wake, for note-off tails and auditions. */
  once(callback: () => void, delayMs: number): WakeHandle;
  cancel(handle: WakeHandle): void;
  /** Release any platform resources. The driver is unusable afterwards. */
  dispose(): void;
}

/** Wakes only when a test tells it to. */
export class ManualSchedulerDriver implements SchedulerDriver {
  readonly kind = "manual" as const;
  private callback: (() => void) | null = null;
  private pending = new Map<number, () => void>();
  private nextHandle = 1;
  intervalMs = 0;

  start(callback: () => void, intervalMs: number): void {
    this.callback = callback;
    this.intervalMs = intervalMs;
  }

  stop(): void {
    this.callback = null;
  }

  once(callback: () => void, delayMs: number): WakeHandle {
    const handle = this.nextHandle++;
    this.pending.set(handle, callback);
    void delayMs;
    return handle;
  }

  cancel(handle: WakeHandle): void {
    this.pending.delete(handle as number);
  }

  dispose(): void {
    this.stop();
    this.pending.clear();
  }

  /** Deliver `count` scheduling wakes. */
  fire(count = 1): void {
    for (let i = 0; i < count; i++) this.callback?.();
  }

  /** Deliver every deferred wake, oldest first. */
  fireDeferred(): void {
    const callbacks = [...this.pending.values()];
    this.pending.clear();
    for (const callback of callbacks) callback();
  }

  get running(): boolean {
    return this.callback !== null;
  }

  get deferredCount(): number {
    return this.pending.size;
  }
}

/** Last-resort main-thread timer. Throttled in background tabs. */
export class TimerSchedulerDriver implements SchedulerDriver {
  readonly kind = "timer" as const;
  private timer: ReturnType<typeof setInterval> | null = null;

  start(callback: () => void, intervalMs: number): void {
    this.stop();
    this.timer = setInterval(callback, intervalMs);
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  once(callback: () => void, delayMs: number): WakeHandle {
    return setTimeout(callback, delayMs);
  }

  cancel(handle: WakeHandle): void {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  }

  dispose(): void {
    this.stop();
  }
}

/**
 * A worker whose only job is to post a message on an interval. Worker timers
 * are not subject to the same background-tab throttling as the main thread.
 */
const WORKER_SOURCE = `
let timer = null;
self.onmessage = (event) => {
  const data = event.data || {};
  if (data.type === "start") {
    if (timer !== null) clearInterval(timer);
    timer = setInterval(() => self.postMessage({ type: "wake" }), data.intervalMs);
  } else if (data.type === "stop") {
    if (timer !== null) clearInterval(timer);
    timer = null;
  }
};
`;

export class WorkerSchedulerDriver implements SchedulerDriver {
  readonly kind = "worker" as const;
  private readonly worker: Worker;
  private readonly url: string;
  private callback: (() => void) | null = null;

  constructor() {
    this.url = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: "text/javascript" }));
    this.worker = new Worker(this.url);
    this.worker.onmessage = () => this.callback?.();
  }

  start(callback: () => void, intervalMs: number): void {
    this.callback = callback;
    this.worker.postMessage({ type: "start", intervalMs });
  }

  stop(): void {
    this.callback = null;
    this.worker.postMessage({ type: "stop" });
  }

  // Deferred wakes are not time-critical — they only trigger a re-drain of a
  // queue whose events already carry their own timestamps.
  once(callback: () => void, delayMs: number): WakeHandle {
    return setTimeout(callback, delayMs);
  }

  cancel(handle: WakeHandle): void {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  }

  dispose(): void {
    this.stop();
    this.worker.terminate();
    URL.revokeObjectURL(this.url);
  }
}

/**
 * A processor that counts render quanta on the audio thread and posts a wake.
 * It outputs silence so the graph has a reason to keep pulling it.
 */
const WORKLET_SOURCE = `
class MCloneClockProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const config = (options && options.processorOptions) || {};
    this.quantaPerWake = Math.max(1, config.quantaPerWake || 4);
    this.counter = 0;
  }
  process() {
    this.counter += 1;
    if (this.counter >= this.quantaPerWake) {
      this.counter = 0;
      this.port.postMessage(0);
    }
    return true;
  }
}
registerProcessor("m-clone-clock", MCloneClockProcessor);
`;

export const CLOCK_WORKLET_NAME = "m-clone-clock";

/** The audio context surface the worklet driver needs. */
export interface WorkletClockContext {
  readonly sampleRate: number;
  readonly destination: AudioNode;
  readonly audioWorklet?: { addModule(url: string): Promise<void> };
  createGain(): GainNode;
}

/**
 * Wakes on the audio thread. Immune to main-thread jank and tab throttling,
 * and locked to the same clock the music is scheduled against.
 */
export class AudioWorkletSchedulerDriver implements SchedulerDriver {
  readonly kind = "audio-worklet" as const;
  private readonly node: AudioWorkletNode;
  private readonly silence: GainNode;
  private callback: (() => void) | null = null;

  private constructor(node: AudioWorkletNode, silence: GainNode) {
    this.node = node;
    this.silence = silence;
    this.node.port.onmessage = () => this.callback?.();
  }

  /**
   * Build the driver, or return null when the platform cannot provide one —
   * the caller then falls back rather than failing to start playback.
   */
  static async create(
    context: WorkletClockContext,
    intervalMs: number,
  ): Promise<AudioWorkletSchedulerDriver | null> {
    if (!context.audioWorklet || typeof AudioWorkletNode === "undefined") return null;
    let url: string | null = null;
    try {
      url = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: "text/javascript" }));
      await context.audioWorklet.addModule(url);
      const node = new AudioWorkletNode(context as unknown as BaseAudioContext, CLOCK_WORKLET_NAME, {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        processorOptions: { quantaPerWake: quantaPerWake(context.sampleRate, intervalMs) },
      });
      // A node with no path to the destination may never be pulled, so route
      // its silent output through a muted gain.
      const silence = context.createGain();
      silence.gain.value = 0;
      node.connect(silence);
      silence.connect(context.destination);
      const driver = new AudioWorkletSchedulerDriver(node, silence);
      URL.revokeObjectURL(url);
      return driver;
    } catch {
      // Released on both paths rather than in a `finally`, so that each one is
      // a branch a test can stand on. `url` is null only when creating it was
      // itself what failed.
      if (url) URL.revokeObjectURL(url);
      return null;
    }
  }

  start(callback: () => void): void {
    this.callback = callback;
  }

  stop(): void {
    this.callback = null;
  }

  once(callback: () => void, delayMs: number): WakeHandle {
    return setTimeout(callback, delayMs);
  }

  cancel(handle: WakeHandle): void {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  }

  dispose(): void {
    this.stop();
    this.node.port.onmessage = null;
    this.node.disconnect();
    this.silence.disconnect();
  }
}

/** Render quanta (128 frames each) closest to the requested wake interval. */
export function quantaPerWake(sampleRate: number, intervalMs: number): number {
  const rate = Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : 48_000;
  const interval = Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : 25;
  return Math.max(1, Math.round((interval / 1000) * rate / 128));
}

export type DriverFactories = {
  audioWorklet?: () => Promise<SchedulerDriver | null>;
  worker?: () => SchedulerDriver | null;
  timer: () => SchedulerDriver;
};

/**
 * Pick the best driver this platform can actually construct. Every step is
 * allowed to fail — a browser without AudioWorklet, a page whose CSP blocks
 * blob workers, an audio context that will not start — and playback still
 * begins on the next option down.
 */
export async function createSchedulerDriver(
  factories: DriverFactories,
): Promise<SchedulerDriver> {
  if (factories.audioWorklet) {
    try {
      const driver = await factories.audioWorklet();
      if (driver) return driver;
    } catch {
      // fall through
    }
  }
  if (factories.worker) {
    try {
      const driver = factories.worker();
      if (driver) return driver;
    } catch {
      // fall through
    }
  }
  return factories.timer();
}

/** The factory set used in a browser. */
export function browserDriverFactories(
  context: WorkletClockContext | null,
  intervalMs: number,
): DriverFactories {
  return {
    audioWorklet: context
      ? () => AudioWorkletSchedulerDriver.create(context, intervalMs)
      : undefined,
    worker: typeof Worker === "undefined" ? undefined : () => new WorkerSchedulerDriver(),
    timer: () => new TimerSchedulerDriver(),
  };
}
