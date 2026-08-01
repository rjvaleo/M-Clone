import { afterEach, describe, expect, it, vi } from "vitest";
import { createDefaultProject } from "./project";
import { MRuntime } from "./runtime";
import type { ClockDriver, SchedulerDriver } from "./scheduler";

class FakeAudioContext {
  currentTime = 0;
  state: AudioContextState = "running";
  destination = {} as AudioDestinationNode;
  createGain() {
    return {
      gain: { value: 0 },
      connect: vi.fn(),
    } as unknown as GainNode;
  }
  getOutputTimestamp() {
    return { contextTime: this.currentTime, performanceTime: this.currentTime * 1000 };
  }
  resume = vi.fn(async () => undefined);
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("browser runtime transport", () => {
  it("reports musical elapsed time from the transport origin", async () => {
    vi.stubGlobal("AudioContext", FakeAudioContext);
    let now = 10;
    const runtime = new MRuntime(() => createDefaultProject(), null, {
      clock: { nowSec: () => now },
    });
    expect(runtime.transportElapsedSec()).toBe(0);
    await runtime.start();
    now = 11;
    expect(runtime.transportElapsedSec()).toBeCloseTo(0.94, 9);
    runtime.stop();
  });
  it("submits MIDI before publishing UI telemetry and makes start idempotent", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("AudioContext", FakeAudioContext);
    const sent: number[][] = [];
    const port = {
      send(data: number[] | Uint8Array) { sent.push(Array.from(data)); },
      clear: vi.fn(),
    } as unknown as MIDIOutput;
    let sendsSeenByTelemetry = -1;
    const runtime = new MRuntime(
      () => createDefaultProject(),
      () => { sendsSeenByTelemetry = sent.length; },
    );
    runtime.setSynthEnabled(false);
    runtime.selectMidiOutput(port);

    await runtime.start();
    await runtime.start();
    await vi.advanceTimersByTimeAsync(25);

    expect(sendsSeenByTelemetry).toBeGreaterThan(0);
    expect(sent.length).toBe(sendsSeenByTelemetry);
  });

  it("clears future MIDI before stop panic messages", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("AudioContext", FakeAudioContext);
    const order: string[] = [];
    const port = {
      send() { order.push("send"); },
      clear() { order.push("clear"); },
    } as unknown as MIDIOutput;
    const runtime = new MRuntime(() => createDefaultProject());
    runtime.setSynthEnabled(false);
    runtime.selectMidiOutput(port);
    await runtime.start();
    order.length = 0;

    runtime.stop();

    expect(order[0]).toBe("clear");
    expect(order.slice(1)).toEqual(Array(48).fill("send"));
    expect(runtime.isRunning()).toBe(false);
  });

  it("uses the injected scheduler for transport and audition", async () => {
    vi.stubGlobal("AudioContext", FakeAudioContext);
    const repeated: Array<() => void> = [];
    const oneShots: Array<() => void> = [];
    const scheduler: SchedulerDriver = {
      repeat: vi.fn((callback) => (repeated.push(callback), callback)),
      once: vi.fn((callback) => (oneShots.push(callback), callback)),
      cancel: vi.fn(),
    };
    const runtime = new MRuntime(() => createDefaultProject(), null, { scheduler });
    runtime.setSynthEnabled(false);
    await runtime.start();
    runtime.audition([60], 100, [1]);
    expect(scheduler.repeat).toHaveBeenCalledTimes(1);
    expect(scheduler.once).toHaveBeenCalledTimes(1);
    runtime.stop();
    expect(scheduler.cancel).toHaveBeenCalled();
  });

  it("exposes one retained multi-port registry", () => {
    vi.stubGlobal("AudioContext", FakeAudioContext);
    const runtime = new MRuntime(() => createDefaultProject());
    const first = runtime.midiPorts();
    expect(runtime.midiPorts()).toBe(first);
    const port = { id: "a", send: vi.fn() } as unknown as MIDIOutput;
    runtime.selectMidiOutputs(new Map([["a", port]]));
    expect(runtime.midiSink?.outputIds()).toEqual(["a"]);
  });

  it("recovers from a 500 ms wake stall without planning an overdue burst", async () => {
    vi.stubGlobal("AudioContext", FakeAudioContext);
    let wake: (() => void) | null = null;
    const scheduler: SchedulerDriver = {
      repeat: (callback) => (wake = callback, callback),
      once: (callback) => callback,
      cancel: vi.fn(),
    };
    const published: number[] = [];
    let now = 0;
    const clock: ClockDriver = { nowSec: () => now };
    const runtime = new MRuntime(
      () => createDefaultProject(),
      (notes) => published.push(...notes.map((note) => note.startSec)),
      { scheduler, clock },
    );
    runtime.setSynthEnabled(false);
    await runtime.start();
    now = 0.5;
    wake!();
    expect(runtime.schedulingDiagnostics()).toMatchObject({ recoveries: 1, droppedWindows: 1 });
    expect(published.every((at) => at >= 0.5)).toBe(true);
  });

  it("clears lifecycle state during suspension and recovers at a fresh boundary", async () => {
    vi.stubGlobal("AudioContext", FakeAudioContext);
    let wake: (() => void) | null = null;
    let now = 0;
    const scheduler: SchedulerDriver = {
      repeat: (callback) => (wake = callback, callback),
      once: (callback) => callback,
      cancel: vi.fn(),
    };
    const runtime = new MRuntime(() => createDefaultProject(), null, {
      scheduler,
      clock: { nowSec: () => now },
    });
    runtime.setSynthEnabled(false);
    await runtime.start();
    const context = runtime.context as unknown as FakeAudioContext;
    context.state = "suspended";
    wake!();
    context.state = "running";
    now = 5;
    wake!();
    expect(runtime.schedulingDiagnostics().recoveries).toBe(1);
  });
});
