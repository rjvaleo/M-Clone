// What the panels draw besides their controls, computed from the effects' own
// maths so a picture never disagrees with the sound.
//
// - The compressor's curve is the kernel's static curve, knee and all
//   (prism-fx effects/compressor.rs `curve`).
// - The filter bank's response is its biquads exactly as `Musical::update`
//   builds them, each blended by its amplitude, then its damping one-pole
//   (effects/mgl_dattorro_filter_bank.rs).
// - The plate's decay is its tank's loop gain over its loop length
//   (effects/mgl_dattorro_plate.rs): an envelope, not a measured impulse.

// ---- the compressor ----------------------------------------------------------

export type CompressorCurve = { thresholdDb: number; ratio: number; kneeDb: number };

/** Level out for level in, both in dB. */
export function compressorCurve(levelDb: number, { thresholdDb, ratio, kneeDb }: CompressorCurve): number {
  const r = Math.max(1, ratio);
  const knee = Math.max(0, kneeDb);
  const over = levelDb - thresholdDb;
  if (knee > 0 && over > -knee / 2 && over < knee / 2) {
    const x = over + knee / 2;
    return levelDb + ((1 / r - 1) * x * x) / (2 * knee);
  }
  if (over <= 0) return levelDb;
  return thresholdDb + over / r;
}

// ---- the filter bank ---------------------------------------------------------

type Complex = { re: number; im: number };
const mul = (a: Complex, b: Complex): Complex => ({ re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re });
const div = (a: Complex, b: Complex): Complex => {
  const d = b.re * b.re + b.im * b.im;
  return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d };
};
/** b0 + b1 z⁻¹ + b2 z⁻² at z = e^{jw}. */
const poly = (c0: number, c1: number, c2: number, w: number): Complex => ({
  re: c0 + c1 * Math.cos(w) + c2 * Math.cos(2 * w),
  im: -c1 * Math.sin(w) - c2 * Math.sin(2 * w),
});

type Mode = "notch" | "resonator" | "regalia";

/** One `Musical` stage, blended: x + (H·x − x)·mix. */
function stage(mode: Mode, centre: number, q: number, mix: number, gainDb: number, w: number, fs: number): Complex {
  const f = Math.min(Math.max(centre, 1), fs * 0.49);
  const bandwidth = Math.max(centre / q, 0.1);
  const quality = Math.max(f / bandwidth, 0.025);
  const omega = (2 * Math.PI * f) / fs;
  const s = Math.sin(omega);
  const c = Math.cos(omega);
  const alpha = s / (2 * quality);
  let b: [number, number, number];
  let a: [number, number, number];
  if (mode === "notch") {
    b = [1, -2 * c, 1];
    a = [1 + alpha, -2 * c, 1 - alpha];
  } else if (mode === "resonator") {
    b = [alpha, 0, -alpha];
    a = [1 + alpha, -2 * c, 1 - alpha];
  } else {
    const k = Math.pow(10, gainDb / 40);
    b = [1 + alpha * k, -2 * c, 1 - alpha * k];
    a = [1 + alpha / k, -2 * c, 1 - alpha / k];
  }
  const h = div(poly(b[0], b[1], b[2], w), poly(a[0], a[1], a[2], w));
  return { re: 1 + (h.re - 1) * mix, im: h.im * mix };
}

export type FilterBank = Record<
  `${"notch" | "resonator" | "regalia" | "damping"}${"On" | "Hz" | "Q" | "Amp"}`,
  number
>;

/** The bank's gain at a frequency, in dB, at sample rate `fs`. */
export function filterBankResponse(hz: number, p: FilterBank, fs: number): number {
  const w = (2 * Math.PI * hz) / fs;
  let h: Complex = { re: 1, im: 0 };
  const on = (v: number) => v >= 0.5;
  if (on(p.notchOn)) h = mul(h, stage("notch", p.notchHz, p.notchQ, p.notchAmp, 0, w, fs));
  if (on(p.resonatorOn)) h = mul(h, stage("resonator", p.resonatorHz, p.resonatorQ, p.resonatorAmp, 0, w, fs));
  if (on(p.regaliaOn)) h = mul(h, stage("regalia", p.regaliaHz, p.regaliaQ, p.regaliaAmp, 12 * p.regaliaAmp, w, fs));
  if (on(p.dampingOn)) {
    const cutoff = Math.min(Math.max(p.dampingHz * Math.sqrt(p.dampingQ / 0.7), 20), 20000);
    const a = 1 - Math.exp((-2 * Math.PI * cutoff) / fs);
    // z += a(x − z): H = a / (1 − (1 − a) z⁻¹), blended wet and dry.
    const lp = div({ re: a, im: 0 }, { re: 1 - (1 - a) * Math.cos(w), im: (1 - a) * Math.sin(w) });
    h = mul(h, { re: (1 - p.dampingAmp) + lp.re * p.dampingAmp, im: lp.im * p.dampingAmp });
  }
  return 20 * Math.log10(Math.max(Math.hypot(h.re, h.im), 1e-12));
}

// ---- the plate ---------------------------------------------------------------

/** One half of the figure-eight: its four lines at Dattorro's 29 761 Hz. */
const HALF_LOOP_SEC = (672 + 4453 + 1800 + 3720) / 29761;
/** The frequency the "high" envelope is drawn at. */
export const PLATE_HIGH_HZ = 4000;

export type PlateEnvelope = {
  /** Level at a time after the strike, low frequencies. */
  low: (t: number) => number;
  /** The same at `PLATE_HIGH_HZ`, where the damping takes more each half. */
  high: (t: number) => number;
  /** Seconds from the strike to 60 dB down, low frequencies. */
  rt60: number;
};

export function plateEnvelope({ decay, damping, predelayMs }: { decay: number; damping: number; predelayMs: number }): PlateEnvelope {
  const pre = Math.max(0, predelayMs) / 1000;
  // Each half multiplies by decay twice; the damping one-pole adds its gain.
  const lowGain = decay * decay;
  const pole = 1 - damping;
  const w = (2 * Math.PI * PLATE_HIGH_HZ) / 29761;
  const hf = pole / Math.hypot(1 - (1 - pole) * Math.cos(w), (1 - pole) * Math.sin(w));
  const highGain = lowGain * hf;
  const at = (gain: number) => (t: number) => (t < pre ? 0 : Math.pow(gain, (t - pre) / HALF_LOOP_SEC));
  const rt60 = lowGain <= 0 ? 0 : pre + (HALF_LOOP_SEC * -3) / Math.log10(lowGain);
  return { low: at(lowGain), high: at(highGain), rt60 };
}

// ---- the grain engine --------------------------------------------------------

/**
 * Where grains are read from, as fractions of the sample: the position, and
 * the spray either side of it (prism-grain offsets each grain by the spray
 * times a bipolar random).
 */
export function grainWindow({ position, sprayMs }: { position: number; sprayMs: number }, sampleSec: number) {
  const at = Math.min(1, Math.max(0, position));
  if (sampleSec <= 0) return { at, from: at, to: at };
  const reach = sprayMs / 1000 / sampleSec;
  return { at, from: Math.max(0, at - reach), to: Math.min(1, at + reach) };
}
