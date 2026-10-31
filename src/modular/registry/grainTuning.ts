// The Grain Engine's tuning, as `prism_grain::tuning` has it: Pitch snapped to
// a scale's nearest degree, in true cents, or with no scale to a grid. The
// engine snaps what it is sent (`GrainEngineModule::transposed`); the face
// snaps the knob the same way, so what it shows is what plays, as
// MultiGrainLive's server snaps the pitch before its slider is redrawn.
//
// The arithmetic is the crate's, in single precision step for step, and
// `grainTuning.test.ts` holds it to the crate's own answers.

import { GRAIN_SCALES, type GrainScale } from "./grainTuning.generated";

export { GRAIN_SCALES, type GrainScale };

const f = Math.fround;

/** `f32::round`: halves away from zero. */
const roundAway = (x: number) => Math.sign(x) * Math.floor(Math.abs(x) + 0.5);

export const scaleByName = (name: string): GrainScale | undefined => GRAIN_SCALES.find((s) => s.name === name);

/** `Scale::nearest`: the degree nearest `cents`, either way, across repeats. */
function nearest(scale: GrainScale, cents: number): number {
  if (scale.cents.length === 0) return cents;
  const span = Math.max(f(scale.span), 1);
  const octave = Math.floor(f(cents / span));
  let best = Infinity;
  let at = cents;
  for (const rep of [octave, f(octave + 1)]) {
    for (const d of scale.cents) {
      const candidate = f(f(rep * span) + f(d));
      const far = Math.abs(f(candidate - cents));
      if (far < best) {
        best = far;
        at = candidate;
      }
    }
  }
  return at;
}

/** `tuning::quantise`: a shift in semitones snapped to `scale`, else to `step`, else left. */
export function quantise(semitones: number, scale: string | null, step: number): number {
  const s = f(semitones);
  const found = scale ? scaleByName(scale) : undefined;
  if (found) return f(nearest(found, f(s * 100)) / 100);
  return step > 0 ? f(roundAway(f(s / f(step))) * f(step)) : s;
}

/** The scale a `scale` value names, or null for none ("free"). */
export const scaleOf = (value: unknown): string | null =>
  typeof value === "string" && value !== "free" && scaleByName(value) ? value : null;

/**
 * MultiGrainLive's `scaleLabel`: semitones, with the cents beside them while
 * the pitch moves finer than a grid.
 */
export function pitchText(v: number, scale: string | null, step: number): string {
  const sign = v >= 0 ? "+" : "";
  if (!scale && step > 0) return `${sign}${v.toFixed(1)} st`;
  return `${sign}${v.toFixed(2)} st · ${sign}${Math.round(v * 100)}¢`;
}

/** What the tuning button says: the scale, or the grid, or "free" (`scaleButton`). */
export const tuningName = (scale: string | null, step: number): string => scale ?? (step > 0 ? `${step} st grid` : "free");

/**
 * MultiGrainLive's `scaleDegrees`: the chosen scale's degrees in cents and the
 * span they repeat at; with none, the grid, or plain semitones.
 */
export function scaleDegrees(scale: string | null, step: number): { cents: number[]; span: number } {
  const found = scale ? scaleByName(scale) : undefined;
  if (found) return { cents: [...found.cents], span: found.span || 1200 };
  const grid = step > 0 ? step : 1;
  const n = Math.max(1, Math.round(12 / grid));
  return { cents: Array.from({ length: n }, (_, i) => i * grid * 100), span: 1200 };
}
