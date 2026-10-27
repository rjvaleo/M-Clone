// The maths behind the ported effects' displays, each worked from the kernel
// it draws (prism-fx crates/prism-fx/src/effects/). Where a display shows a
// response, it is the kernel's own filter at the kernel's own coefficients;
// where it shows a level, a time or a path, it is what the kernel's state
// settles at or walks through for the input named. Nothing here is measured
// from sound; a display that could not be worked out exactly is not drawn.

// ---- complex arithmetic ------------------------------------------------------

type Complex = { re: number; im: number };
const cx = (re: number, im = 0): Complex => ({ re, im });
const add = (a: Complex, b: Complex): Complex => cx(a.re + b.re, a.im + b.im);
const sub = (a: Complex, b: Complex): Complex => cx(a.re - b.re, a.im - b.im);
const times = (a: Complex, k: number): Complex => cx(a.re * k, a.im * k);
const mul = (a: Complex, b: Complex): Complex => cx(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
const div = (a: Complex, b: Complex): Complex => {
  const d = b.re * b.re + b.im * b.im;
  return cx((a.re * b.re + a.im * b.im) / d, (a.im * b.re - a.re * b.im) / d);
};
/** z⁻ᵏ at z = e^{jw}. */
const zk = (w: number, k = 1): Complex => cx(Math.cos(k * w), -Math.sin(k * w));
/** c₀ + c₁z⁻¹ + c₂z⁻². */
const poly = (c0: number, c1: number, c2: number, w: number): Complex => add(add(cx(c0), times(zk(w), c1)), times(zk(w, 2), c2));
const biquad = (b: readonly number[], a: readonly number[], w: number) => div(poly(b[0], b[1], b[2], w), poly(a[0], a[1], a[2], w));
const magnitude = (h: Complex) => Math.hypot(h.re, h.im);
/** Gain in dB, with silence at −240 rather than −∞. */
const db = (h: Complex) => 20 * Math.log10(Math.max(magnitude(h), 1e-12));
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
const omega = (hz: number, fs: number) => (2 * Math.PI * hz) / fs;

/**
 * A two-state filter run a sample at a time: s' = A·s + B·x, y = C·s + D·x.
 * Its response is C (zI − A)⁻¹ B + D.
 */
type StateSpace = { a: [[number, number], [number, number]]; b: [number, number]; c: [number, number]; d: number };

function stateSpace({ a, b, c, d }: StateSpace, w: number): Complex {
  const z = cx(Math.cos(w), Math.sin(w));
  const m00 = sub(z, cx(a[0][0]));
  const m11 = sub(z, cx(a[1][1]));
  const det = sub(mul(m00, m11), cx(a[0][1] * a[1][0]));
  // (zI − A)⁻¹ b, by the adjugate.
  const s0 = div(add(times(m11, b[0]), cx(a[0][1] * b[1])), det);
  const s1 = div(add(cx(a[1][0] * b[0]), times(m00, b[1])), det);
  return add(add(times(s0, c[0]), times(s1, c[1])), cx(d));
}

type Matrix2 = [[number, number], [number, number]];
const matmul = (p: Matrix2, q: Matrix2): Matrix2 => [
  [p[0][0] * q[0][0] + p[0][1] * q[1][0], p[0][0] * q[0][1] + p[0][1] * q[1][1]],
  [p[1][0] * q[0][0] + p[1][1] * q[1][0], p[1][0] * q[0][1] + p[1][1] * q[1][1]],
];
const matvec = (p: Matrix2, v: [number, number]): [number, number] => [p[0][0] * v[0] + p[0][1] * v[1], p[1][0] * v[0] + p[1][1] * v[1]];
const dot = (r: [number, number], v: [number, number]) => r[0] * v[0] + r[1] * v[1];

// ---- filters -----------------------------------------------------------------

export type MusicalMode = "notch" | "resonator" | "regalia";
export type Musical = { frequency: number; bandwidth: number; gainDb: number; mix: number };

/** `Musical::update` and `run` (mgl_dattorro_common.rs): the biquad, blended by the mix. */
export function musicalResponse(mode: MusicalMode, p: Musical, hz: number, fs: number): number {
  const f = clamp(p.frequency, 1, fs * 0.49);
  const q = Math.max(f / Math.max(p.bandwidth, 0.1), 0.025);
  const w0 = omega(f, fs);
  const alpha = Math.sin(w0) / (2 * q);
  const c = Math.cos(w0);
  const a = Math.pow(10, p.gainDb / 40);
  const [b, den] = mode === "notch" ? [[1, -2 * c, 1], [1 + alpha, -2 * c, 1 - alpha]]
    : mode === "resonator" ? [[alpha, 0, -alpha], [1 + alpha, -2 * c, 1 - alpha]]
      : [[1 + alpha * a, -2 * c, 1 - alpha * a], [1 + alpha / a, -2 * c, 1 - alpha / a]];
  const h = biquad(b, den, omega(hz, fs));
  return db(add(cx(1), times(sub(h, cx(1)), p.mix)));
}

/** The one-pole z += a(x − z), a = 1 − e^(−2π·fc/fs), out dry·x + wet·z (mgl_damping_filter.rs). */
export function dampingResponse(p: { cutoffHz: number; wet: number; dry: number }, hz: number, fs: number): number {
  const a = 1 - Math.exp((-2 * Math.PI * p.cutoffHz) / fs);
  const lp = div(cx(a), sub(cx(1), times(zk(omega(hz, fs)), 1 - a)));
  return db(add(cx(p.dry), times(lp, p.wet)));
}

/** The DC filter (dc.rs): the signal less its one-pole low pass, k = min(2π·f/rate, 0.5). */
export function dcResponse(cutHz: number, hz: number, fs: number): number {
  const k = Math.min((2 * Math.PI * clamp(cutHz, 1, 60)) / fs, 0.5);
  return db(sub(cx(1), div(cx(k), sub(cx(1), times(zk(omega(hz, fs)), 1 - k)))));
}

const CHAMBERLIN = ["low", "band", "high", "notch"] as const;
export type Chamberlin = Record<`${(typeof CHAMBERLIN)[number]}${"On" | "Freq" | "Q" | "Amp"}` | "drive", number>;

/**
 * The Chamberlin filter's small-signal response (mgl_chamberlin.rs): its
 * drive and output `tanh` are straight lines near zero, so a quiet signal
 * sees the drive times the four state-variable filters' sum. Each filter runs
 * twice a sample on the held input; its state is low and band.
 */
export function chamberlinResponse(p: Chamberlin, hz: number, fs: number): number {
  const w = omega(hz, fs);
  let sum = cx(0);
  CHAMBERLIN.forEach((name, mode) => {
    const amp = p[`${name}Amp`];
    if (p[`${name}On`] < 0.5 || amp <= 0.0001) return;
    const f = Math.min(2 * Math.sin((Math.PI * Math.min(p[`${name}Freq`], fs * 0.45)) / (2 * fs)), 0.99);
    const resonance = clamp((p[`${name}Q`] - 0.2) / 9.8, 0, 1);
    const d = Math.min(2 * Math.max(1 - resonance, 0.02), 2 / f - f * 0.5);
    // One pass: low += f·band; hi = x − low − d·band; band += f·hi.
    const m: Matrix2 = [[1, f], [-f, 1 - f * f - f * d]];
    const n: [number, number] = [0, f];
    const a = matmul(m, m);
    const mn = matvec(m, n);
    const b: [number, number] = [mn[0] + n[0], mn[1] + n[1]];
    // The second pass's high output, from the state after the first pass.
    const hiRow: [number, number] = [-1, -(f + d)];
    const hiC: [number, number] = [dot(hiRow, [m[0][0], m[1][0]]), dot(hiRow, [m[0][1], m[1][1]])];
    const hiD = 1 + dot(hiRow, n);
    const out = mode === 0 ? { c: a[0], d: b[0] }
      : mode === 1 ? { c: a[1], d: b[1] }
        : mode === 2 ? { c: hiC, d: hiD }
          : { c: [hiC[0] + a[0][0], hiC[1] + a[0][1]] as [number, number], d: hiD + b[0] };
    sum = add(sum, times(stateSpace({ a, b, c: out.c, d: out.d }, w), amp));
  });
  return db(times(sum, p.drive));
}

// The rack EQ (eq.rs): eight RBJ biquads, the end nodes at Q 0.707 and 0 dB.
const EQ_BANDS = 8;
const END_Q = 0.707;

function eqCoeffs(mode: number, freq: number, q: number, gainDb: number, fs: number): [number[], number[]] {
  const f = clamp(freq, 1, fs * 0.49);
  const a = Math.pow(10, gainDb / 40);
  const w0 = omega(f, fs);
  const alpha = Math.sin(w0) / (2 * Math.max(q, 0.05));
  const c = Math.cos(w0);
  const sq = 2 * Math.sqrt(a) * alpha;
  switch (mode) {
    case 0: return [[(1 + c) / 2, -(1 + c), (1 + c) / 2], [1 + alpha, -2 * c, 1 - alpha]];
    case 1: return [
      [a * ((a + 1) - (a - 1) * c + sq), 2 * a * ((a - 1) - (a + 1) * c), a * ((a + 1) - (a - 1) * c - sq)],
      [(a + 1) + (a - 1) * c + sq, -2 * ((a - 1) + (a + 1) * c), (a + 1) + (a - 1) * c - sq]];
    case 2:
    case 3: return [[1 + alpha * a, -2 * c, 1 - alpha * a], [1 + alpha / a, -2 * c, 1 - alpha / a]];
    case 4: return [
      [a * ((a + 1) + (a - 1) * c + sq), -2 * a * ((a - 1) + (a + 1) * c), a * ((a + 1) + (a - 1) * c - sq)],
      [(a + 1) - (a - 1) * c + sq, 2 * ((a - 1) - (a + 1) * c), (a + 1) - (a - 1) * c - sq]];
    default: return [[(1 - c) / 2, 1 - c, (1 - c) / 2], [1 + alpha, -2 * c, 1 - alpha]];
  }
}

/** A node's settings as `Eq::node` reads them. */
export function eqNode(v: Record<string, number>, band: number) {
  const end = band === 0 || band === EQ_BANDS - 1;
  return {
    freq: v[`band.${band}.freq`],
    q: end ? END_Q : v[`band.${band}.q`],
    gainDb: end ? 0 : v[`band.${band}.gainDb`],
    on: v[`band.${band}.enabled`] >= 0.5,
    mode: Math.trunc(v[`band.${band}.mode`]),
  };
}

/** The EQ's gain at a frequency, as `Eq::rebuild` builds it and `tick` runs it. */
export function eqResponse(v: Record<string, number>, hz: number, fs: number): number {
  const w = omega(hz, fs);
  let flat = true;
  let h = cx(1);
  for (let band = 0; band < EQ_BANDS; band++) {
    const { freq, q, gainDb, on, mode } = eqNode(v, band);
    flat &&= !on || (mode === 0 ? freq <= 20 : mode === 5 ? freq >= 20000 : Math.abs(gainDb) < 1e-6);
    if (!on || (band === 0 && freq <= 20)) continue;
    const [b, a] = eqCoeffs(mode, band === 0 ? Math.max(freq, 20) : freq, q, gainDb, fs);
    h = mul(h, biquad(b, a, w));
  }
  return flat ? 0 : db(h);
}

export type Phaser = { notches: number; centreHz: number; spread: number; resonance: number; depth: number; sweep: number; feedback: number; wet: number; dry: number };

/**
 * The phaser (phaser.rs) with its LFO held at `lfo` (−1…1): the all-pass
 * sections in series, the last output fed back a sample later, summed with
 * the input by the depth.
 */
export function phaserResponse(v: Phaser, hz: number, fs: number, lfo: number): number {
  const w = omega(hz, fs);
  const count = clamp(Math.round(v.notches), 1, 8);
  const shift = Math.pow(2, lfo * v.sweep * 0.5);
  const r = clamp(v.resonance, 0, 0.9995);
  let chain = cx(1);
  for (let i = 0; i < count; i++) {
    const at = clamp(v.centreHz * Math.pow(v.spread, i) * shift, 20, fs * 0.49);
    const theta = clamp(omega(at, fs), 1e-4, Math.PI - 1e-4);
    const a1 = -2 * r * Math.cos(theta);
    const a2 = r * r;
    chain = mul(chain, biquad([a2, a1, 1], [1, a1, a2], w));
  }
  const s = div(chain, sub(cx(1), times(mul(chain, zk(w)), v.feedback)));
  return db(add(cx(v.dry + v.wet), times(s, v.wet * v.depth)));
}

/** Where the Rappify band can sit: two octaves either way of its centre at full amount. */
export function rappifyRange(p: { amount: number; hz: number }, fs = 48000) {
  const a = clamp(p.amount, 0, 1);
  return { low: clamp(p.hz * Math.pow(2, -2 * a), 20, fs * 0.45), high: clamp(p.hz * Math.pow(2, 2 * a), 20, fs * 0.45) };
}

/**
 * Rappify's filter (rappify.rs) with its envelope held at `open` (0 closed,
 * 1 fully open): the state-variable band pass at that centre, boosted by
 * 1 + 2·amount and blended with the dry by the amount.
 */
export function rappifyResponse(p: { amount: number; hz: number }, open: number, hz: number, fs: number): number {
  const amount = clamp(p.amount, 0, 1);
  if (amount <= 1e-6) return 0;
  const q = 0.05 + (1 - amount) * 0.9;
  const centre = clamp(p.hz * Math.pow(2, (open * 2 - 1) * 2 * amount), 20, fs * 0.45);
  const g = clamp(Math.tan((Math.PI * centre) / fs), 1e-4, 1);
  const den = 1 + g * q * 2 + g * g;
  // State [lp, bp]; the band read after its update.
  const bpRow: [number, number] = [-g / den, 1 - (2 * q * g) / den];
  const k = amount * (1 + amount * 2);
  return db(stateSpace({
    a: [[1 - (g * g) / den, g * bpRow[1]], bpRow],
    b: [(g * g) / den, g / den],
    c: [k * bpRow[0], k * bpRow[1]],
    d: 1 - amount + (k * g) / den,
  }, omega(hz, fs)));
}

// ---- stereo ------------------------------------------------------------------

/** What each side becomes: out L = m[0][0]·L + m[0][1]·R, out R = m[1][0]·L + m[1][1]·R. */
export type Matrix = Matrix2;

const widthMatrix = (w: number): Matrix => [[(1 + w) / 2, (1 - w) / 2], [(1 - w) / 2, (1 + w) / 2]];

/**
 * The matrix each stereo effect applies (invert.rs, swap.rs, width.rs,
 * utility.rs, stereo_matrix.rs). The Stereo Matrix's is with its side passed
 * whole, as it is wherever the low cut is off and above it.
 */
export function matrixFor(kind: "invert" | "swap" | "width" | "utility" | "matrix", v: Record<string, number>): Matrix {
  switch (kind) {
    case "invert": return [[-1, 0], [0, -1]];
    case "swap": return [[0, 1], [1, 0]];
    case "width": return widthMatrix(clamp(v.width, 0, 2));
    case "utility": {
      const g = Math.pow(10, v.gainDb / 20) * (v.invert >= 0.5 ? -1 : 1);
      const swap: Matrix = v.swap >= 0.5 ? [[0, g], [g, 0]] : [[g, 0], [0, g]];
      return matmul(widthMatrix(v.width), swap);
    }
    default: {
      const [s, c] = [Math.sin((v.rotate * Math.PI) / 180), Math.cos((v.rotate * Math.PI) / 180)];
      const g = Math.pow(10, v.gainDb / 20);
      const [pl, pr] = [Math.min(1 - v.pan, 1) * g, Math.min(1 + v.pan, 1) * g];
      // Mid and side of each input, scaled, then rotated.
      const mid: [number, number] = [v.midGain / 2, v.midGain / 2];
      const side: [number, number] = [v.sideGain / 2, -v.sideGain / 2];
      const m2 = [mid[0] * c - side[0] * s, mid[1] * c - side[1] * s];
      const s2 = [mid[0] * s + side[0] * c, mid[1] * s + side[1] * c];
      return [[(m2[0] + s2[0]) * pl, (m2[1] + s2[1]) * pl], [(m2[0] - s2[0]) * pr, (m2[1] - s2[1]) * pr]];
    }
  }
}

/** The Stereo Matrix's low cut on the side: an RBJ high pass at Q 1/√2, off at 20 Hz. */
export function monoCutResponse(cutHz: number, hz: number, fs: number): number {
  if (cutHz <= 20) return 0;
  const w0 = 2 * Math.PI * Math.min(cutHz / fs, 0.49);
  const alpha = Math.sin(w0) / (2 * Math.SQRT1_2);
  const c = Math.cos(w0);
  return db(biquad([(1 + c) / 2, -(1 + c), (1 + c) / 2], [1 + alpha, -2 * c, 1 - alpha], omega(hz, fs)));
}

// ---- dynamics, held at a steady level ----------------------------------------

const lin = (dB: number) => Math.pow(10, dB / 20);
const toDb = (g: number) => 20 * Math.log10(g);

/** The gate (gate.rs) once its envelope has settled on a steady level: open at or over the threshold. */
export function gateSteady(p: { thresholdDb: number; depth: number }, levelDb: number): number {
  const open = lin(levelDb) >= lin(clamp(p.thresholdDb, -80, 0));
  return levelDb + toDb(open ? 1 : 1 - clamp(p.depth, 0, 1));
}

/** Amp fit (fit.rs, `FitCore`) settled on a steady peak: the gain that puts it at 0.9. */
export function fitSteady(p: { amount: number; floorDb: number }, levelDb: number): number {
  const amount = clamp(p.amount, 0, 1);
  if (amount <= 1e-6) return levelDb;
  const peak = lin(levelDb);
  const want = clamp(peak > lin(clamp(p.floorDb, -80, -20)) ? 0.9 / Math.max(peak, 1e-9) : 1, 0.03, 32);
  return levelDb + toDb(1 + (want - 1) * amount);
}

/** `Maximizer::curve`: the compressor's static curve with its knee. */
function maximizerCurve(levelDb: number, thresholdDb: number, ratio: number, knee: number): number {
  const over = levelDb - thresholdDb;
  if (knee > 0 && over > -knee / 2 && over < knee / 2) {
    const x = over + knee / 2;
    return levelDb + ((1 / ratio - 1) * x * x) / (2 * knee);
  }
  return over <= 0 ? levelDb : thresholdDb + over / ratio;
}

export type Maximizer = { amount: number; ceilingDb: number; autoLevel: number; autoComp: number };

/**
 * The Maximizer (maximizer.rs) settled on a steady peak level: its level
 * estimate is that level, the threshold sits under it or at −24·amount, the
 * reduction is what the curve takes, the makeup what its mode asks, and the
 * output is held to the ceiling.
 */
export function maximizerSteady(v: Maximizer, levelDb: number): number {
  if (v.amount <= 1e-4) return levelDb;
  const a = clamp(v.amount, 0, 1);
  const ratio = Math.max(Math.pow(20, a), 1);
  const knee = Math.max(9 * (1 - a) + 1, 0);
  const threshold = v.autoComp >= 0.5 ? clamp(levelDb + 6 - 21 * a, -60, 0) : -24 * a;
  const reduction = Math.min(maximizerCurve(levelDb, threshold, ratio, knee) - levelDb, 0);
  const makeup = v.autoLevel >= 0.5
    ? clamp(v.ceilingDb - (levelDb + reduction), 0, 30)
    : clamp(-maximizerCurve(0, threshold, ratio, knee), 0, 30);
  return Math.min(levelDb + reduction + makeup, v.ceilingDb);
}

export type Spectral = { mode: number; ratio: number; reductionDb: number; smoothed: number; affect: number; thresholdDb: number };

/**
 * One band of Spectral Dynamics (spectral_dynamics.rs) held at a steady
 * amplitude, in dB from the band's reference (full scale, the frame's peak or
 * the threshold sound, whichever sets the threshold). Hard: a band past its
 * threshold has stepped to the amount; smoothed: the soft knee at that level.
 */
export function spectralSteady(v: Spectral, levelDb: number): number {
  const a = lin(levelDb);
  const t = lin(v.thresholdDb);
  const gate = Math.trunc(v.mode) === 0;
  const amount = gate ? lin(v.reductionDb) : Math.trunc(v.mode) === 1 ? v.ratio : 1 / v.ratio;
  const below = v.affect < 0.5;
  let state: number;
  if (v.smoothed >= 0.5) {
    const x = below ? a / (t + a) : t / (a + t);
    state = !gate && amount > 1 ? 1 / (x * (1 - 1 / amount) + 1 / amount) : amount + x * (1 - amount);
  } else {
    state = (below ? a < t : t < a) ? amount : 1;
  }
  return toDb(gate ? a * state : t * Math.pow(a / t, state));
}

/** The analysis Spectral Dynamics runs: its window, its bins, and the bins it works on. */
export function spectralBands(v: { bands: number; lowHz: number; highHz: number }, fs: number) {
  const n = 2 * (8 << clamp(Math.round(v.bands), 0, 9));
  const bins = n / 2 + 1;
  const perBin = fs / n;
  const low = v.lowHz <= 20 ? 0 : Math.min(Math.ceil(v.lowHz / perBin), bins);
  const high = Math.min(v.highHz >= 20000 ? bins - 1 : Math.floor(v.highHz / perBin), bins - 1);
  return { n, bins, perBin, low, high, windowMs: (n / fs) * 1000 };
}

// ---- the decimator -----------------------------------------------------------

/** `Decimator::crush`: down to one of 2^bits levels, set midway between steps. */
export function crush(x: number, bits: number): number {
  if (bits >= 24) return x;
  const q = Math.pow(2, bits - 1);
  return (clamp(Math.floor(x * q), -q, q - 1) + 0.5) / q;
}

/** A held sample in and out, the crushed one blended with the dry by the mix. */
export const decimatorTransfer = (x: number, p: { bits: number; mix: number }) => x * (1 - p.mix) + crush(x, p.bits) * p.mix;

// ---- delays that move --------------------------------------------------------

/** The longest the modulated delays' 160 ms line reads (`ModDelay::new`), in ms. */
const modLineMs = (fs: number) => ((Math.floor(fs * 0.16) + 4 - 2) / fs) * 1000;

/**
 * How far back a swept delay reads, in ms, `t` seconds into its LFO
 * (`ModDelay::tick`; the doubler's own with its offset and floor).
 */
export function modDelaySweep(
  p: { delayMs: number; depthMs: number; rateHz: number; stereo?: number },
  t: number, ch: number, fs: number,
  { offset = (p.stereo ?? 0) * Math.PI, floor = 0.05 }: { offset?: number; floor?: number } = {},
): number {
  const d = Math.max(p.delayMs + p.depthMs * Math.sin(2 * Math.PI * p.rateHz * t + offset * ch), floor);
  return Math.min(d, modLineMs(fs));
}

/**
 * The pitch a swept delay plays at its fastest and slowest, in cents: the read
 * runs at 1 − dD/dt, and a sine sweep's steepest slope is depth·2π·rate.
 * Slowed to a stop or run backwards, the slow side is −∞.
 */
export function pitchSwing(depthMs: number, rateHz: number) {
  const dev = (depthMs / 1000) * 2 * Math.PI * rateHz;
  return { up: 1200 * Math.log2(1 + dev), down: dev < 1 ? 1200 * Math.log2(1 - dev) : -Infinity };
}

/**
 * The Leslie (mgl_leslie.rs) `t` seconds into a turn: how far back each side
 * hears its 50 ms line, which is written before it is read and is read round
 * when the setting asks for more, and the gain its horn gives it.
 */
export function leslieRotor(p: { rateHz: number; depthMs: number; amDepth: number; width: number; baseMs: number }, t: number, ch: number, fs: number) {
  const side = ch === 0 ? -1 : 1;
  const osc = Math.sin(2 * Math.PI * p.rateHz * t + side * p.width * Math.PI * 0.5);
  const line = Math.max(Math.floor(fs / 20), 8);
  const back = ((p.baseMs + p.depthMs * (1 + osc)) * fs) / 1000 - 1;
  return { delayMs: ((((back % line) + line) % line) / fs) * 1000, gain: 1 - p.amDepth + p.amDepth * (0.5 + 0.5 * osc) };
}

/**
 * The pitch shifter's two taps `n` samples in (`PitchCore::frame`): how far
 * back each reads, in samples, and its raised-cosine weight; and how long a
 * sweep across the window takes.
 */
export function pitchTaps(p: { ratio: number; windowMs: number }, n: number, fs: number) {
  const line = Math.max(Math.floor(fs / 2), 8);
  const win = clamp((p.windowMs * fs) / 1000, 32, line - 2);
  const phase = (((0.25 + (n * (1 - p.ratio)) / win) % 1) + 1) % 1;
  const wa = 0.5 - 0.5 * Math.cos(2 * Math.PI * phase);
  const step = Math.abs(1 - p.ratio);
  return { a: phase * win, b: ((phase + 0.5) % 1) * win, wa, wb: 1 - wa, win, period: step === 0 ? Infinity : win / step };
}

/**
 * The Doppler's source (mgl_doppler.rs): it starts at the distance and moves
 * velocity / speed of sound samples a sample, held between one sample and the
 * end of its two-second line. `at` is the delay in ms `t` seconds after the
 * distance was set; `ratio` the pitch it plays while moving.
 */
export function dopplerPath(p: { distanceMs: number; velocityMps: number; speedMps: number }, fs: number) {
  const start = (p.distanceMs * fs) / 1000;
  const step = p.velocityMps / Math.max(p.speedMps, 1);
  const end = Math.max(2 * fs, 8) - 2;
  const stops = step > 0 ? (end - start) / step : step < 0 ? (start - 1) / -step : Infinity;
  return {
    at: (t: number) => (clamp(start + step * t * fs, 1, end) / fs) * 1000,
    ratio: 1 - step,
    stopsAt: stops / fs,
  };
}

// ---- level that moves --------------------------------------------------------

/** `Tremolo::gain`: the shape at a place in its cycle, sine to triangle to square. */
function tremoloGain(phase: number, depth: number, shape: number, edge: number): number {
  const d = Math.abs(phase - 0.5);
  const triangle = 2 * d;
  let wave: number;
  if (shape <= 1) {
    const sine = Math.sin(Math.PI * d) ** 2;
    wave = sine + (triangle - sine) * shape;
  } else {
    wave = triangle + (clamp((d - 0.25) / edge + 0.5, 0, 1) - triangle) * (shape - 1);
  }
  return 1 - depth * (1 - wave);
}

/** Both sides' gains at a place in the tremolo's cycle (tremolo.rs), the right stereo/2 behind. */
export function tremoloGains(p: { rateHz: number; depth: number; shape: number; stereo: number }, phase: number) {
  const edge = clamp(0.002 * p.rateHz, 1e-6, 0.25);
  let right = phase - 0.5 * p.stereo;
  if (right < 0) right += 1;
  return { left: tremoloGain(phase, p.depth, p.shape, edge), right: tremoloGain(right, p.depth, p.shape, edge) };
}

/**
 * The ring modulator's oscillator (ring.rs): its frequency `t` seconds in,
 * swept by so many hertz a second and started again when it leaves
 * 0.01 Hz…45 % of the rate; and how long one sweep lasts.
 */
export function ringSweep(p: { hz: number; sweep: number }, fs: number) {
  const step = p.sweep / fs;
  const top = fs * 0.45;
  const frames = step > 0 ? Math.floor((top - p.hz) / step) + 1 : step < 0 ? Math.floor((p.hz - 0.01) / -step) + 1 : Infinity;
  return {
    at: (t: number) => clamp(p.hz + (Number.isFinite(frames) ? Math.floor(t * fs) % frames : Math.floor(t * fs)) * step, 0.01, top),
    period: frames / fs,
  };
}

/**
 * Boomerang (boomerang.rs) at frame `n`: how far behind the write head it
 * reads, walking back two frames a frame to the throw, and the fade where the
 * read meets the write head.
 */
export function boomerangRead(p: { throwMs: number }, n: number, fs: number) {
  const frames = Math.max(Math.floor(2 * fs), 64);
  const throwFrames = clamp(Math.floor((clamp(p.throwMs, 20, 2000) / 1000) * fs), 64, frames);
  const lag = Math.min(2 * (n % Math.ceil(throwFrames / 2)), throwFrames - 1);
  const edge = Math.max(Math.floor(throwFrames / 16), 32);
  return { lag, fade: clamp(Math.min(lag, throwFrames - lag) / edge, 0, 1), throwFrames };
}

// ---- echoes ------------------------------------------------------------------

/** Echoes quieter than this are not drawn: 60 dB down. */
const FLOOR = 1e-3;

/**
 * The echo's impulse response (echo.rs): the dry at once, then a repeat every
 * delay, each one the feedback times the damping one-pole of the one before.
 * `low` is the height of each, `high` the same at `highHz`.
 */
export function echoTrain(p: { delayMs: number; feedback: number; damping: number; wet: number; dry: number }, fs: number, highHz = 4000, untilSec = 10) {
  const w = omega(highHz, fs);
  const lp = (1 - p.damping) / Math.hypot(1 - p.damping * Math.cos(w), p.damping * Math.sin(w));
  const train = [{ t: 0, low: p.dry, high: p.dry }];
  const step = ((p.delayMs * fs) / 1000) / fs;
  for (let k = 1; k * step <= untilSec; k++) {
    const low = p.wet * Math.pow(p.feedback, k - 1);
    if (Math.abs(low) < FLOOR && k > 1) break;
    train.push({ t: k * step, low, high: low * Math.pow(lp, k - 1) });
  }
  return train;
}

/** The all-pass diffuser's impulse response (mgl_allpass_diffuser.rs): dry − g·wet, then wet·(1 − g²)·g^(k−1). */
export function allpassTrain(p: { delayMs: number; coefficient: number; wet: number; dry: number }, fs: number, untilSec = 10) {
  const g = p.coefficient;
  const step = Math.max((p.delayMs * fs) / 1000, 1) / fs;
  const train = [{ t: 0, level: p.dry - g * p.wet }];
  for (let k = 1; k * step <= untilSec; k++) {
    const level = p.wet * (1 - g * g) * Math.pow(g, k - 1);
    if (Math.abs(level) < FLOOR && k > 1) break;
    train.push({ t: k * step, level });
  }
  return train;
}

/**
 * The multi delay's impulse response (multi_delay.rs), its dry left out: the
 * line is fed the mid and the average of its taps, so it sounds at every sum
 * of the two times, a·d₁ + b·d₂ with weight (fb/2)^(a+b)·C(a+b, a), and each
 * tap reads that a delay later, panned apart by the spread.
 */
export function multiTapTrain(p: { delay1Ms: number; delay2Ms: number; feedback: number; spread: number; wet: number }, fs: number, untilSec: number) {
  const [d1, d2] = [(p.delay1Ms * fs) / 1000, (p.delay2Ms * fs) / 1000];
  const near = 0.5 * (1 + p.spread);
  const far = 0.5 * (1 - p.spread);
  const stems = new Map<number, { t: number; left: number; right: number }>();
  const put = (samples: number, left: number, right: number) => {
    const key = Math.round(samples * 1e6);
    const stem = stems.get(key) ?? { t: samples / fs, left: 0, right: 0 };
    stem.left += left;
    stem.right += right;
    stems.set(key, stem);
  };
  // Row n holds the line's weights after n trips round it.
  let row = [1];
  for (let n = 0; Math.pow(p.feedback, n) >= FLOOR && n * Math.min(d1, d2) <= untilSec * fs; n++) {
    row.forEach((weight, a) => {
      const at = a * d1 + (n - a) * d2;
      if (at + d1 <= untilSec * fs) put(at + d1, p.wet * weight * near, p.wet * weight * far);
      if (at + d2 <= untilSec * fs) put(at + d2, p.wet * weight * far, p.wet * weight * near);
    });
    row = Array.from({ length: n + 2 }, (_, a) => (p.feedback / 2) * ((row[a - 1] ?? 0) + (row[a] ?? 0)));
  }
  return [...stems.values()].filter((s) => s.left !== 0 || s.right !== 0).sort((a, b) => a.t - b.t);
}

// ---- the comb reverbs --------------------------------------------------------

const SCHROEDER_MS = [29.7, 37.1, 41.1, 43.7];
/** Moorer's Table 2: each comb's delay, then its damping at 25 and 50 kHz. */
const MOORER = [[50, 0.24, 0.46], [56, 0.26, 0.48], [61, 0.28, 0.5], [68, 0.29, 0.52], [72, 0.3, 0.53], [78, 0.32, 0.55]] as const;

export type CombTank = { decay: number; size: number; spread: number; predelayMs: number; freeze: number; damping: number };

/**
 * Each comb of the Schroeder or Moorer reverb (schroeder_reverb.rs,
 * moorer_reverb.rs): its loop in seconds, as the buffers' whole samples make
 * it, and what one trip round it keeps, low and at `highHz`. A comb first
 * sounds one loop after the predelay; `rt60` is when the slowest has fallen
 * 60 dB from there.
 */
export function combTails(kind: "schroeder" | "moorer", v: CombTank, fs: number, highHz = 4000) {
  const frozen = v.freeze >= 0.5;
  const g = frozen ? 1 : v.decay;
  const ms = kind === "schroeder" ? SCHROEDER_MS : MOORER.map((c) => c[0]);
  const stretch = kind === "schroeder" ? 0.17 : 0.2;
  const t = clamp((fs - 25000) / 25000, 0, 1);
  const w = omega(highHz, fs);
  const combs = [0, 1].flatMap((side) => ms.map((len, i) => {
    const buffer = Math.max(Math.floor(len * 8 * (1 + side * stretch) * 0.001 * fs), 2);
    const tap = clamp(Math.floor(len * v.size * (1 + side * v.spread) * 0.001 * fs), 2, buffer - 1);
    const g1 = kind === "moorer" && !frozen ? clamp((MOORER[i][1] + (MOORER[i][2] - MOORER[i][1]) * t) * v.damping, 0, 0.98) : 0;
    // The one-pole inside a Moorer loop: unity at DC, less up high.
    const high = g * ((1 - g1) / Math.hypot(1 - g1 * Math.cos(w), g1 * Math.sin(w)));
    return { side, passSec: tap / fs, low: g, high };
  }));
  const pre = Math.min(Math.max(Math.floor(v.predelayMs * 0.001 * fs), 1), Math.max(Math.floor(fs), 2) - 1);
  const longest = Math.max(...combs.map((c) => c.passSec));
  const rt60 = frozen || g >= 1 ? Infinity : pre / fs + longest * (1 + 3 / -Math.log10(g));
  return { combs, preSec: pre / fs, rt60 };
}

// ---- PN noise ----------------------------------------------------------------

/** One step of the 24-bit register (`shift`, mgl_dattorro_common.rs): taps 0, 1, 3 and 4, never zero. */
export function lfsrStep(reg: number): number {
  const bit = (reg ^ (reg >>> 1) ^ (reg >>> 3) ^ (reg >>> 4)) & 1;
  const next = (reg >>> 1) | (bit << 23);
  return next === 0 ? 1 : next;
}

export type PnKind = "single" | "multibit" | "equalised";

/**
 * The noise's weighting of its bits, as an impulse response per clock step.
 * The register's bits are a maximal-length sequence, so as ±1 they are white;
 * the multibit value is the last 24 of them weighted 2^(23−j)/(2²⁴ − 1); the
 * equalised one is that less its one-pole low pass (0.35), times 1.35.
 */
function pnImpulse(kind: PnKind): number[] {
  if (kind === "single") return [1];
  const h = Array.from({ length: 24 }, (_, j) => Math.pow(2, 23 - j) / (2 ** 24 - 1));
  if (kind === "multibit") return h;
  // E: e[0] = 1.35·0.65, e[k] = −1.35·0.35·0.65^k, long enough to vanish.
  const e = Array.from({ length: 160 }, (_, k) => (k === 0 ? 1.35 * 0.65 : -1.35 * 0.35 * Math.pow(0.65, k)));
  return Array.from({ length: h.length + e.length - 1 }, (_, n) => h.reduce((sum, hj, j) => sum + hj * (e[n - j] ?? 0), 0));
}

/** The noise's power at `w` radians per clock step, for unit bits: |H(e^{jw})|². */
export function pnShape(kind: PnKind, w: number): number {
  const h = pnImpulse(kind).reduce((sum, v, k) => add(sum, times(zk(w, k), v)), cx(0));
  return magnitude(h) ** 2;
}

/** The noise's RMS, for a level of one: the root of its impulse response's energy. */
export const pnRms = (kind: PnKind) => Math.sqrt(pnImpulse(kind).reduce((sum, v) => sum + v * v, 0));

/** How often the register steps (at most once a sample), and how long until it repeats. */
export function pnSteps(clockHz: number, fs: number) {
  const perSec = Math.min(clockHz, fs);
  return { perSec, repeatSec: (2 ** 24 - 1) / perSec };
}

// ---- convolution -------------------------------------------------------------

function besselI0(x: number): number {
  let sum = 1;
  let term = 1;
  for (let k = 1; k < 32; k++) {
    term *= (x / (2 * k)) ** 2;
    sum += term;
    if (term < 1e-9 * sum) break;
  }
  return sum;
}

/** SoundHack's windows over `len` samples, as convolution.rs `window_at` draws them. */
export function convolutionWindow(choice: number, i: number, len: number): number {
  const n = Math.max(len, 1);
  const x = len > 1 ? i / (n - 1) : 0.5;
  switch (choice) {
    case 0: return 0.54 - 0.46 * Math.cos(2 * Math.PI * x);
    case 1: {
      if (i === 0 || i + 1 === len) return 0;
      const u = 2 * x - 1;
      return besselI0(6.8 * Math.sqrt(Math.max(1 - u * u, 0))) / besselI0(6.8);
    }
    case 2: return 1 - i / n;
    case 4: {
      const half = n / 2;
      const u = (Math.PI * (i - half)) / half;
      return Math.abs(u) < 1e-6 ? 1 : Math.sin(u) / u;
    }
    case 5: return 2 * Math.min(i / n, 1 - i / n);
    case 6: return 0.5 - 0.5 * Math.cos(2 * Math.PI * x);
    default: return 1;
  }
}

/** The impulse samples used (`Convolution::prepare`): as asked, at most four seconds' partitions and the sound. */
export function lengthUsed(lengthMs: number, fs: number, soundFrames: number): number {
  const most = Math.ceil(Math.floor(4 * fs) / 512) * 512;
  return Math.min(clamp(Math.round(lengthMs * 0.001 * fs), 1, most), Math.max(soundFrames, 1));
}
