// The effect rack: seven topologies, one shell.
//
// The signal designs come from the AV prototype — its plate reverb, its
// feedback delay, its three-band EQ, its compressor and limiter coefficients,
// its waveshaper crusher. What does not come across is how they were wired to
// the outside world. In that codebase every effect assigned `gain.value = x`
// directly, rebuilt itself when a setting changed, and reached back through a
// global for its context. Here each one is a `ManagedAudioNode`: it receives
// its context, every write is a scheduled ramp, and the shell owns the fade
// handle so the adapter's crossfade works without the topology knowing.
//
// The shell is the part worth reading twice.
//
//   input ─┬─ dry ──────────────────────────┬─ output(level)
//          └─ core.input … core.output ─ wet ┘
//
// Three properties fall out of that shape:
//
//   - **Mix is not a topology change.** Turning wet to zero leaves the DSP
//     connected and running; it is two ramps. That is what makes bypass free
//     and reversible, and it is why §9.4 asks for wet-at-zero rather than a
//     disconnection.
//   - **The crossfade handle is uniform.** `level` is the output gain of every
//     module, so `AudioGraphAdapter` fades anything in or out identically and
//     no effect author has to remember to implement fading.
//   - **Structure is separable.** Everything that decides the *shape* of the
//     graph — a convolver's impulse, a crusher's curve, a delay line's maximum
//     length — is read once at construction from `spec.structure`. Everything
//     in `spec.parameters` is an `AudioParam` and therefore rampable. The split
//     is not a convention here; it is the difference between the two objects.

import type { AudioNodeSpec } from "./audioPlan";
import type { AudioNodeLike, ManagedAudioNode } from "./graphAdapter";
import { rampParam, type AudioParamLike, type SmoothingPolicy } from "./params";
import { crushCurve, impulseFrameCount, renderPlateImpulse } from "./dsp";
import type { BiquadFilterKind, EffectContext, GainNodeLike } from "./nodes";
import { createBlackholeCore } from "./blackhole";
import { createDp4Machine, createDp4ReverbCore, createNonLinCore } from "./dp4";
import { createWidener } from "./widener";
import { createMixer } from "./mixer";

/** Where a parameter's ramp shape comes from — the registry descriptor. */
export type SmoothingLookup = (parameterId: string) => SmoothingPolicy;

/**
 * The DSP between the shell's input and its mix bus.
 *
 * `params` is the whole movable surface: if a control is not in here it cannot
 * be automated, which is exactly the check that keeps a "quick" direct write
 * from appearing later.
 */
type EffectCore = {
  input: AudioNodeLike;
  output: AudioNodeLike;
  params: Record<string, AudioParamLike>;
  /** Parallel effects have a dry path and a mix control; series effects do not. */
  parallel: boolean;
  /** Nodes to disconnect on disposal, in no particular order. */
  owned: readonly AudioNodeLike[];

  /**
   * A hand-written parameter setter, for controls that are not one `AudioParam`.
   *
   * Most effects are a knob per node and `params` says everything. The two
   * reverb machines are not: Blackhole's Gravity moves the decay time *and* the
   * diffusion *and* the de-rating on the global feedback, and its Feedback knob
   * has two discrete states past its top that reconfigure the tank. Those are
   * decisions, not values, and pretending otherwise would mean either exposing
   * three knobs where the machine has one or writing the coupling into the
   * shell, where it does not belong.
   *
   * Consulted only when `params` has no entry for the id, so an effect can mix
   * the two: plain parameters stay plain.
   */
  setParameter?(parameterId: string, value: number, atSec: number): void;

  /** Extra teardown beyond disconnecting `owned` — stopping oscillators, mostly. */
  dispose?(): void;

  /** Per-port wiring for multi-port modules. See `ManagedAudioNode`. */
  inputFor?(portId: string): AudioNodeLike;
  outputFor?(portId: string): AudioNodeLike;
};

type CoreBuilder = (context: EffectContext, spec: AudioNodeSpec) => EffectCore;

const numberOr = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const clamp = (value: number, low: number, high: number): number =>
  Math.min(high, Math.max(low, value));

class EffectModule implements ManagedAudioNode {
  readonly nodeId: string;
  private readonly inputGain: GainNodeLike;
  private readonly dryGain: GainNodeLike;
  private readonly wetGain: GainNodeLike;
  private readonly outputGain: GainNodeLike;
  private readonly core: EffectCore;
  private readonly smoothing: SmoothingLookup;
  private disposed = false;

  constructor(
    context: EffectContext,
    spec: AudioNodeSpec,
    atSec: number,
    core: EffectCore,
    smoothing: SmoothingLookup,
  ) {
    this.nodeId = spec.nodeId;
    this.core = core;
    this.smoothing = smoothing;

    this.inputGain = context.createGain();
    this.dryGain = context.createGain();
    this.wetGain = context.createGain();
    this.outputGain = context.createGain();

    this.inputGain.connect(this.core.input);
    this.core.output.connect(this.wetGain);
    this.wetGain.connect(this.outputGain);
    if (this.core.parallel) {
      this.inputGain.connect(this.dryGain);
      this.dryGain.connect(this.outputGain);
    }

    rampParam(this.inputGain.gain, 1, atSec, "none");
    // A series effect is all wet by definition: its dry path is not even wired,
    // so pinning the gains here keeps the two cases from diverging later.
    rampParam(this.wetGain.gain, 1, atSec, "none");
    rampParam(this.dryGain.gain, 0, atSec, "none");
    // The adapter fades this up from silence; starting anywhere else would be
    // heard as a step the moment the node is wired in.
    rampParam(this.outputGain.gain, 0, atSec, "none");

    for (const [parameterId, value] of Object.entries(spec.parameters)) {
      const param = this.core.params[parameterId];
      if (param) rampParam(param, value, atSec, "none");
    }
    if (this.core.parallel) this.setWet(spec.wet, atSec);
  }

  get input(): AudioNodeLike {
    return this.inputGain;
  }

  get output(): AudioNodeLike {
    return this.outputGain;
  }

  /** The adapter's crossfade handle, and nothing else's business. */
  get level(): AudioParamLike {
    return this.outputGain.gain;
  }

  setParameter(parameterId: string, value: number, atSec: number): void {
    const param = this.core.params[parameterId];
    if (param) {
      rampParam(param, value, atSec, this.smoothing(parameterId));
      return;
    }
    // A core with coupled controls handles its own ramps, because only it knows
    // which of them move together.
    this.core.setParameter?.(parameterId, value, atSec);
  }

  inputFor(portId: string): AudioNodeLike {
    return this.core.inputFor?.(portId) ?? this.inputGain;
  }

  outputFor(portId: string): AudioNodeLike {
    // Multi-port modules bypass the shell's mix bus: a four-output machine has
    // no single point where a dry/wet balance would be meaningful, and its own
    // per-unit mixes are the controls that matter.
    return this.core.outputFor?.(portId) ?? this.outputGain;
  }

  /**
   * Bypass here means *muted*, not *passed through*.
   *
   * The adapter takes `level` to zero for a bypassed node, so the module has
   * nothing to add — and it must not compensate by opening the dry path, which
   * would be an inaudible node quietly fighting the adapter. The pass-through
   * an insert effect wants is `wet = 0`, which leaves the DSP alive and costs
   * two ramps.
   */
  setBypass(): void {
    /* intentionally empty — see the comment above */
  }

  /**
   * Equal-power mix.
   *
   * The prototype used `wet` and `1 − wet`, which dips about 3 dB in the middle
   * because two uncorrelated signals sum in power, not amplitude. Sine and
   * cosine keep the sum constant, so sweeping the mix on a reverb no longer
   * sounds like a volume dip on the way across.
   */
  setWet(wet: number, atSec: number): void {
    if (!this.core.parallel) return;
    const mix = clamp(numberOr(wet, 1), 0, 1);
    const angle = (mix * Math.PI) / 2;
    rampParam(this.wetGain.gain, Math.sin(angle), atSec, "linear");
    rampParam(this.dryGain.gain, Math.cos(angle), atSec, "linear");
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    // Core teardown first: an oscillator must be stopped before the nodes it
    // feeds are torn out from under it.
    this.core.dispose?.();
    this.inputGain.disconnect();
    this.dryGain.disconnect();
    this.wetGain.disconnect();
    this.outputGain.disconnect();
    for (const node of this.core.owned) node.disconnect();
  }
}

// ---- topologies --------------------------------------------------------------

/** Level and nothing else. The patchable sibling of the master gain. */
const buildGain: CoreBuilder = (context) => {
  const gain = context.createGain();
  return { input: gain, output: gain, params: { gain: gain.gain }, parallel: false, owned: [gain] };
};

/**
 * The patch's exit point.
 *
 * Structurally a gain, but a distinct module because it is the one thing the
 * engine looks for: whatever reaches an Audio Output is what reaches the master
 * chain, and therefore the limiter and the speakers. Modelling it as a node
 * rather than as an implicit "anything unconnected is audible" rule means a
 * half-built patch is silent, which is the correct default for something that
 * can make a loud noise.
 */
const buildOutput: CoreBuilder = (context) => {
  const gain = context.createGain();
  return { input: gain, output: gain, params: { volume: gain.gain }, parallel: false, owned: [gain] };
};

/**
 * Delay with a feedback loop.
 *
 * `max-delay-seconds` is structural because a `DelayNode`'s maximum is fixed at
 * construction — asking for more than the line was built for silently clamps,
 * which is the kind of bug that presents as "the long setting sounds wrong".
 */
const buildDelay: CoreBuilder = (context, spec) => {
  const maxDelay = clamp(numberOr(spec.structure["max-delay-seconds"], 2), 0.05, 8);
  const input = context.createGain();
  const delay = context.createDelay(maxDelay);
  const feedback = context.createGain();
  const output = context.createGain();

  input.connect(delay);
  delay.connect(feedback);
  feedback.connect(delay);
  delay.connect(output);

  return {
    input,
    output,
    params: { "delay-seconds": delay.delayTime, feedback: feedback.gain },
    parallel: true,
    owned: [input, delay, feedback, output],
  };
};

/**
 * Convolution reverb on a generated plate tail.
 *
 * Both tail controls are structural: changing either re-renders the buffer, so
 * the node is rebuilt behind the adapter's crossfade rather than having its
 * impulse swapped underneath a sounding convolution.
 */
const buildReverb: CoreBuilder = (context, spec) => {
  const tailSeconds = clamp(numberOr(spec.structure["tail-seconds"], 1.8), 0.05, 8);
  const decayRate = clamp(numberOr(spec.structure["decay-rate"], 2.5), 0.1, 20);
  const seed = Math.round(numberOr(spec.structure["impulse-seed"], 1));

  const frames = impulseFrameCount(tailSeconds, context.sampleRate);
  const buffer = context.createBuffer(2, frames, context.sampleRate);
  renderPlateImpulse(
    [buffer.getChannelData(0), buffer.getChannelData(1)],
    context.sampleRate,
    { tailSeconds, decayRate, seed },
  );

  const input = context.createGain();
  const convolver = context.createConvolver();
  // Normalising would make the tail's loudness depend on the decay setting,
  // so a longer reverb would also be a quieter one.
  convolver.normalize = false;
  convolver.buffer = buffer;
  const damping = context.createBiquadFilter();
  damping.type = "lowpass";
  const output = context.createGain();

  input.connect(convolver);
  convolver.connect(damping);
  damping.connect(output);

  return {
    input,
    output,
    params: { "damping-hz": damping.frequency },
    parallel: true,
    owned: [input, convolver, damping, output],
  };
};

/** Serial low shelf → mid peak → high shelf, the prototype's band layout. */
const buildEq: CoreBuilder = (context) => {
  const low = filter(context, "lowshelf");
  const mid = filter(context, "peaking");
  const high = filter(context, "highshelf");

  low.connect(mid);
  mid.connect(high);

  return {
    input: low,
    output: high,
    params: {
      "low-gain-db": low.gain,
      "low-frequency": low.frequency,
      "mid-gain-db": mid.gain,
      "mid-frequency": mid.frequency,
      "mid-q": mid.Q,
      "high-gain-db": high.gain,
      "high-frequency": high.frequency,
    },
    parallel: false,
    owned: [low, mid, high],
  };
};

/** Compressor into a makeup gain, so gain reduction can be paid back. */
const buildCompressor: CoreBuilder = (context) => {
  const compressor = context.createDynamicsCompressor();
  const makeup = context.createGain();
  compressor.connect(makeup);
  return {
    input: compressor,
    output: makeup,
    params: {
      "threshold-db": compressor.threshold,
      "knee-db": compressor.knee,
      ratio: compressor.ratio,
      "attack-seconds": compressor.attack,
      "release-seconds": compressor.release,
      "makeup-gain": makeup.gain,
    },
    parallel: false,
    owned: [compressor, makeup],
  };
};

/**
 * A patchable limiter — hard knee, high ratio, fast attack.
 *
 * Distinct from the master limiter in `masterChain.ts`, which is a safety
 * device and stays out of reach. This one is an effect, and the difference is
 * that a user can set it badly.
 */
const buildLimiter: CoreBuilder = (context) => {
  const limiter = context.createDynamicsCompressor();
  rampParam(limiter.knee, 0, context.currentTime, "none");
  rampParam(limiter.ratio, 20, context.currentTime, "none");
  rampParam(limiter.attack, 0.001, context.currentTime, "none");
  return {
    input: limiter,
    output: limiter,
    params: { "ceiling-db": limiter.threshold, "release-seconds": limiter.release },
    parallel: false,
    owned: [limiter],
  };
};

/**
 * Bit reduction by waveshaping, then a lowpass to tame the result.
 *
 * The filter is not decoration. Quantisation folds energy back across the whole
 * spectrum, and without something above it the crusher reads as fizz rather
 * than as grit. Depth is structural — it decides the curve — while the filter
 * corner is an ordinary ramped parameter.
 */
const buildBitCrusher: CoreBuilder = (context, spec) => {
  const bits = numberOr(spec.structure["bit-depth"], 8);
  const input = context.createGain();
  const shaper = context.createWaveShaper();
  shaper.curve = crushCurve(bits);
  shaper.oversample = "none";
  const tone = context.createBiquadFilter();
  tone.type = "lowpass";
  const output = context.createGain();

  input.connect(shaper);
  shaper.connect(tone);
  tone.connect(output);

  return {
    input,
    output,
    params: { "tone-hz": tone.frequency },
    parallel: true,
    owned: [input, shaper, tone, output],
  };
};

function filter(context: EffectContext, kind: BiquadFilterKind) {
  const node = context.createBiquadFilter();
  node.type = kind;
  return node;
}

// ---- the two machines --------------------------------------------------------

/**
 * Blackhole — the H90's reverb.
 *
 * `line-count` is the only structural value: the number of delay lines in the
 * feedback network decides how many nodes exist, so it cannot be ramped. Every
 * documented control — Gravity, Size, Pre Delay, the two shelves, Mod Depth and
 * Rate, Feedback, Resonance — is movable, which is what lets the whole front
 * panel be automated from the modulation rack.
 */
const buildBlackhole: CoreBuilder = (context, spec) => {
  const core = createBlackholeCore(context, spec, context.currentTime);
  return {
    input: core.input,
    output: core.output,
    params: {},
    parallel: true,
    owned: core.owned,
    setParameter: core.setParameter,
    dispose: core.dispose,
  };
};

/**
 * One DP/4 reverb tank — plate, room or hall.
 *
 * The algorithm is structural because the manual is explicit that the variants
 * differ in "the internal values of the components (not user programmable)",
 * and because the room and hall algorithms have a pre-echo section the plates
 * do not. Switching between them is a different graph, not a different number.
 */
const buildDp4Reverb: CoreBuilder = (context, spec) => {
  const core = createDp4ReverbCore(context, spec, context.currentTime);
  return {
    input: core.input,
    output: core.output,
    params: {},
    parallel: true,
    owned: core.owned,
    setParameter: core.setParameter,
    dispose: core.dispose,
  };
};

/**
 * Non Lin — the DP/4's single-pass reverb.
 *
 * The one algorithm in this rack with no feedback anywhere, which is why it can
 * make a gate or a reverse swell without any envelope machinery: the nine tap
 * levels *are* the envelope.
 */
const buildDp4NonLin: CoreBuilder = (context, spec) => {
  const core = createNonLinCore(context, spec, context.currentTime);
  return {
    input: core.input,
    output: core.output,
    params: {},
    parallel: true,
    owned: core.owned,
    setParameter: core.setParameter,
    dispose: core.dispose,
  };
};

/**
 * The whole DP/4+ — four units, four ins, four outs.
 *
 * This is the module that needed `inputFor`/`outputFor`. Its four inputs are
 * not four copies of one signal: in a 4-source Config they are four independent
 * mono paths through four independent units, and summing them at a single
 * input would delete the machine's defining feature.
 *
 * `input`/`output` still resolve to inputs[0] and outputs[0], so a patch that
 * wires it like any other stereo effect gets something sensible rather than
 * silence.
 */
const buildDp4Machine: CoreBuilder = (context, spec) => {
  const machine = createDp4Machine(context, spec, context.currentTime);
  const portIndex = (portId: string, prefix: string): number => {
    const match = new RegExp(`^${prefix}-([1-4])$`).exec(portId);
    return match ? Number.parseInt(match[1], 10) - 1 : 0;
  };
  return {
    input: machine.inputs[0],
    output: machine.outputs[0],
    params: {},
    // The machine's dry/wet lives per unit, exactly as the hardware's did, so
    // the shell must not add a second one on top.
    parallel: false,
    owned: machine.owned,
    setParameter: machine.setParameter,
    dispose: machine.dispose,
    inputFor: (portId) => machine.inputs[portIndex(portId, "audio-in")] ?? machine.inputs[0],
    outputFor: (portId) => machine.outputs[portIndex(portId, "audio-out")] ?? machine.outputs[0],
  };
};

/**
 * Module type to topology.
 *
 * Registry descriptors and builders are kept in step by a test that walks this
 * map against the registry: a module registered with no builder would be a face
 * that makes no sound, and a builder with no module would be dead code.
 */
/**
 * The widener, wrapped.
 *
 * Series rather than parallel: a mid/side matrix has no meaningful dry blend —
 * half a width transform is just a different width, and the shell's mix would
 * be a second control fighting the first.
 */
const buildWidener: CoreBuilder = (context, spec) => {
  const core = createWidener(context, spec, context.currentTime);
  return {
    input: core.input,
    output: core.output,
    params: {},
    parallel: false,
    owned: core.owned,
    setParameter(parameterId, value, atSec) {
      if (parameterId === "width") core.setWidth(value, atSec);
      if (parameterId === "crossover") core.setCrossoverHz(value, atSec);
    },
  };
};

/**
 * The mixer, wrapped.
 *
 * Series for the same reason the DP/4 is: there is no single dry signal to
 * balance against four independent inputs.
 */
const buildMixer: CoreBuilder = (context, spec) => {
  const core = createMixer(context, spec, context.currentTime);
  return {
    input: core.input,
    output: core.output,
    params: {},
    parallel: false,
    owned: core.owned,
    inputFor: (portId) => core.inputFor(portId),
    setParameter: (parameterId, value, atSec) => core.setParameter(parameterId, value, atSec),
  };
};

export const EFFECT_BUILDERS: Readonly<Record<string, CoreBuilder>> = {
  "m.audio-output": buildOutput,
  "m.audio-gain": buildGain,
  "m.audio-delay": buildDelay,
  "m.audio-reverb": buildReverb,
  "m.audio-eq": buildEq,
  "m.audio-compressor": buildCompressor,
  "m.audio-limiter": buildLimiter,
  "m.audio-bitcrusher": buildBitCrusher,
  "m.audio-blackhole": buildBlackhole,
  "m.audio-dp4-reverb": buildDp4Reverb,
  "m.audio-dp4-nonlin": buildDp4NonLin,
  "m.audio-dp4": buildDp4Machine,
  "m.audio-widener": buildWidener,
  "m.audio-mixer": buildMixer,
};

export const isEffectModule = (moduleType: string): boolean => moduleType in EFFECT_BUILDERS;

/** Build one effect, or fail loudly rather than silently muting a patch. */
export function createEffect(
  context: EffectContext,
  spec: AudioNodeSpec,
  atSec: number,
  smoothing: SmoothingLookup,
): ManagedAudioNode {
  const build = EFFECT_BUILDERS[spec.moduleType];
  if (!build) throw new Error(`No audio topology for module type: ${spec.moduleType}`);
  return new EffectModule(context, spec, atSec, build(context, spec), smoothing);
}
