import { describe, expect, it } from "vitest";
import { VoiceBank, CHOKE_SEC, clampPan, envelopeValueAt } from "./voices";
import { createPlayer } from "./players";
import { FakeBuffer, FakeBufferSource, FakeNode, FakeStereoPanner } from "./testing/fakeContext";
import { SpecContext, specGain } from "./testing/specParam";

// The envelope as the audio thread will play it, read off Web Audio's own
// timeline rules rather than off whatever the code last scheduled. The numbers
// are the ones `rust/dsp-core/src/sampler.rs` asserts for the same hit, so the
// two backends are held to one law.
//
// One hit: level 0.8, pad gain 0.9, velocity 64, decay 0.5 s.
const LEVEL = 0.8;
const PAD_GAIN = 0.9;
const VELOCITY = 64;
const DECAY = 0.5;
const START = LEVEL * PAD_GAIN * (VELOCITY / 127) ** 2;

const buffer = (seconds = 4, rate = 48000) => new FakeBuffer(1, seconds * rate, rate);

const rig = () => {
  const context = new SpecContext();
  const bank = new VoiceBank(context, new FakeNode("out"));
  const gains = () =>
    context.created
      .filter((node): node is FakeBufferSource => node instanceof FakeBufferSource)
      .map((source) => specGain([...source.outgoing][0]));
  const sources = () => context.created.filter((node): node is FakeBufferSource => node instanceof FakeBufferSource);
  return { context, bank, gains, sources };
};

describe("A voice's envelope, as the audio thread plays it", () => {
  it("starts a decaying hit at its level, not at the gain's default of 1", () => {
    const { bank, gains } = rig();
    bank.play(buffer(), { atSec: 1, level: START, decaySec: DECAY });
    const gain = gains()[0];
    expect(gain.valueAt(1)).toBeCloseTo(START, 12);
    expect(gain.valueAt(1.1)).toBeCloseTo(START * Math.exp(-0.1 / DECAY), 12);
  });

  it("rises a grain window from silence, holds it, then lets it fall", () => {
    const { bank, gains } = rig();
    bank.play(buffer(), { atSec: 2, level: 0.6, attackSec: 0.01, holdSec: 0.03, decaySec: 0.02 });
    const gain = gains()[0];
    expect(gain.valueAt(2)).toBeCloseTo(0, 12);
    expect(gain.valueAt(2.005)).toBeCloseTo(0.3, 12);
    expect(gain.valueAt(2.02)).toBeCloseTo(0.6, 12);
    expect(gain.valueAt(2.05)).toBeCloseTo(0.6 * Math.exp(-1), 12);
  });

  it("plays an undecayed voice at its level", () => {
    const { bank, gains } = rig();
    bank.play(buffer(), { atSec: 0, level: 0.4 });
    expect(gains()[0].valueAt(3)).toBeCloseTo(0.4, 12);
  });

  it("fades a choked voice from where its envelope is at the choke", () => {
    const { bank, gains, sources } = rig();
    bank.play(buffer(), { atSec: 0, level: START, decaySec: DECAY, chokeGroup: 1 });
    bank.play(buffer(), { atSec: 0.12, level: START, decaySec: DECAY, chokeGroup: 1 });
    const choked = gains()[0];
    const atChoke = START * Math.exp(-0.12 / DECAY);
    expect(choked.valueAt(0.12)).toBeCloseTo(atChoke, 12);
    expect(choked.valueAt(0.13)).toBeCloseTo(atChoke * Math.exp(-0.01 / CHOKE_SEC), 12);
    // Its own end was already scheduled; the later stop is the one that applies.
    const stops = sources()[0].stops;
    expect(stops[stops.length - 1]).toBe(0.12 + CHOKE_SEC * 2);
  });

  it("fades a grain choked mid-attack from its rising value", () => {
    const { bank, gains } = rig();
    bank.play(buffer(), { atSec: 0, level: 0.6, attackSec: 0.02, chokeGroup: 2 });
    bank.choke(2, 0.01);
    expect(gains()[0].valueAt(0.01)).toBeCloseTo(0.3, 12);
  });

  it("fades a stolen voice the way it fades a choked one", () => {
    const context = new SpecContext();
    const bank = new VoiceBank(context, new FakeNode("out"), 1);
    bank.play(buffer(), { atSec: 0, level: START, decaySec: DECAY });
    bank.play(buffer(), { atSec: 0.2, level: START, decaySec: DECAY });
    const first = context.created.find((node): node is FakeBufferSource => node instanceof FakeBufferSource)!;
    const gain = specGain([...first.outgoing][0]);
    const atSteal = START * Math.exp(-0.2 / DECAY);
    expect(gain.valueAt(0.2)).toBeCloseTo(atSteal, 12);
    expect(gain.valueAt(0.21)).toBeCloseTo(atSteal * Math.exp(-0.01 / CHOKE_SEC), 12);
  });
});

describe("Percussion's hit, as the audio thread plays it", () => {
  const kit = () => {
    const context = new SpecContext();
    const player = createPlayer(context, {
      nodeId: "p1",
      moduleType: "m.percussion",
      structure: { slots: [{ note: 46, assetId: "hat", chokeGroup: 1, gain: PAD_GAIN, pan: 0.35 }] },
      parameters: { level: LEVEL, "decay-seconds": DECAY },
      bypass: false,
      wet: 1,
    }, 0, {
      samples: () => buffer(),
      schedule: () => () => {},
      random: () => 0.5,
    }, () => "linear");
    return { context, player };
  };

  it("starts at level × pad gain × velocity squared", () => {
    const { context, player } = kit();
    player.noteOn(46, VELOCITY, 1);
    const source = context.created.find((node): node is FakeBufferSource => node instanceof FakeBufferSource)!;
    const gain = specGain([...source.outgoing][0]);
    expect(gain.valueAt(1)).toBeCloseTo(START, 12);
    expect(gain.valueAt(1.1)).toBeCloseTo(START * Math.exp(-0.1 / DECAY), 12);
  });

  it("takes every pad into its pan stage as stereo, so a centred pad never changes level", () => {
    // Left to Web Audio's default, the kit's panner counts channels from what
    // is sounding: centred pads alone are mono and come out 3 dB down, and the
    // same kick jumps 3 dB louder whenever a panned hat is ringing. Explicit
    // stereo makes a centred pad full level in both channels, always.
    const { context } = kit();
    const panner = context.created.find((node): node is FakeStereoPanner => node instanceof FakeStereoPanner)!;
    expect((panner as unknown as { channelCount: number }).channelCount).toBe(2);
    expect((panner as unknown as { channelCountMode: string }).channelCountMode).toBe("explicit");
    expect((panner as unknown as { channelInterpretation: string }).channelInterpretation).toBe("speakers");
  });
});

describe("A voice bank's edges", () => {
  it("steals the voice that started first, wherever it sits in the bank", () => {
    const context = new SpecContext();
    const bank = new VoiceBank(context, new FakeNode("out"), 2);
    bank.play(buffer(), { atSec: 5, level: 0.5 });
    bank.play(buffer(), { atSec: 1, level: 0.5 });
    bank.play(buffer(), { atSec: 6, level: 0.5 });
    const sources = context.created.filter((node): node is FakeBufferSource => node instanceof FakeBufferSource);
    expect(sources[0].stops).toEqual([]);
    expect(sources[1].stops).toEqual([6 + CHOKE_SEC * 2]);
  });

  it("lets go of a voice's panner when the voice ends", () => {
    const context = new SpecContext();
    const out = new FakeNode("out");
    const bank = new VoiceBank(context, out);
    bank.play(buffer(), { atSec: 0, level: 0.5, pan: -0.5 });
    const panner = context.created.find((node): node is FakeStereoPanner => node instanceof FakeStereoPanner)!;
    expect(panner.outgoing.has(out)).toBe(true);
    context.created.find((node): node is FakeBufferSource => node instanceof FakeBufferSource)!.finish();
    expect(panner.outgoing.size).toBe(0);
  });

  it("centres a pan that is not a number", () => {
    expect(clampPan(Number.NaN)).toBe(0);
    expect(clampPan(3)).toBe(1);
  });

  it("is silent before an attack begins, and at full level until a decay's release", () => {
    expect(envelopeValueAt({ atSec: 1, level: 0.8, attackSec: 0.1 }, 0.5)).toBe(0);
    expect(envelopeValueAt({ atSec: 1, level: 0.8, decaySec: 0.5 }, 1)).toBe(0.8);
    expect(envelopeValueAt({ atSec: 1, level: 0.8, holdSec: 0.2, decaySec: 0.5 }, 1.1)).toBe(0.8);
  });
});
