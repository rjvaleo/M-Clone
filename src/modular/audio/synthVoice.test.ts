import { describe, expect, it } from "vitest";
import {
  defaultSynthSettings,
  modulateSettings,
  SynthVoice,
  SynthVoiceBank,
  type SynthSettings,
} from "./synthVoice";
import { emptyMatrix, setRouting, type ModSourceValues } from "./modMatrix";
import {
  FakeAudioContext,
  FakeBiquad,
  FakeGain,
  FakeNode,
  FakeOscillator,
  FakeStereoPanner,
} from "./testing/fakeContext";

/**
 * One note of the synth.
 *
 * The design that matters here is that **the filter lives inside the voice**.
 * Both sources this came from share one filter across the whole instrument and
 * schedule every note's envelope onto its single `frequency` param — which is
 * why, in the scale sequencer, touching the cutoff knob cancels the sweeps of
 * notes that have not sounded yet. A filter per voice cannot have that bug, and
 * several of the tests below exist to keep it that way.
 */

const context = () => new FakeAudioContext();

const of = <T extends FakeNode>(
  ctx: FakeAudioContext,
  Kind: abstract new (...args: never[]) => T,
): T[] => ctx.created.filter((node): node is T => node instanceof Kind);

const settings = (overrides: Partial<SynthSettings> = {}): SynthSettings =>
  ({ ...defaultSynthSettings(), ...overrides });

const play = (
  ctx: FakeAudioContext,
  overrides: Partial<SynthSettings> = {},
  note = 69,
  velocity = 100,
  atSec = 1,
) => {
  const voice = new SynthVoice(ctx, ctx.createGain(), settings(overrides), note, velocity, atSec);
  return voice;
};

describe("Building a voice", () => {
  it("starts three oscillators, one per oscillator setting", () => {
    const ctx = context();
    play(ctx);
    const oscillators = of(ctx, FakeOscillator);
    expect(oscillators).toHaveLength(3);
    for (const osc of oscillators) expect(osc.starts).toEqual([1]);
  });

  it("tunes them from the note, in equal temperament", () => {
    // A4 is MIDI 69 and 440 Hz. The tuning library owns this conversion, so a
    // scale module can later hand the voice a pitch instead.
    const ctx = context();
    play(ctx, {}, 69);
    for (const osc of of(ctx, FakeOscillator)) expect(osc.frequency.value).toBeCloseTo(440, 6);

    const lower = context();
    play(lower, {}, 57);
    expect(of(lower, FakeOscillator)[0].frequency.value).toBeCloseTo(220, 6);
  });

  it("gives each oscillator its own wave, detune and level", () => {
    const ctx = context();
    play(ctx, {
      oscillators: [
        { wave: "sawtooth", detuneCents: 0, level: 1, pulseWidth: 0.5 },
        { wave: "square", detuneCents: 700, level: 0.5, pulseWidth: 0.5 },
        { wave: "triangle", detuneCents: -1200, level: 0.25, pulseWidth: 0.5 },
      ],
    });
    const oscillators = of(ctx, FakeOscillator);
    expect(oscillators.map((osc) => osc.type)).toEqual(["sawtooth", "square", "triangle"]);
    expect(oscillators.map((osc) => osc.detune.value)).toEqual([0, 700, -1200]);
  });

  it("builds a pulse oscillator from a periodic wave rather than a type", () => {
    // "pulse" is not a Web Audio wave: it is a Fourier series, rebuilt per
    // width, which is what makes PWM possible at all.
    const ctx = context();
    play(ctx, {
      oscillators: [
        { wave: "pulse", detuneCents: 0, level: 1, pulseWidth: 0.25 },
        { wave: "sine", detuneCents: 0, level: 0, pulseWidth: 0.5 },
        { wave: "sine", detuneCents: 0, level: 0, pulseWidth: 0.5 },
      ],
    });
    const [first] = of(ctx, FakeOscillator);
    expect(first.type).toBe("custom");
    expect(first.periodicWave).not.toBeNull();
    // A 25% pulse has a DC term of 2w − 1.
    expect(first.periodicWave?.real[0]).toBeCloseTo(-0.5, 6);
  });

  it("gives the voice its own filter, not the instrument's", () => {
    const ctx = context();
    play(ctx);
    play(ctx);
    // Two notes, two filters. This is the whole point.
    expect(of(ctx, FakeBiquad)).toHaveLength(2);
    expect(of(ctx, FakeBiquad)[0].type).toBe("lowpass");
  });

  it("places the voice in the stereo field", () => {
    const ctx = context();
    play(ctx, { pan: -0.5 });
    expect(of(ctx, FakeStereoPanner)[0].pan.value).toBeCloseTo(-0.5, 6);
  });
});

describe("The amplitude envelope", () => {
  /** The amp envelope is the gain that feeds the voice's panner. */
  const ampGain = (ctx: FakeAudioContext): FakeGain => {
    const panner = of(ctx, FakeStereoPanner)[0];
    return of(ctx, FakeGain).filter((gain) => gain.outgoing.has(panner)).slice(-1)[0];
  };

  it("rises to the peak over the attack, then falls to the sustain", () => {
    const ctx = context();
    // Full velocity, so the peak is the level itself and the shape is readable.
    play(ctx, { amp: { attack: 0.1, decay: 0.2, sustain: 0.5, release: 0.3 }, level: 1 }, 69, 127);
    const moves = ampGain(ctx).gain.moves();
    // Silent at the note, up by the end of the attack, down to sustain after decay.
    expect(moves[0]).toMatchObject({ method: "set", value: 0, time: 1 });
    expect(moves.find((call) => call.time === 1.1)?.value).toBeCloseTo(1, 6);
    expect(moves.find((call) => call.time === 1.3)?.value).toBeCloseTo(0.5, 6);
  });

  it("scales the peak by velocity, so playing softer is quieter", () => {
    const loud = context();
    play(loud, { level: 1 }, 69, 127);
    const soft = context();
    play(soft, { level: 1 }, 69, 32);
    const peak = (ctx: FakeAudioContext) =>
      Math.max(...ampGain(ctx).gain.moves().map((call) => call.value));
    expect(peak(loud)).toBeGreaterThan(peak(soft));
  });

  it("holds the sustain until the note is released", () => {
    const ctx = context();
    const voice = play(ctx, { amp: { attack: 0.01, decay: 0.05, sustain: 0.4, release: 0.5 } });
    const before = ampGain(ctx).gain.moves().length;
    voice.release(3);
    const moves = ampGain(ctx).gain.moves();
    expect(moves.length).toBeGreaterThan(before);
    // Falls to silence a release after the key came up.
    expect(moves.slice(-1)[0].value).toBe(0);
    expect(moves.slice(-1)[0].time).toBeCloseTo(3.5, 6);
  });

  it("stops its oscillators after the release, not before", () => {
    const ctx = context();
    const voice = play(ctx, { amp: { attack: 0.01, decay: 0.05, sustain: 0.4, release: 0.5 } });
    voice.release(3);
    for (const osc of of(ctx, FakeOscillator)) {
      expect(osc.stops[0]).toBeGreaterThan(3.5);
    }
  });

  it("snaps to the peak when there is no attack, and holds it when there is no decay", () => {
    // A percussive organ patch: straight to full, no fall. Both stages have to
    // be schedulable as an instant rather than a ramp of length zero.
    const ctx = context();
    play(ctx, {
      amp: { attack: 0, decay: 0, sustain: 1, release: 0.1 }, level: 1,
    }, 69, 127);
    const moves = ampGain(ctx).gain.moves();
    expect(moves.every((call) => call.method === "set")).toBe(true);
    expect(moves.slice(-1)[0].value).toBeCloseTo(1, 6);
    expect(moves.slice(-1)[0].time).toBe(1);
  });

  it("releases only once, however many times the key comes up", () => {
    const ctx = context();
    const voice = play(ctx);
    voice.release(3);
    const after = of(ctx, FakeOscillator)[0].stops.length;
    voice.release(4);
    expect(of(ctx, FakeOscillator)[0].stops).toHaveLength(after);
  });
});

describe("The filter envelope", () => {
  const filterOf = (ctx: FakeAudioContext) => of(ctx, FakeBiquad)[0];

  it("sweeps the cutoff by its own envelope, in octaves", () => {
    const ctx = context();
    play(ctx, {
      filter: {
        cutoffHz: 500, resonance: 1, keyFollow: 0, envAmountOctaves: 2,
        adsr: { attack: 0.1, decay: 0.2, sustain: 0.5, release: 0.3 },
      },
    });
    const moves = filterOf(ctx).frequency.moves();
    // Starts at the base cutoff and peaks two octaves up.
    expect(moves[0].value).toBeCloseTo(500, 6);
    expect(moves.find((call) => call.time === 1.1)?.value).toBeCloseTo(2000, 6);
    // Sustain sits halfway up the sweep, in octaves rather than hertz.
    expect(moves.find((call) => call.time === 1.3)?.value).toBeCloseTo(1000, 6);
  });

  it("sweeps downward when the amount is negative", () => {
    const ctx = context();
    play(ctx, {
      filter: {
        cutoffHz: 2000, resonance: 1, keyFollow: 0, envAmountOctaves: -1,
        adsr: { attack: 0.1, decay: 0.1, sustain: 1, release: 0.1 },
      },
    });
    expect(filterOf(ctx).frequency.moves().find((call) => call.time === 1.1)?.value)
      .toBeCloseTo(1000, 6);
  });

  it("tracks the note when key follow is up", () => {
    // An octave up doubles the cutoff at full key follow, so the timbre stays
    // constant across the keyboard instead of getting duller as it rises.
    const low = context();
    play(low, { filter: { ...defaultSynthSettings().filter, cutoffHz: 1000, keyFollow: 1, envAmountOctaves: 0 } }, 60);
    const high = context();
    play(high, { filter: { ...defaultSynthSettings().filter, cutoffHz: 1000, keyFollow: 1, envAmountOctaves: 0 } }, 72);
    expect(filterOf(high).frequency.moves()[0].value)
      .toBeCloseTo(filterOf(low).frequency.moves()[0].value * 2, 4);
  });

  it("ignores the note when key follow is down", () => {
    const low = context();
    play(low, { filter: { ...defaultSynthSettings().filter, cutoffHz: 1000, keyFollow: 0, envAmountOctaves: 0 } }, 60);
    const high = context();
    play(high, { filter: { ...defaultSynthSettings().filter, cutoffHz: 1000, keyFollow: 0, envAmountOctaves: 0 } }, 84);
    expect(filterOf(high).frequency.moves()[0].value)
      .toBeCloseTo(filterOf(low).frequency.moves()[0].value, 6);
  });

  it("falls back to a usable cutoff when the setting is nonsense", () => {
    // A document written by hand, or a knob bound to the wrong parameter.
    const ctx = context();
    play(ctx, {
      filter: { ...defaultSynthSettings().filter, cutoffHz: Number.NaN, envAmountOctaves: 0 },
    });
    expect(filterOf(ctx).frequency.moves()[0].value).toBeGreaterThan(20);
  });

  it("never asks for a cutoff a filter cannot take", () => {
    const ctx = context();
    play(ctx, {
      filter: {
        cutoffHz: 18000, resonance: 1, keyFollow: 1, envAmountOctaves: 4,
        adsr: { attack: 0.01, decay: 0.01, sustain: 1, release: 0.1 },
      },
    }, 108);
    for (const call of filterOf(ctx).frequency.moves()) {
      expect(call.value).toBeGreaterThanOrEqual(20);
      expect(call.value).toBeLessThanOrEqual(20000);
    }
  });
});

describe("Per-note modulation", () => {
  const sources: ModSourceValues = {
    lfo1: 0, lfo2: 0, ampEnv: 0, filterEnv: 0,
    velocity: 1, note: 0, modWheel: 0, random: 0,
  };

  it("leaves the settings alone when nothing is routed", () => {
    const base = defaultSynthSettings();
    expect(modulateSettings(base, emptyMatrix(), sources)).toEqual(base);
  });

  it("moves an oscillator's pitch in cents, on top of its own detune", () => {
    const matrix = setRouting(emptyMatrix(), "velocity", "osc2-pitch", 0.5);
    const base = defaultSynthSettings();
    const moved = modulateSettings(base, matrix, sources);
    // Half of a ±2400 cent depth at full velocity, added to the detune the
    // oscillator was already carrying.
    expect(moved.oscillators[1].detuneCents).toBe(base.oscillators[1].detuneCents + 1200);
    expect(moved.oscillators[0].detuneCents).toBe(base.oscillators[0].detuneCents);
  });

  it("moves the cutoff in octaves, not hertz", () => {
    const matrix = setRouting(emptyMatrix(), "velocity", "filter-cutoff", 0.25);
    const base = defaultSynthSettings();
    const moved = modulateSettings(base, matrix, sources);
    expect(moved.filter.cutoffHz).toBeCloseTo(base.filter.cutoffHz * 2, 4);
  });

  it("moves level, pan and volume", () => {
    let matrix = setRouting(emptyMatrix(), "velocity", "osc1-level", -0.5);
    matrix = setRouting(matrix, "velocity", "pan", 0.5);
    matrix = setRouting(matrix, "velocity", "volume", -0.25);
    const base = defaultSynthSettings();
    const moved = modulateSettings(base, matrix, sources);
    expect(moved.oscillators[0].level).toBeLessThan(base.oscillators[0].level);
    expect(moved.pan).toBeCloseTo(0.5, 6);
    expect(moved.level).toBeLessThan(base.level);
  });

  it("does not modify the settings it was given", () => {
    const base = defaultSynthSettings();
    const matrix = setRouting(emptyMatrix(), "velocity", "osc1-pitch", 1);
    modulateSettings(base, matrix, sources);
    expect(base.oscillators[0].detuneCents).toBe(0);
  });
});

describe("Polyphony", () => {
  const bank = (ctx: FakeAudioContext, maxVoices = 4) =>
    new SynthVoiceBank(ctx, ctx.createGain(), maxVoices);

  it("counts the notes that are sounding", () => {
    const ctx = context();
    const voices = bank(ctx);
    expect(voices.activeCount).toBe(0);
    voices.noteOn(defaultSynthSettings(), 60, 100, 0);
    voices.noteOn(defaultSynthSettings(), 64, 100, 0);
    expect(voices.activeCount).toBe(2);
  });

  it("releases the voice a note-off names, and only that one", () => {
    const ctx = context();
    const voices = bank(ctx);
    voices.noteOn(defaultSynthSettings(), 60, 100, 0);
    voices.noteOn(defaultSynthSettings(), 64, 100, 0);
    voices.noteOff(60, 1);
    expect(voices.activeCount).toBe(1);
    voices.noteOff(99, 1);
    expect(voices.activeCount).toBe(1);
  });

  it("steals the oldest voice at the ceiling rather than refusing to play", () => {
    const ctx = context();
    const voices = bank(ctx, 2);
    voices.noteOn(defaultSynthSettings(), 60, 100, 0);
    voices.noteOn(defaultSynthSettings(), 62, 100, 0.1);
    voices.noteOn(defaultSynthSettings(), 64, 100, 0.2);
    expect(voices.activeCount).toBe(2);
    // The oldest is gone, so releasing it does nothing.
    voices.noteOff(60, 1);
    expect(voices.activeCount).toBe(2);
  });

  it("retunes a note that is struck again rather than stacking voices", () => {
    const ctx = context();
    const voices = bank(ctx);
    voices.noteOn(defaultSynthSettings(), 60, 100, 0);
    voices.noteOn(defaultSynthSettings(), 60, 100, 0.5);
    expect(voices.activeCount).toBe(1);
  });

  it("goes silent on demand", () => {
    const ctx = context();
    const voices = bank(ctx);
    voices.noteOn(defaultSynthSettings(), 60, 100, 0);
    voices.noteOn(defaultSynthSettings(), 64, 100, 0);
    voices.panic(1);
    expect(voices.activeCount).toBe(0);
  });

  it("refuses to start anything after it has been disposed", () => {
    // A note already in flight when the module is rebuilt would otherwise
    // start an oscillator on a disconnected chain.
    const ctx = context();
    const voices = bank(ctx);
    voices.dispose();
    voices.noteOn(defaultSynthSettings(), 60, 100, 0);
    expect(voices.activeCount).toBe(0);
    expect(of(ctx, FakeOscillator)).toHaveLength(0);
  });

  it("drops every voice it is holding when disposed", () => {
    const ctx = context();
    const voices = bank(ctx);
    voices.noteOn(defaultSynthSettings(), 60, 100, 0);
    voices.noteOn(defaultSynthSettings(), 64, 100, 0);
    voices.dispose();
    expect(voices.activeCount).toBe(0);
  });

  it("stops a voice once, however it is ended", () => {
    // Released, then stolen by a panic: the second stop must not reschedule.
    const ctx = context();
    const voices = bank(ctx);
    voices.noteOn(defaultSynthSettings(), 60, 100, 0);
    voices.noteOff(60, 1);
    const stops = of(ctx, FakeOscillator)[0].stops.length;
    voices.panic(2);
    expect(of(ctx, FakeOscillator)[0].stops).toHaveLength(stops);
  });

  it("forgets a voice when its oscillators end on their own", () => {
    const ctx = context();
    const voices = bank(ctx);
    voices.noteOn(defaultSynthSettings(), 60, 100, 0);
    expect(voices.activeCount).toBe(1);
    of(ctx, FakeOscillator)[0].finish();
    expect(voices.activeCount).toBe(0);
  });
});
