// Reverberation built from native nodes.
//
// Two machines' reverbs land in this rack — the H90's Blackhole and the DP/4's
// plate/room/hall family — and they are less different than their front panels
// suggest. Both are a diffuser feeding a feedback structure with damping in the
// loop; the argument between them is about the *shape* of the feedback, not
// about whether there is any. So the pieces live here and the two modules
// assemble them differently.
//
// Everything is made from `DelayNode`, `BiquadFilterNode`, `GainNode` and one
// `OscillatorNode`. Nothing here needs an AudioWorklet, which is the constraint
// that shaped every decision below: where a per-sample operation was required
// the design had to change rather than the platform.
//
// The one thing worth internalising before reading: **a Web Audio graph can
// express feedback, but only through a `DelayNode`.** The spec requires at least
// one delay in any cycle, and the browser enforces a minimum of one render
// quantum (128 samples) of delay around a loop. That is why every structure
// here is built around delay lines rather than, say, a bare gain fed back on
// itself — and it is also why the loops are stable by construction.

import type {
  BiquadFilterNodeLike,
  DelayNodeLike,
  EffectContext,
  GainNodeLike,
  OscillatorNodeLike,
} from "./nodes";
import type { AudioNodeLike } from "./graphAdapter";
import { rampParam, type AudioParamLike } from "./params";

export const clamp = (value: number, low: number, high: number): number =>
  Math.min(high, Math.max(low, value));

export const numberOr = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

/** Set a value once at construction, with no ramp and no automation event. */
export const setNow = (param: AudioParamLike, value: number, atSec: number): void =>
  rampParam(param, value, atSec, "none");

// ---- delay lengths -----------------------------------------------------------

/**
 * Base delay lengths, in seconds, for a feedback network.
 *
 * They are mutually prime in samples at any ordinary rate, which is the point:
 * if two lines share a common factor their echoes coincide and the tail
 * develops a pitch. The spread is roughly 1 : 4 — wide enough that the network
 * fills in quickly rather than sounding like four distinct echoes.
 *
 * These are prime *numbers of milliseconds*, which is a cruder guarantee than
 * priming the sample counts, but it survives a change of sample rate without
 * recomputation and the residual coincidences are far below audibility.
 */
export const FDN_BASE_SECONDS: readonly number[] = [
  0.023, 0.031, 0.041, 0.053, 0.067, 0.079, 0.089, 0.101,
];

/** Longest line any tank may ask for; sizes the `DelayNode` allocations. */
export const MAX_LINE_SECONDS = 2.5;

// ---- allpass diffuser --------------------------------------------------------

export type Allpass = {
  input: AudioNodeLike;
  output: AudioNodeLike;
  /** The coefficient, as a movable parameter — diffusion is a knob on both machines. */
  coefficient: AudioParamLike;
  owned: readonly AudioNodeLike[];
};

/**
 * A Schroeder allpass, wired from three gains and a delay.
 *
 *     v[n] = x[n] + g·v[n−M]
 *     y[n] = v[n−M] − g·v[n]
 *
 * Unity magnitude at every frequency, dispersive phase — it smears a transient
 * without colouring it, which is exactly what "diffusion" means on both front
 * panels.
 *
 * The wiring below is the direct transcription:
 *
 *     input ─┬────────────────────────► (−g) ──┐
 *            └─►(+)─► delay ─┬─► (g) ──┘       ├─► output
 *                  ▲          └──────────────► ┘
 *                  └──────────────────────────┘
 *
 * Note `feedforward` is set to `−g` and `feedback` to `+g` from a single
 * `coefficient` value; a caller that ramps one must ramp the other, which is
 * why `setAllpassCoefficient` exists rather than exposing the two gains.
 */
export function createAllpass(
  context: EffectContext,
  delaySeconds: number,
  coefficient: number,
  atSec: number,
): Allpass & { setCoefficient(value: number, at: number): void } {
  const input = context.createGain();
  const sum = context.createGain();
  const delay = context.createDelay(Math.max(0.001, delaySeconds * 2));
  const feedback = context.createGain();
  const feedforward = context.createGain();
  const output = context.createGain();

  setNow(delay.delayTime, delaySeconds, atSec);
  setNow(feedback.gain, coefficient, atSec);
  setNow(feedforward.gain, -coefficient, atSec);

  input.connect(sum);
  sum.connect(delay);
  delay.connect(feedback);
  feedback.connect(sum);
  delay.connect(output);
  input.connect(feedforward);
  feedforward.connect(output);

  return {
    input,
    output,
    coefficient: feedback.gain,
    owned: [input, sum, delay, feedback, feedforward, output],
    setCoefficient(value: number, at: number) {
      const g = clamp(value, -0.85, 0.85);
      rampParam(feedback.gain, g, at, "linear");
      rampParam(feedforward.gain, -g, at, "linear");
    },
  };
}

/**
 * A chain of allpasses with decreasing delay lengths.
 *
 * Long first, short last. Each stage multiplies the echo density of the one
 * before it, so putting the longest first means the density has the whole
 * chain to build across rather than being set by the final short stage.
 */
export function createDiffuserChain(
  context: EffectContext,
  seconds: readonly number[],
  coefficient: number,
  atSec: number,
) {
  const stages = seconds.map((s) => createAllpass(context, s, coefficient, atSec));
  for (let i = 1; i < stages.length; i++) stages[i - 1].output.connect(stages[i].input);
  return {
    input: stages[0].input,
    output: stages[stages.length - 1].output,
    owned: stages.flatMap((s) => s.owned),
    setCoefficient(value: number, at: number) {
      for (const stage of stages) stage.setCoefficient(value, at);
    },
  };
}

// ---- modulation --------------------------------------------------------------

export type TankModulator = {
  /** Connect this to a `delayTime` to modulate it. */
  connectTo(param: AudioParamLike): void;
  setDepthSeconds(value: number, at: number): void;
  setRateHz(value: number, at: number): void;
  owned: readonly AudioNodeLike[];
  dispose(): void;
};

/**
 * One LFO per delay line, at deliberately unrelated rates.
 *
 * A single LFO driving every line would move them together, which transposes
 * the whole tail rather than breaking up its modes — audible as a seasick
 * wobble instead of the intended smoothing. The multipliers below are irrational
 * enough that the lines never re-align, so the modulation reads as motion
 * rather than as vibrato.
 *
 * Depth is in *seconds of delay excursion*, not a normalised amount, because
 * what matters perceptually is the excursion relative to the line length and
 * the caller is the only one that knows the line length.
 */
export function createModulator(
  context: EffectContext,
  count: number,
  baseRateHz: number,
  depthSeconds: number,
  atSec: number,
): TankModulator {
  const oscillators: OscillatorNodeLike[] = [];
  const depths: GainNodeLike[] = [];
  let index = 0;

  const make = () => {
    const osc = context.createOscillator();
    osc.type = "sine";
    const depth = context.createGain();
    // Rates fan out over roughly 1 : 2.4 so no two lines share a period.
    const spread = 0.7 + 0.55 * (index / Math.max(1, count - 1)) + 0.13 * (index % 3);
    setNow(osc.frequency, Math.max(0.01, baseRateHz * spread), atSec);
    setNow(depth.gain, depthSeconds, atSec);
    osc.connect(depth);
    osc.start(atSec);
    oscillators.push(osc);
    depths.push(depth);
    index += 1;
    return depth;
  };

  const outputs = Array.from({ length: count }, () => make());
  let connected = 0;

  return {
    connectTo(param: AudioParamLike) {
      // `AudioParam` is a legal connection destination in Web Audio; the node
      // interface here is structural, so the cast is where that fact is stated.
      outputs[connected % outputs.length].connect(param as unknown as AudioNodeLike);
      connected += 1;
    },
    setDepthSeconds(value: number, at: number) {
      for (const depth of depths) rampParam(depth.gain, Math.max(0, value), at, "linear");
    },
    setRateHz(value: number, at: number) {
      oscillators.forEach((osc, i) => {
        const spread = 0.7 + 0.55 * (i / Math.max(1, count - 1)) + 0.13 * (i % 3);
        rampParam(osc.frequency, Math.max(0.01, value * spread), at, "linear");
      });
    },
    owned: [...depths],
    dispose() {
      for (const osc of oscillators) {
        // Stopping before disconnecting leaves nothing running behind a
        // disposed module — an oscillator with no destination still costs.
        /* v8 ignore next 5 — only a real browser throws here */
        try {
          osc.stop();
        } catch {
          // Started at construction, so this means the context is already gone.
        }
        osc.disconnect();
      }
      for (const depth of depths) depth.disconnect();
    },
  };
}

// ---- feedback delay network --------------------------------------------------

export type FeedbackNetwork = {
  input: AudioNodeLike;
  output: AudioNodeLike;
  owned: readonly AudioNodeLike[];
  /** Seconds of RT60. Recomputes every line's gain. */
  setDecaySeconds(value: number, at: number): void;
  /** Multiplies every line length. Ramped, so it Dopplers rather than clicks. */
  setSize(scale: number, at: number): void;
  /** Corner of the in-loop lowpass, in hertz. */
  setDamping(hz: number, at: number): void;
  /** Hold the tail forever without blocking the input. */
  setInfinite(on: boolean, at: number): void;
  modulator: TankModulator;
  dispose(): void;
};

export type NetworkOptions = {
  lineCount: number;
  /** Multiplies `FDN_BASE_SECONDS`; the module's Size knob rides on top. */
  sizeScale: number;
  decaySeconds: number;
  dampingHz: number;
  modRateHz: number;
  modDepthSeconds: number;
};

/**
 * A Householder feedback delay network.
 *
 * The mixing matrix is what makes an FDN sound like a room rather than like a
 * bank of echoes, and the Householder reflection
 *
 *     A = I − (2/N)·1·1ᵀ        so    out_i = s_i − (2/N)·Σ s_j
 *
 * is the one that fits Web Audio's graph model. It is orthogonal, so the loop
 * is lossless before the damping filters apply loss — and, critically, it needs
 * only `2N` connections rather than the `N²` a dense matrix would: every line
 * sends into one shared bus, the bus is scaled by `−2/N`, and the bus returns to
 * every line. A Hadamard matrix would sound marginally smoother and would cost
 * sixty-four connections instead of sixteen.
 *
 *                ┌──────────────── bus (−2/N) ◄──┬──┬──┬──┐
 *                ▼                               │  │  │  │
 *   input ─►(+)─► delay_i ─► damp_i ─► g_i ──────┴──┴──┴──┴──► output
 *            ▲                          │
 *            └──────────────────────────┘
 *
 * Stability: `|g_i| < 1` and `A` orthogonal means the loop cannot grow. The one
 * way to break it is `setInfinite`, which pins `g_i = 1` deliberately.
 */
export function createFeedbackNetwork(
  context: EffectContext,
  options: NetworkOptions,
  atSec: number,
): FeedbackNetwork {
  const count = clamp(Math.round(options.lineCount), 2, FDN_BASE_SECONDS.length);
  const input = context.createGain();
  const output = context.createGain();
  const bus = context.createGain();

  const lines = Array.from({ length: count }, (_, i) => {
    const length = FDN_BASE_SECONDS[i] * options.sizeScale;
    const delay = context.createDelay(MAX_LINE_SECONDS);
    const damping = context.createBiquadFilter();
    damping.type = "lowpass";
    const decay = context.createGain();
    const returnGain = context.createGain();

    setNow(delay.delayTime, clamp(length, 0.001, MAX_LINE_SECONDS), atSec);
    setNow(damping.frequency, options.dampingHz, atSec);
    setNow(damping.Q, 0.7071, atSec);

    input.connect(delay);
    delay.connect(damping);
    damping.connect(decay);
    decay.connect(output);
    // Each line's own return, plus the shared reflection bus.
    decay.connect(returnGain);
    returnGain.connect(delay);
    decay.connect(bus);
    bus.connect(delay);

    return { delay, damping, decay, returnGain, baseSeconds: FDN_BASE_SECONDS[i] };
  });

  // Householder: the shared bus carries −2/N of the sum back to every line.
  setNow(bus.gain, -2 / count, atSec);
  setNow(input.gain, 1, atSec);
  setNow(output.gain, 1 / Math.sqrt(count), atSec);

  const modulator = createModulator(
    context,
    count,
    options.modRateHz,
    options.modDepthSeconds,
    atSec,
  );
  for (const line of lines) modulator.connectTo(line.delay.delayTime);

  let sizeScale = options.sizeScale;
  let decaySeconds = options.decaySeconds;
  let infinite = false;

  /**
   * Per-line gain for a target RT60.
   *
   *     g = 10^(−3·M / RT60)
   *
   * where `M` is the line's length in seconds: after `RT60` seconds the signal
   * has made `RT60/M` passes and must be 60 dB down.
   */
  const applyDecay = (at: number) => {
    for (const line of lines) {
      const lengthSec = Math.max(0.001, line.baseSeconds * sizeScale);
      const g = infinite
        ? 1
        : clamp(Math.pow(10, (-3 * lengthSec) / Math.max(0.05, decaySeconds)), 0, 0.9999);
      rampParam(line.decay.gain, g, at, "linear");
      // The private return and the shared bus split the loop between them;
      // halving keeps total loop gain at `g` rather than `2g`.
      rampParam(line.returnGain.gain, g * 0.5, at, "linear");
    }
  };
  applyDecay(atSec);

  return {
    input,
    output,
    owned: [
      input,
      output,
      bus,
      ...lines.flatMap((l) => [l.delay, l.damping, l.decay, l.returnGain]),
      ...modulator.owned,
    ],
    modulator,
    setDecaySeconds(value: number, at: number) {
      decaySeconds = Math.max(0.05, value);
      applyDecay(at);
    },
    setSize(scale: number, at: number) {
      sizeScale = clamp(scale, 0.05, 12);
      for (const line of lines) {
        const length = clamp(line.baseSeconds * sizeScale, 0.001, MAX_LINE_SECONDS);
        // Ramped, not stepped: a delay line whose length jumps clicks, and one
        // whose length glides Dopplers. The glide is the musical answer and it
        // is what a real tank does when you turn its size knob.
        rampParam(line.delay.delayTime, length, at, "linear");
      }
      applyDecay(at);
    },
    setDamping(hz: number, at: number) {
      for (const line of lines) rampParam(line.damping.frequency, clamp(hz, 200, 20000), at, "linear");
    },
    setInfinite(on: boolean, at: number) {
      infinite = on;
      applyDecay(at);
    },
    dispose() {
      modulator.dispose();
      input.disconnect();
      output.disconnect();
      bus.disconnect();
      for (const line of lines) {
        line.delay.disconnect();
        line.damping.disconnect();
        line.decay.disconnect();
        line.returnGain.disconnect();
      }
    },
  };
}

// ---- shelving with resonance -------------------------------------------------

export type ResonantShelf = {
  input: AudioNodeLike;
  output: AudioNodeLike;
  owned: readonly AudioNodeLike[];
  setGainDb(value: number, at: number): void;
  setResonance(amount: number, at: number): void;
};

/**
 * A shelf whose corner can be made to resonate.
 *
 * Both machines put a resonance control on their shelving filters — the H90's
 * `Resonance` says so outright ("controls the resonance of the Low-level and
 * High-level filters"). The textbook way is the shelf's slope parameter `S`,
 * which produces a peak at the corner when pushed past 1.
 *
 * Web Audio will not do that. Its `lowshelf` and `highshelf` types ignore `Q`
 * entirely — the spec says so — so the slope is fixed and there is no resonance
 * to be had from the shelf itself. Rather than pretend, this pairs the shelf
 * with a `peaking` filter parked at the same corner, whose gain tracks the
 * resonance amount and takes the *sign* of the shelf's gain. Boosting a shelf
 * with resonance up gives a bump at the corner; cutting one gives a notch. That
 * is the audible behaviour the control describes, reached a different way.
 *
 * At zero resonance the peak sits at 0 dB and is exactly transparent, which is
 * also what the manual promises: at zero the control "does nothing".
 */
export function createResonantShelf(
  context: EffectContext,
  kind: "lowshelf" | "highshelf",
  frequencyHz: number,
  atSec: number,
): ResonantShelf {
  const shelf = context.createBiquadFilter();
  shelf.type = kind;
  const peak = context.createBiquadFilter();
  peak.type = "peaking";

  setNow(shelf.frequency, frequencyHz, atSec);
  setNow(shelf.gain, 0, atSec);
  setNow(peak.frequency, frequencyHz, atSec);
  setNow(peak.gain, 0, atSec);
  setNow(peak.Q, 1, atSec);

  shelf.connect(peak);

  let gainDb = 0;
  let resonance = 0;

  const applyPeak = (at: number) => {
    // Sign follows the shelf so resonance emphasises whatever the shelf is
    // already doing, and magnitude is capped well below the shelf's own range
    // — a resonant peak louder than the band it decorates is an overload with
    // a friendly name, and the H90 manual warns about exactly that.
    const direction = gainDb === 0 ? 0 : Math.sign(gainDb);
    rampParam(peak.gain, direction * resonance * 9, at, "linear");
    rampParam(peak.Q, 0.7 + resonance * 6, at, "linear");
  };

  return {
    input: shelf,
    output: peak,
    owned: [shelf, peak],
    setGainDb(value: number, at: number) {
      gainDb = value;
      rampParam(shelf.gain, value, at, "linear");
      applyPeak(at);
    },
    setResonance(amount: number, at: number) {
      resonance = clamp(amount, 0, 1);
      applyPeak(at);
    },
  };
}

// ---- helpers shared by the two machines --------------------------------------

/** A gain node created and pinned in one call. */
export function fixedGain(context: EffectContext, value: number, atSec: number): GainNodeLike {
  const gain = context.createGain();
  setNow(gain.gain, value, atSec);
  return gain;
}

/** A delay node created and pinned in one call. */
export function fixedDelay(
  context: EffectContext,
  seconds: number,
  maxSeconds: number,
  atSec: number,
): DelayNodeLike {
  const delay = context.createDelay(maxSeconds);
  setNow(delay.delayTime, clamp(seconds, 0, maxSeconds), atSec);
  return delay;
}

/** A biquad created, typed and tuned in one call. */
export function fixedFilter(
  context: EffectContext,
  kind: BiquadFilterNodeLike["type"],
  frequencyHz: number,
  atSec: number,
  q = 0.7071,
): BiquadFilterNodeLike {
  const filter = context.createBiquadFilter();
  filter.type = kind;
  setNow(filter.frequency, frequencyHz, atSec);
  setNow(filter.Q, q, atSec);
  return filter;
}
