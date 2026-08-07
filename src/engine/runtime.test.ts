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

describe("following an external transport", () => {
  /** A runtime whose sync settings the test controls. */
  const following = (over: Partial<{
    externalClock: boolean; syncRatioDirection: "in" | "out";
  }> = {}) => {
    vi.stubGlobal("AudioContext", FakeAudioContext);
    return new MRuntime(() => createDefaultProject(), null, {
      clock: { nowSec: () => 0 },
      getPerformanceSettings: () => ({
        useMetronome: false,
        sendClock: false,
        externalClock: true,
        syncRatio: 4,
        syncRatioDirection: "in",
        ...over,
      }),
    });
  };

  it("asks the host to roll on Start", () => {
    expect(following().ingestClockMessage({ type: "start" }, 0)).toBe("start");
  });

  it("asks the host to resume on Continue", () => {
    // Distinct from Start so the host can choose not to rewind.
    expect(following().ingestClockMessage({ type: "continue" }, 0)).toBe("continue");
  });

  it("asks the host to halt on Stop", () => {
    expect(following().ingestClockMessage({ type: "stop" }, 0)).toBe("stop");
  });

  it("asks for nothing on a plain clock pulse", () => {
    // Pulses set the tempo. Only the transport messages move the transport.
    expect(following().ingestClockMessage({ type: "clock" }, 0)).toBeNull();
  });

  it("acts on Start even though no pulse has arrived yet", () => {
    // Start precedes the first pulse, so a freshness check on the tick history
    // would reject the very message that begins the run.
    const runtime = following();
    expect(runtime.ingestClockMessage({ type: "start" }, 0)).toBe("start");
  });

  it("stays silent when External Clock is off", () => {
    // Still decoded and still tracked, so switching the option on mid-stream
    // locks straight on — but it must not seize the transport unasked.
    const runtime = following({ externalClock: false });
    expect(runtime.ingestClockMessage({ type: "start" }, 0)).toBeNull();
    expect(runtime.ingestClockMessage({ type: "stop" }, 0)).toBeNull();
  });

  it("stays silent while M is the master", () => {
    const runtime = following({ syncRatioDirection: "out" });
    expect(runtime.ingestClockMessage({ type: "start" }, 0)).toBeNull();
  });

  it("still tracks pulses while not following, so enabling it locks on at once", () => {
    const runtime = following({ externalClock: false });
    for (let i = 0; i < 24; i++) runtime.ingestClockMessage({ type: "clock" }, i * 0.0208333);
    expect(runtime.followedTempo()).toBeCloseTo(120, 0);
  });
})
