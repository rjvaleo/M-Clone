//! Web Audio's own maths, so the Rust synth sounds as the browser does.
//!
//! The scale sequencer is built from Web Audio nodes: `OscillatorNode`s (its
//! oscillators and its LFOs), a `BiquadFilterNode` lowpass, and `AudioParam`
//! automation (`setValueAtTime`, `linearRampToValueAtTime`, `setTargetAtTime`).
//! Where the browser defines a behaviour, this restates the definition — the
//! Web Audio spec's formulas, carried out the way Chromium's
//! `third_party/blink/renderer/modules/webaudio` and `platform/audio` carry
//! them out — so the Rust `m.synth` is the original's sound rather than a
//! resemblance to it. `src/modular/audio/webAudioLaws.ts` is the reference on
//! the TypeScript side, and both pin the same numbers.
//!
//! # Oscillators
//!
//! A browser oscillator is a `PeriodicWave` read from band-limited tables
//! (`periodic_wave_handler.cc`). The built-in shapes are Fourier series —
//! sine `b₁ = 1`; square `bₙ = 4/(nπ)` for odd `n`; sawtooth
//! `bₙ = (−1)ⁿ⁺¹·2/(nπ)`; triangle `bₙ = 8·sin(nπ/2)/(nπ)²` — and a custom wave
//! is whatever coefficients it was given (the original's pulse is 256 cosine
//! terms). From those, one table per *range*: three ranges per octave, range
//! `r` keeping the partials below `N/2 · 2^(−r/3)`, each table the inverse
//! transform of the kept partials with its DC and Nyquist cleared, all scaled
//! by one normalisation — the reciprocal of the fullest table's peak. A note
//! reads the two tables either side of `1 + 3·log2(f / f_low)` and blends them;
//! inside a table it interpolates linearly, or by 3- and 5-point Lagrange when
//! it moves less than 0.3 of a table entry per sample (an LFO).
//!
//! The tables are computed here in double precision and stored as `f32`, as
//! Chromium stores them. Chromium's inverse transform runs in single precision,
//! so its table entries carry their own rounding: the two agree to about one
//! part in ten million, not bit for bit.
//!
//! # Filter and automation
//!
//! The lowpass is the spec's (`biquad.cc`): Q in decibels, coefficients from
//! the cutoff as a fraction of Nyquist, run in double precision in direct
//! form I. Automation is evaluated as the timeline Chromium keeps: events in
//! time order, a linear ramp running from the event before it, `setTarget`
//! approaching by the discrete time constant `1 − e^(−1/(fs·τ))`.

use core::f64::consts::PI;

/// The render quantum Web Audio processes in.
pub const RENDER_QUANTUM: u64 = 128;

/// Ranges per octave of a band-limited wave.
pub const BANDS_PER_OCTAVE: u32 = 3;
const CENTS_PER_RANGE: f32 = 1200.0 / BANDS_PER_OCTAVE as f32;

/// Below this many table entries per sample an oscillator stops interpolating
/// linearly (`OscillatorHandler::kInterpolate2Point`)…
pub const INTERPOLATE_2_POINT: f32 = 0.3;
/// …and below this one it uses five points rather than three.
pub const INTERPOLATE_3_POINT: f32 = 0.16;

/// The length of a band-limited table at a sample rate: 2048 up to 24 kHz,
/// 4096 up to 88.2 kHz, 16384 above.
pub fn periodic_wave_size(sample_rate: f32) -> usize {
    if sample_rate <= 24_000.0 {
        2048
    } else if sample_rate <= 88_200.0 {
        4096
    } else {
        16384
    }
}

/// How many tables a wave has: three per octave of partials.
pub fn number_of_ranges(size: usize) -> usize {
    (BANDS_PER_OCTAVE as f32 * (size as f32).log2()).round() as usize
}

/// The partials range `range` keeps: `N/2 · 2^(−range/3)`, truncated.
pub fn partials_for_range(range: usize, size: usize) -> usize {
    let cents_to_cull = range as f32 * CENTS_PER_RANGE;
    let culling_scale = 2f64.powf((-cents_to_cull / 1200.0) as f64) as f32;
    (culling_scale * (size / 2) as f32) as usize
}

/// The two tables a frequency reads and the blend between them:
/// `(fuller, sparser, factor)`, as `WaveDataForFundamentalFrequency` picks
/// them — `1 + 3·log2(f / f_low)` clamped to the ranges, its whole part the
/// fuller table.
pub fn select_tables(frequency: f32, sample_rate: f32, size: usize) -> (usize, usize, f32) {
    let ranges = number_of_ranges(size);
    let lowest = sample_rate / size as f32;
    let f = frequency.abs();
    let ratio = if f > 0.0 { f / lowest } else { 0.5 };
    let cents = ratio.log2() * 1200.0;
    let pitch_range = (1.0 + cents / CENTS_PER_RANGE).clamp(0.0, (ranges - 1) as f32);
    let higher = pitch_range as usize;
    let lower = if higher < ranges - 1 { higher + 1 } else { higher };
    (higher, lower, pitch_range - higher as f32)
}

/// The browser's built-in waves, in `OscillatorType` order.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BasicShape {
    Sine = 0,
    Square = 1,
    Sawtooth = 2,
    Triangle = 3,
}

/// The sine coefficient `bₙ` of a built-in wave, as `GenerateBasicWaveform`
/// computes it in single precision. Every cosine coefficient is zero.
pub fn basic_coefficient(shape: BasicShape, n: usize) -> f32 {
    let pi_factor = 2.0f32 / (n as f32 * core::f32::consts::PI);
    match shape {
        BasicShape::Sine => {
            if n == 1 {
                1.0
            } else {
                0.0
            }
        }
        BasicShape::Square => {
            if n & 1 == 1 {
                2.0 * pi_factor
            } else {
                0.0
            }
        }
        BasicShape::Sawtooth => pi_factor * if n & 1 == 1 { 1.0 } else { -1.0 },
        BasicShape::Triangle => {
            if n & 1 == 1 {
                2.0 * (pi_factor * pi_factor) * if ((n - 1) >> 1) & 1 == 1 { -1.0 } else { 1.0 }
            } else {
                0.0
            }
        }
    }
}

/// How many coefficients the original's pulse hands `createPeriodicWave`.
pub const PULSE_COMPONENTS: usize = 256;
pub const MIN_PULSE_WIDTH: f32 = 0.05;
pub const MAX_PULSE_WIDTH: f32 = 0.95;

/// The original's pulse, `buildPulseWave`: cosine terms `2/(nπ)·sin(nπw)`
/// (computed in double, stored as a `Float32Array`), with the DC term `2w − 1`
/// that the wave then discards. Written into `real`; the sine terms are zero.
pub fn pulse_coefficients(width: f32, real: &mut [f32; PULSE_COMPONENTS]) {
    let w = if width.is_finite() { width.clamp(MIN_PULSE_WIDTH, MAX_PULSE_WIDTH) as f64 } else { 0.5 };
    real[0] = (2.0 * w - 1.0) as f32;
    for (n, value) in real.iter_mut().enumerate().skip(1) {
        *value = ((2.0 / (n as f64 * PI)) * (n as f64 * PI * w).sin()) as f32;
    }
}

/// An inverse Fourier transform of `N` points in double precision, with the
/// scratch it needs allocated once.
pub struct Ifft {
    size: usize,
    twiddle_re: Vec<f64>,
    twiddle_im: Vec<f64>,
    re: Vec<f64>,
    im: Vec<f64>,
    /// The fullest table of a wave, while its peak is measured.
    scratch: Vec<f32>,
}

impl Ifft {
    pub fn new(size: usize) -> Self {
        let size = size.max(2).next_power_of_two();
        let half = size / 2;
        let angle = |j: usize| 2.0 * PI * j as f64 / size as f64;
        Self {
            size,
            twiddle_re: (0..half).map(|j| angle(j).cos()).collect(),
            twiddle_im: (0..half).map(|j| angle(j).sin()).collect(),
            re: vec![0.0; size],
            im: vec![0.0; size],
            scratch: vec![0.0; size],
        }
    }

    pub fn size(&self) -> usize {
        self.size
    }

    /// One table: `x[k] = 2·Σ (aₙ·cos(2πnk/N) + bₙ·sin(2πnk/N))` over the
    /// partials `1 ≤ n < end`, rounded to `f32` and scaled by `scale`.
    fn table(&mut self, real: &[f32], imag: &[f32], end: usize, scale: Option<f32>, out: &mut [f32]) {
        let n = self.size;
        self.re.iter_mut().for_each(|v| *v = 0.0);
        self.im.iter_mut().for_each(|v| *v = 0.0);
        for k in 1..end {
            // The conjugate pair: (a − ib) at n, (a + ib) at N − n.
            let a = real[k] as f64;
            let b = imag[k] as f64;
            self.re[k] = a;
            self.im[k] = -b;
            self.re[n - k] = a;
            self.im[n - k] = b;
        }
        // Iterative radix-2, decimation in time, with e^(+2πi/len) twiddles.
        let bits = n.trailing_zeros();
        for i in 0..n {
            let j = i.reverse_bits() >> (usize::BITS - bits);
            if j > i {
                self.re.swap(i, j);
                self.im.swap(i, j);
            }
        }
        let mut len = 2;
        while len <= n {
            let step = n / len;
            let half = len / 2;
            for start in (0..n).step_by(len) {
                for j in 0..half {
                    let (wr, wi) = (self.twiddle_re[j * step], self.twiddle_im[j * step]);
                    let (p, q) = (start + j, start + j + half);
                    let tr = self.re[q] * wr - self.im[q] * wi;
                    let ti = self.re[q] * wi + self.im[q] * wr;
                    self.re[q] = self.re[p] - tr;
                    self.im[q] = self.im[p] - ti;
                    self.re[p] += tr;
                    self.im[p] += ti;
                }
            }
            len *= 2;
        }
        for (value, sum) in out.iter_mut().zip(self.re.iter()) {
            let sample = *sum as f32;
            *value = match scale {
                Some(scale) => sample * scale,
                None => sample,
            };
        }
    }

    /// The normalisation of a coefficient set — one over the peak of its
    /// fullest table (the partials below `end`), or Chromium's ½ for a wave
    /// that is silent.
    pub fn normalisation(&mut self, real: &[f32], imag: &[f32], end: usize) -> f32 {
        let mut scratch = core::mem::take(&mut self.scratch);
        self.table(real, imag, end, None, &mut scratch);
        let peak = scratch.iter().fold(0.0f32, |acc, v| acc.max(v.abs()));
        self.scratch = scratch;
        if peak != 0.0 {
            1.0 / peak
        } else {
            0.5
        }
    }
}

/// A `PeriodicWave`: its coefficients and the tables made from them, each
/// computed the first time a note needs it.
///
/// Storage is allocated up front for `capacity` tables. A built-in wave keeps
/// every range; a pulse, which a note builds for itself, keeps a few and
/// recomputes when the note's pitch moves to another range.
pub struct BandLimitedWave {
    size: usize,
    ranges: usize,
    real: Vec<f32>,
    imag: Vec<f32>,
    components: usize,
    scale: Option<f32>,
    slots: Vec<Vec<f32>>,
    slot_range: Vec<usize>,
    slot_used: Vec<u64>,
    tick: u64,
}

const EMPTY: usize = usize::MAX;

impl BandLimitedWave {
    pub fn new(sample_rate: f32, capacity: usize) -> Self {
        Self::with_components(sample_rate, capacity, usize::MAX)
    }

    /// A wave with room for `components` coefficients and `capacity` tables.
    pub fn with_components(sample_rate: f32, capacity: usize, components: usize) -> Self {
        let size = periodic_wave_size(sample_rate);
        let ranges = number_of_ranges(size);
        let capacity = capacity.clamp(2, ranges);
        let components = components.clamp(2, size / 2);
        Self {
            size,
            ranges,
            real: vec![0.0; components],
            imag: vec![0.0; components],
            components: 0,
            scale: None,
            slots: (0..capacity).map(|_| vec![0.0; size]).collect(),
            slot_range: vec![EMPTY; capacity],
            slot_used: vec![0; capacity],
            tick: 0,
        }
    }

    /// A built-in wave, every range kept.
    pub fn basic(shape: BasicShape, sample_rate: f32) -> Self {
        let mut wave = Self::new(sample_rate, usize::MAX);
        let half = wave.size / 2;
        wave.real.iter_mut().for_each(|v| *v = 0.0);
        for n in 1..half {
            wave.imag[n] = basic_coefficient(shape, n);
        }
        wave.imag[0] = 0.0;
        wave.components = half;
        wave
    }

    pub fn size(&self) -> usize {
        self.size
    }

    /// Replace the coefficients — as `createPeriodicWave(real, imag)` — and
    /// forget every table. Nothing is allocated.
    pub fn set_coefficients(&mut self, real: &[f32], imag: &[f32], scale: Option<f32>) {
        let count = real.len().min(imag.len()).min(self.real.len());
        self.real[..count].copy_from_slice(&real[..count]);
        self.imag[..count].copy_from_slice(&imag[..count]);
        self.components = count;
        self.scale = scale;
        self.slot_range.iter_mut().for_each(|r| *r = EMPTY);
    }

    /// The normalisation, once it is known.
    pub fn scale(&self) -> Option<f32> {
        self.scale
    }

    /// The slot holding `range`'s table, computing it if it is not there —
    /// never into `keep`, the slot the caller is already reading.
    pub fn ensure(&mut self, range: usize, keep: usize, fft: &mut Ifft) -> usize {
        let range = range.min(self.ranges - 1);
        // A wave that keeps every range keeps each in its own slot.
        let direct = self.slots.len() == self.ranges;
        if direct && self.slot_range[range] == range {
            return range;
        }
        self.tick += 1;
        if !direct {
            if let Some(slot) = self.slot_range.iter().position(|&r| r == range) {
                self.slot_used[slot] = self.tick;
                return slot;
            }
        }
        let end = self.components.min(partials_for_range(range, self.size) + 1);
        let scale = match self.scale {
            Some(scale) => scale,
            None => {
                let full = self.components.min(partials_for_range(0, self.size) + 1);
                let scale = fft.normalisation(&self.real, &self.imag, full);
                self.scale = Some(scale);
                scale
            }
        };
        let slot = if direct {
            range
        } else {
            (0..self.slots.len())
                .filter(|&s| s != keep)
                .min_by_key(|&s| if self.slot_range[s] == EMPTY { 0 } else { self.slot_used[s] })
                .unwrap_or(0)
        };
        let mut table = core::mem::take(&mut self.slots[slot]);
        fft.table(&self.real, &self.imag, end, Some(scale), &mut table);
        self.slots[slot] = table;
        self.slot_range[slot] = range;
        self.slot_used[slot] = self.tick;
        slot
    }

    pub fn slot(&self, slot: usize) -> &[f32] {
        &self.slots[slot]
    }

    /// Range `range`'s table, computed if need be. For tests and inspection.
    pub fn table(&mut self, range: usize, fft: &mut Ifft) -> &[f32] {
        let slot = self.ensure(range, EMPTY, fft);
        &self.slots[slot]
    }
}

/// A frequency as an `AudioParam` holds it: clamped to ± Nyquist, NaN to
/// Nyquist (`ClampFrequency`).
pub fn clamp_frequency(frequency: f32, sample_rate: f32) -> f32 {
    let nyquist = sample_rate / 2.0;
    if frequency.is_nan() {
        nyquist
    } else {
        frequency.clamp(-nyquist, nyquist)
    }
}

/// An `OscillatorNode`'s read position and the tables it last chose.
#[derive(Clone, Copy, Debug)]
pub struct WebOsc {
    /// Where in the table, in entries. Double, as Chromium keeps it.
    index: f64,
    frequency: f32,
    higher: usize,
    lower: usize,
    factor: f32,
}

impl Default for WebOsc {
    fn default() -> Self {
        Self::new()
    }
}

impl WebOsc {
    pub const fn new() -> Self {
        Self { index: 0.0, frequency: f32::NAN, higher: 0, lower: 0, factor: 0.0 }
    }

    /// Back to the start of the cycle, where a new oscillator begins.
    pub fn reset(&mut self) {
        self.index = 0.0;
    }

    pub fn index(&self) -> f64 {
        self.index
    }

    /// One sample at `frequency`, read from `wave` — the k-rate path of
    /// `OscillatorHandler::Process`, which is the one a constant frequency
    /// takes.
    pub fn next(&mut self, frequency: f32, sample_rate: f32, wave: &mut BandLimitedWave, fft: &mut Ifft) -> f32 {
        let frequency = clamp_frequency(frequency, sample_rate);
        let size = wave.size();
        if frequency.to_bits() != self.frequency.to_bits() {
            let (higher, lower, factor) = select_tables(frequency, sample_rate, size);
            self.frequency = frequency;
            self.higher = higher;
            self.lower = lower;
            self.factor = factor;
        }
        let hi_slot = wave.ensure(self.higher, EMPTY, fft);
        let lo_slot = wave.ensure(self.lower, hi_slot, fft);
        let higher = wave.slot(hi_slot);
        let lower = wave.slot(lo_slot);
        let rate_scale = size as f32 / sample_rate;
        let incr = frequency * rate_scale;
        let mask = size - 1;
        let factor = self.factor;
        let read0 = self.index as usize;
        let sample = if incr.abs() >= INTERPOLATE_2_POINT {
            let f = self.index as f32 - read0 as f32;
            let i0 = read0 & mask;
            let i1 = (i0 + 1) & mask;
            let s_hi = higher[i0] + f * (higher[i1] - higher[i0]);
            let s_lo = lower[i0] + f * (lower[i1] - lower[i0]);
            s_hi + factor * (s_lo - s_hi)
        } else {
            let t = self.index - read0 as f64;
            let (mut s_lo, mut s_hi) = (0.0f64, 0.0f64);
            if incr.abs() >= INTERPOLATE_3_POINT {
                let a = [0.5 * t * (t - 1.0), 1.0 - t * t, 0.5 * t * (t + 1.0)];
                for (k, weight) in a.iter().enumerate() {
                    let i = (read0.wrapping_add(k).wrapping_sub(1)) & mask;
                    s_lo += weight * lower[i] as f64;
                    s_hi += weight * higher[i] as f64;
                }
            } else {
                let t2 = t * t;
                let a = [
                    t * (t2 - 1.0) * (t - 2.0) / 24.0,
                    -t * (t - 1.0) * (t2 - 4.0) / 6.0,
                    (t2 - 1.0) * (t2 - 4.0) / 4.0,
                    -t * (t + 1.0) * (t2 - 4.0) / 6.0,
                    t * (t2 - 1.0) * (t + 2.0) / 24.0,
                ];
                for (k, weight) in a.iter().enumerate() {
                    let i = (read0.wrapping_add(k).wrapping_sub(2)) & mask;
                    s_lo += weight * lower[i] as f64;
                    s_hi += weight * higher[i] as f64;
                }
            }
            ((1.0 - factor as f64) * s_hi + factor as f64 * s_lo) as f32
        };
        self.index += incr as f64;
        self.index -= (self.index / size as f64).floor() * size as f64;
        sample
    }
}

/// `setTargetAtTime`'s step per sample: `1 − e^(−1/(fs·τ))`.
pub fn discrete_time_constant(time_constant: f64, sample_rate: f64) -> f32 {
    (1.0 - (-1.0 / (sample_rate * time_constant)).exp()) as f32
}

/// `setTarget` is over once ten time constants have passed (`e^−10`)…
pub const TIME_CONSTANTS_TO_CONVERGE: f64 = 10.0;
/// …or once it is this close, relatively.
pub const SET_TARGET_THRESHOLD: f32 = 4.539_993e-5;

/// `HasSetTargetConverged`.
pub fn set_target_converged(value: f32, target: f32, now: f64, start: f64, time_constant: f64) -> bool {
    if now > start + TIME_CONSTANTS_TO_CONVERGE * time_constant {
        return true;
    }
    if target == 0.0 {
        return value.abs() < SET_TARGET_THRESHOLD;
    }
    (target - value).abs() < SET_TARGET_THRESHOLD * value.abs()
}

/// A parameter moved as `cancelAndHoldAtTime(now)` then
/// `setTargetAtTime(target, now, τ)` moves it, every time it is set.
///
/// The value at the frame of a move is where the previous curve had got to;
/// from the next frame it approaches the new target by the discrete time
/// constant, and it lands on the target once converged — checked at each
/// render quantum, as Chromium checks it.
#[derive(Clone, Copy, Debug)]
pub struct TargetGlide {
    value: f32,
    target: f32,
    pending: Option<f32>,
    dtc: f32,
    time_constant: f64,
    sample_rate: f64,
    start: f64,
    converged: bool,
}

impl TargetGlide {
    pub fn new(value: f32, time_constant: f64, sample_rate: f32) -> Self {
        let rate = if sample_rate > 0.0 { sample_rate as f64 } else { 48_000.0 };
        Self {
            value,
            target: value,
            pending: None,
            dtc: discrete_time_constant(time_constant, rate),
            time_constant,
            sample_rate: rate,
            start: 0.0,
            converged: true,
        }
    }

    /// The value last given out.
    pub fn value(&self) -> f32 {
        self.value
    }

    pub fn target(&self) -> f32 {
        self.pending.unwrap_or(self.target)
    }

    /// Jump, as building the node with a value does.
    pub fn reset(&mut self, value: f32) {
        self.value = value;
        self.target = value;
        self.pending = None;
        self.converged = true;
    }

    /// Glide toward `target`, starting at the next frame asked for.
    pub fn set_target(&mut self, target: f32) {
        if target.is_finite() {
            self.pending = Some(target);
        }
    }

    /// The value at `frame` — frames counted from an origin on the render
    /// quantum grid.
    pub fn next(&mut self, frame: u64) -> f32 {
        // This frame on the curve in force.
        let out = if self.converged { self.target } else { self.value + (self.target - self.value) * self.dtc };
        self.value = out;
        let starting = match self.pending.take() {
            // The frame of a move holds where the old curve had got to; the
            // new one runs from there.
            Some(target) => {
                self.target = target;
                self.start = frame as f64 / self.sample_rate;
                self.converged = false;
                true
            }
            None => false,
        };
        if !self.converged && (starting || frame % RENDER_QUANTUM == 0) {
            let now = frame as f64 / self.sample_rate;
            if set_target_converged(out, self.target, now, self.start, self.time_constant) {
                self.converged = true;
                self.value = self.target;
                return self.target;
            }
        }
        out
    }
}

/// A Web Audio lowpass (`Biquad::SetLowpassParams`), run as Chromium runs a
/// biquad: double-precision coefficients and state, direct form I, each
/// output rounded to `f32` before it is remembered.
#[derive(Clone, Copy, Debug)]
pub struct WebLowpass {
    b0: f64,
    b1: f64,
    b2: f64,
    a1: f64,
    a2: f64,
    x1: f64,
    x2: f64,
    y1: f64,
    y2: f64,
    frequency: f32,
    q: f32,
}

impl Default for WebLowpass {
    fn default() -> Self {
        Self::new()
    }
}

impl WebLowpass {
    pub const fn new() -> Self {
        Self {
            b0: 1.0,
            b1: 0.0,
            b2: 0.0,
            a1: 0.0,
            a2: 0.0,
            x1: 0.0,
            x2: 0.0,
            y1: 0.0,
            y2: 0.0,
            frequency: f32::NAN,
            q: f32::NAN,
        }
    }

    /// The coefficients for `frequency` hertz and `q_db` decibels of Q, as
    /// `(b0, b1, b2, a1, a2)` normalised by `a0`.
    pub fn coefficients(frequency: f32, q_db: f32, sample_rate: f32) -> (f64, f64, f64, f64, f64) {
        let nyquist = 0.5 * sample_rate as f64;
        // The frequency param holds 0…Nyquist; the filter clamps again.
        let held = if frequency.is_nan() { 0.0 } else { frequency.clamp(0.0, nyquist as f32) };
        let cutoff = (held as f64 / nyquist).clamp(0.0, 1.0);
        if cutoff == 1.0 {
            (1.0, 0.0, 0.0, 0.0, 0.0)
        } else if cutoff > 0.0 {
            let q = if q_db.is_finite() { q_db as f64 } else { 0.0 };
            let resonance = 10f64.powf(q / 20.0);
            let theta = PI * cutoff;
            let alpha = theta.sin() / (2.0 * resonance);
            let cosw = theta.cos();
            let beta = (1.0 - cosw) / 2.0;
            let a0_inverse = 1.0 / (1.0 + alpha);
            (
                beta * a0_inverse,
                2.0 * beta * a0_inverse,
                beta * a0_inverse,
                -2.0 * cosw * a0_inverse,
                (1.0 - alpha) * a0_inverse,
            )
        } else {
            (0.0, 0.0, 0.0, 0.0, 0.0)
        }
    }

    /// Set the filter for this sample. Recomputed only when a value moves.
    #[inline]
    pub fn set(&mut self, frequency: f32, q_db: f32, sample_rate: f32) {
        if frequency.to_bits() == self.frequency.to_bits() && q_db.to_bits() == self.q.to_bits() {
            return;
        }
        self.frequency = frequency;
        self.q = q_db;
        let (b0, b1, b2, a1, a2) = Self::coefficients(frequency, q_db, sample_rate);
        self.b0 = b0;
        self.b1 = b1;
        self.b2 = b2;
        self.a1 = a1;
        self.a2 = a2;
    }

    #[inline]
    pub fn process(&mut self, x: f32) -> f32 {
        let y = (self.b0 * x as f64 + self.b1 * self.x1 + self.b2 * self.x2 - self.a1 * self.y1 - self.a2 * self.y2)
            as f32;
        self.x2 = self.x1;
        self.x1 = flush_denormal(x as f64);
        self.y2 = self.y1;
        self.y1 = flush_denormal(y as f64);
        y
    }

    pub fn clear(&mut self) {
        self.x1 = 0.0;
        self.x2 = 0.0;
        self.y1 = 0.0;
        self.y2 = 0.0;
    }
}

/// `DenormalDisabler::FlushDenormalFloatToZero`.
#[inline(always)]
fn flush_denormal(v: f64) -> f64 {
    if v.abs() < f32::MIN_POSITIVE as f64 {
        0.0
    } else {
        v
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum EventKind {
    Set,
    Linear,
    /// `setTargetAtTime`, with its time constant.
    Target(f64),
}

#[derive(Clone, Copy, Debug)]
struct ParamEvent {
    time: f64,
    value: f32,
    kind: EventKind,
}

/// The most events a timeline holds. A note writes at most seven.
pub const MAX_PARAM_EVENTS: usize = 16;

/// An `AudioParam`'s automation timeline, for the events the synth writes.
///
/// Events sit in time order, a new one after any already at its time. A frame
/// takes its value from the last event at or before it; if the event after
/// that is a linear ramp, the value runs from one to the other. Events wholly
/// in the past are dropped as frames move on, as Chromium prunes them.
#[derive(Clone, Copy, Debug)]
pub struct ParamTimeline {
    events: [ParamEvent; MAX_PARAM_EVENTS],
    len: usize,
    default: f32,
    last: f32,
}

impl ParamTimeline {
    pub const fn new(default: f32) -> Self {
        Self {
            events: [ParamEvent { time: 0.0, value: 0.0, kind: EventKind::Set }; MAX_PARAM_EVENTS],
            len: 0,
            default,
            last: default,
        }
    }

    pub fn is_empty(&self) -> bool {
        self.len == 0
    }

    pub fn len(&self) -> usize {
        self.len
    }

    /// The value last computed.
    pub fn value(&self) -> f32 {
        self.last
    }

    fn insert(&mut self, event: ParamEvent) {
        if !event.time.is_finite() || !event.value.is_finite() {
            return;
        }
        if self.len == MAX_PARAM_EVENTS {
            // Full: the oldest event goes, as the past would have pruned it.
            self.events.copy_within(1.., 0);
            self.len -= 1;
        }
        let at = self.events[..self.len].iter().position(|e| e.time > event.time).unwrap_or(self.len);
        self.events.copy_within(at..self.len, at + 1);
        self.events[at] = event;
        self.len += 1;
    }

    pub fn set_value_at_time(&mut self, value: f32, time: f64) {
        self.insert(ParamEvent { time, value, kind: EventKind::Set });
    }

    pub fn linear_ramp_to_value_at_time(&mut self, value: f32, time: f64) {
        self.insert(ParamEvent { time, value, kind: EventKind::Linear });
    }

    pub fn set_target_at_time(&mut self, target: f32, time: f64, time_constant: f64) {
        self.insert(ParamEvent { time, value: target, kind: EventKind::Target(time_constant.max(1e-9)) });
    }

    /// Remove every event at or after `time`.
    pub fn cancel_scheduled_values(&mut self, time: f64) {
        self.len = self.events[..self.len].iter().position(|e| e.time >= time).unwrap_or(self.len);
    }

    /// Everything gone, back to the default.
    pub fn clear(&mut self) {
        self.len = 0;
        self.last = self.default;
    }

    /// The value at `frame` at `sample_rate` — frame `k` is time `k / fs`.
    pub fn value_at(&mut self, frame: u64, sample_rate: f64) -> f32 {
        let t = frame as f64 / sample_rate;
        let position = frame as f64;
        // The last event at or before this frame.
        let mut current = None;
        for (i, event) in self.events[..self.len].iter().enumerate() {
            if position >= event.time * sample_rate {
                current = Some(i);
            } else {
                break;
            }
        }
        let Some(i) = current else {
            self.last = self.default;
            return self.default;
        };
        // Where a target event starts from: the event just before it, at the
        // moment it begins; afterwards, the frame before.
        let from = if i > 0 { self.events[i - 1].value } else { self.last };
        // Older events can no longer matter.
        if i > 0 {
            self.events.copy_within(i..self.len, 0);
            self.len -= i;
        }
        let event = self.events[0];
        let value = match (self.len > 1).then(|| self.events[1]) {
            Some(next) if next.kind == EventKind::Linear => {
                let delta = next.time - event.time;
                let k = if delta <= f32::MIN_POSITIVE as f64 { 0.0f32 } else { (1.0 / delta) as f32 };
                let x = ((t - event.time) * k as f64) as f32;
                event.value + x * (next.value - event.value)
            }
            _ => match event.kind {
                // The target approaches from the value it started at, which
                // the synth always sets at the same moment.
                EventKind::Target(tau) => {
                    if t <= event.time {
                        from
                    } else {
                        let step = discrete_time_constant(tau, sample_rate);
                        from + (event.value - from) * step
                    }
                }
                _ => event.value,
            },
        };
        self.last = value;
        value
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const RATE: f32 = 48_000.0;

    #[test]
    fn a_table_is_as_long_as_the_sample_rate_asks() {
        assert_eq!(periodic_wave_size(24_000.0), 2048);
        assert_eq!(periodic_wave_size(44_100.0), 4096);
        assert_eq!(periodic_wave_size(48_000.0), 4096);
        assert_eq!(periodic_wave_size(88_200.0), 4096);
        assert_eq!(periodic_wave_size(96_000.0), 16384);
        assert_eq!(number_of_ranges(2048), 33);
        assert_eq!(number_of_ranges(4096), 36);
        assert_eq!(number_of_ranges(16384), 42);
    }

    #[test]
    fn each_range_keeps_the_partials_chromium_keeps() {
        // Pinned in webAudioLaws.test.ts too.
        let kept: Vec<usize> = [0, 1, 2, 3, 4, 9, 10, 16, 17, 33, 34, 35]
            .iter()
            .map(|&r| partials_for_range(r, 4096))
            .collect();
        assert_eq!(kept, vec![2048, 1625, 1290, 1024, 812, 256, 203, 50, 40, 1, 0, 0]);
    }

    #[test]
    fn a_note_reads_the_two_tables_either_side_of_its_pitch() {
        let (higher, lower, factor) = select_tables(440.0, RATE, 4096);
        assert_eq!((higher, lower), (16, 17));
        assert_eq!(factor, 0.691_837_3);
        // Below the lowest fundamental, the fullest table only.
        assert_eq!(select_tables(5.0, RATE, 4096), (0, 1, 0.0));
        assert_eq!(select_tables(0.0, RATE, 4096), (0, 1, 0.0));
        // At Nyquist, the sparsest.
        assert_eq!(select_tables(24_000.0, RATE, 4096).0, 34);
        assert_eq!(select_tables(1e9, RATE, 4096), (35, 35, 0.0));
    }

    #[test]
    fn the_built_in_coefficients_are_the_fourier_series() {
        use BasicShape::*;
        assert_eq!(basic_coefficient(Sine, 1), 1.0);
        assert_eq!(basic_coefficient(Sine, 2), 0.0);
        assert!((basic_coefficient(Square, 1) - 4.0 / core::f32::consts::PI).abs() < 1e-7);
        assert_eq!(basic_coefficient(Square, 2), 0.0);
        assert!((basic_coefficient(Sawtooth, 2) + 1.0 / core::f32::consts::PI).abs() < 1e-7);
        assert!((basic_coefficient(Triangle, 3) + 8.0 / (9.0 * core::f32::consts::PI.powi(2))).abs() < 1e-7);
        assert_eq!(basic_coefficient(Triangle, 4), 0.0);
        assert!(basic_coefficient(Triangle, 5) > 0.0);
    }

    /// Reference values from the spec's sum, computed directly in
    /// `webAudioLaws.test.ts` — not through a transform.
    #[test]
    fn the_tables_are_the_normalised_partial_sums() {
        let mut fft = Ifft::new(4096);
        let mut saw = BandLimitedWave::basic(BasicShape::Sawtooth, RATE);
        let table = saw.table(0, &mut fft).to_vec();
        assert_eq!(table[0], 0.0);
        let peak = table.iter().fold(0.0f32, |a, v| a.max(v.abs()));
        assert!((peak - 1.0).abs() < 1e-6);
        for (k, expected) in [(1, 0.000_414_428_74f32), (512, 0.212_080_99), (1024, 0.424_139_35), (2047, 1.0)] {
            assert!((table[k] - expected).abs() < 2e-6, "saw[{k}] = {}", table[k]);
        }
        let sparse = saw.table(16, &mut fft).to_vec();
        for (k, expected) in [(1, 4.142_137e-7f32), (1024, 0.429_671_08)] {
            assert!((sparse[k] - expected).abs() < 2e-6, "saw16[{k}] = {}", sparse[k]);
        }
        let mut square = BandLimitedWave::basic(BasicShape::Square, RATE);
        let table = square.table(0, &mut fft).to_vec();
        assert!((table[1024] - 0.847_927_27).abs() < 2e-6, "{}", table[1024]);
        let mut sine = BandLimitedWave::basic(BasicShape::Sine, RATE);
        let table = sine.table(0, &mut fft).to_vec();
        assert!((table[1024] - 1.0).abs() < 1e-6);
        assert!((table[512] - core::f32::consts::FRAC_1_SQRT_2).abs() < 1e-6);
        let mut triangle = BandLimitedWave::basic(BasicShape::Triangle, RATE);
        let table = triangle.table(0, &mut fft).to_vec();
        assert!((table[512] - 0.500_098_94).abs() < 2e-6, "{}", table[512]);
    }

    #[test]
    fn the_pulse_is_the_originals_256_cosines_without_its_dc() {
        let mut real = [0.0f32; PULSE_COMPONENTS];
        pulse_coefficients(0.1, &mut real);
        assert!((real[0] - -0.8).abs() < 1e-7);
        // The width arrives as f32, so the last bit may differ from a JS double.
        assert!((real[1] - 0.196_726_32).abs() < 1e-7);
        let imag = [0.0f32; PULSE_COMPONENTS];
        let mut fft = Ifft::new(4096);
        let mut pulse = BandLimitedWave::new(RATE, 3);
        pulse.set_coefficients(&real, &imag, None);
        let table = pulse.table(16, &mut fft).to_vec();
        let scale = pulse.scale().expect("normalised");
        assert!((scale - 0.506_470_26).abs() < 1e-7, "{scale}");
        for (k, expected) in [(0, 0.952_043f32), (100, 0.917_276_5), (2048, -0.102_315_19)] {
            assert!((table[k] - expected).abs() < 2e-6, "pulse16[{k}] = {}", table[k]);
        }
        // A NaN width is a square.
        pulse_coefficients(f32::NAN, &mut real);
        assert_eq!(real[0], 0.0);
    }

    #[test]
    fn a_wave_with_few_slots_recomputes_rather_than_reading_a_stale_table() {
        let mut fft = Ifft::new(4096);
        let mut real = [0.0f32; PULSE_COMPONENTS];
        pulse_coefficients(0.3, &mut real);
        let imag = [0.0f32; PULSE_COMPONENTS];
        let mut few = BandLimitedWave::new(RATE, 2);
        few.set_coefficients(&real, &imag, None);
        let mut all = BandLimitedWave::new(RATE, 36);
        all.set_coefficients(&real, &imag, None);
        for range in [5, 20, 30, 20, 5, 12] {
            let a = few.table(range, &mut fft).to_vec();
            let b = all.table(range, &mut fft).to_vec();
            assert_eq!(a, b, "range {range}");
        }
        // A silent wave keeps Chromium's default scale.
        let mut silent = BandLimitedWave::new(RATE, 2);
        silent.set_coefficients(&[0.0; 4], &[0.0; 4], None);
        assert!(silent.table(0, &mut fft).iter().all(|v| *v == 0.0));
        assert_eq!(silent.scale(), Some(0.5));
    }

    #[test]
    fn an_oscillator_reads_its_tables_as_chromium_does() {
        let mut fft = Ifft::new(4096);
        let mut saw = BandLimitedWave::basic(BasicShape::Sawtooth, RATE);
        let mut osc = WebOsc::new();
        let samples: Vec<f32> = (0..100).map(|_| osc.next(440.0, RATE, &mut saw, &mut fft)).collect();
        // Pinned in webAudioLaws.test.ts from the reference oscillator.
        for (k, expected) in [(0, 0.0f32), (1, 0.011_840_009), (10, 0.161_495_61), (54, 0.656_023_86), (99, -0.163_309_31)] {
            assert!((samples[k] - expected).abs() < 3e-6, "saw[{k}] = {}", samples[k]);
        }
        // An LFO, slow enough for five-point Lagrange.
        let mut sine = BandLimitedWave::basic(BasicShape::Sine, RATE);
        let mut lfo = WebOsc::new();
        let quarter = (RATE / 4.0) as usize;
        let mut last = 0.0;
        for _ in 0..=quarter {
            last = lfo.next(1.0, RATE, &mut sine, &mut fft);
        }
        assert!((last - 1.0).abs() < 1e-6, "{last}");
        // Three-point Lagrange, between 0.16 and 0.3 entries a sample.
        let mut tri = BandLimitedWave::basic(BasicShape::Triangle, RATE);
        let mut slow = WebOsc::new();
        let values: Vec<f32> = (0..2_400).map(|_| slow.next(2.5, RATE, &mut tri, &mut fft)).collect();
        for (k, expected) in [(100, 0.020_837_458f32), (1_000, 0.208_374_57), (2_399, 0.499_890_6)] {
            assert!((values[k] - expected).abs() < 2e-6, "tri[{k}] = {}", values[k]);
        }
        slow.reset();
        assert_eq!(slow.index(), 0.0);
        assert_eq!(clamp_frequency(f32::NAN, RATE), 24_000.0);
        assert_eq!(clamp_frequency(-1e6, RATE), -24_000.0);
    }

    #[test]
    fn set_target_steps_by_the_discrete_time_constant() {
        let dtc = discrete_time_constant(0.015, 48_000.0);
        assert_eq!(dtc, 0.001_387_924_9);
        let mut glide = TargetGlide::new(1_000.0, 0.015, 48_000.0);
        assert_eq!(glide.next(0), 1_000.0);
        glide.set_target(2_000.0);
        // The frame of the move holds; the next approaches.
        assert_eq!(glide.next(1), 1_000.0);
        let second = glide.next(2);
        assert!((second - (1_000.0 + 1_000.0 * dtc)).abs() < 1e-3);
        let mut value = second;
        for frame in 3..721 {
            value = glide.next(frame);
        }
        // 719 steps: 2000 − 1000·(1 − dtc)^719.
        let expected = 2_000.0 - 1_000.0 * (1.0 - dtc as f64).powi(719);
        assert!((value as f64 - expected).abs() < 0.05, "{value} vs {expected}");
        assert_eq!(value, 1_631.609_9, "pinned in webAudioLaws.test.ts");
        // Ten time constants on, at the next quantum, it lands.
        let mut frame = 721;
        while frame < 48_000 {
            value = glide.next(frame);
            frame += 1;
            if value == 2_000.0 {
                break;
            }
        }
        assert_eq!(value, 2_000.0);
        assert_eq!(frame - 1, 6_784, "converged by ratio, at a quantum");
        assert_eq!(glide.target(), 2_000.0);
        glide.reset(500.0);
        assert_eq!(glide.value(), 500.0);
        glide.set_target(f32::NAN);
        assert_eq!(glide.next(0), 500.0);
    }

    #[test]
    fn set_target_converges_by_ratio_too() {
        assert!(set_target_converged(0.0, 0.0, 0.0, 0.0, 1.0));
        assert!(!set_target_converged(0.1, 0.0, 0.0, 0.0, 1.0));
        assert!(set_target_converged(1000.0, 1000.01, 0.0, 0.0, 1.0));
        assert!(!set_target_converged(1000.0, 1001.0, 0.0, 0.0, 1.0));
    }

    #[test]
    fn the_lowpass_is_the_specs() {
        let (b0, b1, b2, a1, a2) = WebLowpass::coefficients(1_000.0, 6.0, RATE);
        // Pinned in webAudioLaws.test.ts.
        assert!((b0 - 0.004_142_085_705_032_131).abs() < 1e-15, "{b0}");
        assert!((b1 - 2.0 * b0).abs() < 1e-12 && (b2 - b0).abs() < 1e-12);
        assert!((a1 - -1.920_085_584_611_076_3).abs() < 1e-15, "{a1}");
        assert!((a2 - 0.936_653_927_431_204_6).abs() < 1e-15, "{a2}");
        assert_eq!(WebLowpass::coefficients(30_000.0, 0.0, RATE), (1.0, 0.0, 0.0, 0.0, 0.0));
        assert_eq!(WebLowpass::coefficients(-5.0, 0.0, RATE), (0.0, 0.0, 0.0, 0.0, 0.0));
        assert_eq!(WebLowpass::coefficients(f32::NAN, 0.0, RATE), (0.0, 0.0, 0.0, 0.0, 0.0));
        let (n0, ..) = WebLowpass::coefficients(1_000.0, f32::NAN, RATE);
        let (z0, ..) = WebLowpass::coefficients(1_000.0, 0.0, RATE);
        assert_eq!(n0, z0);
        let mut filter = WebLowpass::new();
        filter.set(1_000.0, 6.0, RATE);
        let impulse: Vec<f32> = (0..4).map(|i| filter.process(if i == 0 { 1.0 } else { 0.0 })).collect();
        assert!((impulse[0] as f64 - b0).abs() < 1e-7);
        assert!((impulse[1] as f64 - (b1 - a1 * impulse[0] as f64)).abs() < 1e-7);
        filter.set(1_000.0, 6.0, RATE);
        filter.clear();
        assert_eq!(filter.process(0.0), 0.0);
        let mut open = WebLowpass::default();
        assert_eq!(open.process(0.25), 0.25);
    }

    #[test]
    fn a_timeline_evaluates_set_and_ramp_events_in_time_order() {
        let sr = 1_000.0;
        let mut tl = ParamTimeline::new(7.0);
        assert!(tl.is_empty());
        assert_eq!(tl.value_at(0, sr), 7.0);
        // The original's envelope with a gate inside its attack: 0 until the
        // gate, then the sustain, ramping on to the peak.
        tl.set_value_at_time(0.0, 0.0);
        tl.linear_ramp_to_value_at_time(1.0, 0.1);
        tl.linear_ramp_to_value_at_time(0.5, 0.2);
        tl.set_value_at_time(0.5, 0.05);
        tl.linear_ramp_to_value_at_time(0.0, 0.25);
        assert_eq!(tl.len(), 5);
        let at = |tl: &mut ParamTimeline, k: u64| tl.value_at(k, sr);
        assert_eq!(at(&mut tl, 10), 0.0);
        assert_eq!(at(&mut tl, 49), 0.0);
        assert_eq!(at(&mut tl, 50), 0.5);
        assert!((at(&mut tl, 75) - 0.75).abs() < 1e-6);
        assert_eq!(at(&mut tl, 100), 1.0);
        assert!((at(&mut tl, 150) - 0.75).abs() < 1e-6);
        assert!((at(&mut tl, 225) - 0.25).abs() < 1e-6);
        assert_eq!(at(&mut tl, 300), 0.0);
        assert_eq!(tl.value(), 0.0);
        tl.cancel_scheduled_values(0.0);
        assert!(tl.is_empty());
        // A ramp at the same moment as the event before it is a step.
        tl.set_value_at_time(2.0, 1.0);
        tl.linear_ramp_to_value_at_time(4.0, 1.0);
        assert_eq!(at(&mut tl, 1_000), 4.0);
        // A ramp too short for a float to divide by holds where it starts.
        let mut short = ParamTimeline::new(0.0);
        short.set_value_at_time(3.0, 0.0);
        short.linear_ramp_to_value_at_time(5.0, 1e-40);
        assert_eq!(short.value_at(0, sr), 3.0);
        // Non-finite events are refused.
        tl.set_value_at_time(f32::NAN, 2.0);
        tl.set_value_at_time(1.0, f64::INFINITY);
        assert_eq!(tl.len(), 1);
        tl.clear();
        assert_eq!(tl.value(), 7.0);
    }

    #[test]
    fn a_full_timeline_drops_its_oldest_event() {
        let mut tl = ParamTimeline::new(0.0);
        for i in 0..(MAX_PARAM_EVENTS + 3) {
            tl.set_value_at_time(i as f32, i as f64);
        }
        assert_eq!(tl.len(), MAX_PARAM_EVENTS);
        assert_eq!(tl.value_at(0, 1.0), 0.0, "the earliest left is after frame 0");
        assert_eq!(tl.value_at(5, 1.0), 5.0);
    }

    #[test]
    fn a_target_event_decays_toward_its_value() {
        let sr = 48_000.0;
        let mut tl = ParamTimeline::new(0.0);
        tl.set_value_at_time(1.0, 0.0);
        tl.set_target_at_time(0.0, 0.0, 0.02);
        let first = tl.value_at(0, sr);
        assert_eq!(first, 1.0);
        let mut v = first;
        for k in 1..=960 {
            v = tl.value_at(k, sr);
        }
        // One time constant: e^−1 of the way.
        assert!((v - (-1.0f32).exp()).abs() < 1e-3, "{v}");
    }
}
