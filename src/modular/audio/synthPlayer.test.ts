import { describe, expect, it } from "vitest";
import { SynthPlayer, readSynthSettings } from "./synthPlayer";
import { defaultSynthSettings } from "./synthVoice";
import { isNotePlayer } from "./players";
import {
  FakeAudioContext,
  FakeBiquad,
  FakeNode,
  FakeOscillator,
} from "./testing/fakeContext";
import { emptyMatrix } from "./modMatrix";
import type { AudioNodeSpec } from "./audioPlan";

/**
 * The synth as the rest of the engine sees it.
 *
 * A `ManagedAudioNode` like any effect and a `NotePlayer` like any sampler, so
 * the graph adapter wires, bypasses, ramps and disposes it without knowing what
 * it is, and the note adapter plays it without knowing either. Everything below
 * is about that contract holding — the sound itself is `synthVoice.test.ts`.
 */

const of = <T extends FakeNode>(
  ctx: FakeAudioContext,
  Kind: abstract new (...args: never[]) => T,
): T[] => ctx.created.filter((node): node is T => node instanceof Kind);

const spec = (overrides: Partial<AudioNodeSpec> = {}): AudioNodeSpec => ({
  nodeId: "synth",
  moduleType: "m.synth",
  structure: {},
  parameters: {},
  bypass: false,
  wet: 1,
  ...overrides,
});

const rig = (overrides: Partial<AudioNodeSpec> = {}) => {
  const context = new FakeAudioContext();
  const player = new SynthPlayer(context, spec(overrides), 0, { samples: () => undefined },
    () => "linear");
  return { context, player };
};

describe("The synth as a managed node", () => {
  it("offers an input and an output, and arrives silent", () => {
    const { player } = rig();
    expect(player.input).toBeDefined();
    expect(player.output).toBeDefined();
    // The adapter fades it up; a module that arrives audible clicks.
    expect(player.level.value).toBe(0);
  });

  it("answers to the note adapter", () => {
    expect(isNotePlayer(rig().player)).toBe(true);
  });

  it("makes no sound until a note arrives", () => {
    const { context } = rig();
    expect(of(context, FakeOscillator)).toHaveLength(0);
  });

  it("takes bypass and wet without complaint", () => {
    const { player } = rig();
    expect(() => player.setBypass(true, 0)).not.toThrow();
    expect(() => player.setWet(0.5, 0)).not.toThrow();
  });
});

describe("Playing notes", () => {
  it("starts a voice on a note, and counts it", () => {
    const { context, player } = rig();
    player.noteOn(60, 100, 1);
    expect(of(context, FakeOscillator)).toHaveLength(3);
    expect(player.activeVoices).toBe(1);
  });

  it("adds a note's microtonal detune to every oscillator", () => {
    // What makes the eighty-one scales audible. A quantiser upstream splits a
    // pitch into a MIDI key plus cents; the key picks the frequency and this
    // is the only place the cents are applied.
    const { context, player } = rig();
    player.noteOn(60, 100, 1, -50);
    const detunes = of(context, FakeOscillator).map((osc) => osc.detune.value);
    // Osc 2 and 3 have their own detune (+7 and −1200 by default), so the
    // note's offset has to be a sum rather than an assignment or the patch's
    // own tuning is destroyed.
    expect(detunes).toEqual([-50, -43, -1250]);
  });

  it("leaves the patch's own detune alone when a note has none", () => {
    const { context, player } = rig();
    player.noteOn(60, 100, 1);
    expect(of(context, FakeOscillator).map((osc) => osc.detune.value)).toEqual([0, 7, -1200]);
  });

  it("releases the voice on note-off", () => {
    const { player } = rig();
    player.noteOn(60, 100, 1);
    player.noteOff(60, 2);
    expect(player.activeVoices).toBe(0);
  });

  it("plays several notes at once", () => {
    const { player } = rig();
    player.noteOn(60, 100, 1);
    player.noteOn(64, 100, 1);
    player.noteOn(67, 100, 1);
    expect(player.activeVoices).toBe(3);
  });

  it("goes quiet on demand", () => {
    const { player } = rig();
    player.noteOn(60, 100, 1);
    player.silence(2);
    expect(player.activeVoices).toBe(0);
  });

  it("starts nothing once disposed", () => {
    const { context, player } = rig();
    player.dispose();
    player.noteOn(60, 100, 1);
    expect(of(context, FakeOscillator)).toHaveLength(0);
  });

  it("disposes cleanly, twice if asked", () => {
    const { player } = rig();
    player.noteOn(60, 100, 1);
    expect(() => player.dispose()).not.toThrow();
    expect(() => player.dispose()).not.toThrow();
  });

  it("holds polyphony to the ceiling its parameter sets", () => {
    const { player } = rig({ parameters: { "max-voices": 2 } });
    for (const note of [60, 62, 64, 66]) player.noteOn(note, 100, 1);
    expect(player.activeVoices).toBe(2);
  });
});

describe("Reading the settings a document stores", () => {
  it("falls back to a patch that makes a sound", () => {
    // Plus an empty matrix: a patch is the settings and their routings.
    const { matrix, ...settings } = readSynthSettings({}, {});
    expect(settings).toEqual(defaultSynthSettings());
    expect(matrix).toEqual(emptyMatrix());
  });

  it("reads the oscillators from flat parameters", () => {
    // Flat because that is what a node face edits and a preset slot captures:
    // one number per control, not a nested object.
    const settings = readSynthSettings({
      "osc1-wave": "square", "osc1-detune": 12, "osc1-level": 0.4, "osc1-width": 0.3,
      "osc3-wave": "pulse",
    }, {});
    expect(settings.oscillators[0]).toEqual({
      wave: "square", detuneCents: 12, level: 0.4, pulseWidth: 0.3,
    });
    expect(settings.oscillators[2].wave).toBe("pulse");
  });

  it("reads both envelopes, in seconds", () => {
    // Faces show milliseconds because that is how an envelope is talked about;
    // the voice schedules in seconds because that is what the clock speaks.
    const settings = readSynthSettings({
      "amp-attack": 250, "amp-decay": 500, "amp-sustain": 0.25, "amp-release": 1000,
      "filter-attack": 5, "filter-release": 50,
    }, {});
    expect(settings.amp).toEqual({ attack: 0.25, decay: 0.5, sustain: 0.25, release: 1 });
    expect(settings.filter.adsr.attack).toBeCloseTo(0.005, 9);
    expect(settings.filter.adsr.release).toBeCloseTo(0.05, 9);
  });

  it("reads the filter", () => {
    const settings = readSynthSettings({
      cutoff: 800, resonance: 6, "key-follow": 0.5, "filter-amount": -2,
    }, {});
    expect(settings.filter.cutoffHz).toBe(800);
    expect(settings.filter.resonance).toBe(6);
    expect(settings.filter.keyFollow).toBe(0.5);
    expect(settings.filter.envAmountOctaves).toBe(-2);
  });

  it("refuses a wave it does not have", () => {
    // A document from a later build, or a typo. Falling back keeps the patch.
    expect(readSynthSettings({ "osc1-wave": "supersaw" }, {}).oscillators[0].wave)
      .toBe(defaultSynthSettings().oscillators[0].wave);
  });

  it("reads values that are not numbers as the defaults", () => {
    const settings = readSynthSettings({
      cutoff: Number.NaN, "amp-attack": "soon" as never, level: null as never,
    }, {});
    expect(settings.filter.cutoffHz).toBe(defaultSynthSettings().filter.cutoffHz);
    expect(settings.amp.attack).toBe(defaultSynthSettings().amp.attack);
    expect(settings.level).toBe(defaultSynthSettings().level);
  });

  it("takes the modulation matrix from the node's structure", () => {
    const settings = readSynthSettings({ cutoff: 1000 }, {
      matrix: [{ source: "velocity", destination: "filter-cutoff", amount: 0.25 }],
    });
    expect(settings.matrix).toBeDefined();
  });
});

describe("Modulation reaching a note", () => {
  it("opens the filter further for a harder note", () => {
    // Velocity routed to cutoff: the classic reason a matrix exists.
    const context = new FakeAudioContext();
    const player = new SynthPlayer(context, spec({
      parameters: { cutoff: 1000, "filter-amount": 0, "key-follow": 0 },
      structure: {
        matrix: [{ source: "velocity", destination: "filter-cutoff", amount: 1 }],
      },
    }), 0, { samples: () => undefined }, () => "linear");

    player.noteOn(60, 127, 1);
    player.noteOn(72, 1, 1);
    const [hard, soft] = of(context, FakeBiquad);
    expect(hard.frequency.moves()[0].value)
      .toBeGreaterThan(soft.frequency.moves()[0].value);
  });

  it("gives each note its own random draw", () => {
    const context = new FakeAudioContext();
    let draw = 0;
    const player = new SynthPlayer(context, spec({
      parameters: { cutoff: 1000, "filter-amount": 0, "key-follow": 0 },
      structure: { matrix: [{ source: "random", destination: "filter-cutoff", amount: 1 }] },
    }), 0, { samples: () => undefined, random: () => (draw += 0.5) - 0.5 }, () => "linear");

    player.noteOn(60, 100, 1);
    player.noteOn(62, 100, 1);
    const [first, second] = of(context, FakeBiquad);
    expect(first.frequency.moves()[0].value)
      .not.toBeCloseTo(second.frequency.moves()[0].value, 3);
  });
});

describe("Live parameter edits", () => {
  it("changes the patch the next note is built from", () => {
    const { context, player } = rig({
      parameters: { cutoff: 500, "filter-amount": 0, "key-follow": 0 },
    });
    player.noteOn(60, 100, 1);
    player.setParameter("cutoff", 4000, 1.5);
    player.noteOn(62, 100, 2);
    const [first, second] = of(context, FakeBiquad);
    expect(first.frequency.moves()[0].value).toBeCloseTo(500, 3);
    expect(second.frequency.moves()[0].value).toBeCloseTo(4000, 3);
  });

  it("does not disturb a note already sounding", () => {
    // The bug this design exists to prevent: in the source, touching the cutoff
    // cancelled the envelopes of notes already scheduled.
    const { context, player } = rig({
      parameters: { cutoff: 500, "filter-amount": 2, "key-follow": 0 },
    });
    player.noteOn(60, 100, 1);
    const before = of(context, FakeBiquad)[0].frequency.moves().length;
    player.setParameter("cutoff", 4000, 1.5);
    expect(of(context, FakeBiquad)[0].frequency.moves()).toHaveLength(before);
  });

  it("takes every parameter its module declares without throwing", () => {
    const { player } = rig();
    for (const [id, value] of Object.entries({
      cutoff: 3000, resonance: 4, "key-follow": 1, "filter-amount": 2,
      "amp-attack": 5, "amp-decay": 100, "amp-sustain": 0.5, "amp-release": 200,
      "filter-attack": 5, "filter-decay": 100, "filter-sustain": 0.5, "filter-release": 200,
      "osc1-detune": 5, "osc2-level": 0.5, "osc3-width": 0.4,
      level: 0.5, pan: -0.5, "max-voices": 8,
    })) {
      expect(() => player.setParameter(id, value, 0), id).not.toThrow();
    }
  });
});
