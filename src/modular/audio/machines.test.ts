// The two vintage machines: Blackhole and the DP/4+.
//
// These tests are deliberately not "does it sound right" — a fake context makes
// no sound. They check the things that would be silently wrong and expensive to
// find later: that the documented ranges survived into the code, that the
// coupled controls stay coupled, that the four-input machine really has four
// inputs, and that nothing leaks an oscillator.

import { describe, expect, it } from "vitest";
import { createEffect, EFFECT_BUILDERS } from "./effects";
import type { AudioNodeSpec } from "./audioPlan";
import { FakeAudioContext, FakeGain, FakeOscillator } from "./testing/fakeContext";
import { moduleRegistry } from "../registry/registry";
import { AUDIO_STRUCTURE_PARAMS } from "../registry/audioModules";
import {
  BLACKHOLE_FREEZE_AT,
  BLACKHOLE_HIGH_HZ,
  BLACKHOLE_INFINITE_AT,
  BLACKHOLE_LOW_HZ,
  BLACKHOLE_MAX_PREDELAY_SEC,
  blackholeFeedbackGain,
  blackholeMode,
  blackholeSizeScale,
  resolveGravity,
} from "./blackhole";
import {
  DP4_ABCD_ROUTINGS,
  DP4_ALGORITHMS,
  DP4_PAIR_ROUTINGS,
  DP4_PROFILES,
  DP4_ROUTING_COUNT,
  bandwidthHz,
  dampingHz,
  dp4InputRouting,
  dp4PairsAreLinked,
  lfDecayScale,
  NONLIN_TAPS,
  NONLIN_VARIANTS,
  createDp4ReverbCore,
  createNonLinCore,
} from "./dp4";

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

const descriptorFor = (type: string) => {
  const descriptor = moduleRegistry.get(type);
  if (!descriptor) throw new Error(`not registered: ${type}`);
  return descriptor;
};

const parameterFor = (type: string, id: string) => {
  const found = descriptorFor(type).parameters.find((p) => p.id === id);
  if (!found) throw new Error(`${type} has no parameter ${id}`);
  return found;
};

describe("Both machines are registered and buildable", () => {
  it("has a builder for each new module type", () => {
    for (const type of [
      "m.audio-blackhole",
      "m.audio-dp4-reverb",
      "m.audio-dp4-nonlin",
      "m.audio-dp4",
    ]) {
      expect(EFFECT_BUILDERS[type], type).toBeTypeOf("function");
      expect(descriptorFor(type).family).toBe("audio");
    }
  });

  it("declares every structural parameter it actually reads", () => {
    // A structural value read by a builder but not declared here would be a
    // knob that changes nothing until the node happens to rebuild for some
    // other reason — the worst kind of bug to chase.
    for (const [type, ids] of Object.entries(AUDIO_STRUCTURE_PARAMS)) {
      for (const id of ids) expect(() => parameterFor(type, id), `${type}.${id}`).not.toThrow();
    }
  });

  it("builds every DP/4 algorithm and Non Lin variant without throwing", () => {
    for (const algorithm of DP4_ALGORITHMS) {
      expect(() => build("m.audio-dp4-reverb", { structure: { algorithm } })).not.toThrow();
    }
    for (const variant of ["non-lin-1", "non-lin-2", "non-lin-3"]) {
      expect(() => build("m.audio-dp4-nonlin", { structure: { variant } })).not.toThrow();
    }
  });
});

describe("Blackhole", () => {
  it("keeps the manual's published ranges", () => {
    // [DOC] pre-delay 0–2000 ms.
    expect(parameterFor("m.audio-blackhole", "pre-delay-seconds").maximum).toBe(
      BLACKHOLE_MAX_PREDELAY_SEC,
    );
    // [DOC] shelving filters at 350 Hz and 2000 Hz.
    expect(BLACKHOLE_LOW_HZ).toBe(350);
    expect(BLACKHOLE_HIGH_HZ).toBe(2000);
    // [DOC] Gravity is bipolar — "on the left hand side… inverse mode".
    expect(parameterFor("m.audio-blackhole", "gravity").minimum).toBe(-1);
    expect(parameterFor("m.audio-blackhole", "gravity").maximum).toBe(1);
  });

  it("puts Infinite and Freeze past the top of Feedback, in that order", () => {
    // [DOC] "Turning clockwise to Infinite… Turning further clockwise to Freeze".
    expect(BLACKHOLE_INFINITE_AT).toBeLessThan(BLACKHOLE_FREEZE_AT);
    expect(blackholeMode(0.5)).toBe("normal");
    expect(blackholeMode(BLACKHOLE_INFINITE_AT)).toBe("infinite");
    expect(blackholeMode(BLACKHOLE_FREEZE_AT)).toBe("freeze");
    expect(blackholeMode(1)).toBe("freeze");
  });

  it("never lets the outer loop supply the infinity", () => {
    // Infinity comes from the tank. If the outer feedback also went to unity
    // the two loops would multiply and the module would be an oscillator.
    expect(blackholeFeedbackGain(BLACKHOLE_INFINITE_AT, 8)).toBe(0);
    expect(blackholeFeedbackGain(BLACKHOLE_FREEZE_AT, 8)).toBe(0);
    // And within the normal range it stays bounded at every decay setting.
    for (const decay of [0.8, 4, 16]) {
      for (let f = 0; f < BLACKHOLE_INFINITE_AT; f += 0.05) {
        expect(blackholeFeedbackGain(f, decay)).toBeLessThanOrEqual(0.92);
      }
    }
  });

  it("de-rates feedback as decay lengthens", () => {
    // The same knob position must be safer at 16 s than at 1 s, or the control
    // has a cliff two-thirds of the way up.
    expect(blackholeFeedbackGain(0.8, 16)).toBeLessThan(blackholeFeedbackGain(0.8, 0.8));
  });

  it("sweeps Gravity from dense-and-short to smooth-and-long", () => {
    // [DOC] "from a very dense decay to a very long and smooth decay" — note
    // that density FALLS as decay RISES, which is easy to implement backwards.
    const dense = resolveGravity(0);
    const smooth = resolveGravity(1);
    expect(smooth.decaySeconds).toBeGreaterThan(dense.decaySeconds);
    expect(smooth.diffusion).toBeLessThan(dense.diffusion);
  });

  it("stretches the pre-tank delay in inverse mode only", () => {
    expect(resolveGravity(0.5).preTankStretch).toBe(1);
    expect(resolveGravity(-1).preTankStretch).toBeGreaterThan(1);
    // [DOC] inverse mode is a swell, not a long reverb — a long tail behind it
    // would bury the effect.
    expect(resolveGravity(-1).decaySeconds).toBeLessThan(resolveGravity(1).decaySeconds);
  });

  it("sweeps Size from cartoonishly small to cosmically epic", () => {
    expect(blackholeSizeScale(0)).toBeLessThan(0.1);
    expect(blackholeSizeScale(1)).toBeGreaterThan(7);
    // Monotonic, or the knob would fold back on itself.
    let previous = -Infinity;
    for (let s = 0; s <= 1; s += 0.05) {
      const scale = blackholeSizeScale(s);
      expect(scale).toBeGreaterThan(previous);
      previous = scale;
    }
  });

  it("stops its oscillators when disposed", () => {
    // A modulator left running after the module is gone is an inaudible leak
    // that still costs, and there is no way to notice it by listening.
    const { context, module } = build("m.audio-blackhole");
    const oscillators = context.created.filter((node): node is FakeOscillator =>
      node instanceof FakeOscillator,
    );
    expect(oscillators.length).toBeGreaterThan(0);
    module.dispose();
    for (const osc of oscillators) expect(osc.stops.length).toBeGreaterThan(0);
  });

  it("accepts every documented control without throwing", () => {
    const { module } = build("m.audio-blackhole");
    const ids = [
      "gravity",
      "size",
      "pre-delay-seconds",
      "low-level-db",
      "high-level-db",
      "mod-depth",
      "mod-rate",
      "feedback",
      "resonance",
    ];
    for (const id of ids) {
      expect(() => module.setParameter(id, 0.5, 0), id).not.toThrow();
      expect(() => module.setParameter(id, 1, 0), id).not.toThrow();
      expect(() => module.setParameter(id, -1, 0), id).not.toThrow();
    }
  });
});

describe("DP/4 reverbs", () => {
  it("carries the published decay ceilings", () => {
    // [DOC] Hall reaches 250 s — the longest in the machine, and the reason the
    // decay gain has to be computed carefully rather than eyeballed.
    expect(DP4_PROFILES.hall.maxDecaySeconds).toBe(250);
    expect(DP4_PROFILES["large-plate"].maxDecaySeconds).toBe(140);
    expect(DP4_PROFILES["large-room"].maxDecaySeconds).toBe(150);
    expect(DP4_PROFILES["small-plate"].maxDecaySeconds).toBe(100);
  });

  it("gives rooms and halls the pre-echo section and plates the detune-free ring", () => {
    // [DOC] The plate diagrams have no pre-echoes and no detune; the room and
    // hall diagrams have both. Plates ring on purpose.
    expect(DP4_PROFILES["small-plate"].preEchoes).toBe(false);
    expect(DP4_PROFILES["large-plate"].detune).toBe(false);
    expect(DP4_PROFILES.hall.preEchoes).toBe(true);
    expect(DP4_PROFILES.hall.detune).toBe(true);
  });

  it("scales tanks in the documented order", () => {
    const scale = (a: keyof typeof DP4_PROFILES) => DP4_PROFILES[a].sizeScale;
    expect(scale("small-room")).toBeLessThan(scale("small-plate"));
    expect(scale("small-plate")).toBeLessThan(scale("large-room"));
    expect(scale("large-room")).toBeLessThan(scale("large-plate"));
    expect(scale("large-plate")).toBeLessThan(scale("hall"));
  });

  it("points Bandwidth and Damping in opposite directions", () => {
    // [DOC] Bandwidth is the input lowpass — higher is brighter. Damping is the
    // in-loop lowpass — higher is darker. Getting this backwards makes every
    // preset wrong, and it is the single easiest mistake in the algorithm.
    expect(bandwidthHz(1)).toBeGreaterThan(bandwidthHz(0));
    expect(dampingHz(1)).toBeLessThan(dampingHz(0));
  });

  it("treats LF Decay as a bipolar multiplier about unity", () => {
    // [DOC] "boosts (positive) or cuts (negative) the rate at which low
    // frequencies will decay."
    expect(lfDecayScale(0)).toBeCloseTo(1, 6);
    expect(lfDecayScale(1)).toBeGreaterThan(1);
    expect(lfDecayScale(-1)).toBeLessThan(1);
  });

  it("gives Non Lin nine envelope taps and no decay control", () => {
    // [DOC] The nine levels ARE the decay: there is no feedback to decay.
    expect(NONLIN_TAPS).toBe(9);
    const descriptor = descriptorFor("m.audio-dp4-nonlin");
    for (let i = 1; i <= NONLIN_TAPS; i++) {
      expect(descriptor.parameters.some((p) => p.id === `envelope-${i}`), `envelope-${i}`).toBe(true);
    }
    expect(descriptor.parameters.some((p) => p.id === "decay-seconds")).toBe(false);
  });

  it("moves every Non Lin envelope tap independently", () => {
    const { module } = build("m.audio-dp4-nonlin");
    for (let i = 1; i <= NONLIN_TAPS; i++) {
      expect(() => module.setParameter(`envelope-${i}`, 0.7, 0)).not.toThrow();
    }
    // An out-of-range tap must be ignored rather than throw — the registry
    // should prevent it, but a module is not the place to find out.
    expect(() => module.setParameter("envelope-99", 0.7, 0)).not.toThrow();
  });
});

describe("The DP/4+ machine", () => {
  it("offers the documented 32 routings", () => {
    // [DOC] "By combining parameters 02, 03, and 04, there are 32 different
    // ABCD routing possibilities."
    expect(DP4_PAIR_ROUTINGS.length * DP4_PAIR_ROUTINGS.length * DP4_ABCD_ROUTINGS.length).toBe(32);
    expect(DP4_ROUTING_COUNT).toBe(32);
  });

  it("builds in every routing combination without throwing", () => {
    for (const ab of DP4_PAIR_ROUTINGS) {
      for (const cd of DP4_PAIR_ROUTINGS) {
        for (const abcd of DP4_ABCD_ROUTINGS) {
          expect(
            () =>
              build("m.audio-dp4", {
                structure: { "ab-routing": ab, "cd-routing": cd, "abcd-routing": abcd },
              }),
            `${ab}/${cd}/${abcd}`,
          ).not.toThrow();
        }
      }
    }
  });

  it("has four discrete inputs and four discrete outputs", () => {
    // The whole reason `inputFor`/`outputFor` exist. If these collapsed onto one
    // node the 2-, 3- and 4-source configurations would all be the 1-source one.
    const { module } = build("m.audio-dp4", { structure: { "source-config": 4 } });
    const inputs = [1, 2, 3, 4].map((n) => module.inputFor?.(`audio-in-${n}`));
    const outputs = [1, 2, 3, 4].map((n) => module.outputFor?.(`audio-out-${n}`));
    expect(new Set(inputs).size).toBe(4);
    expect(new Set(outputs).size).toBe(4);
  });

  it("falls back to the first port for an unknown port id", () => {
    // A patch wired as an ordinary stereo effect must get something audible
    // rather than silence.
    const { module } = build("m.audio-dp4");
    expect(module.inputFor?.("audio-in")).toBe(module.inputFor?.("audio-in-1"));
    expect(module.outputFor?.("audio-out")).toBe(module.outputFor?.("audio-out-1"));
  });

  it("routes sources to units per the front-panel diagram", () => {
    // [DOC] 1 source feeds all four units; 4 source feeds one each; 2 and 3 sit
    // between. The empty arrays are sources that drive nothing in that config.
    expect(dp4InputRouting(1)[0]).toEqual([0, 1, 2, 3]);
    expect(dp4InputRouting(2)[0]).toEqual([0, 1]);
    expect(dp4InputRouting(2)[2]).toEqual([2, 3]);
    expect(dp4InputRouting(3)[0]).toEqual([0]);
    expect(dp4InputRouting(3)[1]).toEqual([1]);
    expect(dp4InputRouting(4).flat()).toEqual([0, 1, 2, 3]);
  });

  it("links the AB and CD pairs only in a 1-source config", () => {
    // [DOC] "the blank space will not appear in a 1 Source Config, because all
    // four units are always connected together."
    expect(dp4PairsAreLinked(1)).toBe(true);
    expect(dp4PairsAreLinked(2)).toBe(false);
    expect(dp4PairsAreLinked(4)).toBe(false);
  });

  it("puts a limiter in every feedback routing and nowhere else", () => {
    // A deliberate divergence from the hardware, which simply blew up. Worth a
    // test because the cost of getting it wrong is a browser tab that screams.
    const serial = build("m.audio-dp4", {
      structure: { "ab-routing": "serial", "cd-routing": "serial" },
    });
    const looped = build("m.audio-dp4", {
      structure: { "ab-routing": "feedback1", "cd-routing": "feedback2" },
    });
    const compressors = (ctx: FakeAudioContext) => ctx.countOf("compressor");
    expect(compressors(serial.context)).toBe(0);
    expect(compressors(looped.context)).toBe(2);
  });

  it("dispatches per-unit parameters to the right unit", () => {
    const { module } = build("m.audio-dp4");
    for (const unit of ["a", "b", "c", "d"]) {
      expect(() => module.setParameter(`unit-${unit}-mix`, 0.7, 0)).not.toThrow();
      expect(() => module.setParameter(`unit-${unit}-volume`, 0.5, 0)).not.toThrow();
      expect(() => module.setParameter(`unit-${unit}-decay-seconds`, 12, 0)).not.toThrow();
    }
    // An id that names no unit must be ignored, not throw.
    expect(() => module.setParameter("unit-z-mix", 0.5, 0)).not.toThrow();
    expect(() => module.setParameter("nonsense", 0.5, 0)).not.toThrow();
  });

  it("uses a straight blend for unit mix, not equal power", () => {
    // [DOC] "Setting this parameter to 00 will allow only the unprocessed
    // signal to be heard, while a setting of 99 will eliminate the dry signal
    // completely." That is a linear crossfade. The rack's own shell uses equal
    // power, which is right for a modern effect and wrong for this machine, so
    // the DP/4 keeps its own.
    const { context, module } = build("m.audio-dp4");
    module.setParameter("unit-a-mix", 0.5, 0);
    const gains = context.created.filter((node): node is FakeGain => node instanceof FakeGain);
    // At 0.5 a linear pair sums to 1.0; an equal-power pair would sum to ~1.414.
    const halves = gains.filter((g) => Math.abs(g.gain.value - 0.5) < 1e-9);
    expect(halves.length).toBeGreaterThanOrEqual(2);
  });

  it("stops every unit's oscillators when disposed", () => {
    const { context, module } = build("m.audio-dp4", {
      structure: {
        "unit-a-algorithm": "hall",
        "unit-b-algorithm": "large-room",
        "unit-c-algorithm": "small-room",
        "unit-d-algorithm": "large-room",
      },
    });
    const oscillators = context.created.filter((node): node is FakeOscillator =>
      node instanceof FakeOscillator,
    );
    expect(oscillators.length).toBeGreaterThan(0);
    module.dispose();
    for (const osc of oscillators) expect(osc.stops.length).toBeGreaterThan(0);
  });
});

/*
 * The control surfaces, exhaustively.
 *
 * These two `setParameter` switches are where a machine's front panel actually
 * lives — every documented knob resolves to one case — and until now only one
 * case of one of them was reached by any test. The rest built correctly and
 * were never asked to move, which is the failure mode the players already
 * taught this project once: every layer clean, nothing wired.
 *
 * Asserting *that the right node moved* rather than merely calling the setter,
 * because a switch that silently falls through to `default` is exactly the bug
 * a call-and-don't-look test cannot see.
 */
describe("Every DP/4 tank control", () => {
  const tank = (algorithm: string) => {
    const context = new FakeAudioContext();
    const core = createDp4ReverbCore(context, spec("m.audio-dp4-reverb", {
      structure: { algorithm },
    }), 0);
    return { context, core };
  };

  /** Every scheduled write in the context, so a test can prove one happened. */
  const moveCount = (context: FakeAudioContext): number =>
    context.created.reduce((total, node) => {
      const params = Object.values(node as unknown as Record<string, unknown>);
      return total + params.reduce((sum: number, value) => {
        const param = value as { moves?: () => unknown[] };
        return sum + (typeof param?.moves === "function" ? param.moves().length : 0);
      }, 0);
    }, 0);

  /** Present on every algorithm. */
  const SHARED = [
    "decay-seconds", "pre-delay-seconds", "lf-decay", "hf-damping", "hf-bandwidth",
    "diffusion-1", "diffusion-2", "decay-definition", "primary-send",
  ];
  /** `[DOC]` rooms and halls have detune and the two-tap pre-echo section. */
  const TANK_ONLY = [
    "detune-rate", "detune-depth",
    "ref-1-level", "ref-1-send", "ref-2-level", "ref-2-send",
  ];
  /** `[DOC]` "Early Ref Level 1–4 … Plates only" — exclusive with the above. */
  const PLATE_ONLY = ["early-refs"];

  it("moves something for every control a hall actually has", () => {
    for (const id of [...SHARED, ...TANK_ONLY]) {
      const { context, core } = tank("hall");
      const before = moveCount(context);
      core.setParameter(id, 0.5, 1);
      expect(moveCount(context), id).toBeGreaterThan(before);
    }
  });

  it("moves something for every control a plate actually has", () => {
    for (const id of [...SHARED, ...PLATE_ONLY]) {
      const { context, core } = tank("large-plate");
      const before = moveCount(context);
      core.setParameter(id, 0.5, 1);
      expect(moveCount(context), id).toBeGreaterThan(before);
    }
  });

  it("alternates the sign of the four plate taps", () => {
    // One knob, four bipolar taps: the sign flip is the audible half of the
    // control and would be invisible in a test that only counted movement.
    const { context, core } = tank("small-plate");
    core.setParameter("early-refs", 1, 1);
    const values = context.created
      .filter((node): node is FakeGain => node instanceof FakeGain)
      .map((gain) => gain.gain.value);
    expect(values.some((value) => value > 0.5)).toBe(true);
    expect(values.some((value) => value < -0.5)).toBe(true);
  });

  it("ignores a control it does not have", () => {
    const { context, core } = tank("hall");
    const before = moveCount(context);
    core.setParameter("nonsense", 1, 1);
    expect(moveCount(context)).toBe(before);
  });

  it("silently skips detune and pre-echo controls on a plate, which has neither", () => {
    // `[DOC]` plates have no pre-echo section and no detune. The controls still
    // exist on the face, so they must be harmless rather than throwing.
    const { context, core } = tank("large-plate");
    const before = moveCount(context);
    for (const id of TANK_ONLY) core.setParameter(id, 0.5, 1);
    expect(moveCount(context)).toBe(before);
  });

  it("silently skips the plate taps on a hall, which has none", () => {
    const { context, core } = tank("hall");
    const before = moveCount(context);
    for (const id of PLATE_ONLY) core.setParameter(id, 0.5, 1);
    expect(moveCount(context)).toBe(before);
  });

  it("takes the low-frequency decay multiplier only below zero", () => {
    // `lfDecay > 0` leaves the master decay alone; below it, the scale applies.
    const { context, core } = tank("hall");
    core.setParameter("lf-decay", -1, 1);
    const damped = moveCount(context);
    core.setParameter("lf-decay", 1, 2);
    expect(moveCount(context)).toBeGreaterThan(damped);
    expect(lfDecayScale(-1)).toBeLessThan(1);
  });

  it("clamps decay to its algorithm's published ceiling", () => {
    const { core } = tank("large-plate");
    // Asking for more than the profile allows must not throw or wrap.
    expect(() => core.setParameter("decay-seconds", 10_000, 1)).not.toThrow();
  });
});

describe("Every Non Lin control", () => {
  const nonLin = (variant: string) => {
    const context = new FakeAudioContext();
    const core = createNonLinCore(context, spec("m.audio-dp4-nonlin", {
      structure: { variant },
    }), 0);
    return { context, core };
  };

  it("moves a tap for each envelope segment, and ignores one past the end", () => {
    const { context, core } = nonLin("non-lin-1");
    const gains = context.created.filter((node): node is FakeGain => node instanceof FakeGain);
    const before = gains.map((gain) => gain.gain.moves().length);
    for (let i = 1; i <= NONLIN_TAPS; i++) core.setParameter(`envelope-${i}`, 0.5, 1);
    const moved = gains.filter((gain, i) => gain.gain.moves().length > before[i]);
    expect(moved.length).toBe(NONLIN_TAPS);

    // One past the last tap is a document that outlived its module version.
    const settled = gains.map((gain) => gain.gain.moves().length);
    core.setParameter(`envelope-${NONLIN_TAPS + 1}`, 0.5, 2);
    expect(gains.map((gain) => gain.gain.moves().length)).toEqual(settled);
  });

  it("moves something for every named control", () => {
    for (const id of ["hf-bandwidth", "hf-damping", "diffusion-1", "diffusion-2", "density-1", "density-2"]) {
      const { context, core } = nonLin("non-lin-2");
      const before = context.created.reduce(
        (n, node) => n + ((node as unknown as { frequency?: { moves(): unknown[] } }).frequency?.moves().length ?? 0)
          + ((node as unknown as { gain?: { moves(): unknown[] } }).gain?.moves().length ?? 0), 0);
      core.setParameter(id, 0.5, 1);
      const after = context.created.reduce(
        (n, node) => n + ((node as unknown as { frequency?: { moves(): unknown[] } }).frequency?.moves().length ?? 0)
          + ((node as unknown as { gain?: { moves(): unknown[] } }).gain?.moves().length ?? 0), 0);
      expect(after, id).toBeGreaterThan(before);
    }
  });

  it("ignores a control it does not have", () => {
    const { core } = nonLin("non-lin-3");
    expect(() => core.setParameter("nonsense", 1, 1)).not.toThrow();
  });

  it("disposes without anything to stop, because it has no oscillator", () => {
    // The empty `dispose` is deliberate and worth pinning: a Non Lin is a pure
    // feed-forward tap delay, so there is no loop and no LFO to shut down. If
    // that ever stops being true this test is where it will be noticed.
    for (const variant of NONLIN_VARIANTS) {
      const { context, core } = nonLin(variant);
      expect(context.created.some((node) => node instanceof FakeOscillator)).toBe(false);
      expect(() => core.dispose()).not.toThrow();
    }
  });
});

describe("A Blackhole control it does not have", () => {
  it("is ignored rather than throwing", () => {
    const { module } = build("m.audio-blackhole");
    expect(() => module.setParameter("nonsense", 1, 1)).not.toThrow();
  });
});
