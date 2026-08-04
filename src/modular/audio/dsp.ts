// Signal material generated rather than loaded.
//
// Two of the ported effects need a buffer that is not a knob value: a reverb
// needs an impulse response, and a bit crusher needs a transfer curve. Both are
// generated here, as pure functions over plain typed arrays, for two reasons.
//
// **No asset pipeline.** A convolution reverb normally means shipping an
// impulse file, which means asset loading, which means a whole subsystem must
// exist before the first reverb can make a sound. A synthesised plate tail
// removes that dependency entirely — the module works on the day it is written.
//
// **Determinism.** The tail is noise, but it is not random: it comes from the
// project's counter-based hash, so the same seed always renders the same
// impulse. That matters more than it sounds. A reverb rebuild — which happens
// whenever the decay changes — would otherwise produce a subtly different tail
// each time, and a saved project would not reproduce the performance it saved.

import { randomUnit, streamKey } from "../runtime/rng";

/** Longest tail worth generating; beyond this the buffer costs more than it adds. */
export const MAX_TAIL_SECONDS = 8;

export type ImpulseOptions = {
  /** Length of the generated tail. */
  tailSeconds: number;
  /** Exponential decay rate; larger is shorter and tighter. */
  decayRate: number;
  /** Chooses the noise. Same seed, same tail, forever. */
  seed: number;
};

/**
 * Fill channel buffers with an exponentially decaying noise burst.
 *
 * The shape is the AV prototype's: white noise multiplied by `exp(-t · decay)`.
 * What is added here is that each channel draws from a different stream, so the
 * two sides decorrelate and the tail is genuinely stereo rather than a mono
 * signal arriving on two wires.
 */
export function renderPlateImpulse(
  channels: readonly Float32Array[],
  sampleRate: number,
  options: ImpulseOptions,
): void {
  const rate = Math.max(1, sampleRate);
  const decay = Math.max(0.01, options.decayRate);
  channels.forEach((channel, index) => {
    const key = streamKey(options.seed, `impulse-${index}`, "reverb");
    for (let i = 0; i < channel.length; i++) {
      const seconds = i / rate;
      // randomUnit is uniform on [0, 1); noise wants to straddle zero.
      const noise = randomUnit(key, i, 0) * 2 - 1;
      channel[i] = noise * Math.exp(-seconds * decay);
    }
  });
}

/** How many frames a tail of this length occupies, clamped to something sane. */
export const impulseFrameCount = (tailSeconds: number, sampleRate: number): number =>
  Math.max(1, Math.round(Math.min(MAX_TAIL_SECONDS, Math.max(0.05, tailSeconds)) * sampleRate));

/** Bit depths a crush curve is generated for. One bit is already extreme. */
export const MIN_CRUSH_BITS = 1;
export const MAX_CRUSH_BITS = 16;

/**
 * Resolution of the generated transfer curve.
 *
 * A WaveShaper interpolates linearly between curve points, so a staircase is
 * only a staircase if there are enough points to hold each tread flat. The AV
 * prototype used a fixed 44,100 for every depth, which is wasteful at 4 bits
 * and — more importantly — the wrong instinct: what the curve needs is samples
 * *per quantisation step*, not samples in total. Sixteen per tread renders the
 * step convincingly; the cap keeps a 16-bit setting from allocating a megabyte
 * to describe something almost indistinguishable from a straight line.
 */
const SAMPLES_PER_STEP = 16;
const MIN_CURVE_SAMPLES = 512;
const MAX_CURVE_SAMPLES = 1 << 16;

export const crushCurveLength = (bits: number): number => {
  const steps = Math.pow(2, clampBits(bits));
  return Math.min(MAX_CURVE_SAMPLES, Math.max(MIN_CURVE_SAMPLES, Math.round(steps * SAMPLES_PER_STEP)));
};

/**
 * A quantising transfer function for a WaveShaper.
 *
 * Input runs −1 to +1 across the curve; each output is that input snapped to
 * the nearest of `2^bits` levels. Rounding rather than truncating keeps the
 * curve symmetric about zero, so silence stays silent instead of acquiring a
 * DC offset of half a step.
 */
export function crushCurve(bits: number, length = crushCurveLength(bits)): Float32Array {
  const steps = Math.pow(2, clampBits(bits));
  const samples = Math.max(2, Math.round(length));
  const curve = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    const x = (i * 2) / (samples - 1) - 1;
    curve[i] = Math.max(-1, Math.min(1, Math.round(x * steps) / steps));
  }
  return curve;
}

function clampBits(bits: number): number {
  if (!Number.isFinite(bits)) return MAX_CRUSH_BITS;
  return Math.min(MAX_CRUSH_BITS, Math.max(MIN_CRUSH_BITS, Math.round(bits)));
}

/**
 * Harmonics in a generated pulse wave.
 *
 * Enough that the edge reads as an edge rather than as a rounded hump. The
 * series is truncated rather than band-limited per note, which is the same
 * trade the scale sequencer made: at 256 partials the aliasing above the
 * fundamental is inaudible for anything played as a musical pitch.
 */
export const PULSE_HARMONICS = 256;

/**
 * Duty cycles a pulse is allowed to take.
 *
 * Zero and one are both silence — a pulse that is never high, or never low —
 * so a knob sweeping the full range would pass through nothing at each end.
 */
export const MIN_PULSE_WIDTH = 0.1;
export const MAX_PULSE_WIDTH = 0.9;

/**
 * Fourier coefficients for a pulse of a given duty cycle.
 *
 * The reason this exists rather than `oscillator.type = "square"`: a square is
 * one pulse width out of all of them, and sweeping the width is what PWM *is*.
 * A rectangular wave of width `w` has harmonic amplitudes
 * `2/(nπ)·sin(nπw)`, which collapses to the familiar odd-harmonics-only square
 * at `w = 0.5` — the even terms vanish because `sin(nπ/2)` is zero for even
 * `n`. The DC term is the mean of the wave, `2w − 1`.
 *
 * All the energy is in the cosine terms, so the sine array is left at zero:
 * every note then starts at the same point in the cycle, which keeps repeated
 * notes sounding identical instead of phasing against each other.
 */
export function pulseWaveCoefficients(
  width: number,
  harmonics = PULSE_HARMONICS,
): { real: Float32Array; imag: Float32Array } {
  const w = clampPulseWidth(width);
  const count = Math.max(2, Math.round(harmonics));
  const real = new Float32Array(count);
  const imag = new Float32Array(count);
  real[0] = 2 * w - 1;
  for (let n = 1; n < count; n++) {
    real[n] = (2 / (n * Math.PI)) * Math.sin(n * Math.PI * w);
  }
  return { real, imag };
}

export function clampPulseWidth(width: number): number {
  if (!Number.isFinite(width)) return 0.5;
  return Math.min(MAX_PULSE_WIDTH, Math.max(MIN_PULSE_WIDTH, width));
}
