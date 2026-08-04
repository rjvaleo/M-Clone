import { describe, expect, it } from "vitest";
import { createEffect, EFFECT_BUILDERS, isEffectModule } from "./effects";
import { crushCurve } from "./dsp";
import type { AudioNodeSpec } from "./audioPlan";
import {
  FakeAudioContext,
  FakeBiquad,
  FakeCompressor,
  FakeConvolver,
  FakeDelay,
  FakeGain,
  FakeWaveShaper,
} from "./testing/fakeContext";
import { moduleRegistry } from "../registry/registry";
import { AUDIO_MIX_PARAM, AUDIO_MUTE_PARAM } from "../registry/audioModules";

const spec = (moduleType: string, overrides: Partial<AudioNodeSpec> = {}): AudioNodeSpec => ({
  nodeId: "n1",
  moduleType,
  structure: {},
  parameters: {},
  bypass: false,
  wet: 0.5,
  ...overrides,
});

const build = (moduleType: string, overrides: Partial<AudioNodeSpec> = {}) => {
  const context = new FakeAudioContext();
  const module = createEffect(context, spec(moduleType, overrides), 0, () => "linear");
  return { context, module };
};

describe("Every registered audio module has a topology", () => {
  it("matches the registry, in both directions", () => {
    // A module with no builder is a face that makes no sound; a builder with no
    // module is code nothing can reach.
    const registered = [...moduleRegistry.values()]
      .filter((descriptor) => descriptor.family === "audio")
      .map((descriptor) => descriptor.type)
      .sort();
    expect(Object.keys(EFFECT_BUILDERS).sort()).toEqual(registered);
    for (const type of registered) expect(isEffectModule(type)).toBe(true);
  });

  it("builds each one without reaching for anything it was not given", () => {
    for (const moduleType of Object.keys(EFFECT_BUILDERS)) {
      const { module } = build(moduleType);
      expect(module.nodeId).toBe("n1");
      // Arrives silent: the adapter is what fades it up.
      expect(module.level.value).toBe(0);
    }
  });

  it("never requires an audio input, so a half-built rack still compiles", () => {
    // A required input is a compile error when nothing is patched in, and that
    // is the wrong reading for audio: an idle effect is not a broken one. It
    // would also stop the graph compiling until a sound source module exists,
    // taking the event side down with it.
    for (const descriptor of moduleRegistry.values()) {
      for (const port of descriptor.ports) {
        if (port.signal.kind !== "audio" || port.direction !== "input") continue;
        expect(port.required, `${descriptor.type}.${port.id}`).toBeUndefined();
      }
    }
  });

  it("gives every effect an output, and the exit point none", () => {
    const outputs = (type: string) => moduleRegistry.get(type)?.ports
      .filter((port) => port.direction === "output" && port.signal.kind === "audio") ?? [];
    for (const type of Object.keys(EFFECT_BUILDERS)) {
      expect(outputs(type).length, type).toBe(type === "m.audio-output" ? 0 : 1);
    }
  });

  it("refuses a module type it does not know, rather than silently making no sound", () => {
    expect(() => build("m.not-an-effect")).toThrow(/No audio topology/);
  });
});

describe("The effect shell", () => {
  it("ramps a declared parameter and ignores an undeclared one", () => {
    const { module } = build("m.audio-gain", { parameters: { gain: 1 } });
    module.setParameter("gain", 0.25, 3);
    module.setParameter("not-a-parameter", 0.9, 3);
    expect(() => module.setParameter("not-a-parameter", 0.9, 3)).not.toThrow();
  });

  it("mixes at equal power, so a sweep does not dip in the middle", () => {
    // `wet` and `1 − wet` lose about 3 dB at the midpoint, because two
    // uncorrelated signals sum in power rather than in amplitude.
    const { context, module } = build("m.audio-reverb");
    const gains = () => context.created
      .filter((node): node is FakeGain => node instanceof FakeGain)
      .map((node) => node.gain.value);

    module.setWet(0.5, 1);
    const half = gains().filter((value) => Math.abs(value - Math.SQRT1_2) < 1e-9);
    expect(half).toHaveLength(2);

    module.setWet(1, 2);
    const wetOnly = gains();
    expect(wetOnly.filter((value) => Math.abs(value - 1) < 1e-9).length).toBeGreaterThanOrEqual(1);
    expect(wetOnly.filter((value) => Math.abs(value) < 1e-9).length).toBeGreaterThanOrEqual(1);
  });

  it("leaves a series effect's mix alone", () => {
    // A compressor has no dry path to balance against; accepting a mix would be
    // a control that appears to do something and does not.
    const { module } = build("m.audio-compressor");
    expect(() => module.setWet(0.2, 1)).not.toThrow();
  });

  it("does not fight the adapter over bypass", () => {
    // The adapter mutes a bypassed node by taking `level` to zero. If the module
    // also opened its dry path, a "bypassed" insert would be silently wired.
    const { module } = build("m.audio-delay");
    const before = module.level.value;
    module.setBypass(true, 1);
    expect(module.level.value).toBe(before);
  });

  it("disconnects everything it built, and tolerates a second disposal", () => {
    const { context, module } = build("m.audio-reverb");
    module.dispose();
    for (const node of context.created) expect(node.disconnectCalls).toBeGreaterThan(0);
    const calls = context.created.map((node) => node.disconnectCalls);
    module.dispose();
    expect(context.created.map((node) => node.disconnectCalls)).toEqual(calls);
  });
});

describe("Ported topologies", () => {
  it("builds the delay line at its structural maximum", () => {
    // Asking a DelayNode for more than it was built with clamps silently, which
    // presents as "the long setting sounds wrong" rather than as an error.
    const { context } = build("m.audio-delay", { structure: { "max-delay-seconds": 4 } });
    const delay = context.created.find((node): node is FakeDelay => node instanceof FakeDelay);
    expect(delay?.maxDelaySeconds).toBe(4);
  });

  it("renders the reverb impulse at the requested tail and leaves it un-normalised", () => {
    const { context } = build("m.audio-reverb", {
      structure: { "tail-seconds": 0.5, "decay-rate": 3, "impulse-seed": 2 },
    });
    const convolver = context.created.find((node): node is FakeConvolver =>
      node instanceof FakeConvolver);
    expect(convolver?.buffer?.length).toBe(24000);
    expect(convolver?.buffer?.numberOfChannels).toBe(2);
    // Normalising would make a longer reverb a quieter one.
    expect(convolver?.normalize).toBe(false);
  });

  it("gives the crusher a curve matching its bit depth", () => {
    const { context } = build("m.audio-bitcrusher", { structure: { "bit-depth": 4 } });
    const shaper = context.created.find((node): node is FakeWaveShaper =>
      node instanceof FakeWaveShaper);
    expect(shaper?.curve?.length).toBe(crushCurve(4).length);
    expect([...(shaper?.curve ?? [])]).toEqual([...crushCurve(4)]);
  });

  it("pins the limiter to brick-wall coefficients the user cannot soften", () => {
    const { context } = build("m.audio-limiter");
    const limiter = context.created.find((node): node is FakeCompressor =>
      node instanceof FakeCompressor);
    expect(limiter?.knee.value).toBe(0);
    expect(limiter?.ratio.value).toBe(20);
    expect(limiter?.attack.value).toBe(0.001);
  });

  it("applies the spec's opening parameter values", () => {
    const { context } = build("m.audio-eq", {
      parameters: { "mid-frequency": 2500, "mid-gain-db": 6 },
    });
    const biquads = context.created.filter((node): node is FakeBiquad =>
      node instanceof FakeBiquad);
    expect(biquads.some((node) => node.frequency.value === 2500)).toBe(true);
    expect(biquads.some((node) => node.gain.value === 6)).toBe(true);
  });

  it("never routes the reserved ids into a topology", () => {
    // `mix` and `mute` are the shell's, not the DSP's. A topology that claimed
    // one would have two owners writing the same control.
    const { module } = build("m.audio-delay", {
      parameters: { [AUDIO_MIX_PARAM]: 0.5, [AUDIO_MUTE_PARAM]: 1 },
    });
    expect(() => module.setParameter(AUDIO_MIX_PARAM, 1, 0)).not.toThrow();
  });
});
