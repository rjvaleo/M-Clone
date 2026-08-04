//! Low-frequency modulation, per sample.
//!
//! `ModularAudio_FuncSpec_v11` §9.6 asks for two LFOs with seven waveforms, a
//! start phase, tempo sync and three trigger modes, feeding an 8 × 12 matrix in
//! §9.7 where any source reaches any destination with a bipolar amount.
//!
//! None of that was reachable in the browser build, and the reason is worth
//! stating precisely because it is not "Web Audio is slow". A Web Audio
//! modulation route is a `GainNode` bridging an `OscillatorNode` to a target
//! `AudioParam`. One fixed route is fine. A *matrix* needs one such node per
//! live cell **per voice**, torn down and rebuilt whenever a routing changes or
//! a note starts — so the synth shipped with both LFOs wired to literal zeros,
//! not from neglect but because the shape of the platform refused it.
//!
//! Here an LFO is a number produced once per sample, and a matrix is a loop
//! over it.
//!
//! Everything is bipolar `[-1, 1]` before depth is applied, so a destination
//! sums its routings in one unit and clamps once — see `modmatrix.rs`.

use crate::{clamp, Rng};

use core::f32::consts::TAU;

/// §9.6's rate range. Below this an LFO is indistinguishable from a constant;
/// above it, it is an oscillator and belongs in the audio path.
pub const MIN_RATE_HZ: f32 = 0.01;
pub const MAX_RATE_HZ: f32 = 50.0;

/// How fast `SmoothRandom` slews between its targets, as a fraction of one
/// cycle. A full cycle of glide makes a sine; none at all makes sample-and-hold.
const SMOOTH_GLIDE: f32 = 1.0;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u32)]
pub enum LfoShape {
    Sine = 0,
    Triangle = 1,
    Sawtooth = 2,
    /// Reverse saw. §9.6 names this separately from Sawtooth.
    Ramp = 3,
    Square = 4,
    /// Random stepped — a new value held for each cycle.
    SampleHold = 5,
    /// Random, interpolated so it wanders rather than jumps.
    SmoothRandom = 6,
}

impl LfoShape {
    pub fn from_u32(value: u32) -> Option<Self> {
        match value {
            0 => Some(Self::Sine),
            1 => Some(Self::Triangle),
            2 => Some(Self::Sawtooth),
            3 => Some(Self::Ramp),
            4 => Some(Self::Square),
            5 => Some(Self::SampleHold),
            6 => Some(Self::SmoothRandom),
            _ => None,
        }
    }
}

/// §9.6's three trigger modes.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u32)]
pub enum LfoTrigger {
    /// Runs continuously; notes do not disturb it. Two voices started a beat
    /// apart are modulated in step, which is what makes a shared LFO sound
    /// like one gesture across a chord.
    Free = 0,
    /// Resets to the start phase on every new note, so every note is shaped
    /// identically.
    Note = 1,
    /// Runs once from the start phase, then holds its final value — an
    /// envelope with an LFO's shape.
    OneShot = 2,
}

impl LfoTrigger {
    pub fn from_u32(value: u32) -> Option<Self> {
        match value {
            0 => Some(Self::Free),
            1 => Some(Self::Note),
            2 => Some(Self::OneShot),
            _ => None,
        }
    }
}

/// One LFO.
///
/// Holds its own phase, so two voices can share settings without sharing
/// motion — which is exactly the difference between `Free` and `Note`.
pub struct Lfo {
    shape: LfoShape,
    trigger: LfoTrigger,
    /// Turns per sample. Recomputed only when rate or sample rate changes.
    increment: f32,
    rate_hz: f32,
    sample_rate: f32,
    /// Position in the cycle, `[0, 1)`.
    phase: f32,
    /// Where a retrigger starts, `[0, 1)` — §9.6's Phase control in turns.
    start_phase: f32,
    depth: f32,
    /// `OneShot` has finished and is holding.
    held: bool,
    rng: Rng,
    /// Endpoints for the random shapes.
    current_random: f32,
    next_random: f32,
}

impl Lfo {
    pub fn new(sample_rate: f32, seed: u32) -> Self {
        let mut rng = Rng::new(seed);
        let current = rng.next_bipolar();
        let next = rng.next_bipolar();
        let mut lfo = Self {
            shape: LfoShape::Sine,
            trigger: LfoTrigger::Free,
            increment: 0.0,
            rate_hz: 1.0,
            sample_rate: if sample_rate > 0.0 { sample_rate } else { 48_000.0 },
            phase: 0.0,
            start_phase: 0.0,
            depth: 1.0,
            held: false,
            rng,
            current_random: current,
            next_random: next,
        };
        lfo.recompute();
        lfo
    }

    fn recompute(&mut self) {
        self.increment = self.rate_hz / self.sample_rate;
    }

    pub fn set_sample_rate(&mut self, sample_rate: f32) {
        if sample_rate > 0.0 {
            self.sample_rate = sample_rate;
            self.recompute();
        }
    }

    pub fn set_shape(&mut self, shape: LfoShape) {
        self.shape = shape;
    }

    pub fn set_trigger(&mut self, trigger: LfoTrigger) {
        self.trigger = trigger;
    }

    /// Free-running rate in hertz, clamped to §9.6's range.
    pub fn set_rate_hz(&mut self, hz: f32) {
        self.rate_hz = clamp(hz, MIN_RATE_HZ, MAX_RATE_HZ);
        self.recompute();
    }

    /// Tempo-synced rate: `beats` is the note division in quarter notes, so 1.0
    /// is a quarter, 0.25 a sixteenth, 4.0 a whole bar of 4/4.
    ///
    /// Converted to hertz rather than tracked as a division so that everything
    /// downstream — including a tempo change mid-note — goes through one path.
    pub fn set_rate_synced(&mut self, bpm: f32, beats: f32) {
        let bpm = clamp(bpm, 1.0, 999.0);
        let beats = if beats > 0.0 { beats } else { 1.0 };
        self.set_rate_hz(bpm / 60.0 / beats);
    }

    pub fn rate_hz(&self) -> f32 {
        self.rate_hz
    }

    /// §9.6's Depth, 0..1. Applied on the way out so the shape is unchanged.
    pub fn set_depth(&mut self, depth: f32) {
        self.depth = clamp(depth, 0.0, 1.0);
    }

    /// Start phase in degrees, 0..360.
    pub fn set_phase_degrees(&mut self, degrees: f32) {
        let wrapped = degrees.rem_euclid(360.0);
        self.start_phase = wrapped / 360.0;
    }

    /// A new note arrived.
    ///
    /// `Free` ignores it entirely — that is the whole point of the mode, and
    /// getting it wrong makes a shared LFO restart under every note so a chord
    /// modulates as separate voices rather than as one.
    pub fn retrigger(&mut self) {
        match self.trigger {
            LfoTrigger::Free => {}
            LfoTrigger::Note | LfoTrigger::OneShot => {
                self.phase = self.start_phase;
                self.held = false;
            }
        }
    }

    /// Back to a known state without reallocating.
    pub fn reset(&mut self) {
        self.phase = self.start_phase;
        self.held = false;
    }

    /// The value for this sample, bipolar and already scaled by depth.
    ///
    /// Named `next` for the same reason `Smoothed::next` is: it is read once
    /// per sample in the hot loop, and an `Iterator` impl would be infinite and
    /// lazy, which is worse.
    #[allow(clippy::should_implement_trait)]
    #[inline]
    pub fn next(&mut self) -> f32 {
        let raw = self.shape_at(self.phase);
        if !self.held {
            self.advance();
        }
        raw * self.depth
    }

    #[inline]
    fn advance(&mut self) {
        self.phase += self.increment;
        if self.phase >= 1.0 {
            self.phase -= self.phase.floor();
            // A completed cycle is where the random shapes pick a new target
            // and where a one-shot stops.
            self.current_random = self.next_random;
            self.next_random = self.rng.next_bipolar();
            if self.trigger == LfoTrigger::OneShot {
                self.held = true;
                // Hold at the end of the cycle rather than the start of the
                // next one, so the final value is the shape's last value.
                self.phase = 1.0 - f32::EPSILON;
            }
        }
    }

    #[inline]
    fn shape_at(&self, phase: f32) -> f32 {
        match self.shape {
            LfoShape::Sine => (phase * TAU).sin(),
            // Up for the first half, down for the second, hitting ±1 at the
            // quarter points like a sine.
            LfoShape::Triangle => 1.0 - 4.0 * (phase - 0.5).abs(),
            LfoShape::Sawtooth => phase * 2.0 - 1.0,
            LfoShape::Ramp => 1.0 - phase * 2.0,
            LfoShape::Square => {
                if phase < 0.5 {
                    1.0
                } else {
                    -1.0
                }
            }
            LfoShape::SampleHold => self.current_random,
            LfoShape::SmoothRandom => {
                let t = clamp(phase / SMOOTH_GLIDE, 0.0, 1.0);
                // Smoothstep rather than linear: a linear glide corners at each
                // target and those corners are audible as ticks on a cutoff.
                let eased = t * t * (3.0 - 2.0 * t);
                self.current_random + (self.next_random - self.current_random) * eased
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const RATE: f32 = 48_000.0;

    fn lfo(shape: LfoShape, hz: f32) -> Lfo {
        let mut lfo = Lfo::new(RATE, 7);
        lfo.set_shape(shape);
        lfo.set_rate_hz(hz);
        lfo
    }

    /// One full cycle of values.
    fn cycle(lfo: &mut Lfo, hz: f32) -> Vec<f32> {
        let samples = (RATE / hz) as usize;
        (0..samples).map(|_| lfo.next()).collect()
    }

    fn extremes(values: &[f32]) -> (f32, f32) {
        values.iter().fold((f32::MAX, f32::MIN), |(lo, hi), &v| (lo.min(v), hi.max(v)))
    }

    #[test]
    fn every_shape_stays_inside_the_bipolar_range() {
        // The contract the matrix depends on: a destination sums its routings
        // in one unit and clamps once, which only works if no source can
        // exceed ±1 on its own.
        for value in 0..=6 {
            let shape = LfoShape::from_u32(value).expect("shape");
            let mut lfo = lfo(shape, 4.0);
            let values = cycle(&mut lfo, 4.0);
            let (lo, hi) = extremes(&values);
            assert!(lo >= -1.0 && hi <= 1.0, "{shape:?} ranged {lo}..{hi}");
        }
    }

    #[test]
    fn the_periodic_shapes_reach_both_rails() {
        for shape in [LfoShape::Sine, LfoShape::Triangle, LfoShape::Sawtooth, LfoShape::Ramp, LfoShape::Square] {
            let mut lfo = lfo(shape, 4.0);
            let values = cycle(&mut lfo, 4.0);
            let (lo, hi) = extremes(&values);
            assert!(hi > 0.98, "{shape:?} never reached the top: {hi}");
            assert!(lo < -0.98, "{shape:?} never reached the bottom: {lo}");
        }
    }

    #[test]
    fn sawtooth_and_ramp_run_opposite_ways() {
        // §9.6 lists them separately, so they must actually differ.
        let mut saw = lfo(LfoShape::Sawtooth, 4.0);
        let mut ramp = lfo(LfoShape::Ramp, 4.0);
        let a = cycle(&mut saw, 4.0);
        let b = cycle(&mut ramp, 4.0);
        for (x, y) in a.iter().zip(b.iter()) {
            assert!((x + y).abs() < 1e-5, "{x} and {y} are not mirrored");
        }
    }

    #[test]
    fn depth_scales_without_changing_the_shape() {
        let mut full = lfo(LfoShape::Triangle, 4.0);
        let mut half = lfo(LfoShape::Triangle, 4.0);
        half.set_depth(0.5);
        for (a, b) in cycle(&mut full, 4.0).iter().zip(cycle(&mut half, 4.0).iter()) {
            assert!((a * 0.5 - b).abs() < 1e-6);
        }
    }

    #[test]
    fn rate_clamps_to_the_documented_range() {
        let mut slow = lfo(LfoShape::Sine, 0.0);
        assert_eq!(slow.rate_hz(), MIN_RATE_HZ);
        let mut fast = lfo(LfoShape::Sine, 10_000.0);
        assert_eq!(fast.rate_hz(), MAX_RATE_HZ);
        // Still finite at both ends rather than stuck or diverging.
        assert!(slow.next().is_finite() && fast.next().is_finite());
    }

    #[test]
    fn a_synced_lfo_follows_the_tempo() {
        let mut lfo = lfo(LfoShape::Sine, 1.0);
        // A quarter note at 120 bpm is two per second.
        lfo.set_rate_synced(120.0, 1.0);
        assert!((lfo.rate_hz() - 2.0).abs() < 1e-6);
        // A sixteenth is four times faster.
        lfo.set_rate_synced(120.0, 0.25);
        assert!((lfo.rate_hz() - 8.0).abs() < 1e-6);
        // A whole bar of 4/4 is four times slower than a quarter.
        lfo.set_rate_synced(120.0, 4.0);
        assert!((lfo.rate_hz() - 0.5).abs() < 1e-6);
    }

    #[test]
    fn a_synced_lfo_survives_a_nonsense_division() {
        let mut lfo = lfo(LfoShape::Sine, 1.0);
        lfo.set_rate_synced(120.0, 0.0);
        assert!(lfo.rate_hz().is_finite() && lfo.rate_hz() > 0.0);
        lfo.set_rate_synced(0.0, 1.0);
        assert!(lfo.rate_hz() >= MIN_RATE_HZ);
    }

    #[test]
    fn phase_decides_where_a_retrigger_starts() {
        let mut lfo = lfo(LfoShape::Sawtooth, 1.0);
        lfo.set_trigger(LfoTrigger::Note);
        // A saw at 90° is a quarter of the way up: -1 → +1 across the cycle,
        // so a quarter in is -0.5.
        lfo.set_phase_degrees(90.0);
        lfo.retrigger();
        assert!((lfo.next() + 0.5).abs() < 1e-4);
    }

    #[test]
    fn phase_wraps_rather_than_clamping() {
        // 450° is 90°, and a face that lets someone drag past a full turn
        // should not park at the top.
        let mut a = lfo(LfoShape::Sawtooth, 1.0);
        let mut b = lfo(LfoShape::Sawtooth, 1.0);
        a.set_trigger(LfoTrigger::Note);
        b.set_trigger(LfoTrigger::Note);
        a.set_phase_degrees(90.0);
        b.set_phase_degrees(450.0);
        a.retrigger();
        b.retrigger();
        assert!((a.next() - b.next()).abs() < 1e-6);
    }

    #[test]
    fn a_free_lfo_ignores_notes() {
        // The mode's entire purpose: a chord modulates as one gesture rather
        // than as separate voices, so a note must not disturb the phase.
        let mut lfo = lfo(LfoShape::Sawtooth, 2.0);
        lfo.set_trigger(LfoTrigger::Free);
        for _ in 0..5_000 {
            lfo.next();
        }
        let before = lfo.next();
        lfo.retrigger();
        let after = lfo.next();
        assert!((after - before).abs() < 0.01, "a note moved a free LFO: {before} → {after}");
    }

    #[test]
    fn a_note_mode_lfo_starts_over_on_every_note() {
        let mut lfo = lfo(LfoShape::Sawtooth, 2.0);
        lfo.set_trigger(LfoTrigger::Note);
        for _ in 0..5_000 {
            lfo.next();
        }
        lfo.retrigger();
        // Back to the bottom of the saw.
        assert!((lfo.next() + 1.0).abs() < 1e-3);
    }

    #[test]
    fn a_one_shot_runs_once_and_then_holds() {
        let mut lfo = lfo(LfoShape::Sawtooth, 4.0);
        lfo.set_trigger(LfoTrigger::OneShot);
        lfo.retrigger();
        let values = cycle(&mut lfo, 4.0);
        let (_, hi) = extremes(&values);
        assert!(hi > 0.98, "never completed its cycle");

        // `cycle` runs exactly one nominal period, but the phase increment does
        // not divide the sample rate exactly, so the wrap may still be a sample
        // or two away. Clear it before asserting the hold.
        for _ in 0..32 {
            lfo.next();
        }
        // Everything after is the same value, for ever.
        let held = lfo.next();
        for _ in 0..10_000 {
            assert!((lfo.next() - held).abs() < 1e-6);
        }
        assert!(held > 0.98, "held at {held} rather than the end of the shape");
    }

    #[test]
    fn a_one_shot_runs_again_when_retriggered() {
        let mut lfo = lfo(LfoShape::Sawtooth, 4.0);
        lfo.set_trigger(LfoTrigger::OneShot);
        lfo.retrigger();
        cycle(&mut lfo, 4.0);
        let held = lfo.next();
        lfo.retrigger();
        assert!((lfo.next() - held).abs() > 1.5, "did not restart");
    }

    #[test]
    fn sample_and_hold_steps_rather_than_glides() {
        let mut lfo = lfo(LfoShape::SampleHold, 8.0);
        // Three cycles, so a boundary is certainly crossed however the phase
        // increment rounds against the sample rate.
        let values: Vec<f32> = (0..(RATE / 8.0 * 3.0) as usize).map(|_| lfo.next()).collect();

        let mut steps = 0;
        for pair in values.windows(2) {
            if (pair[1] - pair[0]).abs() > 1e-9 {
                steps += 1;
                // A step, not a glide: when it moves, it moves all at once.
                assert!((pair[1] - pair[0]).abs() > 1e-4, "eased instead of stepping");
            }
        }
        // Two or three transitions across three cycles — held in between, which
        // is the whole difference from SmoothRandom.
        assert!((2..=3).contains(&steps), "{steps} transitions across three cycles");
    }

    #[test]
    fn smooth_random_wanders_without_stepping() {
        let mut lfo = lfo(LfoShape::SmoothRandom, 8.0);
        let values = cycle(&mut lfo, 8.0);
        let mut biggest_jump = 0.0f32;
        for pair in values.windows(2) {
            biggest_jump = biggest_jump.max((pair[1] - pair[0]).abs());
        }
        // A step would be a jump of up to 2; a glide over 6000 samples is tiny.
        assert!(biggest_jump < 0.01, "stepped by {biggest_jump}");
        let (lo, hi) = extremes(&values);
        assert!(hi - lo > 1e-4, "did not move at all");
    }

    #[test]
    fn two_lfos_with_the_same_seed_agree_for_ever() {
        // Determinism is a non-negotiable: §31.2's render-from-data replays a
        // performance and must produce the same audio every time.
        let mut a = lfo(LfoShape::SmoothRandom, 6.0);
        let mut b = lfo(LfoShape::SmoothRandom, 6.0);
        for i in 0..20_000 {
            assert_eq!(a.next(), b.next(), "diverged at sample {i}");
        }
    }

    #[test]
    fn different_seeds_do_not_agree() {
        let mut a = Lfo::new(RATE, 1);
        let mut b = Lfo::new(RATE, 2);
        a.set_shape(LfoShape::SampleHold);
        b.set_shape(LfoShape::SampleHold);
        a.set_rate_hz(8.0);
        b.set_rate_hz(8.0);
        let x = cycle(&mut a, 8.0);
        let y = cycle(&mut b, 8.0);
        assert!((x[0] - y[0]).abs() > 1e-6, "two seeds produced one sequence");
    }

    #[test]
    fn the_wire_protocol_round_trips() {
        for value in 0..=6 {
            assert_eq!(LfoShape::from_u32(value).map(|s| s as u32), Some(value));
        }
        assert_eq!(LfoShape::from_u32(7), None);
        for value in 0..=2 {
            assert_eq!(LfoTrigger::from_u32(value).map(|t| t as u32), Some(value));
        }
        assert_eq!(LfoTrigger::from_u32(3), None);
    }

    #[test]
    fn a_sample_rate_change_keeps_the_frequency() {
        // Rule three: a patch sounds the same at 44.1 and 96 kHz.
        let mut slow = Lfo::new(44_100.0, 3);
        let mut fast = Lfo::new(96_000.0, 3);
        slow.set_shape(LfoShape::Sine);
        fast.set_shape(LfoShape::Sine);
        slow.set_rate_hz(5.0);
        fast.set_rate_hz(5.0);
        // One second of each, sampled at its own rate, ends in the same place.
        for _ in 0..44_100 {
            slow.next();
        }
        for _ in 0..96_000 {
            fast.next();
        }
        assert!((slow.next() - fast.next()).abs() < 0.01);
    }

    #[test]
    fn reset_returns_to_the_start_phase() {
        let mut lfo = lfo(LfoShape::Sawtooth, 2.0);
        lfo.set_phase_degrees(0.0);
        for _ in 0..5_000 {
            lfo.next();
        }
        lfo.reset();
        assert!((lfo.next() + 1.0).abs() < 1e-3);
    }
}
