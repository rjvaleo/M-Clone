import { afterEach, describe, expect, it, vi } from "vitest";
import { createDefaultProject } from "./project";
import { MRuntime } from "./runtime";
import type { ClockDriver, SchedulerDriver } from "./scheduler";
import { neutralTimeMap } from "./timemap";
import type { Pattern, ProjectState, VoiceState } from "./types";

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

const PULSE_MS_240_BPM = 60_000 / (240 * 24);

function quarterProject(): ProjectState {
  const pattern: Pattern = {
    id: "p",
    steps: [{ pitches: [60] }, { pitches: [62] }, { pitches: [64] }, { pitches: [65] }],
    scrambledSteps: [{ pitches: [60] }, { pitches: [62] }, { pitches: [64] }, { pitches: [65] }],
    scrambleGeneration: 0,
    outputLength: 4,
    maxSize: 100,
    chordMode: "single",
    insertMode: "insert",
    drumMachine: false,
    timeBaseNumerator: 1,
    timeBaseDenominator: 4,
    phase: 0,
  };
  const voice: VoiceState = {
    patternIndex: 0,
    playEnabled: true,
    transposition: 0,
    noteOrderMix: { original: 100, cyclic: 0, utterly: 0 },
    density: 1,
    velocityRange: { low: 100, high: 100 },
    timeBaseNumerator: 1,
    timeBaseDenominator: 4,
    phase: 0,
    timeDistort: neutralTimeMap(),
    legato: 0.9,
    channel: 1,
    outputChannels: [1],
    program: 0,
    sourceChannel: "all",
    inputUse: "disabled",
    echoInput: false,
    mouseAdvance: false,
  };
  return {
    tempo: 120,
    patterns: [pattern],
    voices: [voice],
    root: 0,
    scale: "chromatic",
    scaleSnap: false,
    seed: 1,
    diatonicTranspose: false,
    secondOrderTranspose: false,
    chordTones: false,
    midiAssignments: {
      inputs: Array.from({ length: 16 }, (_, i) => ({ deviceId: null, channel: i + 1 })),
      outputs: Array.from({ length: 16 }, (_, i) => ({ deviceId: null, channel: i + 1 })),
      programBase: 0,
      latencyMs: 0,
      conductXController: 16,
      conductYController: 17,
    },
    echoMapChannels: [],
    cyclic: {
      accent: [Array(16).fill(2)],
      legato: [Array(16).fill(2)],
      rhythm: [Array(16).fill(2)],
    },
    cyclicLengths: { accent: [16], legato: [16], rhythm: [16] },
    cyclicValues: {
      legato: [6, 25, 50, 75, 100],
      rhythm: [0.5, 0.75, 1, 1.5, 2],
    },
  };
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

  it("drives transport and diagnostics from external MIDI clock input", async () => {
    vi.stubGlobal("AudioContext", FakeAudioContext);
    let wake: (() => void) | null = null;
    let now = 0;
    let perfMs = 0;
    const transport: string[] = [];
    const diagnostics: Array<{ clockStatus: string; inferredBpm: number }> = [];
    const scheduler: SchedulerDriver = {
      repeat: (callback) => (wake = callback, callback),
      once: (callback) => callback,
      cancel: vi.fn(),
    };
    const runtime = new MRuntime(() => createDefaultProject(), null, {
      scheduler,
      clock: { nowSec: () => now },
      performanceClockMs: () => perfMs,
      getPerformanceSettings: () => ({
        useMetronome: false,
        sendClock: false,
        syncRatio: 4,
        syncRatioDirection: "in",
        externalClockEnabled: true,
      }),
      onClockTransport: (event) => transport.push(event),
      onClockDiagnostics: (snapshot) => diagnostics.push(snapshot),
    });
    runtime.setSynthEnabled(false);

    await runtime.onClockInput(0xfa, 0);
    expect(transport).toEqual(["start"]);
    await runtime.onClockInput(0xfa, 1);
    expect(transport).toEqual(["start"]);

    perfMs = PULSE_MS_240_BPM;
    await runtime.onClockInput(0xf8, perfMs);
    perfMs += PULSE_MS_240_BPM;
    await runtime.onClockInput(0xf8, perfMs);
    expect(diagnostics[diagnostics.length - 1]).toMatchObject({ clockStatus: "locked" });
    expect(diagnostics[diagnostics.length - 1]?.inferredBpm).toBeCloseTo(240, 6);

    now = 0.5;
    perfMs = 500;
    wake!();
    expect(diagnostics[diagnostics.length - 1]).toMatchObject({ clockStatus: "lost" });

    await runtime.onClockInput(0xfc, 510);
    expect(transport[transport.length - 1]).toBe("stop");
    await runtime.onClockInput(0xfb, 520);
    expect(transport[transport.length - 1]).toBe("continue");
  });

  it("applies external tempo changes at the next unscheduled boundary only", async () => {
    vi.stubGlobal("AudioContext", FakeAudioContext);
    let wake: (() => void) | null = null;
    let now = 0;
    let perfMs = 0;
    const scheduler: SchedulerDriver = {
      repeat: (callback) => (wake = callback, callback),
      once: (callback) => callback,
      cancel: vi.fn(),
    };
    const state = quarterProject();
    const starts: number[] = [];
    const runtime = new MRuntime(
      () => state,
      (notes) => starts.push(...notes.filter((note) => note.voice === 0).map((note) => note.startSec)),
      {
        scheduler,
        clock: { nowSec: () => now },
        performanceClockMs: () => perfMs,
        getPerformanceSettings: () => ({
          useMetronome: false,
          sendClock: false,
          syncRatio: 4,
          syncRatioDirection: "in",
          externalClockEnabled: true,
        }),
      },
    );
    runtime.setSynthEnabled(false);

    await runtime.start();
    wake!();

    const pumpClock = async (untilMs: number) => {
      if (perfMs === 0) await runtime.onClockInput(0xf8, perfMs);
      while (perfMs + PULSE_MS_240_BPM <= untilMs) {
        perfMs += PULSE_MS_240_BPM;
        await runtime.onClockInput(0xf8, perfMs);
      }
    };

    await pumpClock(440);
    now = 0.45;
    wake!();
    await pumpClock(690);
    now = 0.7;
    wake!();
    await pumpClock(940);
    now = 0.95;
    wake!();

    expect(starts[0]).toBeCloseTo(0.06, 9);
    expect(starts[1]).toBeGreaterThanOrEqual(0.45);
    expect(starts[2] - starts[1]).toBeCloseTo(0.25, 9);
  });
});
