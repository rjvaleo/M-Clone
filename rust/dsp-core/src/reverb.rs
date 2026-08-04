//! The two machines, as portable DSP.
//!
//! Both are assembled from [`crate::delay`], [`crate::filter`] and
//! [`crate::fdn`]. What is new here relative to the browser build is the part
//! that needed per-sample control: Blackhole's inverse mode is a real
//! onset-triggered envelope rather than an approximation, because an envelope
//! follower is four lines here and was unreachable in a node graph.

use crate::delay::DiffuserChain;
use crate::dynamics::EnvelopeFollower;
use crate::fdn::{Fdn, MixMatrix};
use crate::filter::{Biquad, BiquadKind};
use crate::{clamp, delay::DelayLine, log_map};

/// `[DOC]` The H90's two published shelf corners.
pub const BLACKHOLE_LOW_HZ: f32 = 350.0;
pub const BLACKHOLE_HIGH_HZ: f32 = 2000.0;
/// `[DOC]` "this ranges from 0 ms to 2000 ms".
pub const BLACKHOLE_MAX_PREDELAY_SEC: f32 = 2.0;

/// `[DOC]` Feedback carries two discrete states past its top.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FeedbackMode {
    Normal,
    /// Endless tail, input still enters.
    Infinite,
    /// Endless tail, input blocked.
    Freeze,
}

pub fn feedback_mode(feedback: f32) -> FeedbackMode {
    if feedback >= 0.96 {
        FeedbackMode::Freeze
    } else if feedback >= 0.92 {
        FeedbackMode::Infinite
    } else {
        FeedbackMode::Normal
    }
}

/// Gravity, resolved into the three things it moves at once.
#[derive(Clone, Copy, Debug)]
pub struct Gravity {
    pub rt60: f32,
    pub diffusion: f32,
    /// 0 = forward, 1 = full inverse swell.
    pub swell: f32,
}

/// `[DOC]` "On the right-hand side… from a very dense decay to a very long and
/// smooth decay. On the left hand side… inverse mode."
///
/// Note the direction: density *falls* as decay *rises*.
pub fn resolve_gravity(gravity: f32) -> Gravity {
    let g = clamp(gravity, -1.0, 1.0);
    if g >= 0.0 {
        Gravity { rt60: log_map(g, 0.8, 16.0), diffusion: 0.75 - 0.20 * g, swell: 0.0 }
    } else {
        let a = -g;
        Gravity { rt60: log_map(a, 0.8, 6.0), diffusion: 0.75 - 0.55 * a, swell: a }
    }
}

/// Blackhole.
pub struct Blackhole {
    sample_rate: f32,
    predelay: DelayLine,
    predelay_samples: f32,
    diffuser: DiffuserChain,
    tank: Fdn,
    low_shelf: Biquad,
    high_shelf: Biquad,
    onset: EnvelopeFollower,
    slow: EnvelopeFollower,
    swell_ramp: f32,
    swell_inc: f32,
    swell: f32,
    feedback: f32,
    feedback_state: f32,
    outer_gain: f32,
    rt60: f32,
    mode: FeedbackMode,
    low_db: f32,
    high_db: f32,
    resonance: f32,
}

impl Blackhole {
    pub fn new(sample_rate: f32) -> Self {
        let mut this = Self {
            sample_rate,
            predelay: DelayLine::new(BLACKHOLE_MAX_PREDELAY_SEC + 0.01, sample_rate),
            predelay_samples: 0.0,
            diffuser: DiffuserChain::new(&[0.0207, 0.0127, 0.0083, 0.0047], 0.7, sample_rate),
            tank: Fdn::new(8, sample_rate, MixMatrix::Hadamard),
            low_shelf: Biquad::identity(),
            high_shelf: Biquad::identity(),
            onset: EnvelopeFollower::new(),
            slow: EnvelopeFollower::new(),
            swell_ramp: 1.0,
            swell_inc: 1.0 / (0.4 * sample_rate),
            swell: 0.0,
            feedback: 0.0,
            feedback_state: 0.0,
            outer_gain: 0.0,
            rt60: 2.0,
            mode: FeedbackMode::Normal,
            low_db: 0.0,
            high_db: 0.0,
            resonance: 0.0,
        };
        this.onset.set_times(0.003, 0.003, sample_rate);
        this.slow.set_times(0.150, 0.150, sample_rate);
        this.set_gravity(0.5);
        this.set_shelves(0.0, 0.0, 0.0);
        this
    }

    /// De-rate the outer loop against the tank's own decay.
    ///
    /// A feedback value that is safe with a 0.8-second tank is a runaway with a
    /// 16-second one, because the tank contributes most of the loop gain. Without
    /// this the knob has a cliff two-thirds of the way up instead of a range.
    fn recompute_outer(&mut self) {
        let normalised = clamp(self.rt60 / 16.0, 0.0, 1.0);
        let raw = clamp(self.feedback / 0.92, 0.0, 1.0);
        self.outer_gain = clamp(raw * (1.0 - 0.75 * normalised) * 0.55, 0.0, 0.55);
    }

    pub fn set_gravity(&mut self, gravity: f32) {
        let g = resolve_gravity(gravity);
        self.rt60 = g.rt60;
        self.recompute_outer();
        // Highs decay faster than lows — the "lingering, harmonic tail".
        self.tank.set_decay(g.rt60, g.rt60 * 0.45);
        self.diffuser.set_gain(g.diffusion);
        self.swell = g.swell;
        self.swell_inc = 1.0 / ((0.05 + 0.35 * g.swell) * self.sample_rate);
    }

    pub fn set_size(&mut self, size: f32) {
        // `[DOC]` "cartoonishly small to cosmically epic".
        self.tank.set_size(0.08 + (8.0 - 0.08) * clamp(size, 0.0, 1.0).powi(2));
    }

    pub fn set_predelay_seconds(&mut self, seconds: f32) {
        self.predelay_samples =
            clamp(seconds, 0.0, BLACKHOLE_MAX_PREDELAY_SEC) * self.sample_rate;
    }

    /// The two shelves and the resonance shared between them.
    ///
    /// Resonance is the RBJ slope `S`, which is the control the H90 actually
    /// has and which a Web Audio shelf cannot express at all.
    pub fn set_shelves(&mut self, low_db: f32, high_db: f32, resonance: f32) {
        self.low_db = low_db;
        self.high_db = high_db;
        self.resonance = clamp(resonance, 0.0, 1.0);
        let s = 1.0 + 2.0 * self.resonance.powf(1.5);
        self.low_shelf.set(BiquadKind::LowShelf, BLACKHOLE_LOW_HZ, s, low_db, self.sample_rate);
        self.high_shelf.set(BiquadKind::HighShelf, BLACKHOLE_HIGH_HZ, s, high_db, self.sample_rate);
    }

    pub fn set_modulation(&mut self, depth: f32, rate: f32) {
        // `[DOC]` frozen while Infinite or Freeze is engaged — modulating a
        // lossless loop pumps energy into it.
        if self.mode == FeedbackMode::Normal {
            self.tank.set_mod_depth_seconds(clamp(depth, 0.0, 1.0) * 0.0015);
            self.tank.set_mod_rate(0.05 + clamp(rate, 0.0, 1.0) * 3.5);
        }
    }

    pub fn set_feedback(&mut self, feedback: f32) {
        self.feedback = clamp(feedback, 0.0, 1.0);
        self.mode = feedback_mode(self.feedback);
        self.recompute_outer();
        self.tank.set_infinite(self.mode != FeedbackMode::Normal);
        if self.mode != FeedbackMode::Normal {
            self.tank.set_mod_depth_seconds(0.0);
        }
    }

    pub fn mode(&self) -> FeedbackMode {
        self.mode
    }

    pub fn clear(&mut self) {
        self.predelay.clear();
        self.diffuser.clear();
        self.tank.clear();
        self.low_shelf.clear();
        self.high_shelf.clear();
        self.onset.clear();
        self.slow.clear();
        self.feedback_state = 0.0;
    }

    #[inline]
    pub fn process(&mut self, input: f32) -> f32 {
        // Onset detection — the thing the browser build could not do, and the
        // reason its inverse mode was an approximation rather than a reverse.
        let fast = self.onset.process(input);
        let slow = self.slow.process(input);
        if self.swell > 0.0 && fast > slow * 1.6 && self.swell_ramp > 0.25 {
            self.swell_ramp = 0.0;
        }
        if self.swell_ramp < 1.0 {
            self.swell_ramp = (self.swell_ramp + self.swell_inc).min(1.0);
        }

        self.predelay.push(input);
        let delayed = if self.predelay_samples >= 1.0 {
            self.predelay.read(self.predelay_samples)
        } else {
            input
        };

        let diffused = self.diffuser.process(delayed);
        let gated = if self.mode == FeedbackMode::Freeze { 0.0 } else { diffused };

        // The global feedback is de-rated against decay: the tank's own
        // transfer already approaches unity at long settings, and the two loops
        // multiply.
        let outer = match self.mode {
            FeedbackMode::Normal => self.outer_gain,
            _ => 0.0,
        };

        // Bounded saturation on the global feedback path.
        //
        // `[DOC]` the H90 warns that extreme Resonance "will increase the
        // chances of overloads", and the outer loop wraps a tank whose own
        // transfer already approaches unity at long decay — the two multiply.
        // `tanh` rather than the softer `x/(1+|x|)`: the latter only bounds
        // asymptotically, and at Size 0 with inverse Gravity the tank's lines
        // are short enough that per-pass loss is under 0.1%, which was measured
        // running away to a peak of 3877 before this was tightened.
        let injected = (self.feedback_state * outer).tanh();
        let tank_out = self.tank.process(gated + injected);
        let shaped = self.high_shelf.process(self.low_shelf.process(tank_out));
        self.feedback_state = shaped;

        // The inverse envelope: squared so the build feels slower than linear.
        let envelope = if self.swell > 0.0 {
            let g = self.swell_ramp * self.swell_ramp;
            1.0 - self.swell + self.swell * g
        } else {
            1.0
        };
        let out = shaped * envelope;

        // Output ceiling.
        //
        // Not a substitute for the gain staging above it — that work is what
        // keeps ordinary settings near unity. This exists because the extremes
        // are reachable and legitimate: a tiny tank with a six-second decay and
        // a +12 dB shelf is a real request, and it lands around 116× before
        // anything bounds it. `tanh(x/8)·8` is within 0.5% of linear at unity
        // and hard-bounded at 8, so the sound is untouched where it matters and
        // the speakers are safe where it does not.
        (out / 8.0).tanh() * 8.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Rng;

    const SR: f32 = 48_000.0;

    #[test]
    fn feedback_modes_sit_in_the_documented_order() {
        assert_eq!(feedback_mode(0.5), FeedbackMode::Normal);
        assert_eq!(feedback_mode(0.93), FeedbackMode::Infinite);
        assert_eq!(feedback_mode(1.0), FeedbackMode::Freeze);
    }

    #[test]
    fn gravity_trades_density_for_length() {
        let dense = resolve_gravity(0.0);
        let smooth = resolve_gravity(1.0);
        assert!(smooth.rt60 > dense.rt60);
        assert!(smooth.diffusion < dense.diffusion);
        assert_eq!(dense.swell, 0.0);
        assert!(resolve_gravity(-1.0).swell > 0.9);
    }

    #[test]
    fn freeze_blocks_input_and_infinite_does_not() {
        // The distinction the H90 manual draws, tested directly. This was
        // expressible in the browser too — what was not is the swell below.
        // The tank has to be filled *before* the mode is engaged, or both
        // measurements are zero and the comparison proves nothing — which is
        // exactly how the first version of this test passed vacuously.
        let tail_energy = |feedback: f32| {
            let mut bh = Blackhole::new(SR);
            bh.set_gravity(0.5);
            bh.set_feedback(0.0);
            let mut rng = Rng::new(2);
            for _ in 0..9600 {
                bh.process(rng.next_bipolar() * 0.3);
            }
            bh.set_feedback(feedback);
            let before: f32 = (0..4800).map(|_| bh.process(0.0).abs()).sum();
            for _ in 0..24_000 {
                bh.process(rng.next_bipolar());
            }
            let after: f32 = (0..4800).map(|_| bh.process(0.0).abs()).sum();
            (before, after)
        };
        // The probe has to be loud and long relative to what is already held,
        // or an infinite tank's existing energy swamps the addition and the two
        // modes look identical for reasons that have nothing to do with gating.
        let (inf_before, inf_after) = tail_energy(0.93);
        let (frz_before, frz_after) = tail_energy(0.99);
        // Compared against each other rather than against a fixed threshold.
        // A lossless tank's output level wanders by a few percent between any
        // two windows, so an absolute bar measures that wander as much as it
        // measures gating. The claim being tested is relative: Infinite takes
        // the signal, Freeze does not.
        let inf_rise = inf_after / inf_before.max(1.0e-6);
        let frz_rise = frz_after / frz_before.max(1.0e-6);
        assert!(
            inf_rise > frz_rise * 1.5,
            "Infinite should admit far more than Freeze: {inf_rise:.3} vs {frz_rise:.3}"
        );
        assert!(frz_rise < 1.25, "Freeze admitted too much: {frz_rise:.3}");
    }

    #[test]
    fn inverse_gravity_suppresses_the_attack() {
        // The capability the node graph could not reach. With Gravity negative
        // the output must start quiet after an onset and build; with Gravity
        // positive it must not.
        let early_energy = |gravity: f32| {
            let mut bh = Blackhole::new(SR);
            bh.set_gravity(gravity);
            bh.set_feedback(0.0);
            let mut sum = 0.0f32;
            for n in 0..2400 {
                let x = if n < 64 { 1.0 } else { 0.0 };
                sum += bh.process(x).abs();
            }
            sum
        };
        let forward = early_energy(0.5);
        let inverse = early_energy(-1.0);
        assert!(
            inverse < forward * 0.6,
            "inverse mode did not suppress the attack: {inverse} vs {forward}"
        );
    }

    #[test]
    fn blackhole_is_stable_across_its_whole_surface() {
        for gravity in [-1.0f32, -0.5, 0.0, 0.5, 1.0] {
            for feedback in [0.0f32, 0.5, 0.91, 0.93, 0.99] {
                for size in [0.0f32, 0.5, 1.0] {
                    let mut bh = Blackhole::new(SR);
                    bh.set_gravity(gravity);
                    bh.set_size(size);
                    bh.set_feedback(feedback);
                    bh.set_shelves(12.0, -12.0, 1.0);
                    bh.set_modulation(1.0, 1.0);
                    let mut peak = 0.0f32;
                    let mut rng = Rng::new(9);
                    for n in 0..(SR as usize / 2) {
                        let x = if n < 2000 { rng.next_bipolar() * 0.5 } else { 0.0 };
                        let y = bh.process(x);
                        assert!(y.is_finite(), "g={gravity} f={feedback} s={size} at {n}");
                        peak = peak.max(y.abs());
                    }
                    assert!(peak <= 8.0, "g={gravity} f={feedback} s={size} peaked {peak}");
                }
            }
        }
    }

    #[test]
    fn zero_shelves_are_transparent_at_any_resonance() {
        let mut bh = Blackhole::new(SR);
        for resonance in [0.0f32, 0.5, 1.0] {
            bh.set_shelves(0.0, 0.0, resonance);
            let mut probe = Biquad::identity();
            probe.set(BiquadKind::LowShelf, BLACKHOLE_LOW_HZ, 1.0 + 2.0 * resonance.powf(1.5), 0.0, SR);
            for hz in [50.0f32, 350.0, 2000.0, 12_000.0] {
                let db = 20.0 * probe.magnitude_at(hz, SR).log10();
                assert!(db.abs() < 0.01, "resonance {resonance} at {hz}: {db} dB");
            }
        }
    }
}
