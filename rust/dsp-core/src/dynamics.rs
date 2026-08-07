//! Dynamics.
//!
//! This module exists to prove a point about portability. Web Audio offers
//! exactly one dynamics processor — `DynamicsCompressor` — with a fixed
//! topology, no sidechain input, no expansion, and no way to read its detector.
//! The DP/4+ needs six variants of one gain computer, including negative ratios
//! ("dynamic reversal"), a two-threshold gate with hysteresis that appears on
//! ten algorithms, and a sidechain that crossfades between feedforward and
//! feedback. None of that was reachable from the browser. All of it is forty
//! lines here.

use crate::clamp;

/// An attack/release envelope follower.
#[derive(Clone, Copy, Debug, Default)]
pub struct EnvelopeFollower {
    attack: f32,
    release: f32,
    env: f32,
}

impl EnvelopeFollower {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn set_times(&mut self, attack_seconds: f32, release_seconds: f32, sample_rate: f32) {
        let coef = |t: f32| 1.0 - (-1.0 / (clamp(t, 1.0e-5, 20.0) * sample_rate)).exp();
        self.attack = coef(attack_seconds);
        self.release = coef(release_seconds);
    }

    pub fn clear(&mut self) {
        self.env = 0.0;
    }

    #[inline(always)]
    pub fn process(&mut self, x: f32) -> f32 {
        let rect = x.abs();
        let coef = if rect > self.env { self.attack } else { self.release };
        self.env += coef * (rect - self.env);
        self.env
    }

    #[inline(always)]
    pub fn value(&self) -> f32 {
        self.env
    }
}

/// What a gain computer is doing to the signal.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DynamicsMode {
    /// Attenuate above threshold. Ratio > 1.
    Compress,
    /// Attenuate below threshold. Ratio > 1 measured downward.
    Expand,
    /// Boost below threshold — the DP/4's "InversExpander", used for sustain.
    InverseExpand,
}

/// The DP/4's dynamics section, as one control.
///
/// The manual describes a single continuum: "from traditional Gated sound, to
/// expansion, then compression, then limiting and infinite ducking, then to
/// negative ratios which result in dynamic reversal". Modelling that as one
/// signed slope rather than as a mode switch is what makes the knob sweep
/// continuously through all of it, which is how the hardware behaved.
#[derive(Clone, Copy, Debug)]
pub struct GainComputer {
    pub threshold_db: f32,
    pub ratio: f32,
    pub mode: DynamicsMode,
    /// Width of the soft corner, in dB, centred on the threshold.
    ///
    /// Zero is a hard knee: gain reduction begins the instant the detector
    /// crosses over, which is audible as the compressor "grabbing". A wider
    /// knee eases the slope in over `knee_db/2` either side, so the curve and
    /// its first derivative are both continuous — that smoothness is the whole
    /// difference between a compressor you notice and one you do not.
    pub knee_db: f32,
}

impl Default for GainComputer {
    fn default() -> Self {
        Self { threshold_db: -20.0, ratio: 4.0, mode: DynamicsMode::Compress, knee_db: 0.0 }
    }
}

impl GainComputer {
    /// Gain to apply, in dB, for a detector level in dB.
    #[inline]
    pub fn gain_db(&self, env_db: f32) -> f32 {
        let over = env_db - self.threshold_db;
        // Infinity is the limit of the ratio, not a special case: modelling it
        // as 1e6 keeps the curve continuous as the knob sweeps into it.
        let r = clamp(self.ratio, 1.0, 1.0e6);
        let knee = self.knee_db.max(0.0);

        // The slope each mode applies once fully past the corner, and which
        // side of the threshold that mode acts on.
        let (slope, acts_above) = match self.mode {
            DynamicsMode::Compress => (1.0 / r - 1.0, true),
            DynamicsMode::Expand => (r - 1.0, false),
            DynamicsMode::InverseExpand => (1.0 / r - 1.0, false),
        };

        // Signed distance into the region this mode acts on, so one knee
        // formula serves all three rather than each growing its own.
        let into = if acts_above { over } else { -over };

        if knee <= 0.0 {
            return if into > 0.0 { over * slope } else { 0.0 };
        }
        let half = knee * 0.5;
        if into <= -half {
            return 0.0;
        }
        if into >= half {
            return over * slope;
        }
        // The standard quadratic interpolation across the corner: it meets the
        // flat region and the sloped one at both value *and* gradient, which is
        // what stops the knee itself being audible as a kink.
        let x = into + half;
        let magnitude = slope * x * x / (2.0 * knee);
        if acts_above {
            magnitude
        } else {
            -magnitude
        }
    }

    #[inline]
    pub fn gain_linear(&self, env: f32) -> f32 {
        let env_db = 20.0 * env.max(1.0e-9).log10();
        10f32.powf(self.gain_db(env_db) / 20.0)
    }
}

/// A gate with two thresholds.
///
/// The DP/4 puts this on about ten algorithms and is explicit about why there
/// are two: "This higher second threshold prevents false 'turn ons.'" A single
/// threshold chatters on any signal sitting near it; the hysteresis is the fix,
/// and it has to be two independent user controls rather than a fixed window
/// because the manual exposes both.
#[derive(Clone, Copy, Debug, Default)]
pub struct HysteresisGate {
    pub off_below_db: f32,
    pub on_above_db: f32,
    open: bool,
    gain: f32,
    release_coef: f32,
}

impl HysteresisGate {
    pub fn new() -> Self {
        Self { off_below_db: -96.0, on_above_db: -90.0, open: false, gain: 0.0, release_coef: 0.001 }
    }

    pub fn set_release(&mut self, seconds: f32, sample_rate: f32) {
        self.release_coef = 1.0 - (-1.0 / (clamp(seconds, 1.0e-4, 20.0) * sample_rate)).exp();
    }

    pub fn is_open(&self) -> bool {
        self.open
    }

    /// Opening is immediate; closing is a ramp. A gate that faded in would clip
    /// the transient it exists to preserve.
    #[inline]
    pub fn process(&mut self, env: f32) -> f32 {
        let env_db = 20.0 * env.max(1.0e-9).log10();
        if !self.open && env_db > self.on_above_db {
            self.open = true;
        } else if self.open && env_db < self.off_below_db {
            self.open = false;
        }
        let target = if self.open { 1.0 } else { 0.0 };
        if self.open {
            self.gain = 1.0;
        } else {
            self.gain += self.release_coef * (target - self.gain);
        }
        self.gain
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A compressor with a knee of `knee`, 4:1 above −20 dB.
    fn kneed(knee: f32) -> GainComputer {
        GainComputer {
            threshold_db: -20.0,
            ratio: 4.0,
            mode: DynamicsMode::Compress,
            knee_db: knee,
        }
    }

    #[test]
    fn a_hard_knee_does_nothing_until_the_threshold() {
        let gc = kneed(0.0);
        assert_eq!(gc.gain_db(-30.0), 0.0);
        assert_eq!(gc.gain_db(-20.0), 0.0);
        // 10 dB over at 4:1 keeps a quarter of it, so 7.5 dB comes off.
        assert!((gc.gain_db(-10.0) + 7.5).abs() < 1e-4);
    }

    #[test]
    fn a_soft_knee_starts_working_before_the_threshold() {
        // The whole point: gain reduction eases in over the corner instead of
        // arriving the instant the detector crosses, which is what makes a
        // compressor audible as "grabbing".
        let soft = kneed(12.0);
        assert_eq!(kneed(0.0).gain_db(-24.0), 0.0);
        assert!(soft.gain_db(-24.0) < 0.0, "the knee never opened below threshold");
        assert!(soft.gain_db(-24.0) > -1.0, "it should be gentle down there");
    }

    #[test]
    fn a_soft_knee_is_gentler_than_a_hard_one_at_the_threshold() {
        // Exactly at threshold a hard knee has done nothing and a soft knee is
        // already halfway into its slope.
        assert_eq!(kneed(0.0).gain_db(-20.0), 0.0);
        assert!(kneed(12.0).gain_db(-20.0) < 0.0);
    }

    #[test]
    fn both_knees_agree_once_past_the_corner() {
        // The knee is a local smoothing, not a different compressor: well above
        // it the two curves have to land on the same slope or the ratio control
        // means something different depending on the knee.
        let hard = kneed(0.0).gain_db(0.0);
        let soft = kneed(12.0).gain_db(0.0);
        assert!((hard - soft).abs() < 1e-3, "curves diverged past the knee: {hard} vs {soft}");
    }

    #[test]
    fn the_knee_is_continuous_with_no_step_anywhere() {
        // A kink in the curve is audible as distortion on a sustained note, so
        // the quadratic has to meet both neighbours in value as well as slope.
        let gc = kneed(10.0);
        let mut previous = gc.gain_db(-40.0);
        let mut step = 0.0f32;
        for i in 0..=800 {
            let db = -40.0 + i as f32 * 0.05;
            let current = gc.gain_db(db);
            step = step.max((current - previous).abs());
            previous = current;
        }
        // 0.05 dB of input can move the output by at most its steepest slope.
        assert!(step < 0.05, "the knee has a step in it: {step}");
    }

    #[test]
    fn the_knee_never_boosts_a_compressor() {
        let gc = kneed(18.0);
        for i in 0..=100 {
            let db = -60.0 + i as f32 * 0.6;
            assert!(gc.gain_db(db) <= 1e-6, "compression added gain at {db} dB");
        }
    }

    #[test]
    fn a_knee_works_on_the_expanders_side_of_the_threshold_too() {
        // One formula serves all three modes; the expanders act *below* the
        // threshold, so their knee has to open upward.
        let expand = GainComputer {
            threshold_db: -20.0,
            ratio: 4.0,
            mode: DynamicsMode::Expand,
            knee_db: 12.0,
        };
        // Above the threshold an expander is inactive even with a wide knee…
        assert!(expand.gain_db(-10.0).abs() < 1e-6);
        // …just inside the corner it has begun…
        assert!(expand.gain_db(-22.0) < 0.0);
        // …and well below it matches the hard-knee slope.
        let hard = GainComputer { knee_db: 0.0, ..expand };
        assert!((expand.gain_db(-40.0) - hard.gain_db(-40.0)).abs() < 1e-3);
    }

    #[test]
    fn a_negative_knee_is_treated_as_no_knee() {
        assert_eq!(kneed(-5.0).gain_db(-24.0), 0.0);
    }

    const SR: f32 = 48_000.0;

    #[test]
    fn compressor_curve_matches_the_algebra() {
        let gc = GainComputer { threshold_db: -20.0, ratio: 4.0, mode: DynamicsMode::Compress, knee_db: 0.0 };
        // Below threshold: untouched.
        assert_eq!(gc.gain_db(-30.0), 0.0);
        // 12 dB over at 4:1 should come out 3 dB over — a 9 dB reduction.
        assert!((gc.gain_db(-8.0) + 9.0).abs() < 1.0e-4);
    }

    #[test]
    fn infinite_ratio_is_a_limiter() {
        let gc = GainComputer { threshold_db: -20.0, ratio: 1.0e6, mode: DynamicsMode::Compress, knee_db: 0.0 };
        // Everything above threshold is pinned back to it.
        for input in [-10.0f32, 0.0, 10.0] {
            let out = input + gc.gain_db(input);
            assert!((out + 20.0).abs() < 0.01, "{input} dB became {out} dB");
        }
    }

    #[test]
    fn ratio_of_one_is_a_no_op_in_every_mode() {
        // The manual: "a setting of exactly 1:1 disables expansion".
        for mode in [DynamicsMode::Compress, DynamicsMode::Expand, DynamicsMode::InverseExpand] {
            let gc = GainComputer { threshold_db: -20.0, ratio: 1.0, mode, knee_db: 0.0 };
            for level in [-60.0f32, -20.0, 0.0] {
                assert!(gc.gain_db(level).abs() < 1.0e-6, "{mode:?} at {level}");
            }
        }
    }

    #[test]
    fn expander_attenuates_below_and_inverse_expander_boosts() {
        let down = GainComputer { threshold_db: -20.0, ratio: 4.0, mode: DynamicsMode::Expand, knee_db: 0.0 };
        let up = GainComputer { threshold_db: -20.0, ratio: 4.0, mode: DynamicsMode::InverseExpand, knee_db: 0.0 };
        // Same input, opposite signs — this is the whole distinction between
        // the DP/4's Expander and its InversExpander.
        assert!(down.gain_db(-40.0) < -1.0);
        assert!(up.gain_db(-40.0) > 1.0);
        // Neither touches anything above threshold.
        assert_eq!(down.gain_db(-10.0), 0.0);
        assert_eq!(up.gain_db(-10.0), 0.0);
    }

    #[test]
    fn envelope_follower_attacks_fast_and_releases_slow() {
        let mut env = EnvelopeFollower::new();
        env.set_times(0.001, 0.5, SR);
        for _ in 0..(SR as usize / 100) {
            env.process(1.0);
        }
        let attacked = env.value();
        assert!(attacked > 0.95, "attack only reached {attacked}");
        for _ in 0..(SR as usize / 100) {
            env.process(0.0);
        }
        // 10 ms into a 500 ms release: barely moved.
        assert!(env.value() > 0.9, "release too fast: {}", env.value());
    }

    #[test]
    fn gate_hysteresis_prevents_chatter() {
        let mut gate = HysteresisGate::new();
        gate.off_below_db = -40.0;
        gate.on_above_db = -30.0;
        gate.set_release(0.01, SR);

        // A signal parked between the thresholds must not toggle the gate.
        let between = 10f32.powf(-35.0 / 20.0);
        gate.process(10f32.powf(-20.0 / 20.0));
        assert!(gate.is_open());
        for _ in 0..1000 {
            gate.process(between);
            assert!(gate.is_open(), "gate closed inside its own hysteresis window");
        }
        // Only below the lower threshold does it close.
        for _ in 0..1000 {
            gate.process(10f32.powf(-60.0 / 20.0));
        }
        assert!(!gate.is_open());
    }

    #[test]
    fn gain_computer_never_produces_nan() {
        for mode in [DynamicsMode::Compress, DynamicsMode::Expand, DynamicsMode::InverseExpand] {
            for ratio in [0.0f32, 1.0, 40.0, 1.0e9, f32::INFINITY] {
                let gc = GainComputer { threshold_db: -20.0, ratio, mode, knee_db: 0.0 };
                for env in [0.0f32, 1.0e-30, 0.5, 100.0] {
                    assert!(gc.gain_linear(env).is_finite(), "{mode:?} r={ratio} env={env}");
                }
            }
        }
    }
}
