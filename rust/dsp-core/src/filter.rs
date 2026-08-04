//! Filters.
//!
//! One of these exists specifically because Web Audio could not provide it.
//! Both the H90 and the DP/4 put a **resonance** control on their shelving
//! filters, and the Web Audio spec says `lowshelf` and `highshelf` ignore `Q`
//! entirely — so the browser build had to fake it with a peaking filter parked
//! at the corner. Here the shelf takes the RBJ slope parameter `S` directly and
//! the control does what the manual says it does.

use crate::{clamp, flush};
use core::f32::consts::PI;

/// One-pole lowpass. The damping filter inside every reverb tank.
#[derive(Clone, Copy, Debug, Default)]
pub struct OnePole {
    a: f32,
    z: f32,
}

impl OnePole {
    pub fn new() -> Self {
        Self::default()
    }

    /// Set the corner frequency. Clamped inside the Nyquist limit.
    pub fn set_cutoff(&mut self, hz: f32, sample_rate: f32) {
        let nyquist = sample_rate * 0.5;
        let hz = clamp(hz, 1.0, nyquist * 0.99);
        self.a = (-2.0 * PI * hz / sample_rate).exp();
    }

    /// Set the pole directly, for the Jot damping design in [`crate::fdn`].
    pub fn set_pole(&mut self, a: f32) {
        self.a = clamp(a, -0.999, 0.999);
    }

    pub fn pole(&self) -> f32 {
        self.a
    }

    pub fn clear(&mut self) {
        self.z = 0.0;
    }

    #[inline(always)]
    pub fn process(&mut self, x: f32) -> f32 {
        self.z = flush(x * (1.0 - self.a) + self.z * self.a);
        self.z
    }
}

/// Biquad shapes, as the audio EQ cookbook defines them.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BiquadKind {
    LowPass,
    HighPass,
    BandPass,
    Notch,
    AllPass,
    Peaking,
    LowShelf,
    HighShelf,
}

/// A biquad in transposed direct form II.
///
/// TDF2 rather than DF1: it needs two state variables instead of four and has
/// the better numerical behaviour in `f32`, which matters when a filter sits
/// inside a feedback loop being asked to run for four minutes.
#[derive(Clone, Copy, Debug)]
pub struct Biquad {
    b0: f32,
    b1: f32,
    b2: f32,
    a1: f32,
    a2: f32,
    s1: f32,
    s2: f32,
}

impl Default for Biquad {
    fn default() -> Self {
        Self::identity()
    }
}

impl Biquad {
    /// A filter that passes everything, exactly.
    pub fn identity() -> Self {
        Self { b0: 1.0, b1: 0.0, b2: 0.0, a1: 0.0, a2: 0.0, s1: 0.0, s2: 0.0 }
    }

    pub fn clear(&mut self) {
        self.s1 = 0.0;
        self.s2 = 0.0;
    }

    #[inline(always)]
    pub fn process(&mut self, x: f32) -> f32 {
        let y = self.b0 * x + self.s1;
        self.s1 = flush(self.b1 * x - self.a1 * y + self.s2);
        self.s2 = flush(self.b2 * x - self.a2 * y);
        y
    }

    /// Design the filter. `q` is Q for the resonant shapes and the **shelf
    /// slope `S`** for the two shelves.
    ///
    /// `S = 1` is the steepest shelf that stays monotonic. Above it the shelf
    /// overshoots — a bump at the corner and a dip on the far side — which is
    /// exactly the "much more filtered sound" the H90's Resonance control
    /// describes, and exactly what a Web Audio shelf refuses to do.
    pub fn set(&mut self, kind: BiquadKind, hz: f32, q: f32, gain_db: f32, sample_rate: f32) {
        let nyquist = sample_rate * 0.5;
        let hz = clamp(hz, 1.0, nyquist * 0.99);
        let w0 = 2.0 * PI * hz / sample_rate;
        let (sin_w0, cos_w0) = (w0.sin(), w0.cos());
        let a_gain = (10.0f32).powf(gain_db / 40.0);

        let (b0, b1, b2, a0, a1, a2) = match kind {
            BiquadKind::LowShelf | BiquadKind::HighShelf => {
                // The slope constraint. `(A + 1/A)(1/S − 1) + 2` must stay
                // positive or the square root is imaginary; at ±18 dB that
                // caps S near 2.7, so the requested slope is clamped rather
                // than allowed to produce a NaN that would silence the graph.
                let s = clamp(q, 0.05, 8.0);
                let a_sum = a_gain + 1.0 / a_gain;
                let max_s = if a_sum > 2.0 { 1.0 / (1.0 - 2.0 / a_sum) } else { 8.0 };
                let s = if max_s > 0.0 { clamp(s, 0.05, 0.95 * max_s) } else { s.min(1.0) };

                let arg = (a_sum * (1.0 / s - 1.0) + 2.0).max(0.0);
                let alpha = sin_w0 * 0.5 * arg.sqrt();
                let two_sqrt_a_alpha = 2.0 * a_gain.sqrt() * alpha;

                if kind == BiquadKind::LowShelf {
                    (
                        a_gain * ((a_gain + 1.0) - (a_gain - 1.0) * cos_w0 + two_sqrt_a_alpha),
                        2.0 * a_gain * ((a_gain - 1.0) - (a_gain + 1.0) * cos_w0),
                        a_gain * ((a_gain + 1.0) - (a_gain - 1.0) * cos_w0 - two_sqrt_a_alpha),
                        (a_gain + 1.0) + (a_gain - 1.0) * cos_w0 + two_sqrt_a_alpha,
                        -2.0 * ((a_gain - 1.0) + (a_gain + 1.0) * cos_w0),
                        (a_gain + 1.0) + (a_gain - 1.0) * cos_w0 - two_sqrt_a_alpha,
                    )
                } else {
                    (
                        a_gain * ((a_gain + 1.0) + (a_gain - 1.0) * cos_w0 + two_sqrt_a_alpha),
                        -2.0 * a_gain * ((a_gain - 1.0) + (a_gain + 1.0) * cos_w0),
                        a_gain * ((a_gain + 1.0) + (a_gain - 1.0) * cos_w0 - two_sqrt_a_alpha),
                        (a_gain + 1.0) - (a_gain - 1.0) * cos_w0 + two_sqrt_a_alpha,
                        2.0 * ((a_gain - 1.0) - (a_gain + 1.0) * cos_w0),
                        (a_gain + 1.0) - (a_gain - 1.0) * cos_w0 - two_sqrt_a_alpha,
                    )
                }
            }
            _ => {
                let q = clamp(q, 0.05, 40.0);
                let alpha = sin_w0 / (2.0 * q);
                match kind {
                    BiquadKind::LowPass => (
                        (1.0 - cos_w0) * 0.5,
                        1.0 - cos_w0,
                        (1.0 - cos_w0) * 0.5,
                        1.0 + alpha,
                        -2.0 * cos_w0,
                        1.0 - alpha,
                    ),
                    BiquadKind::HighPass => (
                        (1.0 + cos_w0) * 0.5,
                        -(1.0 + cos_w0),
                        (1.0 + cos_w0) * 0.5,
                        1.0 + alpha,
                        -2.0 * cos_w0,
                        1.0 - alpha,
                    ),
                    BiquadKind::BandPass => {
                        (alpha, 0.0, -alpha, 1.0 + alpha, -2.0 * cos_w0, 1.0 - alpha)
                    }
                    BiquadKind::Notch => {
                        (1.0, -2.0 * cos_w0, 1.0, 1.0 + alpha, -2.0 * cos_w0, 1.0 - alpha)
                    }
                    BiquadKind::AllPass => (
                        1.0 - alpha,
                        -2.0 * cos_w0,
                        1.0 + alpha,
                        1.0 + alpha,
                        -2.0 * cos_w0,
                        1.0 - alpha,
                    ),
                    // Peaking
                    _ => (
                        1.0 + alpha * a_gain,
                        -2.0 * cos_w0,
                        1.0 - alpha * a_gain,
                        1.0 + alpha / a_gain,
                        -2.0 * cos_w0,
                        1.0 - alpha / a_gain,
                    ),
                }
            }
        };

        let a0 = if a0.abs() < 1.0e-12 { 1.0e-12 } else { a0 };
        self.b0 = b0 / a0;
        self.b1 = b1 / a0;
        self.b2 = b2 / a0;
        self.a1 = a1 / a0;
        self.a2 = a2 / a0;

        if !(self.b0.is_finite() && self.b1.is_finite() && self.b2.is_finite()
            && self.a1.is_finite() && self.a2.is_finite())
        {
            *self = Self::identity();
        }
    }

    /// Magnitude response at `hz`. For tests, not for the audio path.
    pub fn magnitude_at(&self, hz: f32, sample_rate: f32) -> f32 {
        let w = 2.0 * PI * hz / sample_rate;
        let (cw, sw) = (w.cos(), w.sin());
        let (c2w, s2w) = ((2.0 * w).cos(), (2.0 * w).sin());
        let num_re = self.b0 + self.b1 * cw + self.b2 * c2w;
        let num_im = -(self.b1 * sw + self.b2 * s2w);
        let den_re = 1.0 + self.a1 * cw + self.a2 * c2w;
        let den_im = -(self.a1 * sw + self.a2 * s2w);
        ((num_re * num_re + num_im * num_im) / (den_re * den_re + den_im * den_im)).sqrt()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SR: f32 = 48_000.0;

    fn db(x: f32) -> f32 {
        20.0 * x.log10()
    }

    #[test]
    fn identity_passes_signal_untouched() {
        let mut f = Biquad::identity();
        for x in [1.0f32, -0.5, 0.25, 0.0] {
            assert_eq!(f.process(x), x);
        }
    }

    #[test]
    fn shelf_at_zero_db_is_transparent_at_every_slope() {
        // Both manuals promise this: "when the filters are set to 0, this does
        // nothing". It has to hold for every resonance setting, or the
        // resonance control becomes an EQ that is never truly flat.
        for s in [0.3f32, 0.7, 1.0, 2.0, 3.0] {
            for kind in [BiquadKind::LowShelf, BiquadKind::HighShelf] {
                let mut f = Biquad::identity();
                f.set(kind, 350.0, s, 0.0, SR);
                for hz in [20.0f32, 100.0, 350.0, 1000.0, 10_000.0] {
                    let mag = f.magnitude_at(hz, SR);
                    assert!(
                        db(mag).abs() < 0.01,
                        "{kind:?} S={s} at {hz} Hz: {} dB",
                        db(mag)
                    );
                }
            }
        }
    }

    #[test]
    fn shelf_reaches_its_gain_in_the_right_band() {
        let mut low = Biquad::identity();
        low.set(BiquadKind::LowShelf, 350.0, 1.0, 12.0, SR);
        assert!((db(low.magnitude_at(20.0, SR)) - 12.0).abs() < 0.5);
        assert!(db(low.magnitude_at(10_000.0, SR)).abs() < 0.5);

        let mut high = Biquad::identity();
        high.set(BiquadKind::HighShelf, 2000.0, 1.0, -12.0, SR);
        assert!((db(high.magnitude_at(18_000.0, SR)) + 12.0).abs() < 0.5);
        assert!(db(high.magnitude_at(50.0, SR)).abs() < 0.5);
    }

    #[test]
    fn shelf_slope_above_one_produces_the_resonant_overshoot() {
        // The whole reason this filter exists rather than a Web Audio shelf.
        // At S > 1 the shelf must overshoot its own gain near the corner.
        let mut flat = Biquad::identity();
        flat.set(BiquadKind::LowShelf, 350.0, 1.0, 12.0, SR);
        let mut resonant = Biquad::identity();
        resonant.set(BiquadKind::LowShelf, 350.0, 2.5, 12.0, SR);

        let peak_flat = (200..600)
            .map(|hz| flat.magnitude_at(hz as f32, SR))
            .fold(0.0f32, f32::max);
        let peak_resonant = (200..600)
            .map(|hz| resonant.magnitude_at(hz as f32, SR))
            .fold(0.0f32, f32::max);

        assert!(
            db(peak_resonant) > db(peak_flat) + 0.5,
            "S=2.5 peaked at {} dB, S=1 at {} dB — no overshoot",
            db(peak_resonant),
            db(peak_flat)
        );
    }

    #[test]
    fn extreme_shelf_settings_never_produce_nan() {
        // The slope clamp exists because the cookbook's square root goes
        // imaginary at high gain and high S. A NaN here would propagate through
        // the tank and silence the whole rack permanently.
        for gain in [-48.0f32, -24.0, 0.0, 12.0, 24.0] {
            for s in [0.05f32, 1.0, 8.0, 100.0] {
                let mut f = Biquad::identity();
                f.set(BiquadKind::LowShelf, 350.0, s, gain, SR);
                let y = f.process(0.5);
                assert!(y.is_finite(), "gain {gain} S {s} produced {y}");
            }
        }
    }

    #[test]
    fn filters_reject_out_of_range_frequencies_without_panicking() {
        let mut f = Biquad::identity();
        for hz in [-100.0f32, 0.0, 1.0, SR, SR * 10.0] {
            f.set(BiquadKind::LowPass, hz, 0.7, 0.0, SR);
            assert!(f.process(1.0).is_finite(), "cutoff {hz} broke the filter");
        }
    }

    #[test]
    fn one_pole_lowpass_attenuates_above_its_corner() {
        let mut f = OnePole::new();
        f.set_cutoff(1000.0, SR);
        let measure = |f: &mut OnePole, hz: f32| {
            f.clear();
            let mut peak = 0.0f32;
            for n in 0..20_000 {
                let y = f.process((2.0 * PI * hz * n as f32 / SR).sin());
                if n > 10_000 {
                    peak = peak.max(y.abs());
                }
            }
            peak
        };
        let low = measure(&mut f, 100.0);
        let high = measure(&mut f, 10_000.0);
        assert!(low > 0.9, "passband attenuated to {low}");
        assert!(high < 0.2, "stopband only reached {high}");
    }

    #[test]
    fn one_pole_state_decays_to_exact_zero() {
        // Denormal proof. Without the flush this settles at ~1e-40 and stays
        // there, and every subsequent multiply pays the denormal penalty.
        let mut f = OnePole::new();
        f.set_cutoff(2000.0, SR);
        f.process(1.0);
        for _ in 0..200_000 {
            f.process(0.0);
        }
        assert_eq!(f.process(0.0), 0.0, "one-pole state never reached zero");
    }
}
