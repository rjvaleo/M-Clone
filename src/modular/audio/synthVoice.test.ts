import { describe, expect, it } from "vitest";
import {
  defaultSynthSettings,
  modulateSettings,
  SynthVoice,
  SynthVoiceBank,
  type SynthSettings,
} from "./synthVoice";
import { emptyMatrix, setRouting, type ModSourceValues } from "./modMatrix";
import { orderTimeline, timelineValueAt, type TimelineEvent } from "./webAudioLaws";
import {
  FakeAudioContext,
  FakeBiquad,
  FakeGain,
  FakeNode,
  FakeConstantSource,
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
  routing: ConstructorParameters<typeof SynthVoice>[6] = {},
) => {
  const voice = new SynthVoice(ctx, ctx.createGain(), settings(overrides), note, velocity, atSec, routing);
  return voice;
};

/**
 * A parameter's automation as the browser's timeline holds it: its calls,
 * ordered as `InsertEvent` orders them, cancels applied.
 */
type TimelineCall = TimelineEvent | { kind: "cancel"; time: number };
const timeline = (param: FakeGain["gain"]): TimelineEvent[] =>
  orderTimeline(param.calls.flatMap((call): TimelineCall[] => {
    if (call.method === "set") return [{ kind: "set", value: call.value, time: call.time }];
    if (call.method === "linear") return [{ kind: "linear", value: call.value, time: call.time }];
    if (call.method === "cancel") return [{ kind: "cancel", time: call.time }];
    return [];
  }));

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
    // A percussive organ patch: straight to full, no fall. A ramp that ends
    // at the moment it starts is a step on the browser's timeline.
    const ctx = context();
    play(ctx, {
      amp: { attack: 0, decay: 0, sustain: 1, release: 0.1 }, level: 1,
    }, 69, 127);
    const events = timeline(ampGain(ctx).gain);
    expect(timelineValueAt(events, 47999, 48000)).toBe(0);
    expect(timelineValueAt(events, 48000, 48000)).toBe(1);
    expect(timelineValueAt(events, 96000, 48000)).toBe(1);
  });

  it("holds its sustain until it is released, then releases over the release time", () => {
    // The numbers `voice.rs` pins: a 10 ms attack, 80 ms decay to 0.6, a
    // 200 ms release. Played at 0 s. No gate: whatever its step, nothing is
    // written for a release until the note-off.
    const ctx = context();
    const voice = play(ctx, {
      amp: { attack: 0.01, decay: 0.08, sustain: 0.6, release: 0.2 }, level: 1,
    }, 69, 127, 0);
    expect(voice.isReleased).toBe(false);
    const held = timeline(ampGain(ctx).gain);
    // Past 85 % of a 125 ms step (5 100), past the step (6 000), and on.
    expect([0, 240, 480, 2400, 4320, 5100, 6000, 12000].map((k) => timelineValueAt(held, k, 48000)))
      .toEqual([0, 0.5, 1, 0.800000011920929, 0.6000000238418579, 0.6000000238418579, 0.6000000238418579, 0.6000000238418579]);
    expect(of(ctx, FakeOscillator)[0].stops).toEqual([]);
    // Released at 250 ms: the sustain, then down over 200 ms.
    voice.release(0.25);
    expect(voice.isReleased).toBe(true);
    const released = timeline(ampGain(ctx).gain);
    expect([12000, 16800, 21600].map((k) => timelineValueAt(released, k, 48000)))
      .toEqual([0.6000000238418579, 0.30000001192092896, 0]);
    // The oscillators stop 50 ms after the release ends.
    expect(of(ctx, FakeOscillator)[0].stops).toEqual([0.25 + 0.2 + 0.05]);
  });

  it("writes a live release over the envelope without cancelling it", () => {
    // From the key-up on, the original's release curve, written over what is there.
    const ctx = context();
    const voice = play(ctx, {
      amp: { attack: 0.15, decay: 0.08, sustain: 0.6, release: 0.2 }, level: 1,
    }, 69, 127, 0);
    voice.release(0.10625);
    const events = timeline(ampGain(ctx).gain);
    expect(ampGain(ctx).gain.calls.some((call) => call.method === "cancel")).toBe(false);
    expect([5100, 6000, 7200, 9000, 11040].map((k) => timelineValueAt(events, k, 48000)))
      .toEqual([0.6000000238418579, 0.7714285850524902, 1, 0.8125, 0.6000000238418579]);
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

  it("is written in hertz when the knob comes without its value", () => {
    const ctx = context();
    const knob = ctx.createConstantSource();
    play(ctx, {
      filter: { ...defaultSynthSettings().filter, cutoffHz: 1000, keyFollow: 0, envAmountOctaves: 0 },
    }, 60, 100, 1, { cutoffBase: knob });
    expect(timeline(filterOf(ctx).frequency)[0].value).toBe(1000);
  });

  it("is written as offsets from the knob, which arrives as a signal and moves sounding notes", () => {
    const ctx = context();
    const knob = ctx.createConstantSource() as FakeConstantSource;
    const voice = play(ctx, {
      filter: {
        cutoffHz: 1000, resonance: 1, keyFollow: 1, envAmountOctaves: 0, envAmount: 1,
        adsr: { attack: 0.01, decay: 0.15, sustain: 0.3, release: 0.3 },
      },
    }, 72, 100, 1, { cutoffBase: knob, knobHz: 1000 });
    const filter = filterOf(ctx);
    expect(knob.outgoing.has(filter.frequency as unknown as FakeNode)).toBe(true);
    // Key follow an octave up: base 2 kHz, peak 2 + 30 kHz held at 20, all
    // less the knob's 1 kHz.
    const events = timeline(filter.frequency);
    expect(events.map((event) => event.value)).toEqual([1000, 19000, 2000 + 0.3 * 30000 - 1000]);
    voice.release(2);
    expect(timeline(filter.frequency).slice(-2).map((event) => event.value)).toEqual([2000 + 0.3 * 30000 - 1000, 1000]);
    voice.dispose();
    expect(knob.outgoing.has(filter.frequency as unknown as FakeNode)).toBe(false);
  });

  it("sweeps the cutoff by its own envelope, in octaves", () => {
    const ctx = context();
    play(ctx, {
      filter: {
        cutoffHz: 500, resonance: 1, keyFollow: 0, envAmountOctaves: 2, envAmount: 0,
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
        cutoffHz: 2000, resonance: 1, keyFollow: 0, envAmountOctaves: -1, envAmount: 0,
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
        cutoffHz: 18000, resonance: 1, keyFollow: 1, envAmountOctaves: 4, envAmount: 0,
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

  it("releases the voice a note-off names, and only that one, which rings out", () => {
    const ctx = context();
    const voices = bank(ctx);
    voices.noteOn(defaultSynthSettings(), 60, 100, 0);
    voices.noteOn(defaultSynthSettings(), 64, 100, 0);
    voices.noteOff(60, 1);
    expect(voices.heldCount).toBe(1);
    expect(voices.activeCount).toBe(2);
    voices.noteOff(99, 1);
    expect(voices.heldCount).toBe(1);
    of(ctx, FakeOscillator)[0].finish();
    expect(voices.activeCount).toBe(1);
  });

  it("steals the earliest-started voice, whatever order the notes arrived in", () => {
    const ctx = context();
    const voices = bank(ctx, 2);
    voices.noteOn(defaultSynthSettings(), 60, 100, 0.5);
    voices.noteOn(defaultSynthSettings(), 62, 100, 0.1);
    voices.noteOn(defaultSynthSettings(), 64, 100, 0.6);
    // 62 began first, so 62 went: releasing it does nothing, 60 is still held.
    voices.noteOff(62, 1);
    expect(voices.heldCount).toBe(2);
    voices.noteOff(60, 1);
    expect(voices.heldCount).toBe(1);
  });

  it("lets a released note ring without counting against the ceiling", () => {
    const ctx = context();
    const voices = bank(ctx, 1);
    for (const note of [60, 62, 64]) {
      voices.noteOn(defaultSynthSettings(), note, 100, 0);
      voices.noteOff(note, 0.1);
    }
    expect(voices.heldCount).toBe(0);
    expect(voices.activeCount).toBe(3);
    voices.panic(1);
    expect(voices.activeCount).toBe(0);
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

  it("lets a note struck again ring out and starts it afresh, as the original does", () => {
    const ctx = context();
    const voices = bank(ctx);
    voices.noteOn(defaultSynthSettings(), 60, 100, 0);
    voices.noteOn(defaultSynthSettings(), 60, 100, 0.5);
    expect(voices.heldCount).toBe(1);
    expect(voices.activeCount).toBe(2);
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

describe("The scale sequencer's filter laws, in a voice", () => {
  const filterOf = (ctx: FakeAudioContext) => of(ctx, FakeBiquad)[0];
  const sweepOf = (envAmount: number, overrides: Partial<SynthSettings["filter"]> = {}) => {
    const ctx = context();
    play(ctx, {
      filter: {
        cutoffHz: 1000, resonance: 1, keyFollow: 0, envAmountOctaves: 0, envAmount,
        adsr: { attack: 0.01, decay: 0.15, sustain: 0.3, release: 0.3 }, ...overrides,
      },
    }, 60);
    return filterOf(ctx).frequency.moves().map((call) => call.value);
  };

  it("peaks four octaves up at +100 %, with the sustain in hertz", () => {
    expect(sweepOf(1)).toEqual([1000, 16000, 5500]);
  });

  it("subtracts linearly at −100 %, to the 20 Hz floor", () => {
    expect(sweepOf(-1)).toEqual([1000, 20, 20]);
  });

  it("follows a microtonal pitch when the bank is told it", () => {
    const ctx = context();
    const voice = new SynthVoice(ctx, ctx.createGain(), settings({
      filter: { ...defaultSynthSettings().filter, cutoffHz: 1000, keyFollow: 1, envAmountOctaves: 0 },
    }), 60, 100, 1, { pitch: 61 });
    expect(filterOf(ctx).frequency.moves()[0].value).toBeCloseTo(1000 * Math.pow(2, 1 / 12), 6);
    voice.dispose();
  });

  it("releases back to the key-followed base", () => {
    const ctx = context();
    const voice = play(ctx, {
      filter: {
        cutoffHz: 1000, resonance: 1, keyFollow: 0, envAmountOctaves: 0, envAmount: 0.5,
        adsr: { attack: 0.01, decay: 0.15, sustain: 0.3, release: 0.3 },
      },
    }, 60);
    voice.release(2);
    expect(filterOf(ctx).frequency.moves().slice(-2).map((call) => [call.time, call.value]))
      .toEqual([[2, 1000 + 0.5 * 15000 * 0.3], [2.3, 1000]]);
  });
});

describe("A classic voice", () => {
  it("has no filter or panner, and sends its amp straight to the shared filter", () => {
    const ctx = context();
    const shared = ctx.createGain();
    play(ctx);
    const before = ctx.created.length;
    new SynthVoice(ctx, shared, settings(), 60, 100, 1, { classic: true });
    const made = ctx.created.slice(before);
    expect(made.filter((node) => node instanceof FakeBiquad)).toHaveLength(0);
    expect(made.filter((node) => node instanceof FakeStereoPanner)).toHaveLength(0);
    const amp = made.find((node): node is FakeGain => node instanceof FakeGain && node.outgoing.has(shared));
    expect(amp).toBeDefined();
    // The oscillators' gains feed the amp directly.
    expect(made.filter((node) => node instanceof FakeGain && node.outgoing.has(amp!))).toHaveLength(3);
  });

  it("stops after its amp releases — its filter is not its own to wait for", () => {
    const ctx = context();
    const voice = new SynthVoice(ctx, ctx.createGain(), settings({
      amp: { attack: 0.01, decay: 0.1, sustain: 0.5, release: 0.2 },
      filter: { ...defaultSynthSettings().filter, adsr: { attack: 0, decay: 0, sustain: 1, release: 3 } },
    }), 60, 100, 1, { classic: true });
    voice.release(2);
    expect(of(ctx, FakeOscillator)[0].stops).toEqual([2 + 0.2 + 0.05]);
    voice.dispose();
  });
});

describe("The module's LFOs reaching a voice", () => {
  it("sum into the voice filter's frequency and Q for as long as it sounds", () => {
    const ctx = context();
    const frequencyMod = ctx.createGain() as FakeGain;
    const qMod = ctx.createGain() as FakeGain;
    const voice = new SynthVoice(ctx, ctx.createGain(), settings(), 60, 100, 1, {
      filterFrequencyMod: frequencyMod, filterQMod: qMod,
    });
    const filter = of(ctx, FakeBiquad)[0];
    expect(frequencyMod.outgoing.has(filter.frequency as unknown as FakeNode)).toBe(true);
    expect(qMod.outgoing.has(filter.Q as unknown as FakeNode)).toBe(true);
    voice.dispose();
    expect(frequencyMod.outgoing.size).toBe(0);
    expect(qMod.outgoing.size).toBe(0);
  });
});
