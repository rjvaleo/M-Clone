export const SYNTH_WAVEFORMS = ["sine", "triangle", "sawtooth", "square"] as const;
export type SynthWaveform = (typeof SYNTH_WAVEFORMS)[number];

export const SYNTH_LFO_DESTINATIONS = ["pitch", "filter", "amp"] as const;
export type SynthLfoDestination = (typeof SYNTH_LFO_DESTINATIONS)[number];

export const SYNTH_FILTER_TYPES = ["lowpass", "highpass", "bandpass"] as const;
export type SynthFilterType = (typeof SYNTH_FILTER_TYPES)[number];

export type SynthSettings = {
  enabled: boolean;
  waveform: SynthWaveform;
  oscillatorOctave: number;
  detuneCents: number;
  oscillator2Waveform: SynthWaveform;
  oscillator2Octave: number;
  oscillator2DetuneCents: number;
  subOscillatorWaveform: SynthWaveform;
  oscillator1Level: number;
  oscillator2Level: number;
  subOscillatorLevel: number;
  noiseLevel: number;
  lfoRateHz: number;
  lfoDepth: number;
  lfoWaveform: SynthWaveform;
  lfoDestination: SynthLfoDestination;
  glideSec: number;
  filterType: SynthFilterType;
  filterCutoffHz: number;
  filterResonance: number;
  filterEnvelopeAmount: number;
  filterKeyboardTracking: number;
  filterAttackSec: number;
  filterDecaySec: number;
  filterSustain: number;
  filterReleaseSec: number;
  ampAttackSec: number;
  ampDecaySec: number;
  ampSustain: number;
  ampReleaseSec: number;
  velocitySensitivity: number;
  masterVolume: number;
};

export const DEFAULT_SYNTH_SETTINGS: SynthSettings = {
  enabled: true,
  waveform: "triangle",
  oscillatorOctave: 0,
  detuneCents: 0,
  oscillator2Waveform: "sawtooth",
  oscillator2Octave: 0,
  oscillator2DetuneCents: 0,
  subOscillatorWaveform: "square",
  oscillator1Level: 0.8,
  oscillator2Level: 0,
  subOscillatorLevel: 0,
  noiseLevel: 0,
  lfoRateHz: 4,
  lfoDepth: 0,
  lfoWaveform: "triangle",
  lfoDestination: "pitch",
  glideSec: 0,
  filterType: "lowpass",
  filterCutoffHz: 12_000,
  filterResonance: 0.7,
  filterEnvelopeAmount: 0,
  filterKeyboardTracking: 0,
  filterAttackSec: 0.01,
  filterDecaySec: 0.12,
  filterSustain: 0.5,
  filterReleaseSec: 0.08,
  ampAttackSec: 0.01,
  ampDecaySec: 0.08,
  ampSustain: 0.8,
  ampReleaseSec: 0.05,
  velocitySensitivity: 0.8,
  masterVolume: 0.8,
};

export function createDefaultSynthSettings(voices = 4): SynthSettings[] {
  return Array.from({ length: voices }, () => ({ ...DEFAULT_SYNTH_SETTINGS }));
}

const clamp = (value: number, low: number, high: number) =>
  Math.max(low, Math.min(high, Number.isFinite(value) ? value : low));

export function normalizeSynthSettings(
  value: Partial<SynthSettings>,
): SynthSettings {
  return {
    enabled: Boolean(value.enabled ?? DEFAULT_SYNTH_SETTINGS.enabled),
    waveform: SYNTH_WAVEFORMS.includes(value.waveform as SynthWaveform)
      ? value.waveform as SynthWaveform : DEFAULT_SYNTH_SETTINGS.waveform,
    oscillatorOctave: Math.round(clamp(value.oscillatorOctave ?? 0, -2, 2)),
    detuneCents: clamp(value.detuneCents ?? 0, -100, 100),
    oscillator2Waveform: SYNTH_WAVEFORMS.includes(value.oscillator2Waveform as SynthWaveform)
      ? value.oscillator2Waveform as SynthWaveform : DEFAULT_SYNTH_SETTINGS.oscillator2Waveform,
    oscillator2Octave: Math.round(clamp(value.oscillator2Octave ?? 0, -2, 2)),
    oscillator2DetuneCents: clamp(value.oscillator2DetuneCents ?? 0, -100, 100),
    subOscillatorWaveform: SYNTH_WAVEFORMS.includes(value.subOscillatorWaveform as SynthWaveform)
      ? value.subOscillatorWaveform as SynthWaveform : DEFAULT_SYNTH_SETTINGS.subOscillatorWaveform,
    oscillator1Level: clamp(value.oscillator1Level ?? 0.8, 0, 1),
    oscillator2Level: clamp(value.oscillator2Level ?? 0, 0, 1),
    subOscillatorLevel: clamp(value.subOscillatorLevel ?? 0, 0, 1),
    noiseLevel: clamp(value.noiseLevel ?? 0, 0, 1),
    lfoRateHz: clamp(value.lfoRateHz ?? 4, 0.05, 20),
    lfoDepth: clamp(value.lfoDepth ?? 0, 0, 1),
    lfoWaveform: SYNTH_WAVEFORMS.includes(value.lfoWaveform as SynthWaveform)
      ? value.lfoWaveform as SynthWaveform : DEFAULT_SYNTH_SETTINGS.lfoWaveform,
    lfoDestination: SYNTH_LFO_DESTINATIONS.includes(value.lfoDestination as SynthLfoDestination)
      ? value.lfoDestination as SynthLfoDestination : DEFAULT_SYNTH_SETTINGS.lfoDestination,
    glideSec: clamp(value.glideSec ?? 0, 0, 1),
    filterType: SYNTH_FILTER_TYPES.includes(value.filterType as SynthFilterType)
      ? value.filterType as SynthFilterType : DEFAULT_SYNTH_SETTINGS.filterType,
    filterCutoffHz: clamp(value.filterCutoffHz ?? 12_000, 40, 18_000),
    filterResonance: clamp(value.filterResonance ?? 0.7, 0, 30),
    filterEnvelopeAmount: clamp(value.filterEnvelopeAmount ?? 0, -1, 1),
    filterKeyboardTracking: clamp(value.filterKeyboardTracking ?? 0, 0, 1),
    filterAttackSec: clamp(value.filterAttackSec ?? 0.01, 0.003, 2),
    filterDecaySec: clamp(value.filterDecaySec ?? 0.12, 0.003, 2),
    filterSustain: clamp(value.filterSustain ?? 0.5, 0, 1),
    filterReleaseSec: clamp(value.filterReleaseSec ?? 0.08, 0.015, 5),
    ampAttackSec: clamp(value.ampAttackSec ?? 0.01, 0.003, 2),
    ampDecaySec: clamp(value.ampDecaySec ?? 0.08, 0.003, 2),
    ampSustain: clamp(value.ampSustain ?? 0.8, 0, 1),
    ampReleaseSec: clamp(value.ampReleaseSec ?? 0.05, 0.015, 5),
    velocitySensitivity: clamp(value.velocitySensitivity ?? 0.8, 0, 1),
    masterVolume: clamp(value.masterVolume ?? 0.8, 0, 1),
  };
}

export function synthFrequency(note: number, octave: number, detuneCents: number): number {
  return 440 * Math.pow(2, (note + octave * 12 - 69 + detuneCents / 100) / 12);
}
