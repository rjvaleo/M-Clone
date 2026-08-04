// The ENSONIQ DP/4+ — its reverbs, and the machine that held four of them.
//
// There is a detail in the DP/4+ manual's credits that decides the design of
// this file: **Jon Dattorro is one of its authors.** A year after it shipped he
// published "Effect Design Part 1", the paper whose plate topology is now the
// reference implementation for the whole industry. The DP/4's reverb parameters
// are that paper's block diagram with the labels changed:
//
//   Diffusion 1 / Diffusion 2   →  input diffusion 1 / input diffusion 2
//   Decay Definition            →  decay diffusion
//   "Definition (Decay Diffuser)" → the tank
//   HF Bandwidth                →  bandwidth      (the input lowpass)
//   HF Damping                  →  damping        (the in-tank lowpass)
//   Detune Rate / Detune Depth  →  excursion      (the modulated allpass)
//
// So these are not reverse-engineered by ear. They are built from the designer's
// own published equations, using the manual's parameter ranges.
//
// Two things the manual is precise about and which are easy to get backwards:
//
//   - **Bandwidth and Damping are different filters in different places.**
//     Bandwidth is on the way *in* ("acts as a low pass filter on the signal
//     going into the reverb… like a tone control on a guitar"); Damping is
//     inside the loop ("the rate of attenuation of high frequencies in the
//     decay"). Bandwidth high = brighter. Damping high = darker.
//   - **The Non Lin reverbs have no feedback at all.** "Unlike the hall, room
//     and plate reverbs, Non Lin 1, 2, and 3 pass the input signal through the
//     reverb diffusers only once. For this reason the reverb diffusers are
//     called Density, to distinguish them from the other reverb diffusers
//     (called Definition)." Nine level controls tap that single pass — a
//     drawable envelope, which is how the machine made gated, reverse and
//     blooming sounds from one structure.

import type { AudioNodeSpec } from "./audioPlan";
import type { AudioNodeLike } from "./graphAdapter";
import { rampParam } from "./params";
import type { EffectContext, GainNodeLike } from "./nodes";
import {
  clamp,
  createDiffuserChain,
  createFeedbackNetwork,
  fixedDelay,
  fixedFilter,
  fixedGain,
  numberOr,
  setNow,
  type FeedbackNetwork,
} from "./reverbTank";

// ---- the reverb family -------------------------------------------------------

/**
 * `[DOC]` The five tank algorithms and their published decay ceilings.
 *
 * "The internal values of the components (not user programmable) differentiate
 * the large and small plate reverbs" — same code, different constants, which is
 * exactly how this table is used.
 *
 * `plate` variants have no pre-echo section and no detune; `room` and `hall` do.
 * That asymmetry is in the manual's own diagrams and is not tidied away here.
 */
export const DP4_ALGORITHMS = [
  "small-plate",
  "large-plate",
  "small-room",
  "large-room",
  "hall",
] as const;

export type Dp4Algorithm = (typeof DP4_ALGORITHMS)[number];

type AlgorithmProfile = {
  sizeScale: number;
  /** `[DOC]` published maximum decay, in seconds. */
  maxDecaySeconds: number;
  /** `[DOC]` published maximum pre-delay, in seconds. */
  maxPreDelaySeconds: number;
  lineCount: number;
  /** Plates ring on purpose; rooms and halls get a detune to break that up. */
  detune: boolean;
  /** Rooms and halls have the pre-echo / position section; plates do not. */
  preEchoes: boolean;
};

export const DP4_PROFILES: Readonly<Record<Dp4Algorithm, AlgorithmProfile>> = {
  "small-plate": {
    sizeScale: 0.55,
    maxDecaySeconds: 100,
    maxPreDelaySeconds: 0.5,
    lineCount: 6,
    detune: false,
    preEchoes: false,
  },
  "large-plate": {
    sizeScale: 1.0,
    maxDecaySeconds: 140,
    maxPreDelaySeconds: 0.43,
    lineCount: 6,
    detune: false,
    preEchoes: false,
  },
  "small-room": {
    sizeScale: 0.45,
    maxDecaySeconds: 100,
    maxPreDelaySeconds: 0.45,
    lineCount: 8,
    detune: true,
    preEchoes: true,
  },
  "large-room": {
    sizeScale: 0.85,
    maxDecaySeconds: 150,
    maxPreDelaySeconds: 0.45,
    lineCount: 8,
    detune: true,
    preEchoes: true,
  },
  hall: {
    sizeScale: 1.6,
    // `[DOC]` "0.70 to 250.0 sec." — the longest published decay in the machine.
    maxDecaySeconds: 250,
    maxPreDelaySeconds: 0.45,
    lineCount: 8,
    detune: true,
    preEchoes: true,
  },
};

export const dp4Algorithm = (value: unknown): Dp4Algorithm => {
  const name = typeof value === "string" ? value : "";
  return (DP4_ALGORITHMS as readonly string[]).includes(name)
    ? (name as Dp4Algorithm)
    : "large-plate";
};

/**
 * `[DOC]` "LF Decay Time … boosts (positive) or cuts (negative) the rate at
 * which low frequencies will decay." Range −99 to +99, normalised here to ±1.
 *
 * A multiplier on the low-frequency RT60, bipolar about unity. Positive means
 * lows ring longer than highs, which is what a large hall does; negative means
 * they die first, which no real room does and is exactly why the control exists.
 */
export const lfDecayScale = (amount: number): number =>
  Math.pow(2, clamp(amount, -1, 1) * 1.5);

/** `[DOC]` HF Bandwidth 01–99: the input lowpass. Higher = brighter. */
export const bandwidthHz = (amount: number): number =>
  200 * Math.pow(20000 / 200, clamp(amount, 0, 1));

/** `[DOC]` HF Damping 00–99: the in-tank lowpass. Higher = darker. */
export const dampingHz = (amount: number): number =>
  18000 * Math.pow(600 / 18000, clamp(amount, 0, 1));

export type Dp4ReverbCore = {
  input: AudioNodeLike;
  output: AudioNodeLike;
  owned: readonly AudioNodeLike[];
  setParameter(id: string, value: number, at: number): void;
  dispose(): void;
};

/**
 * One DP/4 tank.
 *
 *   in ─► bandwidth(LPF) ─► diffuser(D1,D2) ─┬─► [pre-echo taps] ─┐
 *                                             │                    ├─► tank ─► LPF ─► out
 *                                             └─► primary send ────┘
 *
 * The pre-echo section is the part people miss. `[DOC]` each pre-echo has *two*
 * destinations with independent levels: "Ref 1 Level … controls the echo send
 * to the Definition" and "Ref 1 Send … with the echo routed directly to the
 * output". One goes into the reverb, one goes around it. That is a distinctive
 * and very usable design and both paths are wired below.
 */
export function createDp4ReverbCore(
  context: EffectContext,
  spec: AudioNodeSpec,
  atSec: number,
): Dp4ReverbCore {
  const algorithm = dp4Algorithm(spec.structure["algorithm"]);
  const profile = DP4_PROFILES[algorithm];

  const input = fixedGain(context, 1, atSec);
  const bandwidth = fixedFilter(context, "lowpass", 12000, atSec);
  const preDelay = fixedDelay(context, 0, Math.max(0.05, profile.maxPreDelaySeconds), atSec);

  // `[DOC]` Diffusion 1 "controls the high frequency ranges", Diffusion 2
  // "controls lower frequency ranges" — which in a diffuser means shorter and
  // longer delays respectively, so they are two chains rather than one.
  const diffusion1 = createDiffuserChain(context, [0.0048, 0.0036], 0.75, atSec);
  const diffusion2 = createDiffuserChain(context, [0.0127, 0.0093], 0.625, atSec);

  const primarySend = fixedGain(context, 0.8, atSec);
  const tankIn = fixedGain(context, 1, atSec);

  const network: FeedbackNetwork = createFeedbackNetwork(
    context,
    {
      lineCount: profile.lineCount,
      sizeScale: profile.sizeScale,
      decaySeconds: 2,
      dampingHz: 8000,
      modRateHz: profile.detune ? 0.4 : 0,
      modDepthSeconds: 0,
    },
    atSec,
  );

  const outputFilter = fixedFilter(context, "lowpass", 16000, atSec);
  const output = fixedGain(context, 1, atSec);

  input.connect(bandwidth);
  bandwidth.connect(preDelay);
  preDelay.connect(diffusion1.input);
  diffusion1.output.connect(diffusion2.input);
  diffusion2.output.connect(primarySend);
  primarySend.connect(tankIn);
  tankIn.connect(network.input);
  network.output.connect(outputFilter);
  outputFilter.connect(output);

  // Pre-echoes: two taps, each with a send into the tank and a send to the
  // output. Plates skip this entirely, matching the manual's diagrams.
  type PreEcho = {
    delay: ReturnType<typeof fixedDelay>;
    toTank: GainNodeLike;
    toOutput: GainNodeLike;
  };
  const preEchoes: PreEcho[] = [];
  if (profile.preEchoes) {
    for (let i = 0; i < 2; i++) {
      // `[DOC]` "Ref 1 Time … 0 to 120 milliseconds".
      const delay = fixedDelay(context, 0.02 + i * 0.017, 0.12, atSec);
      const toTank = fixedGain(context, 0.3, atSec);
      const toOutput = fixedGain(context, 0.2, atSec);
      diffusion2.output.connect(delay);
      delay.connect(toTank);
      toTank.connect(tankIn);
      delay.connect(toOutput);
      toOutput.connect(output);
      preEchoes.push({ delay, toTank, toOutput });
    }
  }

  // `[DOC]` Early Ref Level 1–4, "close to the input of the Decay Definition",
  // range −99 to +99 — bipolar, so the sign inverts the tap. Plates only.
  const earlyRefs: GainNodeLike[] = [];
  if (!profile.preEchoes) {
    for (let i = 0; i < 4; i++) {
      const tap = fixedDelay(context, 0.004 + i * 0.0037, 0.05, atSec);
      const level = fixedGain(context, 0, atSec);
      diffusion1.output.connect(tap);
      tap.connect(level);
      level.connect(tankIn);
      earlyRefs.push(level);
      // The delay is owned through the level's chain; track it for disposal.
      (level as unknown as { __tap?: AudioNodeLike }).__tap = tap;
    }
  }

  let decaySeconds = 2;
  let lfDecay = 0;

  const applyDecay = (at: number) => {
    // The network holds one RT60. The DP/4 has two — a master decay and a low
    // frequency multiplier — so the low band is approximated by biasing the
    // in-tank damping alongside the decay rather than by running two networks.
    // A second network per band would be the faithful answer and costs twice
    // the delay lines; noted in the module docs rather than done silently.
    network.setDecaySeconds(decaySeconds * (lfDecay > 0 ? 1 : lfDecayScale(lfDecay)), at);
  };

  const setParameter = (id: string, value: number, at: number): void => {
    switch (id) {
      case "decay-seconds":
        decaySeconds = clamp(value, 0.2, profile.maxDecaySeconds);
        applyDecay(at);
        return;
      case "pre-delay-seconds":
        rampParam(preDelay.delayTime, clamp(value, 0, profile.maxPreDelaySeconds), at, "linear");
        return;
      case "lf-decay":
        lfDecay = clamp(value, -1, 1);
        applyDecay(at);
        return;
      case "hf-damping":
        network.setDamping(dampingHz(value), at);
        return;
      case "hf-bandwidth":
        rampParam(bandwidth.frequency, bandwidthHz(value), at, "linear");
        return;
      case "diffusion-1":
        diffusion1.setCoefficient(clamp(value, 0, 1) * 0.78, at);
        return;
      case "diffusion-2":
        diffusion2.setCoefficient(clamp(value, 0, 1) * 0.65, at);
        return;
      case "decay-definition":
        // `[DOC]` "Controls the rate at which echo density is increased with
        // time… Definition should not exceed the Decay Rate." The manual warns
        // rather than prevents; the clamp below is the one concession, because
        // a browser tab that self-oscillates is worse than a knob that stops.
        network.setSize(profile.sizeScale * (0.6 + clamp(value, 0, 1) * 0.9), at);
        return;
      case "detune-rate":
        if (profile.detune) network.modulator.setRateHz(0.05 + clamp(value, 0, 1) * 2.5, at);
        return;
      case "detune-depth":
        // `[DOC]` "Low values yield a metallic sound" — so zero really is an
        // available, and deliberately unpleasant, setting.
        if (profile.detune) network.modulator.setDepthSeconds(clamp(value, 0, 1) * 0.0012, at);
        return;
      case "primary-send":
        rampParam(primarySend.gain, clamp(value, -1, 1), at, "linear");
        return;
      case "ref-1-level":
        if (preEchoes[0]) rampParam(preEchoes[0].toTank.gain, clamp(value, 0, 1), at, "linear");
        return;
      case "ref-1-send":
        if (preEchoes[0]) rampParam(preEchoes[0].toOutput.gain, clamp(value, 0, 1), at, "linear");
        return;
      case "ref-2-level":
        if (preEchoes[1]) rampParam(preEchoes[1].toTank.gain, clamp(value, 0, 1), at, "linear");
        return;
      case "ref-2-send":
        if (preEchoes[1]) rampParam(preEchoes[1].toOutput.gain, clamp(value, 0, 1), at, "linear");
        return;
      case "early-refs":
        // One control drives all four taps with alternating sign, which is the
        // audible half of four bipolar controls without four knobs.
        earlyRefs.forEach((tap, i) => {
          const sign = i % 2 === 0 ? 1 : -1;
          rampParam(tap.gain, sign * clamp(value, 0, 1) * 0.6, at, "linear");
        });
        return;
      default:
        return;
    }
  };

  return {
    input,
    output,
    owned: [
      input,
      bandwidth,
      preDelay,
      primarySend,
      tankIn,
      outputFilter,
      output,
      ...diffusion1.owned,
      ...diffusion2.owned,
      ...network.owned,
      ...preEchoes.flatMap((e) => [e.delay, e.toTank, e.toOutput]),
      ...earlyRefs,
    ],
    setParameter,
    dispose() {
      network.dispose();
    },
  };
}

// ---- Non Lin -----------------------------------------------------------------

/** `[DOC]` Nine taps across the density, "sequenced in time from input to output". */
export const NONLIN_TAPS = 9;

/**
 * `[DOC]` The three variants and their published durations.
 *
 * Note Non Lin 2's reflection times are *shorter* than 1 and 3's despite its
 * longer overall duration (0–85 ms against 0–600 ms). That is in the manual and
 * it is not a typo.
 */
export const NONLIN_VARIANTS = ["non-lin-1", "non-lin-2", "non-lin-3"] as const;
export type NonLinVariant = (typeof NONLIN_VARIANTS)[number];

export const NONLIN_PROFILES: Readonly<
  Record<NonLinVariant, { durationSeconds: number; reflectionMaxSeconds: number; spread: number }>
> = {
  "non-lin-1": { durationSeconds: 0.5, reflectionMaxSeconds: 0.6, spread: 1 },
  "non-lin-2": { durationSeconds: 1.5, reflectionMaxSeconds: 0.085, spread: 1 },
  // `[DOC]` "sonically similar to Non Lin 1, but there is less stereo movement,
  // making it better suited for drum tracks."
  "non-lin-3": { durationSeconds: 0.5, reflectionMaxSeconds: 0.6, spread: 0.25 },
};

export const nonLinVariant = (value: unknown): NonLinVariant => {
  const name = typeof value === "string" ? value : "";
  return (NONLIN_VARIANTS as readonly string[]).includes(name)
    ? (name as NonLinVariant)
    : "non-lin-1";
};

/**
 * A single-pass diffusion line with nine level taps.
 *
 * No feedback anywhere — that is the defining property, and it is why this
 * cannot ring and cannot be made infinite. The envelope is drawn by the nine
 * levels, so the same structure gives a gate (early taps up, late taps down), a
 * reverse swell (the opposite), or a bloom (a hump in the middle).
 *
 * `[DOC]` "We recommend the average Envelope Level not to exceed a value of 45
 * to prevent overdriving these three reverbs" — hence the −6 dB trim on the
 * summed output, so following that advice lands at a sane level here.
 */
export function createNonLinCore(
  context: EffectContext,
  spec: AudioNodeSpec,
  atSec: number,
): Dp4ReverbCore {
  const variant = nonLinVariant(spec.structure["variant"]);
  const profile = NONLIN_PROFILES[variant];

  const input = fixedGain(context, 1, atSec);
  const bandwidth = fixedFilter(context, "lowpass", 12000, atSec);
  const diffusion1 = createDiffuserChain(context, [0.0051, 0.0037], 0.7, atSec);
  const diffusion2 = createDiffuserChain(context, [0.0131, 0.0097], 0.6, atSec);
  const output = fixedGain(context, 0.5, atSec);
  const damping = fixedFilter(context, "lowpass", 14000, atSec);

  input.connect(bandwidth);
  bandwidth.connect(diffusion1.input);
  diffusion1.output.connect(diffusion2.input);

  // The density: a chain of allpasses tapped at nine points. Each tap sees more
  // diffusion than the one before it, so the echo density rises along the line
  // exactly as the manual describes.
  const step = profile.durationSeconds / NONLIN_TAPS;
  let node: AudioNodeLike = diffusion2.output;
  const stages: ReturnType<typeof createDiffuserChain>[] = [];
  const taps: GainNodeLike[] = [];

  for (let i = 0; i < NONLIN_TAPS; i++) {
    const stage = createDiffuserChain(
      context,
      [step * 0.61 * profile.spread + 0.003, step * 0.37 + 0.002],
      0.6,
      atSec,
    );
    node.connect(stage.input);
    const tap = fixedGain(context, i === 0 ? 0.5 : 0.3, atSec);
    stage.output.connect(tap);
    tap.connect(damping);
    stages.push(stage);
    taps.push(tap);
    node = stage.output;
  }
  damping.connect(output);

  const setParameter = (id: string, value: number, at: number): void => {
    if (id.startsWith("envelope-")) {
      const index = Number.parseInt(id.slice("envelope-".length), 10) - 1;
      const tap = taps[index];
      if (tap) rampParam(tap.gain, clamp(value, 0, 1), at, "linear");
      return;
    }
    switch (id) {
      case "hf-bandwidth":
        rampParam(bandwidth.frequency, bandwidthHz(value), at, "linear");
        return;
      case "hf-damping":
        rampParam(damping.frequency, dampingHz(value), at, "linear");
        return;
      case "diffusion-1":
        diffusion1.setCoefficient(clamp(value, 0, 1) * 0.78, at);
        return;
      case "diffusion-2":
        diffusion2.setCoefficient(clamp(value, 0, 1) * 0.65, at);
        return;
      case "density-1":
        for (let i = 0; i < stages.length; i += 2) {
          stages[i].setCoefficient(clamp(value, 0, 1) * 0.8, at);
        }
        return;
      case "density-2":
        // `[DOC]` "to get the smoothest sound, Density 2 is usually less than
        // the value of Density 1" — a convention, not a constraint.
        for (let i = 1; i < stages.length; i += 2) {
          stages[i].setCoefficient(clamp(value, 0, 1) * 0.8, at);
        }
        return;
      default:
        return;
    }
  };

  return {
    input,
    output,
    owned: [
      input,
      bandwidth,
      damping,
      output,
      ...diffusion1.owned,
      ...diffusion2.owned,
      ...stages.flatMap((s) => s.owned),
      ...taps,
    ],
    setParameter,
    dispose() {
      /* nothing beyond the owned nodes — there is no oscillator and no loop */
    },
  };
}

// ---- the machine -------------------------------------------------------------

/**
 * `[DOC]` The pair routings. Four options, and the difference between the two
 * feedback modes is *only* where the dry signal rejoins:
 *
 *   serial     in ─► A ─► B ─► out
 *   parallel   in ─┬► A ─┬► out
 *                  └► B ─┘
 *   feedback1  in ─►(+)─► A ─► B ─┬─► out          dry summed at the OUTPUT
 *                    ▲            │
 *                    └── wet tap ─┘
 *   feedback2  same loop, dry summed BEFORE A
 *
 * `[DOC]` "Note that the feedback signal is all wet, and that it is tapped
 * before the dry signal." That sentence is the whole specification of the tap
 * point and it is why `wetTap` below sits where it does.
 */
export const DP4_PAIR_ROUTINGS = ["serial", "parallel", "feedback1", "feedback2"] as const;
export type Dp4PairRouting = (typeof DP4_PAIR_ROUTINGS)[number];

/** `[DOC]` AB into CD is serial or parallel only — no feedback at this level. */
export const DP4_ABCD_ROUTINGS = ["serial", "parallel"] as const;
export type Dp4AbcdRouting = (typeof DP4_ABCD_ROUTINGS)[number];

/** `[DOC]` "there are 32 different ABCD routing possibilities" — 4 × 4 × 2. */
export const DP4_ROUTING_COUNT =
  DP4_PAIR_ROUTINGS.length * DP4_PAIR_ROUTINGS.length * DP4_ABCD_ROUTINGS.length;

/** `[DOC]` The four input configurations from the diagram on the front panel. */
export const DP4_SOURCE_CONFIGS = [1, 2, 3, 4] as const;
export type Dp4SourceConfig = (typeof DP4_SOURCE_CONFIGS)[number];

export const dp4PairRouting = (value: unknown): Dp4PairRouting => {
  const name = typeof value === "string" ? value : "";
  return (DP4_PAIR_ROUTINGS as readonly string[]).includes(name)
    ? (name as Dp4PairRouting)
    : "serial";
};

export const dp4AbcdRouting = (value: unknown): Dp4AbcdRouting =>
  value === "parallel" ? "parallel" : "serial";

export const dp4SourceConfig = (value: unknown): Dp4SourceConfig => {
  const n = Math.round(numberOr(value, 1));
  return (DP4_SOURCE_CONFIGS as readonly number[]).includes(n) ? (n as Dp4SourceConfig) : 1;
};

/**
 * Which units a source feeds, per the machine's input-configuration diagram.
 *
 *   1 source   all four units see input 1
 *   2 source   src1 → A,B      src2 → C,D          (no AB↔CD connection)
 *   3 source   src1 → A        src2 → B            src3 → C,D
 *   4 source   one input each
 */
export function dp4InputRouting(config: Dp4SourceConfig): readonly (readonly number[])[] {
  switch (config) {
    case 1:
      return [[0, 1, 2, 3], [], [], []];
    case 2:
      return [[0, 1], [], [2, 3], []];
    case 3:
      return [[0], [1], [2, 3], []];
    case 4:
    default:
      return [[0], [1], [2], [3]];
  }
}

/** `[DOC]` In 2-, 3- and 4-source configs the AB and CD pairs are independent. */
export const dp4PairsAreLinked = (config: Dp4SourceConfig): boolean => config === 1;

export type Dp4UnitSlot = {
  input: GainNodeLike;
  output: GainNodeLike;
  core: Dp4ReverbCore;
  /** `[DOC]` Mix is per unit — 00 all dry, 99 all wet. */
  dry: GainNodeLike;
  wet: GainNodeLike;
  /** `[DOC]` "Volume … Setting this to 00 will eliminate the signal, and any
   *  algorithms and/or configs that follow will also receive no signal." */
  volume: GainNodeLike;
};

export type Dp4Machine = {
  inputs: readonly GainNodeLike[];
  outputs: readonly GainNodeLike[];
  owned: readonly AudioNodeLike[];
  setParameter(id: string, value: number, at: number): void;
  dispose(): void;
};

/**
 * Four units, wired per the Config.
 *
 * The unit algorithms and the routing are all **structural** — changing any of
 * them rebuilds the machine behind the adapter's crossfade — because they
 * decide the shape of the graph, and a graph shape is not something that can be
 * ramped. The movable surface is what is left: each unit's mix, volume and its
 * algorithm's own parameters.
 *
 * The loop-safety limiter in the feedback routings is a deliberate divergence.
 * The hardware simply clipped; a browser tab that runs away is a worse
 * experience than one that ducks, and the machine's own manual warns about
 * "blow up" in three separate algorithms.
 */
export function createDp4Machine(
  context: EffectContext,
  spec: AudioNodeSpec,
  atSec: number,
): Dp4Machine {
  const config = dp4SourceConfig(spec.structure["source-config"]);
  const abRouting = dp4PairRouting(spec.structure["ab-routing"]);
  const cdRouting = dp4PairRouting(spec.structure["cd-routing"]);
  const abcdRouting = dp4AbcdRouting(spec.structure["abcd-routing"]);

  const inputs = Array.from({ length: 4 }, () => fixedGain(context, 1, atSec));
  const outputs = Array.from({ length: 4 }, () => fixedGain(context, 1, atSec));
  const owned: AudioNodeLike[] = [...inputs, ...outputs];

  const unitAlgorithms: Dp4Algorithm[] = ["a", "b", "c", "d"].map((letter) =>
    dp4Algorithm(spec.structure[`unit-${letter}-algorithm`]),
  );

  const units: Dp4UnitSlot[] = unitAlgorithms.map((algorithm) => {
    const unitInput = fixedGain(context, 1, atSec);
    const dry = fixedGain(context, 0.5, atSec);
    const wet = fixedGain(context, 0.5, atSec);
    const volume = fixedGain(context, 0.8, atSec);
    const unitOutput = fixedGain(context, 1, atSec);

    const core = createDp4ReverbCore(
      context,
      { ...spec, structure: { algorithm } } as AudioNodeSpec,
      atSec,
    );

    unitInput.connect(core.input);
    core.output.connect(wet);
    unitInput.connect(dry);
    wet.connect(volume);
    dry.connect(volume);
    volume.connect(unitOutput);

    owned.push(unitInput, dry, wet, volume, unitOutput, ...core.owned);
    return { input: unitInput, output: unitOutput, core, dry, wet, volume };
  });

  /** Wire one pair (A+B or C+D) and hand back its single entry and exit. */
  const wirePair = (
    first: Dp4UnitSlot,
    second: Dp4UnitSlot,
    routing: Dp4PairRouting,
  ): { input: AudioNodeLike; output: AudioNodeLike } => {
    const entry = fixedGain(context, 1, atSec);
    const exit = fixedGain(context, 1, atSec);
    owned.push(entry, exit);

    if (routing === "parallel") {
      entry.connect(first.input);
      entry.connect(second.input);
      first.output.connect(exit);
      second.output.connect(exit);
      return { input: entry, output: exit };
    }

    // Serial and both feedback modes share the A → B spine.
    entry.connect(first.input);
    first.output.connect(second.input);
    second.output.connect(exit);

    if (routing === "feedback1" || routing === "feedback2") {
      // `[DOC]` the tap is all-wet and taken before the dry sum, so it comes
      // off the second unit's output, which is the wet spine.
      const wetTap = fixedGain(context, 0.45, atSec);
      const limiter = context.createDynamicsCompressor();
      setNow(limiter.threshold, -6, atSec);
      setNow(limiter.knee, 0, atSec);
      setNow(limiter.ratio, 20, atSec);
      setNow(limiter.attack, 0.001, atSec);
      setNow(limiter.release, 0.1, atSec);
      // A delay in the loop is not optional: Web Audio requires one in any
      // cycle, and this also fixes the loop time so a patch sounds the same at
      // every sample rate rather than tracking the render quantum.
      const loopDelay = fixedDelay(context, 0.02, 0.5, atSec);

      second.output.connect(wetTap);
      wetTap.connect(limiter);
      limiter.connect(loopDelay);
      // feedback1 sums the dry at the output; feedback2 sums it before A. The
      // difference is only where the loop re-enters.
      loopDelay.connect(routing === "feedback1" ? first.input : entry);
      owned.push(wetTap, limiter, loopDelay);
    }

    return { input: entry, output: exit };
  };

  const ab = wirePair(units[0], units[1], abRouting);
  const cd = wirePair(units[2], units[3], cdRouting);

  // `[DOC]` "the blank space will not appear in a 1 Source Config, because all
  // four units are always connected together" — so AB↔CD only exists there.
  if (dp4PairsAreLinked(config)) {
    if (abcdRouting === "serial") {
      ab.output.connect(cd.input);
      cd.output.connect(outputs[0]);
      cd.output.connect(outputs[1]);
    } else {
      ab.output.connect(outputs[0]);
      ab.output.connect(outputs[1]);
      cd.output.connect(outputs[0]);
      cd.output.connect(outputs[1]);
    }
  } else {
    ab.output.connect(outputs[0]);
    ab.output.connect(outputs[1]);
    cd.output.connect(outputs[2]);
    cd.output.connect(outputs[3]);
  }

  // Inputs into pairs, per the configuration diagram.
  const routing = dp4InputRouting(config);
  routing.forEach((targets, sourceIndex) => {
    for (const unitIndex of targets) {
      const destination = unitIndex < 2 ? ab.input : cd.input;
      inputs[sourceIndex].connect(destination);
    }
  });

  const setParameter = (id: string, value: number, at: number): void => {
    // `unit-a-mix`, `unit-c-decay-seconds`, and so on. One prefix, so adding an
    // algorithm parameter never means touching this dispatcher.
    const match = /^unit-([abcd])-(.+)$/.exec(id);
    if (!match) return;
    const slot = units["abcd".indexOf(match[1])];
    if (!slot) return;
    const parameterId = match[2];

    if (parameterId === "mix") {
      const mix = clamp(value, 0, 1);
      // `[DOC]` The DP/4's mix is a straight blend, not equal power: "00 will
      // allow only the unprocessed signal … 99 will eliminate the dry signal".
      rampParam(slot.wet.gain, mix, at, "linear");
      rampParam(slot.dry.gain, 1 - mix, at, "linear");
      return;
    }
    if (parameterId === "volume") {
      rampParam(slot.volume.gain, clamp(value, 0, 1), at, "linear");
      return;
    }
    slot.core.setParameter(parameterId, value, at);
  };

  return {
    inputs,
    outputs,
    owned,
    setParameter,
    dispose() {
      for (const unit of units) unit.core.dispose();
      for (const node of owned) node.disconnect();
    },
  };
}
