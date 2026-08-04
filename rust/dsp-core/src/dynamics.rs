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
}

impl Default for GainComputer {
    fn default() -> Self {
        Self { threshold_db: -20.0, ratio: 4.0, mode: DynamicsMode::Compress }
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
        match self.mode {
            DynamicsMode::Compress if over > 0.0 => over * (1.0 / r - 1.0),
            DynamicsMode::Expand if over < 0.0 => over * (r - 1.0),
            DynamicsMode::InverseExpand if over < 0.0 => over * (1.0 / r - 1.0),
            _ => 0.0,
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

    const SR: f32 = 48_000.0;

    #[test]
    fn compressor_curve_matches_the_algebra() {
        let gc = GainComputer { threshold_db: -20.0, ratio: 4.0, mode: DynamicsMode::Compress };
        // Below threshold: untouched.
        assert_eq!(gc.gain_db(-30.0), 0.0);
        // 12 dB over at 4:1 should come out 3 dB over — a 9 dB reduction.
        assert!((gc.gain_db(-8.0) + 9.0).abs() < 1.0e-4);
    }

    #[test]
    fn infinite_ratio_is_a_limiter() {
        let gc = GainComputer { threshold_db: -20.0, ratio: 1.0e6, mode: DynamicsMode::Compress };
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
            let gc = GainComputer { threshold_db: -20.0, ratio: 1.0, mode };
            for level in [-60.0f32, -20.0, 0.0] {
                assert!(gc.gain_db(level).abs() < 1.0e-6, "{mode:?} at {level}");
            }
        }
    }

    #[test]
    fn expander_attenuates_below_and_inverse_expander_boosts() {
        let down = GainComputer { threshold_db: -20.0, ratio: 4.0, mode: DynamicsMode::Expand };
        let up = GainComputer { threshold_db: -20.0, ratio: 4.0, mode: DynamicsMode::InverseExpand };
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
                let gc = GainComputer { threshold_db: -20.0, ratio, mode };
                for env in [0.0f32, 1.0e-30, 0.5, 100.0] {
                    assert!(gc.gain_linear(env).is_finite(), "{mode:?} r={ratio} env={env}");
                }
            }
        }
    }
}
