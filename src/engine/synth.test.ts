import { describe, expect, it } from "vitest";
import {
  DEFAULT_SYNTH_SETTINGS,
  createDefaultSynthSettings,
  normalizeSynthSettings,
  synthFrequency,
} from "./synth";

describe("built-in synth controls", () => {
  it("ships a click-safe, playable subtractive-synth patch", () => {
    expect(DEFAULT_SYNTH_SETTINGS).toMatchObject({
      enabled: true,
      waveform: "triangle",
      oscillator2Waveform: "sawtooth",
      subOscillatorWaveform: "square",
      oscillator1Level: 0.8,
      oscillator2Level: 0,
      subOscillatorLevel: 0,
      noiseLevel: 0,
      lfoWaveform: "triangle",
      lfoDestination: "pitch",
      filterType: "lowpass",
      ampAttackSec: 0.01,
      ampReleaseSec: 0.05,
      masterVolume: 0.8,
    });
    expect(DEFAULT_SYNTH_SETTINGS.ampAttackSec).toBeGreaterThanOrEqual(0.003);
    expect(DEFAULT_SYNTH_SETTINGS.ampReleaseSec).toBeGreaterThanOrEqual(0.015);
    expect(normalizeSynthSettings({})).toEqual(DEFAULT_SYNTH_SETTINGS);
    expect(normalizeSynthSettings(DEFAULT_SYNTH_SETTINGS)).toEqual(DEFAULT_SYNTH_SETTINGS);
  });

  it("normalizes every continuous and enumerated control", () => {
    expect(normalizeSynthSettings({
      enabled: 0 as never,
      waveform: "noise" as never,
      oscillator2Waveform: "noise" as never,
      subOscillatorWaveform: "noise" as never,
      oscillatorOctave: 9,
      oscillator2Octave: -9,
      detuneCents: -999,
      oscillator2DetuneCents: 999,
      glideSec: 9,
      oscillator1Level: 9,
      oscillator2Level: -9,
      subOscillatorLevel: 9,
      noiseLevel: -9,
      lfoRateHz: 99,
      lfoDepth: -1,
      lfoWaveform: "noise" as never,
      lfoDestination: "pan" as never,
      filterType: "comb" as never,
      filterCutoffHz: 1,
      filterResonance: 99,
      filterEnvelopeAmount: -99,
      filterKeyboardTracking: 9,
      filterAttackSec: -1,
      filterDecaySec: 99,
      filterSustain: 3,
      filterReleaseSec: -1,
      ampAttackSec: 0,
      ampDecaySec: 99,
      ampSustain: -1,
      ampReleaseSec: 0,
      velocitySensitivity: 4,
      masterVolume: -1,
    })).toEqual({
      enabled: false,
      waveform: "triangle",
      oscillator2Waveform: "sawtooth",
      subOscillatorWaveform: "square",
      oscillatorOctave: 2,
      oscillator2Octave: -2,
      detuneCents: -100,
      oscillator2DetuneCents: 100,
      glideSec: 1,
      oscillator1Level: 1,
      oscillator2Level: 0,
      subOscillatorLevel: 1,
      noiseLevel: 0,
      lfoRateHz: 20,
      lfoDepth: 0,
      lfoWaveform: "triangle",
      lfoDestination: "pitch",
      filterType: "lowpass",
      filterCutoffHz: 40,
      filterResonance: 30,
      filterEnvelopeAmount: -1,
      filterKeyboardTracking: 1,
      filterAttackSec: 0.003,
      filterDecaySec: 2,
      filterSustain: 1,
      filterReleaseSec: 0.015,
      ampAttackSec: 0.003,
      ampDecaySec: 2,
      ampSustain: 0,
      ampReleaseSec: 0.015,
      velocitySensitivity: 1,
      masterVolume: 0,
    });
  });

  it("applies octave and fine detune to oscillator frequency", () => {
    expect(synthFrequency(69, 0, 0)).toBe(440);
    expect(synthFrequency(69, 1, 0)).toBe(880);
    expect(synthFrequency(69, 0, 100)).toBeCloseTo(466.1637615, 6);
    expect(normalizeSynthSettings({ filterCutoffHz: Number.NaN }).filterCutoffHz).toBe(40);
  });

  it("creates an independent patch for every sequencer stream", () => {
    const patches = createDefaultSynthSettings(4);
    expect(patches).toHaveLength(4);
    expect(patches.every((patch) => patch !== DEFAULT_SYNTH_SETTINGS)).toBe(true);
    patches[0].waveform = "square";
    expect(patches[1].waveform).toBe("triangle");
  });
});
