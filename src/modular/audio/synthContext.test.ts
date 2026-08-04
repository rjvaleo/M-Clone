import { describe, expect, it } from "vitest";
import { FakeAudioContext, FakeOscillator } from "./testing/fakeContext";
import { rampParam } from "./params";
import { pulseWaveCoefficients } from "./dsp";
import type { SynthContext } from "./nodes";

/**
 * The oscillator surface the synth is built on.
 *
 * `nodes.ts` describes only the slice of Web Audio this codebase touches, and
 * until now that slice had no way to *generate* a pitch — every sound came from
 * a buffer. These are the additions, exercised through the same fake the rest of
 * the audio tests stand on, so the synth can be built and verified under Node.
 *
 * The point of testing the fake is that every later assertion about the synth is
 * really an assertion about what it told these nodes to do. If the recorder is
 * wrong, all of it is wrong.
 */

const context = (): SynthContext => new FakeAudioContext();

const oscillators = (ctx: SynthContext): FakeOscillator[] =>
  (ctx as FakeAudioContext).created.filter(
    (node): node is FakeOscillator => node instanceof FakeOscillator,
  );

describe("Oscillators", () => {
  it("is built with a type and a frequency, and remembers both", () => {
    const ctx = context();
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    rampParam(osc.frequency, 440, 0, "none");
    expect(osc.type).toBe("sawtooth");
    expect(osc.frequency.value).toBe(440);
    expect(oscillators(ctx)).toHaveLength(1);
  });

  it("detunes in cents, which is what a scale needs", () => {
    // Detune is a second input to the same pitch, in cents rather than hertz:
    // it is how a voice takes its tuning without recomputing a frequency.
    const osc = context().createOscillator();
    rampParam(osc.detune, -1200, 0, "none");
    expect(osc.detune.value).toBe(-1200);
  });

  it("takes a periodic wave, and reports itself custom afterwards", () => {
    // Setting a wave is how PWM works: the shape is rebuilt whenever the duty
    // cycle changes, and the browser reports the type as "custom" from then on.
    const ctx = context();
    const osc = ctx.createOscillator();
    const { real, imag } = pulseWaveCoefficients(0.25);
    const wave = ctx.createPeriodicWave(real, imag);
    osc.setPeriodicWave(wave);
    expect(osc.type).toBe("custom");
    // A real oscillator does not hand the wave back, so this is the fake's own
    // recorder — the thing the synth's tests will read to see what was set.
    expect((osc as FakeOscillator).periodicWave).toBe(wave);
  });

  it("starts and stops on the audio clock, and says when it ended", () => {
    const osc = context().createOscillator();
    let ended = 0;
    osc.onended = () => { ended += 1; };
    osc.start(1.5);
    osc.stop(2.5);
    const fake = osc as FakeOscillator;
    expect(fake.starts).toEqual([1.5]);
    expect(fake.stops).toEqual([2.5]);
    fake.finish();
    expect(ended).toBe(1);
  });

  it("refuses to stop before it has started, as a browser does", () => {
    // The guard the voice bank already relies on for buffer sources: a stop
    // that throws must be survivable, so the fake has to actually throw.
    expect(() => context().createOscillator().stop(0)).toThrow();
  });

  it("connects and disconnects like any other node", () => {
    const ctx = context();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    expect(() => osc.disconnect()).not.toThrow();
  });
});

describe("Stereo panning", () => {
  it("has a pan position that ramps like any other parameter", () => {
    // The matrix's `pan` destination writes here, so it has to be an
    // AudioParam rather than a plain number.
    const panner = context().createStereoPanner();
    rampParam(panner.pan, -1, 0, "none");
    expect(panner.pan.value).toBe(-1);
    rampParam(panner.pan, 0.5, 0, "linear");
    expect(panner.pan.value).toBe(0.5);
  });
});

describe("Periodic waves", () => {
  it("keeps the coefficients it was given", () => {
    const ctx = context();
    const wave = ctx.createPeriodicWave(
      Float32Array.from([0, 1, 0.5]),
      Float32Array.from([0, 0, 0]),
    );
    expect(wave.real[1]).toBe(1);
    expect(wave.imag).toHaveLength(3);
  });
});
