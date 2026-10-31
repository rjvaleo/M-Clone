import { describe, expect, it } from "vitest";
import { SynthPlayer, readSynthSettings, CUTOFF_GLIDE_SEC } from "./synthPlayer";
import {
  FakeAudioContext,
  FakeBiquad,
  FakeConstantSource,
  FakeDelay,
  FakeGain,
  FakeNode,
  FakeOscillator,
  FakeParam,
  FakeStereoPanner,
} from "./testing/fakeContext";
import type { AudioNodeSpec } from "./audioPlan";
import {
  DELAY_NOTES,
  delaySeconds,
  planTapeGlide,
  tapeGlideCurve,
  tapeGlideValueAt,
} from "./synthLaws";
import { pulseWaveCoefficients } from "./dsp";

/**
 * The scale sequencer's parts of the synth on Web Audio: the chain after the
 * voices, the three LFOs, the pulse LFO, the classic shared filter. The graph
 * is checked node by node against `initAudio`, and the laws by the values the
 * nodes are given.
 */

const spec = (parameters: Record<string, unknown> = {}): AudioNodeSpec => ({
  nodeId: "synth",
  moduleType: "m.synth",
  structure: {},
  parameters: parameters as Record<string, number>,
  bypass: false,
  wet: 1,
});

const build = (parameters: Record<string, unknown> = {}, atSec = 0) => {
  const context = new FakeAudioContext();
  const player = new SynthPlayer(context, spec(parameters), atSec, { samples: () => undefined }, () => "linear");
  const built = context.created.length;
  const all = <T extends FakeNode>(Kind: abstract new (...args: never[]) => T): T[] =>
    context.created.filter((node): node is T => node instanceof Kind);
  const fresh = <T extends FakeNode>(Kind: abstract new (...args: never[]) => T): T[] =>
    context.created.slice(built).filter((node): node is T => node instanceof Kind);
  const [delayL, delayR] = all(FakeDelay);
  const [hiCutLR, hiCutRL, classicFilter] = all(FakeBiquad);
  const [panL, panR] = all(FakeStereoPanner);
  const [cutoffBase, filterEnv] = all(FakeConstantSource);
  const lfoOscs = all(FakeOscillator).slice(0, 3);
  const lfoGains = lfoOscs.map((osc) => [...osc.outgoing][0] as FakeGain);
  const gains = all(FakeGain);
  const output = player.output as FakeGain;
  const master = gains.find((gain) => gain.outgoing.has(output))!;
  const wetGain = [...panL.outgoing][0] as FakeGain;
  const fbLR = [...hiCutLR.outgoing][0] as FakeGain;
  const fbRL = [...hiCutRL.outgoing][0] as FakeGain;
  const mono = gains.find((gain) => gain.outgoing.has(delayL) && gain !== fbRL)!;
  const bus = gains.find((gain) => gain.outgoing.has(mono))!;
  const dry = gains.find((gain) => bus.outgoing.has(gain) && gain !== mono)!;
  const classicIn = gains.find((gain) => gain.outgoing.has(classicFilter))!;
  const freqOf = (filter: FakeBiquad) => filter.frequency as unknown as FakeNode;
  const lfoFilterBus = gains.find((gain) => gain !== classicIn && gain.outgoing.has(freqOf(classicFilter)))!;
  const lfoQBus = gains.find((gain) => gain.outgoing.has(classicFilter.Q as unknown as FakeNode))!;
  return {
    context, player, fresh, delayL, delayR, hiCutLR, hiCutRL, classicFilter, panL, panR,
    cutoffBase, filterEnv, lfoOscs, lfoGains, master, wetGain, fbLR, fbRL, mono, bus, dry,
    classicIn, lfoFilterBus, lfoQBus,
  };
};

/** The nth item from the end. */
const from = <T,>(items: ArrayLike<T>, n: number): T => items[items.length - n];

const index = (label: string) => DELAY_NOTES.findIndex((note) => note.label === label);

describe("The chain after the voices", () => {
  it("is the original's ping-pong loop, wired node for node", () => {
    const rig = build();
    expect(rig.bus.outgoing).toEqual(new Set([rig.dry, rig.mono]));
    expect(rig.dry.outgoing).toEqual(new Set([rig.master]));
    expect(rig.mono.outgoing).toEqual(new Set([rig.delayL]));
    expect(rig.delayL.outgoing).toEqual(new Set([rig.panL, rig.hiCutLR]));
    expect(rig.hiCutLR.outgoing).toEqual(new Set([rig.fbLR]));
    expect(rig.fbLR.outgoing).toEqual(new Set([rig.delayR]));
    expect(rig.delayR.outgoing).toEqual(new Set([rig.panR, rig.hiCutRL]));
    expect(rig.hiCutRL.outgoing).toEqual(new Set([rig.fbRL]));
    expect(rig.fbRL.outgoing).toEqual(new Set([rig.delayL]));
    expect(rig.panR.outgoing).toEqual(new Set([rig.wetGain]));
    expect(rig.wetGain.outgoing).toEqual(new Set([rig.master]));
    expect(rig.classicFilter.outgoing).toEqual(new Set([rig.bus]));
  });

  it("feeds the delay one channel, as the original's mono filter did", () => {
    const { mono } = build();
    expect(mono.channelCount).toBe(1);
    expect(mono.channelCountMode).toBe("explicit");
    expect(mono.channelInterpretation).toBe("speakers");
  });

  it("gives the lines four seconds and the hi-cuts the original's Q", () => {
    const rig = build({ "delay-hicut": 3000 });
    expect(rig.delayL.maxDelaySeconds).toBe(4);
    expect(rig.delayR.maxDelaySeconds).toBe(4);
    for (const cut of [rig.hiCutLR, rig.hiCutRL]) {
      expect(cut.type).toBe("lowpass");
      expect(cut.Q.value).toBe(0.5);
      expect(cut.frequency.value).toBe(3000);
    }
  });

  it("splits dry and wet as 1 − wet and wet, feeds back both legs, and spreads them apart", () => {
    const rig = build({ "delay-wet": 0.25, "delay-feedback": 0.35, "delay-spread": 0.8, volume: 0.21 });
    expect(rig.dry.gain.value).toBe(0.75);
    expect(rig.wetGain.gain.value).toBe(0.25);
    expect(rig.fbLR.gain.value).toBe(0.35);
    expect(rig.fbRL.gain.value).toBe(0.35);
    expect(rig.panL.pan.value).toBe(-0.8);
    expect(rig.panR.pan.value).toBe(0.8);
    expect(rig.master.gain.value).toBe(0.21);
  });

  it("is out of the way by default: no wet, unity volume", () => {
    const rig = build();
    expect(rig.dry.gain.value).toBe(1);
    expect(rig.wetGain.gain.value).toBe(0);
    expect(rig.master.gain.value).toBe(1);
  });

  it("moves its controls when they are turned", () => {
    const rig = build();
    rig.player.setParameter("delay-wet", 0.4, 1);
    rig.player.setParameter("delay-spread", 0.5, 1);
    rig.player.setParameter("volume", 0.5, 1);
    expect(rig.dry.gain.value).toBeCloseTo(0.6, 12);
    expect(rig.wetGain.gain.value).toBe(0.4);
    expect(rig.panL.pan.value).toBe(-0.5);
    expect(rig.master.gain.value).toBe(0.5);
  });

  it("disposes the whole chain, stopping its sources", () => {
    const rig = build();
    rig.player.dispose();
    expect(rig.cutoffBase.stops).toEqual([0]);
    expect(rig.filterEnv.stops).toEqual([0]);
    for (const osc of rig.lfoOscs) expect(osc.stops).toEqual([0]);
    expect(rig.delayL.outgoing.size).toBe(0);
    expect(rig.master.outgoing.size).toBe(0);
  });
});

describe("The delay's time", () => {
  it("is each note value at the tempo", () => {
    for (const note of DELAY_NOTES) {
      const rig = build({ tempo: 90, "delay-note": index(note.label) });
      expect(rig.delayL.delayTime.value, note.label).toBeCloseTo(delaySeconds(90, note.beats), 12);
      expect(rig.delayR.delayTime.value, note.label).toBeCloseTo(delaySeconds(90, note.beats), 12);
      expect(rig.player.delayTimeAt(5)).toBeCloseTo(delaySeconds(90, note.beats), 12);
    }
  });

  it("glides on tape to a new note value, starting at once", () => {
    const rig = build({ tempo: 120, "delay-note": index("1/8") });
    rig.player.setParameter("delay-note", index("1/4"), 2);
    const glide = planTapeGlide(2, 0, 0.25, 0.5, 7.5)!;
    for (const line of [rig.delayL, rig.delayR]) {
      const time = line.delayTime as FakeParam;
      expect(time.curves).toHaveLength(1);
      expect(time.curves[0].start).toBe(2);
      expect(time.curves[0].duration).toBeCloseTo(glide.T, 12);
      expect(Array.from(time.curves[0].values)).toEqual(Array.from(tapeGlideCurve(glide)));
      // Held where it is, then pinned there, then the curve.
      const tail = time.calls.slice(-3).map((call) => call.method);
      expect(tail).toEqual(["hold", "set", "curve"]);
      expect(from(time.calls, 2)!.value).toBe(0.25);
    }
    expect(rig.player.delayTimeAt(2 + glide.T / 2)).toBeCloseTo(tapeGlideValueAt(glide, 2 + glide.T / 2), 12);
  });

  it("follows a tempo change after the original's pause", () => {
    const rig = build({ tempo: 120, "delay-note": index("1/8") });
    rig.player.setParameter("tempo", 60, 1);
    const curve = (rig.delayL.delayTime as FakeParam).curves[0];
    expect(curve.start).toBeCloseTo(1.12, 12);
    expect(from(curve.values, 1)).toBeCloseTo(0.5, 6);
  });

  it("glides slower at a faster tape speed, as the transport's speed change is larger", () => {
    const at = (tape: number) => {
      const rig = build({ tempo: 120, "delay-note": index("1/8"), tape });
      rig.player.setParameter("delay-note", index("1/4"), 0);
      return (rig.delayL.delayTime as FakeParam).curves[0].duration;
    };
    expect(at(0) / at(2)).toBeCloseTo(4, 9);
  });

  it("picks up a glide in flight from where it has got to", () => {
    const rig = build({ tempo: 120, "delay-note": index("1/8") });
    rig.player.setParameter("delay-note", index("1 bar"), 0);
    const first = planTapeGlide(0, 0, 0.25, 2, 7.5)!;
    rig.player.setParameter("delay-note", index("1/16"), 0.5);
    const dNow = tapeGlideValueAt(first, 0.5);
    const time = rig.delayL.delayTime as FakeParam;
    expect(from(time.calls, 2)!.value).toBeCloseTo(dNow, 12);
    expect(time.curves[1].duration).toBeCloseTo(planTapeGlide(0.5, 0, dNow, 0.125, 7.5)!.T, 12);
  });

  it("does not move for an edit that leaves the time where it is", () => {
    const rig = build({ tempo: 120, "delay-note": index("1/8") });
    rig.player.setParameter("delay-note", index("1/8"), 1);
    rig.player.setParameter("tempo", 120, 1);
    rig.player.setParameter("delay-feedback", 0.5, 1);
    expect((rig.delayL.delayTime as FakeParam).curves).toHaveLength(0);
  });

  it("cancels and pins where a browser has no cancel-and-hold", () => {
    const rig = build({ tempo: 120 });
    for (const line of [rig.delayL, rig.delayR]) {
      (line.delayTime as { cancelAndHoldAtTime?: unknown }).cancelAndHoldAtTime = undefined;
    }
    rig.player.setParameter("tempo", 100, 3);
    expect((rig.delayL.delayTime as FakeParam).calls.slice(-3).map((call) => call.method))
      .toEqual(["cancel", "set", "curve"]);
  });
});

describe("The three LFOs", () => {
  it("are oscillators at their rate and wave, through a gain", () => {
    const rig = build({ "lfo-a-rate": 3, "lfo-a-wave": 1, "lfo-b-wave": 2 });
    expect(rig.lfoOscs.map((osc) => osc.type)).toEqual(["triangle", "sawtooth", "sine"]);
    expect(rig.lfoOscs[0].frequency.value).toBe(3);
    expect(rig.lfoOscs.every((osc) => osc.starts[0] === 0)).toBe(true);
  });

  it("scale a filter LFO by the cutoff knob, into every filter's frequency", () => {
    const rig = build({ cutoff: 2000, "lfo-a-depth": 0.2, "lfo-a-target": 1 });
    expect(rig.lfoGains[0].gain.value).toBe(400);
    expect(rig.lfoGains[0].outgoing).toEqual(new Set([rig.lfoFilterBus]));
    // A voice's filter hears the same bus while its note sounds.
    rig.player.noteOn(60, 100, 1);
    const [voiceFilter] = rig.fresh(FakeBiquad);
    expect(rig.lfoFilterBus.outgoing.has(voiceFilter.frequency as unknown as FakeNode)).toBe(true);
    expect(rig.lfoQBus.outgoing.has(voiceFilter.Q as unknown as FakeNode)).toBe(true);
    // And the cutoff knob rescales it, as `updateFilter` does.
    rig.player.setParameter("cutoff", 1000, 2);
    expect(rig.lfoGains[0].gain.value).toBe(200);
  });

  it("send ten units of Q per unit of depth to resonance", () => {
    const rig = build({ "lfo-b-depth": 0.5, "lfo-b-target": 2 });
    expect(rig.lfoGains[1].gain.value).toBe(5);
    expect(rig.lfoGains[1].outgoing).toEqual(new Set([rig.lfoQBus]));
  });

  it("keep the volume and wet they were last touched at, as the original's do", () => {
    // `updateVol` and `updateDelay` never rescale an LFO; touching one of the
    // LFO's own controls does, with the levels of the moment.
    const rig = build({
      volume: 0.21, "delay-wet": 0.25,
      "lfo-a-depth": 0.5, "lfo-a-target": 3, "lfo-c-depth": 1, "lfo-c-target": 5,
    });
    rig.player.setParameter("volume", 0.6, 1);
    rig.player.setParameter("delay-wet", 0.8, 1);
    expect(rig.lfoGains[0].gain.value).toBeCloseTo(0.105, 12);
    expect(rig.lfoGains[2].gain.value).toBe(0.25);
    rig.player.setParameter("lfo-a-rate", 2, 2);
    expect(rig.lfoGains[0].gain.value).toBeCloseTo(0.3, 12);
    expect(rig.lfoGains[2].gain.value).toBe(0.25);
    rig.player.setParameter("lfo-c-wave", 1, 3);
    expect(rig.lfoGains[2].gain.value).toBe(0.8);
    rig.player.setParameter("lfo-b-target", 4, 4);
    rig.player.setParameter("lfo-b-depth", 1, 4);
    expect(rig.lfoGains[0].gain.value).toBeCloseTo(0.3, 12);
  });

  it("take the levels a whole moment lands on, and all three on a preset load", () => {
    const rig = build({ volume: 0.21, "delay-wet": 0.25, "lfo-a-depth": 1, "lfo-a-target": 3, "lfo-c-depth": 1, "lfo-c-target": 5 });
    // An LFO touched, then the volume set, in one moment: the volume counts.
    rig.player.setParameter("lfo-a-depth", 0.5, 2);
    rig.player.setParameter("volume", 0.6, 2);
    expect(rig.lfoGains[0].gain.value).toBeCloseTo(0.3, 12);
    // A later moment does not.
    rig.player.setParameter("volume", 0.9, 3);
    expect(rig.lfoGains[0].gain.value).toBeCloseTo(0.3, 12);
    // A preset load touches all three, whatever changed.
    rig.player.setParameter("delay-wet", 0.5, 4);
    rig.player.setParameter("lfo-touch", 1, 4);
    expect(rig.lfoGains[0].gain.value).toBeCloseTo(0.45, 12);
    expect(rig.lfoGains[2].gain.value).toBe(0.5);
  });

  it("swing the volume and the delay's wet around their own level", () => {
    const rig = build({
      volume: 0.21, "delay-wet": 0.25,
      "lfo-a-depth": 0.5, "lfo-a-target": 3, "lfo-c-depth": 1, "lfo-c-target": 5,
    });
    expect(rig.lfoGains[0].gain.value).toBeCloseTo(0.105, 12);
    expect(rig.lfoGains[0].outgoing.has(rig.master.gain as unknown as FakeNode)).toBe(true);
    expect(rig.lfoGains[2].gain.value).toBe(0.25);
    expect(rig.lfoGains[2].outgoing.has(rig.wetGain.gain as unknown as FakeNode)).toBe(true);
  });

  it("leave a pulse-width or unassigned LFO unplugged", () => {
    const rig = build({ "lfo-b-depth": 1 });
    expect(rig.lfoGains[1].outgoing.size).toBe(0);
    expect(rig.lfoGains[1].gain.value).toBe(0);
    expect(rig.lfoGains[2].outgoing.size).toBe(0);
  });

  it("move to a new target when it is chosen", () => {
    const rig = build({ "lfo-a-depth": 0.5 });
    rig.player.setParameter("lfo-a-target", 2, 1);
    expect(rig.lfoGains[0].outgoing).toEqual(new Set([rig.lfoQBus]));
    rig.player.setParameter("lfo-a-target", 0, 2);
    expect(rig.lfoGains[0].outgoing.size).toBe(0);
    rig.player.setParameter("lfo-a-rate", 7, 3);
    expect(rig.lfoOscs[0].frequency.value).toBe(7);
  });

  it("let a voice go from the filter bus when it ends", () => {
    const rig = build({ "lfo-a-depth": 0.2 });
    rig.player.noteOn(60, 100, 1);
    const [voiceFilter] = rig.fresh(FakeBiquad);
    rig.player.silence(1.5);
    rig.fresh(FakeOscillator)[0].finish();
    expect(rig.lfoFilterBus.outgoing.has(voiceFilter.frequency as unknown as FakeNode)).toBe(false);
  });
});

describe("The pulse LFO", () => {
  // `osc1-wave` arrives as the document's name, as the voice reads it.
  const pulseRig = (extra: Record<string, unknown> = {}) => build({
    "lfo-b-depth": 1, "lfo-b-rate": 1, "osc1-wave": "pulse", "osc2-level": 0, "osc3-level": 0, ...extra,
  });
  /** The width a note's first oscillator was built with: its DC term is 2w − 1. */
  const widthAt = (rig: ReturnType<typeof build>, note: number, atSec: number, stepSec?: number) => {
    const before = rig.fresh(FakeOscillator).length;
    rig.player.noteOn(note, 100, atSec, 0, stepSec);
    const osc = rig.fresh(FakeOscillator)[before];
    return { width: (osc.periodicWave!.real[0] + 1) / 2, osc };
  };

  it("advances step by step, before each step plays, rests included", () => {
    // Quarter-second steps at 1 Hz, as `modules.rs` plays them. The first
    // step moves it a quarter turn before it sounds: sin = 1, +0.45 → 95 %.
    const rig = pulseRig();
    const first = widthAt(rig, 60, 0.25, 0.25);
    expect(first.width).toBeCloseTo(0.95, 6);
    expect(Array.from(first.osc.periodicWave!.real)).toEqual(Array.from(pulseWaveCoefficients(0.95).real));
    // After a rest, two steps on: three quarters of a turn, sin = −1 → 5 %.
    expect(widthAt(rig, 62, 0.75, 0.25).width).toBeCloseTo(0.05, 6);
    // A chord is one step.
    expect(widthAt(rig, 64, 0.75, 0.25).width).toBeCloseTo(0.05, 6);
  });

  it("moves by the time between notes played live, and starts a run afresh", () => {
    const rig = pulseRig();
    // The first live note does not move it; the next moves by the time since.
    expect(widthAt(rig, 60, 0.25).width).toBeCloseTo(0.5, 6);
    expect(widthAt(rig, 62, 0.5).width).toBeCloseTo(0.95, 6);
    // A sequenced note after a live one moves by the time between.
    expect(widthAt(rig, 64, 0.75, 0.25).width).toBeCloseTo(0.5, 6);
    // Silence ends the run: the next step moves by its own length.
    rig.player.silence(1);
    expect(widthAt(rig, 65, 3, 0.25).width).toBeCloseTo(0.05, 6);
  });

  it("swings by depth · 0.45 around the knob's width", () => {
    // A quarter turn at 0.5 Hz takes half a second.
    const rig = pulseRig({ "lfo-b-depth": 0.5, "lfo-b-rate": 0.5, "osc1-width": 0.3 });
    expect(widthAt(rig, 60, 0.5, 0.5).width).toBeCloseTo(0.3 + 0.5 * 0.45, 6);
  });

  it("does not advance an LFO pointed elsewhere", () => {
    const rig = pulseRig({ "lfo-b-target": 1 });
    expect(widthAt(rig, 60, 0.25).width).toBeCloseTo(0.5, 6);
  });
});

describe("Classic: one filter for every note", () => {
  const classic = (extra: Record<string, number> = {}) => build({
    classic: 1, cutoff: 1000, "key-follow": 0, "filter-amount": 0, "filter-env": 1,
    "filter-attack": 10, "filter-decay": 150, "filter-sustain": 0.3, "filter-release": 300, ...extra,
  });

  it("gives a note no filter or panner of its own, and feeds the shared one", () => {
    const rig = classic();
    rig.player.noteOn(60, 127, 1);
    expect(rig.fresh(FakeBiquad)).toHaveLength(0);
    expect(rig.fresh(FakeStereoPanner)).toHaveLength(0);
    const amp = rig.fresh(FakeGain).find((gain) => gain.outgoing.has(rig.classicIn));
    expect(amp).toBeDefined();
  });

  it("drives the shared filter from the knob's base plus an envelope offset", () => {
    const rig = classic();
    expect(rig.classicFilter.frequency.value).toBe(0);
    expect(rig.cutoffBase.offset.value).toBe(1000);
    expect(rig.cutoffBase.outgoing.has(rig.classicFilter.frequency as unknown as FakeNode)).toBe(true);
    expect(rig.filterEnv.outgoing.has(rig.classicFilter.frequency as unknown as FakeNode)).toBe(true);
    expect(rig.cutoffBase.starts).toEqual([0]);
  });

  it("sweeps the offset by the original's law: +100 % is four octaves, sustain in hertz", () => {
    const rig = classic();
    rig.player.noteOn(60, 127, 1);
    const moves = rig.filterEnv.offset.moves().slice(-3);
    // Relative to the knob: base 1000 → offset 0; peak 16 000 → 15 000;
    // sustain 1000 + 15 000 · 0.3 → 4 500.
    expect(moves.map((call) => [call.method, call.time, call.value])).toEqual([
      ["set", 1, 0],
      ["linear", 1.01, 15000],
      ["linear", 1.16, 4500],
    ]);
  });

  it("follows the key from middle C, by the note's true pitch", () => {
    const rig = classic({ "key-follow": 1, "filter-env": 0 });
    rig.player.noteOn(72, 127, 1, 0);
    expect(from(rig.filterEnv.offset.moves(), 3)!.value).toBeCloseTo(1000, 9);
    rig.player.noteOn(60, 127, 2, 50);
    expect(from(rig.filterEnv.offset.moves(), 3)!.value).toBeCloseTo(1000 * Math.pow(2, 0.5 / 12) - 1000, 9);
  });

  it("is retriggered by every note, which cancels the sweep before it", () => {
    const rig = classic();
    rig.player.noteOn(60, 127, 1);
    rig.player.noteOn(64, 127, 1.05);
    const calls = rig.filterEnv.offset.calls;
    const cancel = calls.map((call) => call.method).lastIndexOf("cancel");
    expect(calls[cancel].time).toBe(1.05);
    expect(calls[cancel + 1]).toMatchObject({ method: "set", time: 1.05, value: 0 });
  });

  it("is released only by the note that last struck it", () => {
    const rig = classic();
    rig.player.noteOn(60, 127, 1);
    rig.player.noteOn(64, 127, 1.25);
    const before = rig.filterEnv.offset.calls.length;
    rig.player.noteOff(60, 1.4);
    expect(rig.filterEnv.offset.calls).toHaveLength(before);
    rig.player.noteOff(64, 1.5);
    expect(rig.filterEnv.offset.moves().slice(-2).map((call) => [call.method, call.time, call.value]))
      .toEqual([["set", 1.5, 4500], ["linear", 1.8, 0]]);
    // Written over the sweep, not cancelling it.
    expect(rig.filterEnv.offset.calls.slice(-3)[0].method).not.toBe("cancel");
    // Released once; a second key-up has nothing left to release.
    const after = rig.filterEnv.offset.calls.length;
    rig.player.noteOff(64, 1.6);
    expect(rig.filterEnv.offset.calls).toHaveLength(after);
  });

  it("forgets its note on silence", () => {
    const rig = classic();
    rig.player.noteOn(60, 127, 1);
    rig.player.silence(1.1);
    const before = rig.filterEnv.offset.calls.length;
    rig.player.noteOff(60, 1.2);
    expect(rig.filterEnv.offset.calls).toHaveLength(before);
  });

  it("glides its base when the knob turns, leaving the envelope alone", () => {
    const rig = classic();
    rig.player.noteOn(60, 127, 1);
    const envelope = rig.filterEnv.offset.calls.length;
    rig.player.setParameter("cutoff", 4000, 1.1);
    // `cancelAndHoldAtTime(now)` then `setTargetAtTime(cutoff, now, 0.015)`.
    expect(rig.cutoffBase.offset.calls.slice(-2).map((call) => [call.method, call.time]))
      .toEqual([["hold", 1.1], ["target", 1.1]]);
    expect(from(rig.cutoffBase.offset.calls, 1)).toMatchObject({ method: "target", time: 1.1, value: 4000 });
    expect(CUTOFF_GLIDE_SEC).toBe(0.015);
    expect(rig.filterEnv.offset.calls).toHaveLength(envelope);
    // A browser without cancel-and-hold cancels instead.
    (rig.cutoffBase.offset as { cancelAndHoldAtTime?: unknown }).cancelAndHoldAtTime = undefined;
    rig.player.setParameter("cutoff", 3000, 1.2);
    expect(rig.cutoffBase.offset.calls.slice(-2).map((call) => call.method)).toEqual(["cancel", "target"]);
  });

  it("is the same glide every per-voice note follows", () => {
    const rig = build({ cutoff: 1000, "key-follow": 0 });
    rig.player.noteOn(60, 127, 1);
    const [voiceFilter] = rig.fresh(FakeBiquad);
    expect(rig.cutoffBase.outgoing.has(voiceFilter.frequency as unknown as FakeNode)).toBe(true);
    // The note's own automation is its offset from the knob — none here.
    expect((voiceFilter.frequency as FakeParam).moves()[0].value).toBe(0);
  });

  it("holds a sequenced note's shared envelope until the last note's note-off", () => {
    // No gate: a step is no release. The sweep is cancelled from the note on
    // and written up to the sustain, and the sustain holds.
    const rig = classic();
    rig.player.noteOn(60, 127, 1, 0, 0.5);
    expect(rig.filterEnv.offset.calls.slice(-4).map((call) => [call.method, call.time, call.value])).toEqual([
      ["cancel", 1, 0],
      ["set", 1, 0],
      ["linear", 1.01, 15000],
      ["linear", 1.16, 4500],
    ]);
    rig.player.noteOn(64, 127, 1.25, 0, 0.5);
    const held = rig.filterEnv.offset.calls.length;
    // Past 85 % of its step and past the step, the older note's note-off
    // leaves the shared envelope alone…
    rig.player.noteOff(60, 1.9);
    expect(rig.filterEnv.offset.calls).toHaveLength(held);
    // …and the latest note's releases it, over the release time.
    rig.player.noteOff(64, 2);
    expect(rig.filterEnv.offset.moves().slice(-2).map((call) => [call.method, call.time, call.value]))
      .toEqual([["set", 2, 4500], ["linear", 2.3, 0]]);
  });

  it("takes resonance on the shared filter, and leaves per-voice notes to their own", () => {
    const rig = classic({ resonance: 7 });
    expect(rig.classicFilter.Q.value).toBe(7);
    rig.player.setParameter("classic", 0, 1);
    rig.player.noteOn(60, 127, 2);
    expect(rig.fresh(FakeBiquad)).toHaveLength(1);
  });
});

describe("Reading the scale sequencer's controls", () => {
  it("takes a choice as the plan sends it, or as a document names it", () => {
    expect(readSynthSettings({ "delay-note": 6 }, {}).delay.beats).toBe(1);
    expect(readSynthSettings({ "delay-note": "1/4" }, {}).delay.beats).toBe(1);
    expect(readSynthSettings({ "delay-note": 99 }, {}).delay.beats).toBe(0.5);
    expect(readSynthSettings({ "delay-note": 1.5 }, {}).delay.beats).toBe(0.5);
    expect(readSynthSettings({ tape: 4 }, {}).delay.ips).toBe(1.875);
    expect(readSynthSettings({ "lfo-c-target": "volume" }, {}).lfos[2].target).toBe("volume");
    expect(readSynthSettings({ "lfo-c-wave": 2 }, {}).lfos[2].wave).toBe("sawtooth");
  });

  it("takes a switch as 0 and 1 or as a boolean", () => {
    expect(readSynthSettings({ classic: 1 }, {}).classic).toBe(true);
    expect(readSynthSettings({ classic: 0 }, {}).classic).toBe(false);
    expect(readSynthSettings({ classic: true as never }, {}).classic).toBe(true);
  });

  it("reads the filter envelope amount and keeps a usable tempo", () => {
    expect(readSynthSettings({ "filter-env": -0.4 }, {}).filter.envAmount).toBe(-0.4);
    expect(readSynthSettings({ tempo: 0 }, {}).delay.tempo).toBe(120);
  });
});
