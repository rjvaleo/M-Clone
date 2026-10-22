import { afterEach, describe, expect, it, vi } from "vitest";
import { getRuntime, setRuntimeHost } from "./runtime";

class FakeAudioContext {
  currentTime = 0;
  state: AudioContextState = "running";
  destination = {} as AudioDestinationNode;
  createGain() { return { gain: { value: 0 }, connect: vi.fn() } as unknown as GainNode; }
  createOscillator() { return {} as OscillatorNode; }
  resume = vi.fn(async () => undefined);
}

afterEach(() => {
  getRuntime().stop();
  setRuntimeHost(null);
});

describe("M's runtime inside a host", () => {
  it("plays through the host's audio once a host is set", async () => {
    const context = new FakeAudioContext() as unknown as AudioContext;
    const audio = vi.fn(() => ({ context, output: {} as AudioNode }));
    setRuntimeHost({ audio });
    await getRuntime().start();
    expect(audio).toHaveBeenCalledTimes(1);
    expect(getRuntime().context).toBe(context);
  });

  it("replaces a runtime made before the host arrived", () => {
    setRuntimeHost(null);
    const before = getRuntime();
    setRuntimeHost({ audio: () => ({ context: new FakeAudioContext() as unknown as AudioContext, output: {} as AudioNode }) });
    expect(getRuntime()).not.toBe(before);
  });
});
