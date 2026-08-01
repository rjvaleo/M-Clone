import { afterEach, describe, expect, it, vi } from "vitest";
import { createDefaultProject } from "./project";
import { MRuntime } from "./runtime";

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
    expect(order.slice(1)).toEqual(Array(16).fill("send"));
    expect(runtime.isRunning()).toBe(false);
  });
});
