// The only sanctioned way to write an audio parameter.
//
// Assigning `param.value = x` is the single most common source of clicks in a
// Web Audio application: the change lands at an arbitrary point inside the next
// render quantum and steps the signal discontinuously. A fader drag becomes a
// staircase, and a staircase is audible as zipper noise.
//
// Every parameter in the registry already declares how it should move —
// `ParameterDescriptor.smoothing` — but until now nothing consumed that on the
// audio side. This module is where the declaration becomes behaviour, and
// `params.test.ts` fails the build if any file under `src/modular/audio/`
// writes a `.value` directly, so the rule cannot quietly erode.

import type { ParameterDescriptor } from "../model/graph";

export type SmoothingPolicy = ParameterDescriptor["smoothing"];

/** The slice of `AudioParam` used here, so tests need no Web Audio. */
export interface AudioParamLike {
  readonly value: number;
  setValueAtTime(value: number, startTime: number): void;
  linearRampToValueAtTime(value: number, endTime: number): void;
  exponentialRampToValueAtTime(value: number, endTime: number): void;
  setTargetAtTime(target: number, startTime: number, timeConstant: number): void;
  cancelScheduledValues(startTime: number): void;
}

/**
 * How long a smoothed change takes.
 *
 * Twenty milliseconds is the usual floor for "inaudible as a step" without
 * being sluggish under the hand; the exponential constant is shorter because
 * `setTargetAtTime` approaches asymptotically and reaches most of the distance
 * in about three time constants.
 */
export const SMOOTHING_SEC: Record<SmoothingPolicy, number> = {
  none: 0,
  linear: 0.02,
  exponential: 0.015,
};

export type RampOptions = {
  /** Overrides the policy's default duration. */
  durationSec?: number;
};

/**
 * Move a parameter to a value, in the manner its descriptor asks for.
 *
 * Every path first cancels pending automation and pins the current value at
 * `atSec`. Without that pin, a ramp scheduled while an earlier one is still
 * running interpolates from the *earlier* ramp's target rather than from where
 * the signal actually is, which is heard as a jump — the exact artefact the
 * smoothing exists to avoid.
 */
export function rampParam(
  param: AudioParamLike,
  value: number,
  atSec: number,
  smoothing: SmoothingPolicy,
  options: RampOptions = {},
): void {
  const target = Number.isFinite(value) ? value : 0;
  const start = Math.max(0, atSec);
  const duration = Math.max(0, options.durationSec ?? SMOOTHING_SEC[smoothing] ?? 0);

  param.cancelScheduledValues(start);
  param.setValueAtTime(param.value, start);

  if (smoothing === "none" || duration === 0) {
    param.setValueAtTime(target, start);
    return;
  }
  if (smoothing === "exponential") {
    // `setTargetAtTime`, not `exponentialRampToValueAtTime`: the ramp form
    // cannot reach or cross zero, and gain targets are zero all the time.
    param.setTargetAtTime(target, start, duration);
    return;
  }
  param.linearRampToValueAtTime(target, start + duration);
}

/**
 * A click-free fade to an explicit level over an explicit window.
 *
 * Used by the crossfade protocol, where the duration comes from the transition
 * rather than from a parameter's own policy.
 */
export function fadeParam(
  param: AudioParamLike,
  value: number,
  fromSec: number,
  durationSec: number,
): void {
  rampParam(param, value, fromSec, "linear", { durationSec: Math.max(0, durationSec) });
}

/**
 * Cancel automation and hold whatever the value is now.
 *
 * The panic and stall paths need a parameter to stop moving without jumping;
 * cancelling alone would let a scheduled ramp's final value snap in.
 */
export function holdParam(param: AudioParamLike, atSec: number): void {
  const start = Math.max(0, atSec);
  param.cancelScheduledValues(start);
  param.setValueAtTime(param.value, start);
}
