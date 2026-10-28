/**
 * The browser's own maths, restated.
 *
 * On the Web Audio backend the browser *is* these laws: an `OscillatorNode`
 * reads band-limited tables, a `BiquadFilterNode` computes the spec's lowpass,
 * and an `AudioParam` evaluates its automation timeline. The Rust engine has
 * no browser, so `rust/dsp-core/src/webaudio.rs` carries the same maths out by
 * hand — and this file is the reference it is held to. Each function is the
 * Web Audio spec's formula, evaluated the way Chromium evaluates it
 * (`periodic_wave_handler.cc`, `oscillator_handler.cc`, `biquad.cc`,
 * `audio_param_handler.cc`), single-precision steps marked with `f32`.
 *
 * Nothing here runs on the Web Audio path. It is computed directly — a table
 * is its partial sum, not a transform — so that when the Rust tables, built
 * with an inverse FFT, give the numbers the tests pin here, both are the
 * spec's numbers.
 */

/** `Math.fround`: the single-precision rounding Chromium's `float`s get. */
const f32 = Math.fround;
const F32_PI = f32(Math.PI);
/** The smallest normal `float`. */
const F32_MIN = 1.1754943508222875e-38;

/** The render quantum Web Audio processes in. */
export const RENDER_QUANTUM = 128;

/** Three tables per octave of partials. */
export const BANDS_PER_OCTAVE = 3;
const CENTS_PER_RANGE = 1200 / BANDS_PER_OCTAVE;

/** Below this many table entries per sample, interpolation stops being linear… */
export const INTERPOLATE_2_POINT = f32(0.3);
/** …and below this, it is five-point rather than three. */
export const INTERPOLATE_3_POINT = f32(0.16);

/** A table's length at a sample rate: 2048 to 24 kHz, 4096 to 88.2 kHz, then 16384. */
export function periodicWaveSize(sampleRate: number): number {
  if (sampleRate <= 24000) return 2048;
  if (sampleRate <= 88200) return 4096;
  return 16384;
}

/** How many tables a wave has. */
export const numberOfRanges = (size: number): number => Math.round(BANDS_PER_OCTAVE * Math.log2(size));

/** The partials range `range` keeps: `N/2 · 2^(−range/3)`, truncated. */
export function partialsForRange(range: number, size: number): number {
  const centsToCull = f32(range * CENTS_PER_RANGE);
  const cullingScale = f32(Math.pow(2, f32(-centsToCull / 1200)));
  return Math.trunc(f32(cullingScale * (size / 2)));
}

/** The tables a frequency reads and the blend between them. */
export type TableChoice = { higher: number; lower: number; factor: number };

/** `WaveDataForFundamentalFrequency`: `1 + 3·log2(f / f_low)`, clamped. */
export function selectTables(frequency: number, sampleRate: number, size: number): TableChoice {
  const ranges = numberOfRanges(size);
  const lowest = f32(f32(sampleRate) / size);
  const f = Math.abs(f32(frequency));
  const ratio = f > 0 ? f32(f / lowest) : 0.5;
  const cents = f32(f32(Math.log2(ratio)) * 1200);
  const pitchRange = Math.min(ranges - 1, Math.max(0, f32(1 + f32(cents / CENTS_PER_RANGE))));
  const higher = Math.trunc(pitchRange);
  return { higher, lower: higher < ranges - 1 ? higher + 1 : higher, factor: f32(pitchRange - higher) };
}

/** The browser's built-in waves. */
export type BasicShape = "sine" | "square" | "sawtooth" | "triangle";

/** A built-in wave's sine coefficient `bₙ`, in single precision as Chromium has it. */
export function basicCoefficient(shape: BasicShape, n: number): number {
  const piFactor = f32(2 / f32(n * F32_PI));
  const odd = (n & 1) === 1;
  switch (shape) {
    case "sine":
      return n === 1 ? 1 : 0;
    case "square":
      return odd ? f32(2 * piFactor) : 0;
    case "sawtooth":
      return odd ? piFactor : -piFactor;
    case "triangle":
      return odd ? f32(f32(2 * f32(piFactor * piFactor)) * ((((n - 1) >> 1) & 1) === 1 ? -1 : 1)) : 0;
  }
}

/** A built-in wave's coefficients, as `GenerateBasicWaveform` hands them on. */
export function basicCoefficients(shape: BasicShape, size: number): { real: Float32Array; imag: Float32Array } {
  const half = size / 2;
  const real = new Float32Array(half);
  const imag = new Float32Array(half);
  for (let n = 1; n < half; n++) imag[n] = basicCoefficient(shape, n);
  return { real, imag };
}

/** The partial sum `2·Σ (aₙ·cos + bₙ·sin)` at every entry, for `1 ≤ n < end`. */
function partialSum(real: Float32Array, imag: Float32Array, end: number, size: number): Float32Array {
  const out = new Float32Array(size);
  for (let k = 0; k < size; k++) {
    let sum = 0;
    for (let n = 1; n < end; n++) {
      const phase = (2 * Math.PI * ((n * k) % size)) / size;
      sum += real[n] * Math.cos(phase) + imag[n] * Math.sin(phase);
    }
    out[k] = 2 * sum;
  }
  return out;
}

/**
 * One band-limited table, normalised — what `CreateBandLimitedTables` makes
 * for `range`, from the coefficients a `createPeriodicWave` was given. The
 * normalisation is one over the fullest table's peak, the same for every
 * range; `scale` is returned so a caller can check it.
 */
export function periodicWaveTable(
  real: Float32Array,
  imag: Float32Array,
  range: number,
  sampleRate: number,
): { table: Float32Array; scale: number } {
  const size = periodicWaveSize(sampleRate);
  const components = Math.min(real.length, imag.length, size / 2);
  const endFor = (r: number) => Math.min(components, partialsForRange(r, size) + 1);
  const full = partialSum(real, imag, endFor(0), size);
  let peak = 0;
  for (const value of full) peak = Math.max(peak, Math.abs(value));
  const scale = peak !== 0 ? f32(1 / peak) : 0.5;
  const raw = range === 0 ? full : partialSum(real, imag, endFor(range), size);
  return { table: raw.map((value) => f32(value * scale)), scale };
}

/** An `AudioParam` frequency: ± Nyquist, NaN to Nyquist. */
export function clampFrequency(frequency: number, sampleRate: number): number {
  const nyquist = f32(sampleRate / 2);
  if (Number.isNaN(frequency)) return nyquist;
  return Math.min(nyquist, Math.max(-nyquist, f32(frequency)));
}

/**
 * An `OscillatorNode` at a constant frequency, as the k-rate path renders
 * it: two tables chosen by pitch, linear interpolation in single precision
 * when the read moves at least 0.3 of an entry a sample, otherwise 3- or
 * 5-point Lagrange in double; the read position kept in double.
 */
export function renderOscillator(
  tables: (range: number) => Float32Array,
  frequency: number,
  sampleRate: number,
  frames: number,
): Float32Array {
  const size = periodicWaveSize(sampleRate);
  const mask = size - 1;
  const f = clampFrequency(frequency, sampleRate);
  const { higher: hi, lower: lo, factor } = selectTables(f, sampleRate, size);
  const higher = tables(hi);
  const lower = tables(lo);
  const incr = f32(f * f32(size / f32(sampleRate)));
  const out = new Float32Array(frames);
  let index = 0;
  for (let i = 0; i < frames; i++) {
    const read0 = Math.trunc(index);
    if (Math.abs(incr) >= INTERPOLATE_2_POINT) {
      const t = f32(f32(index) - read0);
      const i0 = read0 & mask;
      const i1 = (i0 + 1) & mask;
      const sHi = f32(higher[i0] + f32(t * f32(higher[i1] - higher[i0])));
      const sLo = f32(lower[i0] + f32(t * f32(lower[i1] - lower[i0])));
      out[i] = f32(sHi + f32(factor * f32(sLo - sHi)));
    } else {
      const t = index - read0;
      const t2 = t * t;
      const weights = Math.abs(incr) >= INTERPOLATE_3_POINT
        ? [0.5 * t * (t - 1), 1 - t2, 0.5 * t * (t + 1)]
        : [
          (t * (t2 - 1) * (t - 2)) / 24,
          (-t * (t - 1) * (t2 - 4)) / 6,
          ((t2 - 1) * (t2 - 4)) / 4,
          (-t * (t + 1) * (t2 - 4)) / 6,
          (t * (t2 - 1) * (t + 2)) / 24,
        ];
      const offset = (weights.length - 1) / 2;
      let sLo = 0;
      let sHi = 0;
      weights.forEach((weight, k) => {
        const at = (read0 + k - offset) & mask;
        sLo += weight * lower[at];
        sHi += weight * higher[at];
      });
      out[i] = f32((1 - factor) * sHi + factor * sLo);
    }
    index += incr;
    index -= Math.floor(index / size) * size;
  }
  return out;
}

/** `setTargetAtTime`'s step per sample, `1 − e^(−1/(fs·τ))`. */
export const discreteTimeConstant = (timeConstant: number, sampleRate: number): number =>
  f32(1 - Math.exp(-1 / (sampleRate * timeConstant)));

/** `setTarget` is done after ten time constants, or within this ratio. */
export const TIME_CONSTANTS_TO_CONVERGE = 10;
export const SET_TARGET_THRESHOLD = f32(4.539992976248485e-5);

/** `HasSetTargetConverged`. */
export function setTargetConverged(value: number, target: number, now: number, start: number, timeConstant: number): boolean {
  if (now > start + TIME_CONSTANTS_TO_CONVERGE * timeConstant) return true;
  if (target === 0) return Math.abs(value) < SET_TARGET_THRESHOLD;
  return Math.abs(target - value) < SET_TARGET_THRESHOLD * Math.abs(value);
}

/**
 * The frames of `cancelAndHoldAtTime(t)` + `setTargetAtTime(target, t, τ)`
 * from `from`, the move landing on frame `startFrame`: that frame holds,
 * each after steps by the discrete time constant, and from the first render
 * quantum the curve has converged on, it is the target.
 */
export function renderSetTarget(
  from: number,
  target: number,
  timeConstant: number,
  sampleRate: number,
  startFrame: number,
  frames: number,
): Float32Array {
  const dtc = discreteTimeConstant(timeConstant, sampleRate);
  const out = new Float32Array(frames);
  let value = f32(from);
  let converged = false;
  const start = startFrame / sampleRate;
  for (let frame = startFrame; frame < startFrame + frames; frame++) {
    if (frame > startFrame && !converged) value = f32(value + f32(f32(target - value) * dtc));
    if (!converged && (frame === startFrame || frame % RENDER_QUANTUM === 0)) {
      converged = setTargetConverged(value, target, frame / sampleRate, start, timeConstant);
    }
    out[frame - startFrame] = converged ? target : value;
  }
  return out;
}

/** A lowpass's coefficients, normalised by `a0`: the spec's, Q in decibels. */
export function lowpassCoefficients(
  frequency: number,
  qDb: number,
  sampleRate: number,
): { b0: number; b1: number; b2: number; a1: number; a2: number } {
  const nyquist = 0.5 * sampleRate;
  const held = Number.isNaN(frequency) ? 0 : Math.min(f32(nyquist), Math.max(0, f32(frequency)));
  const cutoff = Math.min(1, Math.max(0, held / nyquist));
  if (cutoff === 1) return { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 };
  if (cutoff <= 0) return { b0: 0, b1: 0, b2: 0, a1: 0, a2: 0 };
  const resonance = Math.pow(10, (Number.isFinite(qDb) ? f32(qDb) : 0) / 20);
  const theta = Math.PI * cutoff;
  const alpha = Math.sin(theta) / (2 * resonance);
  const cosw = Math.cos(theta);
  const beta = (1 - cosw) / 2;
  const inverse = 1 / (1 + alpha);
  return { b0: beta * inverse, b1: 2 * beta * inverse, b2: beta * inverse, a1: -2 * cosw * inverse, a2: (1 - alpha) * inverse };
}

/** One automation call, as a timeline holds it. */
export type TimelineEvent =
  | { kind: "set"; value: number; time: number }
  | { kind: "linear"; value: number; time: number };

/**
 * Put events in a timeline's order: by time, each after any already at its
 * time — `InsertEvent`'s rule — then drop what a `cancelScheduledValues`
 * at `cancels` removed when it was called. Calls are in the order made.
 */
export function orderTimeline(
  calls: readonly (TimelineEvent | { kind: "cancel"; time: number })[],
): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  for (const call of calls) {
    if (call.kind === "cancel") {
      const keep = events.filter((event) => event.time < call.time);
      events.length = 0;
      events.push(...keep);
      continue;
    }
    const at = events.findIndex((event) => event.time > call.time);
    if (at < 0) events.push(call);
    else events.splice(at, 0, call);
  }
  return events;
}

/**
 * A timeline's value at frame `frame`: the last event at or before it, run
 * on to the next if that one is a linear ramp, in Chromium's precision.
 * `initial` before the first event.
 */
export function timelineValueAt(events: readonly TimelineEvent[], frame: number, sampleRate: number, initial = 0): number {
  let current = -1;
  for (let i = 0; i < events.length; i++) {
    if (frame >= events[i].time * sampleRate) current = i;
    else break;
  }
  if (current < 0) return f32(initial);
  const event = events[current];
  const next = events[current + 1];
  const value1 = f32(event.value);
  if (next?.kind !== "linear") return value1;
  const delta = next.time - event.time;
  const k = delta <= F32_MIN ? 0 : f32(1 / delta);
  const x = f32((frame / sampleRate - event.time) * k);
  return f32(value1 + f32(x * f32(f32(next.value) - value1)));
}
