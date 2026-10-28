import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AudioWorkletSchedulerDriver,
  browserDriverFactories,
  CLOCK_WORKLET_NAME,
  WorkerSchedulerDriver,
  type WorkletClockContext,
} from "./clock";

/**
 * The two off-main-thread scheduler drivers.
 *
 * Neither exists in Node, so both are exercised against stand-ins that record
 * what the driver asked the platform for. That is the point: the wake source is
 * the difference between a stream that keeps time in a background tab and one
 * that stutters whenever the canvas repaints, and it is the piece least likely
 * to be noticed if it silently stops working — everything still plays, just
 * worse.
 */

type Installed = { restore: () => void };

const install = (name: string, value: unknown): Installed => {
  const had = name in globalThis;
  const previous = (globalThis as Record<string, unknown>)[name];
  (globalThis as Record<string, unknown>)[name] = value;
  return {
    restore: () => {
      if (had) (globalThis as Record<string, unknown>)[name] = previous;
      else Reflect.deleteProperty(globalThis as object, name);
    },
  };
};

const installed: Installed[] = [];
const stub = (name: string, value: unknown) => installed.push(install(name, value));

afterEach(() => {
  while (installed.length > 0) installed.pop()?.restore();
  vi.restoreAllMocks();
});

/** A Worker that records what it was told, and can be made to post back. */
class FakeWorker {
  static last: FakeWorker | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  readonly posted: unknown[] = [];
  terminated = false;

  constructor(readonly url: string) {
    FakeWorker.last = this;
  }

  postMessage(data: unknown): void {
    this.posted.push(data);
  }

  terminate(): void {
    this.terminated = true;
  }

  /** Stand in for the interval firing inside the worker. */
  wake(): void {
    this.onmessage?.({ data: { type: "wake" } });
  }
}

const stubObjectUrls = () => {
  const revoked: string[] = [];
  stub("URL", {
    createObjectURL: () => "blob:fake",
    revokeObjectURL: (url: string) => revoked.push(url),
  });
  stub("Blob", class {
    constructor(readonly parts: unknown[], readonly options: unknown) {}
  });
  return revoked;
};

describe("The worker scheduler driver", () => {
  it("starts an interval in the worker and wakes the scheduler from it", () => {
    stubObjectUrls();
    stub("Worker", FakeWorker);

    const driver = new WorkerSchedulerDriver();
    expect(driver.kind).toBe("worker");
    const worker = FakeWorker.last as FakeWorker;
    expect(worker.url).toBe("blob:fake");

    const wake = vi.fn();
    driver.start(wake, 25);
    expect(worker.posted).toEqual([{ type: "start", intervalMs: 25 }]);

    worker.wake();
    expect(wake).toHaveBeenCalledTimes(1);
  });

  it("stops waking after stop, and stays quiet if the worker posts anyway", () => {
    stubObjectUrls();
    stub("Worker", FakeWorker);
    const driver = new WorkerSchedulerDriver();
    const worker = FakeWorker.last as FakeWorker;

    const wake = vi.fn();
    driver.start(wake, 25);
    driver.stop();
    expect(worker.posted[worker.posted.length - 1]).toEqual({ type: "stop" });

    // A message already in flight when stop was called must not fire.
    worker.wake();
    expect(wake).not.toHaveBeenCalled();
  });

  it("still schedules one-off wakes on the host timer", () => {
    stubObjectUrls();
    stub("Worker", FakeWorker);
    vi.useFakeTimers();
    const driver = new WorkerSchedulerDriver();
    const once = vi.fn();
    const handle = driver.once(once, 10);
    vi.advanceTimersByTime(10);
    expect(once).toHaveBeenCalledTimes(1);

    const cancelled = vi.fn();
    driver.cancel(driver.once(cancelled, 10));
    vi.advanceTimersByTime(20);
    expect(cancelled).not.toHaveBeenCalled();
    expect(handle).toBeDefined();
    vi.useRealTimers();
  });

  it("gives the worker and its blob url back on dispose", () => {
    const revoked = stubObjectUrls();
    stub("Worker", FakeWorker);
    const driver = new WorkerSchedulerDriver();
    const worker = FakeWorker.last as FakeWorker;
    driver.start(() => {}, 25);
    driver.dispose();
    expect(worker.terminated).toBe(true);
    expect(revoked).toEqual(["blob:fake"]);
  });
});

/** An AudioWorkletNode stand-in with a port we can post through. */
class FakeWorkletNode {
  static last: FakeWorkletNode | null = null;
  readonly port = {
    onmessage: null as ((event: unknown) => void) | null,
  };
  disconnected = 0;
  constructor(readonly context: unknown, readonly name: string, readonly options: unknown) {
    FakeWorkletNode.last = this;
  }
  connect(): void {}
  disconnect(): void {
    this.disconnected += 1;
  }
  wake(): void {
    this.port.onmessage?.({ data: 0 });
  }
}

const fakeContext = (overrides: Partial<WorkletClockContext> = {}): WorkletClockContext & {
  added: string[];
} => {
  const added: string[] = [];
  return {
    added,
    sampleRate: 48000,
    destination: {} as AudioNode,
    audioWorklet: {
      addModule: async (url: string) => {
        added.push(url);
      },
    },
    createGain: () => ({
      gain: { value: 1 },
      connect: () => {},
      disconnect: () => {},
    } as unknown as GainNode),
    ...overrides,
  };
};

describe("The audio worklet scheduler driver", () => {
  it("registers the processor, wires it to the destination, and wakes from it", async () => {
    const revoked = stubObjectUrls();
    stub("AudioWorkletNode", FakeWorkletNode);
    const context = fakeContext();

    const driver = await AudioWorkletSchedulerDriver.create(context, 25);
    expect(driver).not.toBeNull();
    expect(driver?.kind).toBe("audio-worklet");
    expect(context.added).toEqual(["blob:fake"]);
    // The blob is released whether or not the module loaded.
    expect(revoked).toEqual(["blob:fake"]);

    const node = FakeWorkletNode.last as FakeWorkletNode;
    expect(node.name).toBe(CLOCK_WORKLET_NAME);

    const wake = vi.fn();
    driver?.start(wake);
    node.wake();
    expect(wake).toHaveBeenCalledTimes(1);

    driver?.stop();
    node.wake();
    expect(wake).toHaveBeenCalledTimes(1);
  });

  it("counts render quanta rather than milliseconds", async () => {
    stubObjectUrls();
    stub("AudioWorkletNode", FakeWorkletNode);
    await AudioWorkletSchedulerDriver.create(fakeContext(), 25);
    const options = (FakeWorkletNode.last as FakeWorkletNode).options as {
      processorOptions: { quantaPerWake: number };
    };
    // 25 ms at 48 kHz is 1200 frames, which is 9.4 quanta of 128.
    expect(options.processorOptions.quantaPerWake).toBeGreaterThan(1);
    expect(Number.isInteger(options.processorOptions.quantaPerWake)).toBe(true);
  });

  it("returns nothing when the platform cannot provide one", async () => {
    stubObjectUrls();
    // No AudioWorkletNode constructor at all.
    expect(await AudioWorkletSchedulerDriver.create(fakeContext(), 25)).toBeNull();

    stub("AudioWorkletNode", FakeWorkletNode);
    // A context with no worklet support.
    expect(await AudioWorkletSchedulerDriver.create(
      fakeContext({ audioWorklet: undefined }), 25,
    )).toBeNull();
  });

  it("returns nothing, and leaks no blob, when loading the module fails", async () => {
    const revoked = stubObjectUrls();
    stub("AudioWorkletNode", FakeWorkletNode);
    const context = fakeContext({
      audioWorklet: { addModule: async () => { throw new Error("CSP"); } },
    });
    expect(await AudioWorkletSchedulerDriver.create(context, 25)).toBeNull();
    expect(revoked).toEqual(["blob:fake"]);
  });

  it("unwires itself on dispose", async () => {
    stubObjectUrls();
    stub("AudioWorkletNode", FakeWorkletNode);
    const driver = await AudioWorkletSchedulerDriver.create(fakeContext(), 25);
    const node = FakeWorkletNode.last as FakeWorkletNode;
    driver?.dispose();
    expect(node.port.onmessage).toBeNull();
    expect(node.disconnected).toBe(1);
  });

  it("still schedules one-off wakes on the host timer", async () => {
    stubObjectUrls();
    stub("AudioWorkletNode", FakeWorkletNode);
    vi.useFakeTimers();
    const driver = await AudioWorkletSchedulerDriver.create(fakeContext(), 25);
    const once = vi.fn();
    driver?.once(once, 5);
    vi.advanceTimersByTime(5);
    expect(once).toHaveBeenCalledTimes(1);

    const cancelled = vi.fn();
    const handle = driver?.once(cancelled, 5);
    if (handle !== undefined) driver?.cancel(handle);
    vi.advanceTimersByTime(10);
    expect(cancelled).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("has nothing to release when the blob could not even be made", async () => {
    stub("URL", {
      createObjectURL: () => { throw new Error("blocked"); },
      revokeObjectURL: () => { throw new Error("should not be called"); },
    });
    stub("Blob", class {});
    stub("AudioWorkletNode", FakeWorkletNode);
    expect(await AudioWorkletSchedulerDriver.create(fakeContext(), 25)).toBeNull();
  });
});

describe("Choosing a driver in a browser", () => {
  it("offers the worklet only when there is a context to hang it on", async () => {
    stubObjectUrls();
    stub("AudioWorkletNode", FakeWorkletNode);
    expect(browserDriverFactories(null, 25).audioWorklet).toBeUndefined();
    const factory = browserDriverFactories(fakeContext(), 25).audioWorklet;
    expect(factory).toBeDefined();
    expect(await factory?.()).toBeInstanceOf(AudioWorkletSchedulerDriver);
  });

  it("offers a worker only where the platform has one", () => {
    stubObjectUrls();
    stub("Worker", FakeWorker);
    const factory = browserDriverFactories(null, 25).worker;
    expect(factory?.()).toBeInstanceOf(WorkerSchedulerDriver);
    installed.pop()?.restore();
    expect(browserDriverFactories(null, 25).worker).toBeUndefined();
  });

  it("always offers the timer, which needs nothing", () => {
    expect(browserDriverFactories(null, 25).timer()).toBeDefined();
  });
});
