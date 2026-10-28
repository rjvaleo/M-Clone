// The master output chain: everything the graph makes passes through here.
//
// The limiter is not a mixing decision, it is a safety device. A modular patch
// can be wired into a runaway — a feedback path, a hundred voices landing on
// one tick, a gain typed as 100 instead of 1.0 — and the difference between an
// unpleasant moment and damaged hearing or speakers is whether something
// bounded sits at the end. So it is always on and cannot be patched around.
//
// Its coefficients come from the AV prototype's limiter, which had them right:
// threshold just below full scale, hard knee, high ratio, and an attack fast
// enough to catch a transient rather than let the first millisecond through.

import { rampParam } from "./params";
import type { AudioNodeLike } from "./graphAdapter";
import type { CompressorNodeLike, GainNodeLike } from "./nodes";

/** Brick-wall settings. Not exposed as user controls — this is not an effect. */
export const LIMITER_SETTINGS = {
  thresholdDb: -0.1,
  kneeDb: 0,
  ratio: 20,
  attackSec: 0.001,
  releaseSec: 0.1,
} as const;

// Re-exported because the master chain was where these were first needed; they
// now live in `nodes.ts` so the effect rack shares one vocabulary with them.
export type { CompressorNodeLike, GainNodeLike } from "./nodes";

/** The slice of `AudioContext` the master chain needs. */
export interface MasterChainContext {
  readonly currentTime: number;
  readonly destination: AudioNodeLike;
  createGain(): GainNodeLike;
  createDynamicsCompressor(): CompressorNodeLike;
}

/**
 * Master gain into a limiter into the destination.
 *
 * The gain sits *before* the limiter so turning down reduces what the limiter
 * has to catch, rather than turning down the already-limited result.
 */
export class MasterChain {
  private readonly context: MasterChainContext;
  private readonly gain: GainNodeLike;
  private readonly limiter: CompressorNodeLike;
  private disposed = false;

  constructor(context: MasterChainContext, initialVolume = 0.8) {
    this.context = context;
    this.gain = context.createGain();
    this.limiter = context.createDynamicsCompressor();

    const now = context.currentTime;
    // Even these one-time settings go through the scheduled writer: the ban on
    // direct `.value` assignment has no exceptions, because "just this once"
    // is how it comes back.
    rampParam(this.gain.gain, initialVolume, now, "none");
    rampParam(this.limiter.threshold, LIMITER_SETTINGS.thresholdDb, now, "none");
    rampParam(this.limiter.knee, LIMITER_SETTINGS.kneeDb, now, "none");
    rampParam(this.limiter.ratio, LIMITER_SETTINGS.ratio, now, "none");
    rampParam(this.limiter.attack, LIMITER_SETTINGS.attackSec, now, "none");
    rampParam(this.limiter.release, LIMITER_SETTINGS.releaseSec, now, "none");

    this.gain.connect(this.limiter);
    this.limiter.connect(context.destination);
  }

  /** Where every module's output goes. */
  get input(): AudioNodeLike {
    return this.gain;
  }

  /** How hard the limiter is working, in decibels, for a meter. */
  get reductionDb(): number {
    return this.limiter.reduction ?? 0;
  }

  /** Master volume, always ramped — a fader drag must not be a staircase. */
  setVolume(value: number, atSec: number = this.context.currentTime): void {
    rampParam(this.gain.gain, Math.max(0, value), atSec, "linear");
  }

  /** Fall silent without a step, for panic and for stalls. */
  mute(atSec: number = this.context.currentTime, fadeSec = 0.01): void {
    rampParam(this.gain.gain, 0, atSec, "linear", { durationSec: fadeSec });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.gain.disconnect();
    this.limiter.disconnect();
  }
}
