//! A `DynamicsCompressorNode`'s engine: Chromium's `DynamicsCompressor`
//! (`platform/audio/dynamics_compressor.cc`), stereo, line for line.
//!
//! Its maths is the page's: fdlibm's `powf` and `asinf` where Chromium calls
//! fdlibm, the system's `powf`, `log10f`, `exp` and `sin` where it calls the
//! C library (`audio_utilities`' dB conversions, the knee, the warp): on a
//! Mac those are the same functions the page ran.

use super::fdlibm;

const METERING_RELEASE_TIME_CONSTANT: f32 = 0.325;
const PRE_DELAY: f32 = 0.006;
const RELEASE_ZONE1: f32 = 0.09;
const RELEASE_ZONE2: f32 = 0.16;
const RELEASE_ZONE3: f32 = 0.42;
const RELEASE_ZONE4: f32 = 0.98;
const SAT_RELEASE_TIME: f32 = 0.0025;
const MAX_PRE_DELAY_FRAMES: usize = 1024;
const MAX_PRE_DELAY_MASK: usize = MAX_PRE_DELAY_FRAMES - 1;
const DEFAULT_PRE_DELAY_FRAMES: usize = 256;
const DIVISION_FRAMES: usize = 32;
const PI_OVER_TWO_FLOAT: f32 = core::f32::consts::FRAC_PI_2;
const UNINITIALIZED: f32 = -1.0;

// The polynomial's bases, as Chromium's constexprs compute them: each
// product and sum in float.
fn a_base() -> f32 {
    0.9999999999999998f32 * RELEASE_ZONE1 + 1.8432219684323923e-16f32 * RELEASE_ZONE2 - 1.9373394351676423e-16f32 * RELEASE_ZONE3
        + 8.824516011816245e-18f32 * RELEASE_ZONE4
}
fn b_base() -> f32 {
    -1.5788320352845888f32 * RELEASE_ZONE1 + 2.3305837032074286f32 * RELEASE_ZONE2 - 0.9141194204840429f32 * RELEASE_ZONE3
        + 0.1623677525612032f32 * RELEASE_ZONE4
}
fn c_base() -> f32 {
    0.5334142869106424f32 * RELEASE_ZONE1 - 1.272736789213631f32 * RELEASE_ZONE2 + 0.9258856042207512f32 * RELEASE_ZONE3
        - 0.18656310191776226f32 * RELEASE_ZONE4
}
fn d_base() -> f32 {
    0.08783463138207234f32 * RELEASE_ZONE1 - 0.1694162967925622f32 * RELEASE_ZONE2 + 0.08588057951595272f32 * RELEASE_ZONE3
        - 0.00429891410546283f32 * RELEASE_ZONE4
}
fn e_base() -> f32 {
    -0.042416883008123074f32 * RELEASE_ZONE1 + 0.1115693827987602f32 * RELEASE_ZONE2 - 0.09764676325265872f32 * RELEASE_ZONE3
        + 0.028494263462021576f32 * RELEASE_ZONE4
}

fn ensure_finite(x: f32, default: f32) -> f32 {
    if x.is_finite() {
        x
    } else {
        default
    }
}

/// `audio_utilities::DecibelsToLinear`: the C library's `powf`.
fn db_to_linear(db: f32) -> f32 {
    10f32.powf(0.05 * db)
}

/// `audio_utilities::LinearToDecibels`: the C library's `log10f`.
fn linear_to_db(linear: f32) -> f32 {
    20.0 * linear.log10()
}

fn fdlibm_powf(x: f32, y: f32) -> f32 {
    fdlibm::pow(x as f64, y as f64) as f32
}

fn fdlibm_asinf(x: f64) -> f32 {
    fdlibm::asin(x) as f32
}

/// `DenormalDisabler::FlushDenormalFloatToZero`.
fn flush(f: f32) -> f32 {
    if f.abs() < f32::MIN_POSITIVE {
        0.0
    } else {
        f
    }
}

/// `DynamicsCompressor`, two channels.
#[derive(Clone)]
pub struct Compressor {
    sample_rate: f32,
    pre_delay: [[f32; MAX_PRE_DELAY_FRAMES]; 2],
    pre_delay_read: usize,
    pre_delay_write: usize,
    last_pre_delay_frames: usize,
    detector_average: f32,
    compressor_gain: f32,
    metering_gain: f32,
    metering_release_k: f32,
    db_max_attack_compression_diff: f32,
    ratio: f32,
    slope: f32,
    linear_threshold: f32,
    db_threshold: f32,
    db_knee: f32,
    knee_threshold: f32,
    db_knee_threshold: f32,
    db_yknee_threshold: f32,
    knee: f32,
    /// `kParamReduction`.
    pub reduction: f32,
}

impl Compressor {
    pub fn new(sample_rate: f32) -> Self {
        let mut c = Compressor {
            sample_rate,
            pre_delay: [[0.0; MAX_PRE_DELAY_FRAMES]; 2],
            pre_delay_read: 0,
            pre_delay_write: DEFAULT_PRE_DELAY_FRAMES,
            last_pre_delay_frames: DEFAULT_PRE_DELAY_FRAMES,
            detector_average: 0.0,
            compressor_gain: 1.0,
            metering_gain: 1.0,
            metering_release_k: 0.0,
            db_max_attack_compression_diff: -1.0,
            ratio: UNINITIALIZED,
            slope: UNINITIALIZED,
            linear_threshold: UNINITIALIZED,
            db_threshold: UNINITIALIZED,
            db_knee: UNINITIALIZED,
            knee_threshold: UNINITIALIZED,
            db_knee_threshold: UNINITIALIZED,
            db_yknee_threshold: UNINITIALIZED,
            knee: UNINITIALIZED,
            reduction: 0.0,
        };
        c.reset();
        c.metering_release_k = super::param::discrete_time_constant(METERING_RELEASE_TIME_CONSTANT as f64, sample_rate as f64) as f32;
        c
    }

    pub fn reset(&mut self) {
        self.detector_average = 0.0;
        self.compressor_gain = 1.0;
        self.metering_gain = 1.0;
        for b in self.pre_delay.iter_mut() {
            b.iter_mut().for_each(|v| *v = 0.0);
        }
        self.pre_delay_read = 0;
        self.pre_delay_write = DEFAULT_PRE_DELAY_FRAMES;
        self.db_max_attack_compression_diff = -1.0;
    }

    /// `TailTime() + LatencyTime()`.
    pub fn tail_and_latency(&self) -> f64 {
        5.0 * METERING_RELEASE_TIME_CONSTANT as f64 + self.last_pre_delay_frames as f64 / self.sample_rate as f64
    }

    fn set_pre_delay_time(&mut self, t: f32) {
        let mut frames = (t * self.sample_rate) as usize;
        if frames > MAX_PRE_DELAY_FRAMES - 1 {
            frames = MAX_PRE_DELAY_FRAMES - 1;
        }
        if self.last_pre_delay_frames != frames {
            self.last_pre_delay_frames = frames;
            for b in self.pre_delay.iter_mut() {
                b.iter_mut().for_each(|v| *v = 0.0);
            }
            self.pre_delay_read = 0;
            self.pre_delay_write = frames;
        }
    }

    fn knee_curve(&self, x: f32, k: f32) -> f32 {
        if x < self.linear_threshold {
            return x;
        }
        self.linear_threshold + (1.0 - ((-k * (x - self.linear_threshold)) as f64).exp() as f32) / k
    }

    fn saturate(&self, x: f32, k: f32) -> f32 {
        if x < self.knee_threshold {
            return self.knee_curve(x, k);
        }
        let db_x = linear_to_db(x);
        let db_y = self.db_yknee_threshold + self.slope * (db_x - self.db_knee_threshold);
        db_to_linear(db_y)
    }

    fn k_at_slope(&self, desired_slope: f32) -> f32 {
        let db_x = self.db_threshold + self.db_knee;
        let x = db_to_linear(db_x);
        let mut x2 = 1.0f32;
        let mut db_x2 = 0.0f32;
        if !(x < self.linear_threshold) {
            x2 = (x as f64 * 1.001) as f32;
            db_x2 = linear_to_db(x2);
        }
        let mut min_k = 0.1f32;
        let mut max_k = 10000.0f32;
        let mut k = 5.0f32;
        let mut slope = 1.0f32;
        for _ in 0..15 {
            if !(x < self.linear_threshold) {
                let db_y = linear_to_db(self.knee_curve(x, k));
                let db_y2 = linear_to_db(self.knee_curve(x2, k));
                slope = (db_y2 - db_y) / (db_x2 - db_x);
            }
            if slope < desired_slope {
                max_k = k;
            } else {
                min_k = k;
            }
            k = (min_k * max_k).sqrt();
        }
        k
    }

    fn update_static_curve(&mut self, db_threshold: f32, db_knee: f32, ratio: f32) -> f32 {
        if db_threshold != self.db_threshold || db_knee != self.db_knee || ratio != self.ratio {
            self.db_threshold = db_threshold;
            self.linear_threshold = db_to_linear(db_threshold);
            self.db_knee = db_knee;
            self.ratio = ratio;
            self.slope = 1.0 / self.ratio;
            let k = self.k_at_slope(1.0 / self.ratio);
            self.db_knee_threshold = db_threshold + db_knee;
            self.knee_threshold = db_to_linear(self.db_knee_threshold);
            self.db_yknee_threshold = linear_to_db(self.knee_curve(self.knee_threshold, k));
            self.knee = k;
        }
        self.knee
    }

    /// `DynamicsCompressor::Process` of `n` frames (a multiple of 32):
    /// `input` one or two channels, `out` two.
    #[allow(clippy::too_many_arguments)]
    pub fn process(&mut self, input: [&[f32]; 2], input_channels: usize, out: &mut [[f32; 128]; 2], n: usize, threshold: f32, knee: f32, ratio: f32, attack: f32, release: f32) {
        let sample_rate = self.sample_rate;
        let k = self.update_static_curve(threshold, knee, ratio);
        let linear_post_gain = fdlibm_powf(1.0 / self.saturate(1.0, k), 0.6);
        let attack_frames = 0.001f32.max(attack) * sample_rate;
        let release_frames = sample_rate * release;
        let sat_release_frames = SAT_RELEASE_TIME * sample_rate;
        let a = release_frames * a_base();
        let b = release_frames * b_base();
        let c = release_frames * c_base();
        let d = release_frames * d_base();
        let e = release_frames * e_base();
        self.set_pre_delay_time(PRE_DELAY);
        let divisions = n / DIVISION_FRAMES;
        let mut frame = 0usize;
        for _ in 0..divisions {
            self.detector_average = ensure_finite(self.detector_average, 1.0);
            let desired_gain = self.detector_average;
            let scaled_desired_gain = fdlibm_asinf(desired_gain as f64) / PI_OVER_TWO_FLOAT;
            let envelope_rate;
            let is_releasing = scaled_desired_gain > self.compressor_gain;
            let mut db_compression_diff = if scaled_desired_gain == 0.0 {
                if is_releasing {
                    -1.0
                } else {
                    1.0
                }
            } else {
                linear_to_db(self.compressor_gain / scaled_desired_gain)
            };
            if is_releasing {
                self.db_max_attack_compression_diff = -1.0;
                db_compression_diff = ensure_finite(db_compression_diff, -1.0);
                let mut x = db_compression_diff;
                x = x.clamp(-12.0, 0.0);
                x = 0.25 * (x + 12.0);
                let x2 = x * x;
                let x3 = x2 * x;
                let x4 = x2 * x2;
                let calc_release_frames = a + b * x + c * x2 + d * x3 + e * x4;
                let db_per_frame = 5.0 / calc_release_frames;
                envelope_rate = db_to_linear(db_per_frame);
            } else {
                db_compression_diff = ensure_finite(db_compression_diff, 1.0);
                if self.db_max_attack_compression_diff == -1.0 || self.db_max_attack_compression_diff < db_compression_diff {
                    self.db_max_attack_compression_diff = db_compression_diff;
                }
                let db_eff_atten_diff = 0.5f32.max(self.db_max_attack_compression_diff);
                let x = 0.25 / db_eff_atten_diff;
                envelope_rate = 1.0 - fdlibm_powf(x, 1.0 / attack_frames);
            }
            let mut read = self.pre_delay_read;
            let mut write = self.pre_delay_write;
            let mut detector_average = self.detector_average;
            let mut compressor_gain = self.compressor_gain;
            for _ in 0..DIVISION_FRAMES {
                let mut compressor_input = 0.0f32;
                for j in 0..2 {
                    let src = if input_channels > j { input[j] } else { input[0] };
                    let undelayed = src[frame];
                    self.pre_delay[j][write] = undelayed;
                    let abs = if undelayed > 0.0 { undelayed } else { -undelayed };
                    if compressor_input < abs {
                        compressor_input = abs;
                    }
                }
                let scaled_input = compressor_input;
                let abs_input = if scaled_input > 0.0 { scaled_input } else { -scaled_input };
                let shaped_input = self.saturate(abs_input, k);
                let attenuation = if abs_input <= 0.0001 { 1.0 } else { shaped_input / abs_input };
                let db_attenuation = 2.0f32.max(-linear_to_db(attenuation));
                let db_per_frame = db_attenuation / sat_release_frames;
                let sat_release_rate = db_to_linear(db_per_frame) - 1.0;
                let is_release = attenuation > detector_average;
                let rate = if is_release { sat_release_rate } else { 1.0 };
                detector_average += (attenuation - detector_average) * rate;
                detector_average = 1.0f32.min(detector_average);
                detector_average = ensure_finite(detector_average, 1.0);
                if envelope_rate < 1.0 {
                    compressor_gain += (scaled_desired_gain - compressor_gain) * envelope_rate;
                } else {
                    compressor_gain *= envelope_rate;
                    compressor_gain = 1.0f32.min(compressor_gain);
                }
                let post_warp = ((PI_OVER_TWO_FLOAT * compressor_gain) as f64).sin() as f32;
                let total_gain = linear_post_gain * post_warp;
                let db_real_gain = linear_to_db(post_warp);
                if db_real_gain < self.metering_gain {
                    self.metering_gain = db_real_gain;
                } else {
                    self.metering_gain += (db_real_gain - self.metering_gain) * self.metering_release_k;
                }
                for j in 0..2 {
                    out[j][frame] = self.pre_delay[j][read] * total_gain;
                }
                frame += 1;
                read = (read + 1) & MAX_PRE_DELAY_MASK;
                write = (write + 1) & MAX_PRE_DELAY_MASK;
            }
            self.pre_delay_read = read;
            self.pre_delay_write = write;
            self.detector_average = flush(detector_average);
            self.compressor_gain = flush(compressor_gain);
        }
        self.reduction = self.metering_gain;
    }
}
