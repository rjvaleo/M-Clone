// Blackhole — the H90's reverb on a galactic scale.
//
// Eventide's manual describes it in one sentence worth taking literally: "its
// soft attack and lingering, harmonic tail". Everything below serves those two
// properties. The soft attack comes from a deep input diffuser, so no transient
// arrives at the tank intact; the lingering tail comes from a sixteen-second
// decay ceiling and a feedback path wrapped around the whole structure.
//
// The documented parameter set is reproduced exactly — Mix, Gravity, Size,
// Pre Delay, Low Level, High Level, Mod Depth, Mod Rate, Feedback, Resonance —
// with the ranges the manual publishes: pre-delay to 2000 ms, shelves at 350 Hz
// and 2000 Hz, Feedback carrying Infinite and Freeze past its top.
//
//   in ─► preDelay ─► diffuser ─►(+)─► FDN[8] ─► lowShelf ─► highShelf ─┬─► out
//                                 ▲                                      │
//                                 └───────────── feedback ◄──────────────┘
//
// **What this build does not do.** Gravity is documented as bipolar: to the
// right it sweeps forward decay, to the left it enters "inverse mode" and
// sweeps "reverse reverb-like settings". A true reverse envelope needs the
// tank's output gated against an onset detector, and a Web Audio graph made of
// native nodes has no way to detect an onset — there is no envelope follower
// short of an AudioWorklet. So the left half is approximated: diffusion drops
// away and the pre-tank delay stretches, which pushes early energy later and
// gives a swelling, discrete build-up. It is a real and useful sound and it is
// not a reverse reverb. `docs/` records the gap rather than the module
// pretending otherwise.

import type { AudioNodeSpec } from "./audioPlan";
import type { AudioNodeLike } from "./graphAdapter";
import type { AudioParamLike } from "./params";
import { rampParam } from "./params";
import type { EffectContext } from "./nodes";
import {
  clamp,
  createDiffuserChain,
  createFeedbackNetwork,
  createResonantShelf,
  fixedGain,
  numberOr,
  setNow,
} from "./reverbTank";

/** `[DOC]` The manual's two published corner frequencies. */
export const BLACKHOLE_LOW_HZ = 350;
export const BLACKHOLE_HIGH_HZ = 2000;

/** `[DOC]` "this ranges from 0 ms to 2000 ms". */
export const BLACKHOLE_MAX_PREDELAY_SEC = 2;

/**
 * Where Feedback stops being a number.
 *
 * `[DOC]` "Turning clockwise to Infinite will allow for infinite reverberation
 * time, while still letting incoming signal into the reverberation structure.
 * Turning further clockwise to Freeze sets the reverberation time to infinite,
 * and does not allow incoming signal."
 *
 * Two discrete states at the top of a continuous control. The knob runs 0–1;
 * the top 8% is divided between them, which is enough travel to land on
 * deliberately and little enough to sweep past.
 */
export const BLACKHOLE_INFINITE_AT = 0.92;
export const BLACKHOLE_FREEZE_AT = 0.96;

export type BlackholeMode = "normal" | "infinite" | "freeze";

export const blackholeMode = (feedback: number): BlackholeMode => {
  if (feedback >= BLACKHOLE_FREEZE_AT) return "freeze";
  if (feedback >= BLACKHOLE_INFINITE_AT) return "infinite";
  return "normal";
};

/**
 * Gravity, resolved.
 *
 * `[DOC]` "On the right-hand side, the Gravity control sweeps through its
 * forward reverb range from a very dense decay to a very long and smooth
 * decay." Note the direction of travel: density *falls* as decay *rises*, which
 * is why `diffusion` decreases across the positive half rather than increasing.
 */
export type GravitySettings = {
  decaySeconds: number;
  diffusion: number;
  /** Multiplies the pre-tank delay; > 1 pushes early energy later. */
  preTankStretch: number;
};

export function resolveGravity(gravity: number): GravitySettings {
  const g = clamp(gravity, -1, 1);
  if (g >= 0) {
    return {
      decaySeconds: 0.8 * Math.pow(16 / 0.8, g),
      diffusion: 0.75 - 0.2 * g,
      preTankStretch: 1,
    };
  }
  const a = -g;
  return {
    // Inverse mode is not a long reverb; the swell is the effect and a long
    // tail behind it would bury it.
    decaySeconds: 0.8 * Math.pow(6 / 0.8, a),
    diffusion: 0.75 - 0.55 * a,
    preTankStretch: 1 + 2.5 * a,
  };
}

/** `[DOC]` "cartoonishly small to cosmically epic" — a wide, tapered sweep. */
export const blackholeSizeScale = (size: number): number =>
  0.08 + (8 - 0.08) * Math.pow(clamp(size, 0, 1), 2);

/**
 * Global feedback, de-rated against decay.
 *
 * `[DOC]` "Controls the feedback around the entire reverberation structure."
 * That is a second loop wrapped around a structure that already has one, and
 * the two multiply. At long decay the tank's own transfer already approaches
 * unity, so a feedback value that is safe at 1 s is a runaway at 16 s. De-rating
 * against the normalised decay keeps the knob usable across its whole range
 * instead of having a cliff two-thirds of the way up.
 */
export function blackholeFeedbackGain(feedback: number, decaySeconds: number): number {
  const mode = blackholeMode(feedback);
  // Infinity comes from the tank, never from the outer loop — pinning the loop
  // at unity as well would be an oscillator.
  if (mode !== "normal") return 0;
  const raw = clamp(feedback / BLACKHOLE_INFINITE_AT, 0, 1);
  const normalisedDecay = clamp(decaySeconds / 16, 0, 1);
  return clamp(raw * (1 - 0.35 * normalisedDecay), 0, 0.92);
}

export type BlackholeCore = {
  input: AudioNodeLike;
  output: AudioNodeLike;
  params: Record<string, AudioParamLike>;
  owned: readonly AudioNodeLike[];
  setParameter(id: string, value: number, at: number): void;
  dispose(): void;
};

export function createBlackholeCore(
  context: EffectContext,
  spec: AudioNodeSpec,
  atSec: number,
): BlackholeCore {
  const lineCount = clamp(Math.round(numberOr(spec.structure["line-count"], 8)), 4, 8);

  const input = fixedGain(context, 1, atSec);
  const preDelay = context.createDelay(BLACKHOLE_MAX_PREDELAY_SEC);
  setNow(preDelay.delayTime, 0, atSec);

  // Four stages, longest first. Deep enough that a struck transient never
  // reaches the tank as a transient — the "soft attack" the manual promises.
  const diffuser = createDiffuserChain(
    context,
    [0.0207, 0.0127, 0.0083, 0.0047],
    0.7,
    atSec,
  );

  const tankInput = fixedGain(context, 1, atSec);
  const network = createFeedbackNetwork(
    context,
    {
      lineCount,
      sizeScale: blackholeSizeScale(0.5),
      decaySeconds: resolveGravity(0.5).decaySeconds,
      dampingHz: 12000,
      modRateHz: 0.6,
      modDepthSeconds: 0.0006,
    },
    atSec,
  );

  const lowShelf = createResonantShelf(context, "lowshelf", BLACKHOLE_LOW_HZ, atSec);
  const highShelf = createResonantShelf(context, "highshelf", BLACKHOLE_HIGH_HZ, atSec);
  const feedback = fixedGain(context, 0, atSec);
  const output = fixedGain(context, 1, atSec);

  input.connect(preDelay);
  preDelay.connect(diffuser.input);
  diffuser.output.connect(tankInput);
  tankInput.connect(network.input);
  network.output.connect(lowShelf.input);
  lowShelf.output.connect(highShelf.input);
  highShelf.output.connect(output);
  // The outer loop is tapped after the shelves, so it carries the tone the user
  // hears rather than the raw tank — turning the highs down thins the
  // regeneration too, which is what makes the control musical.
  highShelf.output.connect(feedback);
  feedback.connect(tankInput);

  // Live state, kept because several controls are cross-coupled: Gravity moves
  // decay *and* diffusion *and* the feedback de-rating, and Feedback's mode
  // decides whether the tank is infinite.
  let gravity = 0.5;
  let feedbackValue = 0;
  let resonance = 0;
  let lowLevel = 0;
  let highLevel = 0;
  let preDelaySeconds = 0;

  const applyGravity = (at: number) => {
    const settings = resolveGravity(gravity);
    network.setDecaySeconds(settings.decaySeconds, at);
    diffuser.setCoefficient(settings.diffusion, at);
    rampParam(
      preDelay.delayTime,
      clamp(preDelaySeconds * settings.preTankStretch, 0, BLACKHOLE_MAX_PREDELAY_SEC),
      at,
      "linear",
    );
    rampParam(feedback.gain, blackholeFeedbackGain(feedbackValue, settings.decaySeconds), at, "linear");
  };

  const applyFeedback = (at: number) => {
    const mode = blackholeMode(feedbackValue);
    network.setInfinite(mode !== "normal", at);
    // `[DOC]` Freeze "does not allow incoming signal into the reverberation
    // structure" — the input gate closes, and only there. Infinite keeps it open.
    rampParam(tankInput.gain, mode === "freeze" ? 0 : 1, at, "linear");
    rampParam(
      feedback.gain,
      blackholeFeedbackGain(feedbackValue, resolveGravity(gravity).decaySeconds),
      at,
      "linear",
    );
  };

  const setParameter = (id: string, value: number, at: number): void => {
    switch (id) {
      case "gravity":
        gravity = clamp(value, -1, 1);
        applyGravity(at);
        return;
      case "size":
        network.setSize(blackholeSizeScale(value), at);
        return;
      case "pre-delay-seconds":
        preDelaySeconds = clamp(value, 0, BLACKHOLE_MAX_PREDELAY_SEC);
        applyGravity(at);
        return;
      case "low-level-db":
        lowLevel = value;
        lowShelf.setGainDb(value, at);
        return;
      case "high-level-db":
        highLevel = value;
        highShelf.setGainDb(value, at);
        return;
      case "mod-depth":
        // Seconds of excursion. A thousandth of a second is plenty: more reads
        // as pitch wobble rather than as the mode-breaking the control is for.
        network.modulator.setDepthSeconds(clamp(value, 0, 1) * 0.0015, at);
        return;
      case "mod-rate":
        network.modulator.setRateHz(0.05 + clamp(value, 0, 1) * 3.5, at);
        return;
      case "feedback":
        feedbackValue = clamp(value, 0, 1);
        applyFeedback(at);
        return;
      case "resonance":
        resonance = clamp(value, 0, 1);
        lowShelf.setResonance(resonance, at);
        highShelf.setResonance(resonance, at);
        // `[DOC]` "When the filters are set to 0, this does nothing" — which
        // falls out of the shelf sign being zero, so nothing special is needed
        // here beyond re-applying the levels the peaks take their sign from.
        lowShelf.setGainDb(lowLevel, at);
        highShelf.setGainDb(highLevel, at);
        return;
      default:
        return;
    }
  };

  applyGravity(atSec);
  applyFeedback(atSec);

  return {
    input,
    output,
    params: {},
    owned: [
      input,
      preDelay,
      tankInput,
      feedback,
      output,
      ...diffuser.owned,
      ...network.owned,
      ...lowShelf.owned,
      ...highShelf.owned,
    ],
    setParameter,
    dispose() {
      network.dispose();
    },
  };
}
