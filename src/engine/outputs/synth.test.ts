import { describe, expect, it, vi } from "vitest";
import { SynthSink } from "./synth";
import { DEFAULT_SYNTH_SETTINGS } from "../synth";
import type { EngineEvent } from "../events";

class FakeParam {
  value = 0;
  setValueAtTime = vi.fn((value: number) => { this.value = value; return this as unknown as AudioParam; });
  exponentialRampToValueAtTime = vi.fn((value: number) => { this.value = value; return this as unknown as AudioParam; });
  cancelAndHoldAtTime = vi.fn(() => this as unknown as AudioParam);
  cancelScheduledValues = vi.fn(() => this as unknown as AudioParam);
}

class FakeNode {
  connect = vi.fn((destination: AudioNode | AudioParam) => destination);
  disconnect = vi.fn();
}

function fakeOscillator() {
  return Object.assign(new FakeNode(), {
    type: "sine" as OscillatorType,
    frequency: new FakeParam(),
    detune: new FakeParam(),
    start: vi.fn(), stop: vi.fn(), onended: null as (() => void) | null,
  });
}

describe("SynthSink envelopes", () => {
  it("builds the reference-inspired dual-oscillator, sub, noise, LFO, filter and envelope path", () => {
    const oscillators: ReturnType<typeof fakeOscillator>[] = [];
    const gains: Array<FakeNode & { gain: FakeParam }> = [];
    const filter = Object.assign(new FakeNode(), {
      type: "lowpass" as BiquadFilterType,
      frequency: new FakeParam(), Q: new FakeParam(),
    });
    const noise = Object.assign(new FakeNode(), {
      buffer: null as AudioBuffer | null, loop: false,
      start: vi.fn(), stop: vi.fn(),
    });
    const master = Object.assign(new FakeNode(), { gain: new FakeParam() });
    const context = {
      currentTime: 0, sampleRate: 100,
      createOscillator: () => {
        const oscillator = fakeOscillator();
        oscillators.push(oscillator);
        return oscillator;
      },
      createBiquadFilter: () => filter,
      createGain: () => {
        const gain = Object.assign(new FakeNode(), { gain: new FakeParam() });
        gains.push(gain);
        return gain;
      },
      createBuffer: () => ({ getChannelData: () => new Float32Array(100) }),
      createBufferSource: () => noise,
    } as unknown as AudioContext;
    const sink = new SynthSink(context, master as unknown as GainNode);
    sink.setSettings({
      ...DEFAULT_SYNTH_SETTINGS,
      waveform: "square",
      oscillator2Waveform: "sine",
      subOscillatorWaveform: "triangle",
      oscillator1Level: 0.7,
      oscillator2Level: 0.6,
      subOscillatorLevel: 0.5,
      noiseLevel: 0.4,
      lfoWaveform: "sawtooth",
      lfoRateHz: 5,
      lfoDepth: 0.3,
      filterType: "highpass",
      ampReleaseSec: 0.2,
    });
    const base = {
      atTick: 0, sequence: 0, destination: "synth" as const,
      voice: 0, channel: 1, noteId: 4, note: 60,
    };
    sink.scheduleBatch([
      { ...base, type: "note-on", atSec: 1, velocity: 100 },
      { ...base, type: "note-off", atSec: 1.1, velocity: 0 },
    ] satisfies EngineEvent[]);

    expect(oscillators.map((oscillator) => oscillator.type)).toEqual([
      "square", "sine", "triangle", "sawtooth",
    ]);
    expect(gains.slice(0, 4).map((gain) => gain.gain.value)).toEqual([0.7, 0.6, 0.5, 0.4]);
    expect(noise.loop).toBe(true);
    expect(filter.type).toBe("highpass");
    expect(gains[4].gain.exponentialRampToValueAtTime).toHaveBeenCalled();
    expect(gains[4].gain.cancelAndHoldAtTime).toHaveBeenCalledWith(1.1);
    expect(filter.frequency.cancelAndHoldAtTime).toHaveBeenCalledWith(1.1);
    expect(oscillators.slice(0, 3).every((oscillator) =>
      oscillator.stop.mock.calls.some(([at]) => at === 1.32))).toBe(true);
    expect(noise.stop).toHaveBeenCalledWith(1.32);
  });
});
