/**
 * The scale sequencer's synth, as numbers.
 *
 * Every law here is read from `scale-sequencer/app.js` and kept literally —
 * constants, clamps and quirks included — because the point of carrying them
 * over is that the original's sound can be had exactly. Both of idMLab's
 * backends use these: the Web Audio synth calls them directly, and the Rust
 * `Synth` restates them in `dsp-core` with tests that pin the same numbers.
 *
 * Nothing here builds a node. Each function is the arithmetic one line of the
 * original performs, so it can be checked without making a sound.
 */

/** The note key follow measures against: middle C, `KEY_FOLLOW_REF_MIDI`. */
export const KEY_FOLLOW_REFERENCE_MIDI = 60;

export const MIN_CUTOFF_HZ = 20;
export const MAX_CUTOFF_HZ = 20000;

/**
 * How far a full filter envelope reaches, as a multiple of the base cutoff.
 *
 * `baseCutoff * (2^4 - 1)`: at +100 % the peak is four octaves up. The sweep
 * is linear in hertz, so −100 % does not mirror it — it subtracts fifteen
 * times the base and lands on the 20 Hz floor.
 */
export const FILTER_ENV_SPAN = 2 ** 4 - 1;

/** A pulse LFO swings the width by this much at full depth. */
export const PW_LFO_SWING = 0.45;
/** Where a modulated pulse width is held — wider than the knob's own range. */
export const MIN_MODULATED_PW = 0.05;
export const MAX_MODULATED_PW = 0.95;

const clamp = (value: number, low: number, high: number): number =>
  Math.max(low, Math.min(high, value));

/** An oscillator stops this long after its release ends: the original's `osc.stop(… + r + 0.05)`. */
export const NOTE_TAIL_SEC = 0.05;

/** One automation call, as `playNote` makes it. */
export type EnvelopeEvent = { kind: "set" | "linear"; value: number; time: number };

/**
 * An envelope as a note starts it: `from` at the note, a ramp to `peak` over
 * the attack and to `sustain` over the decay, and the sustain holds. Nothing
 * is written for the release here: the synth has no gate, so a note releases
 * only at its note-off (`releaseEvents`), whatever sent it.
 */
export function envelopeEvents(
  atSec: number,
  from: number,
  peak: number,
  sustain: number,
  times: { attack: number; decay: number },
): EnvelopeEvent[] {
  const attack = Math.max(0, times.attack);
  const decay = Math.max(0, times.decay);
  return [
    { kind: "set", value: from, time: atSec },
    { kind: "linear", value: peak, time: atSec + attack },
    { kind: "linear", value: sustain, time: atSec + attack + decay },
  ];
}

/** The release written at a note-off: the sustain, then a ramp to `to`. */
export const releaseEvents = (atSec: number, sustain: number, to: number, releaseSec: number): EnvelopeEvent[] => [
  { kind: "set", value: sustain, time: atSec },
  { kind: "linear", value: to, time: atSec + Math.max(0, releaseSec) },
];

/**
 * The cutoff a note starts from: the knob, moved by key follow.
 *
 * `pitch` is fractional — the original measures the note from its frequency
 * (`69 + 12·log2(f/440)`), so a microtonal degree follows by its true pitch.
 * Clamped above only, exactly as the original's `Math.min(20000, …)`.
 */
export function keyFollowedCutoff(cutoffHz: number, pitch: number, keyFollow: number): number {
  const semitones = (pitch - KEY_FOLLOW_REFERENCE_MIDI) * clamp(keyFollow, 0, 1);
  return Math.min(MAX_CUTOFF_HZ, cutoffHz * Math.pow(2, semitones / 12));
}

/** The three points a filter envelope moves between, in hertz. */
export type FilterSweep = { base: number; peak: number; sustain: number };

/**
 * Where a note's filter envelope goes.
 *
 * `amount` is the original's −1…+1 (its −100…+100 % slider), linear in hertz:
 * `peak = base + amount · base · 15`, the sustain the same scaled by the
 * sustain level, each clamped to 20 Hz–20 kHz. `octaves` is idMLab's own
 * exponential amount, kept so the superset still opens its existing patches;
 * at zero octaves the sweep is the original's exactly.
 */
export function filterSweep(
  base: number,
  octaves: number,
  amount: number,
  sustainLevel: number,
): FilterSweep {
  const oct = clamp(octaves, -8, 8);
  const amt = clamp(amount, -1, 1);
  const s = clamp(sustainLevel, 0, 1);
  const reach = amt * FILTER_ENV_SPAN * base;
  return {
    base,
    peak: clamp(base * Math.pow(2, oct) + reach, MIN_CUTOFF_HZ, MAX_CUTOFF_HZ),
    sustain: clamp(base * Math.pow(2, oct * s) + reach * s, MIN_CUTOFF_HZ, MAX_CUTOFF_HZ),
  };
}

/** What the original's LFOs can be pointed at, in its menu's order. */
export const LFO_TARGETS = ["none", "filter", "resonance", "volume", "pw", "delay-wet"] as const;
export type LfoTarget = (typeof LFO_TARGETS)[number];

/** Its three waves. The order is the wire value Rust reads. */
export const LFO_WAVES = ["sine", "triangle", "sawtooth"] as const;
export type LfoWave = (typeof LFO_WAVES)[number];

export const MIN_LFO_RATE_HZ = 0.05;
export const MAX_LFO_RATE_HZ = 20;

/**
 * What an LFO's depth is scaled against.
 *
 * `cutoffHz` is the knob now: `updateFilter` rescales a filter LFO whenever
 * the cutoff moves. `volume` and `delayWet` are the levels *as of the last
 * time that LFO's own controls moved* — `updateVol` and `updateDelay` never
 * touch an LFO's gain, so a volume LFO keeps the swing it was given until
 * its rate, depth, wave or target is next touched.
 */
export type LfoScales = { cutoffHz: number; volume: number; delayWet: number };

/**
 * The gain between an LFO and its target — `getLFOGainValue`.
 *
 * Filter: hertz, as a fraction of the knob's cutoff (not the key-followed
 * one). Resonance: ten units of Q. Volume and delay wet: a fraction of their
 * own level, so the swing is `level · (1 ± depth)`. A pulse-width LFO has no
 * gain at all — it is sampled per note instead (`pulseWidthSwing`).
 */
export function lfoTargetGain(target: LfoTarget, depth: number, scales: LfoScales): number {
  switch (target) {
    case "filter":
      return depth * scales.cutoffHz;
    case "resonance":
      return depth * 10;
    case "volume":
      return depth * scales.volume;
    case "delay-wet":
      return depth * scales.delayWet;
    default:
      return 0;
  }
}

/** Where a note sits on the step grid: when it starts and its step's length. */
export type PulseStep = { onsetSec: number; stepSec?: number };

const known = (seconds: number | undefined): seconds is number =>
  seconds !== undefined && Number.isFinite(seconds) && seconds > 0;

/**
 * How far a pulse LFO moves before a note — in seconds of its rate.
 *
 * The original advances it by `rate · stepDur` at every step, rests included,
 * before the step plays. So from one note to the next it moves through the
 * steps after the earlier note's, and this note's own:
 * `(onset − previous onset) − previous step + this step`. A run's first note
 * moves it by its own step. Without step lengths (notes played live) it moves
 * by the time between notes, and not at all for the first.
 */
export function pulseAdvanceSec(previous: PulseStep | null, current: PulseStep): number {
  if (!known(current.stepSec)) return previous ? current.onsetSec - previous.onsetSec : 0;
  if (!previous) return current.stepSec;
  if (!known(previous.stepSec)) return current.onsetSec - previous.onsetSec;
  return current.onsetSec - previous.onsetSec - previous.stepSec + current.stepSec;
}

/**
 * The pulse-width offset a note is built with.
 *
 * The original advances each pulse LFO's phase once per step and adds
 * `sin(phase) · depth · 0.45` — a sine whatever the LFO's wave, read when the
 * note starts and held for its life. `phases` are radians.
 */
export function pulseWidthSwing(lfos: readonly { phase: number; depth: number }[]): number {
  let swing = 0;
  for (const lfo of lfos) swing += Math.sin(lfo.phase) * lfo.depth * PW_LFO_SWING;
  return swing;
}

export const modulatedPulseWidth = (width: number, swing: number): number =>
  clamp(width + swing, MIN_MODULATED_PW, MAX_MODULATED_PW);

/**
 * The delay's note values, in beats, as the original's menu has them.
 *
 * Literal, but for "1/4T": the original played 1.33333 beats under it, a
 * half-note triplet's length. RJ had it made a true quarter-note triplet
 * (31 Oct 2026), so it moved into length order between 1/8 and D 1/8.
 */
export const DELAY_NOTES = [
  { label: "1/32", beats: 0.125 },
  { label: "1/16", beats: 0.25 },
  { label: "1/8T", beats: 0.33333 },
  { label: "1/8", beats: 0.5 },
  { label: "1/4T", beats: 0.66667 },
  { label: "D 1/8", beats: 0.75 },
  { label: "1/4", beats: 1 },
  { label: "D 1/4", beats: 1.5 },
  { label: "1/2", beats: 2 },
  { label: "D 1/2", beats: 3 },
  { label: "1 bar", beats: 4 },
] as const;

/** The tape machine's six speeds, in inches per second. */
export const TAPE_SPEEDS = [
  { label: "30 IPS", key: "studio30", ips: 30 },
  { label: "15 IPS", key: "studio15", ips: 15 },
  { label: "7.5 IPS", key: "studio75", ips: 7.5 },
  { label: "3.75 IPS", key: "studio375", ips: 3.75 },
  { label: "1⅞ IPS", key: "cassette", ips: 1.875 },
  { label: "15/16 IPS", key: "micro", ips: 0.9375 },
] as const;

/** Capstan acceleration, in/s². */
export const TAPE_ACCEL = 12;
/** Head gap, sized so the nominal speed is half a second of delay. */
export const TAPE_HEADGAP_S = 0.5;
export const MAX_DELAY_S = 4;
export const MIN_DELAY_S = 0.005;
/** A tempo change waits this long before the tape follows: `BPM_SLEW_DELAY_S`. */
export const TEMPO_GLIDE_DELAY_S = 0.12;
/** The delay's feedback hi-cut is a lowpass at this Q (Web Audio's, in dB). */
export const DELAY_HICUT_Q = 0.5;

/** The synced delay time: `(60 / bpm) · beats`, held to the line's range. */
export const delaySeconds = (bpm: number, beats: number): number =>
  Math.min(MAX_DELAY_S, Math.max(MIN_DELAY_S, (60 / bpm) * beats));

/** One varispeed move of the tape, as the original records it. */
export type TapeGlide = {
  v0: number;
  v1: number;
  /** Head gap, in inches. */
  L: number;
  start: number;
  T: number;
  dEnd: number;
};

/**
 * Plan the glide from `dNow` to `dTarget` — `tapeGlideDelayTime`.
 *
 * Delay is head gap over tape speed, and the capstan changes speed at a
 * fixed acceleration, so the glide takes `|Δv| / 12` seconds (0.02–10), and
 * never less than keeps the read behind the write (`|Δd| / 0.85`). `null`
 * when the target is within half a millisecond, which the original ignores.
 */
export function planTapeGlide(
  nowSec: number,
  startDelaySec: number,
  dNow: number,
  dTarget: number,
  ips: number,
): TapeGlide | null {
  if (Math.abs(dTarget - dNow) < 0.0005) return null;
  const L = ips * TAPE_HEADGAP_S;
  const v0 = L / dNow;
  const v1 = L / dTarget;
  let T = Math.min(10, Math.max(0.02, Math.abs(v1 - v0) / TAPE_ACCEL));
  T = Math.max(T, Math.abs(dTarget - dNow) / 0.85);
  return { v0, v1, L, start: nowSec + startDelaySec, T, dEnd: dTarget };
}

/** Where a glide has the delay at `t`, analytically — `tapeGlideValueAt`. */
export function tapeGlideValueAt(glide: TapeGlide, t: number): number {
  if (t >= glide.start + glide.T) return glide.dEnd;
  if (t <= glide.start) return glide.L / glide.v0;
  const f = (t - glide.start) / glide.T;
  return glide.L / (glide.v0 + (glide.v1 - glide.v0) * f);
}

/** How many points the original's curve has: one per half millisecond. */
export const tapeCurveLength = (glide: TapeGlide): number =>
  Math.min(48000, Math.max(16, Math.ceil(glide.T * 2000)));

/** The curve handed to `setValueCurveAtTime`: `L / v` with `v` ramping linearly. */
export function tapeGlideCurve(glide: TapeGlide): Float32Array {
  const n = tapeCurveLength(glide);
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) curve[i] = glide.L / (glide.v0 + ((glide.v1 - glide.v0) * i) / (n - 1));
  return curve;
}

/**
 * What the delay line actually reads at `t`: the curve, interpolated linearly
 * between its points as `setValueCurveAtTime` does, held at `holdValue` before
 * the glide starts and at the last point after it ends. The Rust delay
 * evaluates the same thing per sample; this is its reference.
 */
export function tapeCurveValueAt(glide: TapeGlide, t: number, holdValue: number): number {
  if (t < glide.start) return holdValue;
  const n = tapeCurveLength(glide);
  const point = (i: number) => glide.L / (glide.v0 + ((glide.v1 - glide.v0) * i) / (n - 1));
  if (t >= glide.start + glide.T) return point(n - 1);
  const position = ((t - glide.start) / glide.T) * (n - 1);
  const k = Math.floor(position);
  return point(k) + (point(k + 1) - point(k)) * (position - k);
}
