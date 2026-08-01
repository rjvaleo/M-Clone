// Built-in WebAudio synth adapter for explicit portable engine events.

import type { EngineEvent, NoteOnEvent } from "../events";
import type { OutputSink } from "./types";
import {
  DEFAULT_SYNTH_SETTINGS,
  normalizeSynthSettings,
  synthFrequency,
  type SynthSettings,
  type SynthWaveform,
} from "../synth";

type ActiveSynthNote = {
  sources: AudioScheduledSourceNode[];
  oscillators: OscillatorNode[];
  filter: BiquadFilterNode;
  gain: GainNode;
  nodes: AudioNode[];
  baseCutoff: number;
};

function holdAt(param: AudioParam, at: number, floor = 0.0001): void {
  if (typeof param.cancelAndHoldAtTime === "function") {
    param.cancelAndHoldAtTime(at);
    return;
  }
  param.cancelScheduledValues(at);
  param.setValueAtTime(Math.max(floor, param.value), at);
}

const clampCutoff = (value: number) => Math.max(40, Math.min(18_000, value));

export class SynthSink implements OutputSink {
  readonly destination = "synth" as const;
  private active = new Set<AudioScheduledSourceNode>();
  private notes = new Map<number, ActiveSynthNote>();
  private settings = DEFAULT_SYNTH_SETTINGS;
  private lastFrequency: number | null = null;
  private noiseBuffer: AudioBuffer | null = null;

  constructor(private ctx: AudioContext, private master: GainNode) {}

  setSettings(settings: SynthSettings): void {
    this.settings = normalizeSynthSettings(settings);
    this.master.gain.value = this.settings.masterVolume;
  }

  private oscillator(
    waveform: SynthWaveform,
    frequency: number,
    start: number,
    glideFrom: number | null,
  ): OscillatorNode {
    const oscillator = this.ctx.createOscillator();
    oscillator.type = waveform;
    if (this.settings.glideSec > 0 && glideFrom !== null) {
      oscillator.frequency.setValueAtTime(glideFrom, start);
      oscillator.frequency.exponentialRampToValueAtTime(
        frequency, start + this.settings.glideSec,
      );
    } else {
      oscillator.frequency.setValueAtTime(frequency, start);
    }
    return oscillator;
  }

  private noise(): AudioBufferSourceNode {
    if (!this.noiseBuffer) {
      this.noiseBuffer = this.ctx.createBuffer(1, this.ctx.sampleRate, this.ctx.sampleRate);
      const data = this.noiseBuffer.getChannelData(0);
      for (let index = 0; index < data.length; index += 1) data[index] = Math.random() * 2 - 1;
    }
    const source = this.ctx.createBufferSource();
    source.buffer = this.noiseBuffer;
    source.loop = true;
    return source;
  }

  private noteOn(event: NoteOnEvent): void {
    const start = Math.max(event.atSec, this.ctx.currentTime);
    const settings = this.settings;
    const velocity = event.velocity / 127;
    const level = 0.25 * ((1 - settings.velocitySensitivity)
      + settings.velocitySensitivity * velocity);
    const frequency1 = synthFrequency(event.note, settings.oscillatorOctave, settings.detuneCents);
    const frequency2 = synthFrequency(
      event.note, settings.oscillator2Octave, settings.oscillator2DetuneCents,
    );
    const oscillator1 = this.oscillator(settings.waveform, frequency1, start, this.lastFrequency);
    const oscillator2 = this.oscillator(settings.oscillator2Waveform, frequency2, start, this.lastFrequency);
    const subOscillator = this.oscillator(
      settings.subOscillatorWaveform, frequency1 / 2, start,
      this.lastFrequency === null ? null : this.lastFrequency / 2,
    );
    this.lastFrequency = frequency1;

    const noise = this.noise();
    const mixLevels = [
      settings.oscillator1Level, settings.oscillator2Level,
      settings.subOscillatorLevel, settings.noiseLevel,
    ].map((value) => {
      const gain = this.ctx.createGain();
      gain.gain.value = value;
      return gain;
    });
    const filter = this.ctx.createBiquadFilter();
    filter.type = settings.filterType;
    filter.Q.setValueAtTime(settings.filterResonance, start);
    const trackingRatio = Math.pow(2, ((event.note - 60) / 12) * settings.filterKeyboardTracking);
    const baseCutoff = clampCutoff(settings.filterCutoffHz * trackingRatio);
    const peakCutoff = clampCutoff(baseCutoff
      * Math.pow(2, settings.filterEnvelopeAmount * 5));
    const sustainCutoff = clampCutoff(baseCutoff
      + (peakCutoff - baseCutoff) * settings.filterSustain);
    filter.frequency.setValueAtTime(baseCutoff, start);
    filter.frequency.exponentialRampToValueAtTime(
      peakCutoff, start + settings.filterAttackSec,
    );
    filter.frequency.exponentialRampToValueAtTime(
      sustainCutoff, start + settings.filterAttackSec + settings.filterDecaySec,
    );

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(
      Math.max(level, 0.0002), start + settings.ampAttackSec,
    );
    gain.gain.exponentialRampToValueAtTime(
      Math.max(level * settings.ampSustain, 0.0002),
      start + settings.ampAttackSec + settings.ampDecaySec,
    );

    const lfo = this.ctx.createOscillator();
    lfo.type = settings.lfoWaveform;
    lfo.frequency.setValueAtTime(settings.lfoRateHz, start);
    const lfoGain = this.ctx.createGain();
    if (settings.lfoDestination === "pitch") {
      lfoGain.gain.value = settings.lfoDepth * 100;
      lfo.connect(lfoGain);
      for (const oscillator of [oscillator1, oscillator2, subOscillator]) {
        lfoGain.connect(oscillator.detune);
      }
    } else if (settings.lfoDestination === "filter") {
      lfoGain.gain.value = settings.lfoDepth * baseCutoff * 0.5;
      lfo.connect(lfoGain).connect(filter.frequency);
    } else {
      lfoGain.gain.value = settings.lfoDepth * level * 0.4;
      lfo.connect(lfoGain).connect(gain.gain);
    }

    oscillator1.connect(mixLevels[0]).connect(filter);
    oscillator2.connect(mixLevels[1]).connect(filter);
    subOscillator.connect(mixLevels[2]).connect(filter);
    noise.connect(mixLevels[3]).connect(filter);
    filter.connect(gain).connect(this.master);
    const oscillators = [oscillator1, oscillator2, subOscillator, lfo];
    const sources: AudioScheduledSourceNode[] = [...oscillators, noise];
    for (const source of sources) {
      source.start(start);
      this.active.add(source);
    }
    const nodes: AudioNode[] = [...mixLevels, lfoGain, gain, filter];
    this.notes.set(event.noteId, {
      sources, oscillators, filter, gain, nodes, baseCutoff,
    });
    oscillator1.onended = () => {
      for (const node of nodes) node.disconnect();
      for (const source of sources) {
        source.disconnect();
        this.active.delete(source);
      }
      this.notes.delete(event.noteId);
    };
  }

  scheduleBatch(events: readonly EngineEvent[]): void {
    for (const event of events) {
      if (event.destination !== this.destination || event.type === "program-change") continue;
      if (event.type === "note-on") {
        this.noteOn(event);
        continue;
      }
      const active = this.notes.get(event.noteId);
      if (!active) continue;
      const at = Math.max(event.atSec, this.ctx.currentTime);
      holdAt(active.gain.gain, at, 0.0002);
      active.gain.gain.exponentialRampToValueAtTime(
        0.0001, at + this.settings.ampReleaseSec,
      );
      holdAt(active.filter.frequency, at, 40);
      active.filter.frequency.exponentialRampToValueAtTime(
        active.baseCutoff, at + this.settings.filterReleaseSec,
      );
      const stopAt = at + Math.max(
        this.settings.ampReleaseSec, this.settings.filterReleaseSec,
      ) + 0.02;
      for (const source of active.sources) source.stop(stopAt);
    }
  }

  cancelScheduled(): void {
    this.panic();
  }

  panic(): void {
    for (const source of this.active) {
      try { source.stop(); } catch { /* already stopped */ }
    }
    this.active.clear();
    this.notes.clear();
    this.lastFrequency = null;
  }
}
