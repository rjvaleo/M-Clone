//! The audio oscillator — §9.2's three-oscillator section, one voice of it.
//!
//! Five waves, and a pulse whose width is a live control rather than a
//! rebuild. That last part is the reason this exists at all: Web Audio's
//! `OscillatorNode` has no pulse, so the browser build synthesised one as a
//! `PeriodicWave` from 256 Fourier coefficients — which works, sounds correct,
//! and has to be **recomputed and reassigned every time the width moves**.
//! Sweeping PWM meant allocating a new wavetable per frame.
//!
//! # Anti-aliasing
//!
//! A naive saw or square is a step, a step has infinite bandwidth, and
//! everything above Nyquist folds back down as inharmonic tones that move the
//! wrong way when you play up the keyboard. The fix here is PolyBLEP: at each
//! discontinuity, subtract a small polynomial correction spanning one sample
//! either side. It is a couple of multiplies against a wavetable's memory and
//! rebuild cost, and unlike a wavetable it costs nothing extra to sweep width.
//!
//! It is not perfect — a true BLEP uses a longer kernel — but the residue sits
//! far below the harmonics that matter, and the tests pin that rather than
//! trusting the claim.

use crate::clamp;

use core::f32::consts::TAU;

/// §9.2's pulse width range. At 0 or 1 a pulse is silence, and near them it is
/// a click train with almost no fundamental, so the useful range stops short.
pub const MIN_PULSE_WIDTH: f32 = 0.05;
pub const MAX_PULSE_WIDTH: f32 = 0.95;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u32)]
pub enum Wave {
    Sine = 0,
    Triangle = 1,
    Sawtooth = 2,
    Square = 3,
    /// Square with a movable duty cycle.
    Pulse = 4,
}

impl Wave {
    pub fn from_u32(value: u32) -> Option<Self> {
        match value {
            0 => Some(Self::Sine),
            1 => Some(Self::Triangle),
            2 => Some(Self::Sawtooth),
            3 => Some(Self::Square),
            4 => Some(Self::Pulse),
            _ => None,
        }
    }
}

/// One oscillator.
pub struct Osc {
    wave: Wave,
    sample_rate: f32,
    /// Turns per sample.
    increment: f32,
    frequency: f32,
    phase: f32,
    width: f32,
    /// Running integrator state for the triangle, which is a filtered square.
    triangle: f32,
    /// DC blocker state, for the pulse.
    dc_x: f32,
    dc_y: f32,
}

/// DC blocker pole. About 5 Hz at 48 kHz — below anything musical, high enough
/// to track a width sweep rather than lagging behind it.
const DC_POLE: f32 = 0.9995;

impl Osc {
    pub fn new(sample_rate: f32) -> Self {
        let mut osc = Self {
            wave: Wave::Sawtooth,
            sample_rate: if sample_rate > 0.0 { sample_rate } else { 48_000.0 },
            increment: 0.0,
            frequency: 440.0,
            phase: 0.0,
            width: 0.5,
            triangle: 0.0,
            dc_x: 0.0,
            dc_y: 0.0,
        };
        osc.recompute();
        osc
    }

    fn recompute(&mut self) {
        self.increment = self.frequency / self.sample_rate;
    }

    pub fn set_sample_rate(&mut self, sample_rate: f32) {
        if sample_rate > 0.0 {
            self.sample_rate = sample_rate;
            self.recompute();
        }
    }

    pub fn set_wave(&mut self, wave: Wave) {
        self.wave = wave;
    }

    /// Frequency in hertz.
    ///
    /// Clamped below Nyquist: a modulated pitch can be driven anywhere, and an
    /// oscillator above Nyquist is not a high note, it is a wrong one.
    #[inline]
    pub fn set_frequency(&mut self, hz: f32) {
        let nyquist = self.sample_rate * 0.5;
        let hz = if hz.is_finite() { hz } else { 0.0 };
        self.frequency = clamp(hz, 0.0, nyquist * 0.98);
        self.recompute();
    }

    pub fn frequency(&self) -> f32 {
        self.frequency
    }

    /// Pulse width, 0..1, clamped to the useful range.
    pub fn set_width(&mut self, width: f32) {
        self.width = clamp(width, MIN_PULSE_WIDTH, MAX_PULSE_WIDTH);
    }

    /// Start the cycle somewhere specific. Used at note-on so a plucked sound
    /// starts identically every time.
    pub fn set_phase(&mut self, phase: f32) {
        self.phase = phase.rem_euclid(1.0);
    }

    pub fn reset(&mut self) {
        self.phase = 0.0;
        self.triangle = 0.0;
        self.dc_x = 0.0;
        self.dc_y = 0.0;
    }

    /// The PolyBLEP correction around a discontinuity at phase zero.
    ///
    /// `t` is the phase, `dt` the increment. Within one sample either side of
    /// the step, the naive value is corrected by a quadratic that approximates
    /// the band-limited step.
    #[inline]
    fn blep(t: f32, dt: f32) -> f32 {
        if t < dt {
            let x = t / dt;
            x + x - x * x - 1.0
        } else if t > 1.0 - dt {
            let x = (t - 1.0) / dt;
            x * x + x + x + 1.0
        } else {
            0.0
        }
    }

    /// One sample, in `[-1, 1]`.
    #[allow(clippy::should_implement_trait)]
    #[inline]
    pub fn next(&mut self) -> f32 {
        let dt = self.increment;
        let phase = self.phase;

        let value = match self.wave {
            Wave::Sine => (phase * TAU).sin(),
            Wave::Sawtooth => {
                // Naive saw, minus the step at the wrap.
                let naive = 2.0 * phase - 1.0;
                naive - Self::blep(phase, dt)
            }
            Wave::Square | Wave::Pulse => {
                let width = if self.wave == Wave::Square { 0.5 } else { self.width };
                let naive = if phase < width { 1.0 } else { -1.0 };
                // Two discontinuities per cycle: one at zero, one at the width.
                let rising = Self::blep(phase, dt);
                let falling = Self::blep((phase - width).rem_euclid(1.0), dt);
                let corrected = naive + rising - falling;
                // A pulse carries a DC offset of `2w - 1`, and a width sweep
                // would walk the whole voice off centre without removing it.
                //
                // Subtracting the offset analytically is the obvious move and
                // it is wrong: it re-centres by *widening* the swing, so a 5%
                // pulse ends up spanning -0.1..1.9 and eats the headroom the
                // rest of the voice needs. A blocker removes the same DC while
                // leaving the signal inside its rails.
                self.dc_y = corrected - self.dc_x + DC_POLE * self.dc_y;
                self.dc_x = corrected;
                self.dc_y
            }
            Wave::Triangle => {
                // A triangle is an integrated square, which is why it is built
                // from one rather than from `abs`: the square is already
                // band-limited, so the triangle inherits that for free.
                let naive = if phase < 0.5 { 1.0 } else { -1.0 };
                let stepped = naive + Self::blep(phase, dt)
                    - Self::blep((phase - 0.5).rem_euclid(1.0), dt);
                // Leaky integrator: the leak removes the DC that would
                // otherwise accumulate without touching the audible shape.
                self.triangle = dt * 4.0 * stepped + (1.0 - dt) * self.triangle;
                self.triangle
            }
        };

        self.phase += dt;
        if self.phase >= 1.0 {
            self.phase -= self.phase.floor();
        }
        value
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const RATE: f32 = 48_000.0;

    fn osc(wave: Wave, hz: f32) -> Osc {
        let mut osc = Osc::new(RATE);
        osc.set_wave(wave);
        osc.set_frequency(hz);
        osc
    }

    fn take(osc: &mut Osc, n: usize) -> Vec<f32> {
        (0..n).map(|_| osc.next()).collect()
    }

    /// Settle any integrator, then measure.
    fn settled(osc: &mut Osc, n: usize) -> Vec<f32> {
        take(osc, RATE as usize / 4);
        take(osc, n)
    }

    fn peak(values: &[f32]) -> f32 {
        values.iter().fold(0.0f32, |acc, v| acc.max(v.abs()))
    }

    fn mean(values: &[f32]) -> f32 {
        values.iter().sum::<f32>() / values.len() as f32
    }

    /// Energy at a frequency, by direct correlation — enough to tell a
    /// harmonic from an alias without pulling in an FFT.
    fn energy_at(values: &[f32], hz: f32) -> f32 {
        let mut re = 0.0f32;
        let mut im = 0.0f32;
        for (i, v) in values.iter().enumerate() {
            let t = i as f32 / RATE;
            re += v * (TAU * hz * t).cos();
            im += v * (TAU * hz * t).sin();
        }
        (re * re + im * im).sqrt() / values.len() as f32
    }

    #[test]
    fn every_wave_stays_inside_the_rails() {
        for value in 0..=4 {
            let wave = Wave::from_u32(value).expect("wave");
            let mut osc = osc(wave, 220.0);
            let values = settled(&mut osc, 4096);
            let p = peak(&values);
            assert!(p <= 1.2, "{wave:?} peaked at {p}");
            assert!(p > 0.2, "{wave:?} barely moved: {p}");
        }
    }

    #[test]
    fn every_wave_is_centred() {
        // DC offset costs headroom and thumps when a voice starts. The pulse is
        // the one that would drift, because its offset moves with width.
        for value in 0..=4 {
            let wave = Wave::from_u32(value).expect("wave");
            let mut osc = osc(wave, 220.0);
            let values = settled(&mut osc, RATE as usize / 4);
            assert!(mean(&values).abs() < 0.02, "{wave:?} sits at {}", mean(&values));
        }
    }

    #[test]
    fn a_sine_is_a_sine() {
        let mut osc = osc(Wave::Sine, 1000.0);
        let values = take(&mut osc, 4800);
        assert!(energy_at(&values, 1000.0) > 0.4, "no fundamental");
        // A sine has no second harmonic worth the name.
        assert!(energy_at(&values, 2000.0) < 0.01);
    }

    #[test]
    fn a_saw_has_all_the_harmonics() {
        let mut osc = osc(Wave::Sawtooth, 500.0);
        let values = take(&mut osc, 9600);
        let f = energy_at(&values, 500.0);
        // Amplitudes fall as 1/n, so the second is about half the first and the
        // third about a third.
        assert!((energy_at(&values, 1000.0) / f - 0.5).abs() < 0.1);
        assert!((energy_at(&values, 1500.0) / f - 0.333).abs() < 0.1);
    }

    #[test]
    fn a_square_has_only_odd_harmonics() {
        let mut osc = osc(Wave::Square, 500.0);
        let values = take(&mut osc, 9600);
        let f = energy_at(&values, 500.0);
        assert!(energy_at(&values, 1500.0) / f > 0.2, "missing the third");
        assert!(energy_at(&values, 1000.0) / f < 0.05, "has an even harmonic");
    }

    #[test]
    fn pulse_width_changes_the_harmonic_content() {
        // The point of PWM. At 50% a pulse is a square with no even harmonics;
        // off centre the evens come in, which is the sound of the sweep.
        let mut square = osc(Wave::Pulse, 500.0);
        square.set_width(0.5);
        let even_at_half = {
            let values = take(&mut square, 9600);
            energy_at(&values, 1000.0) / energy_at(&values, 500.0)
        };

        let mut narrow = osc(Wave::Pulse, 500.0);
        narrow.set_width(0.25);
        let even_at_quarter = {
            let values = take(&mut narrow, 9600);
            energy_at(&values, 1000.0) / energy_at(&values, 500.0)
        };

        assert!(even_at_half < 0.05, "a 50% pulse should have no evens");
        assert!(even_at_quarter > 0.3, "a 25% pulse should have strong evens");
    }

    #[test]
    fn pulse_width_can_sweep_while_sounding() {
        // The thing a PeriodicWave could not do: this is a live control, not a
        // rebuild. It must stay bounded and centred across the whole sweep.
        let mut osc = osc(Wave::Pulse, 220.0);
        let mut values = Vec::new();
        for step in 0..2000 {
            osc.set_width(0.05 + 0.9 * (step as f32 / 2000.0));
            values.push(osc.next());
        }
        assert!(peak(&values) <= 1.2, "swept out of range: {}", peak(&values));
        assert!(mean(&values).abs() < 0.1, "swept off centre: {}", mean(&values));
    }

    #[test]
    fn width_clamps_to_the_useful_range() {
        let mut osc = osc(Wave::Pulse, 220.0);
        osc.set_width(0.0);
        let narrow = settled(&mut osc, 4096);
        // Still an oscillator rather than silence or a DC rail.
        assert!(peak(&narrow) > 0.1, "a zero-width pulse went silent");
        osc.set_width(1.0);
        let wide = settled(&mut osc, 4096);
        assert!(peak(&wide) > 0.1);
    }

    #[test]
    fn a_square_is_a_pulse_at_half_width() {
        let mut square = osc(Wave::Square, 440.0);
        let mut pulse = osc(Wave::Pulse, 440.0);
        pulse.set_width(0.5);
        for (a, b) in take(&mut square, 2048).iter().zip(take(&mut pulse, 2048).iter()) {
            assert!((a - b).abs() < 1e-5);
        }
    }

    #[test]
    fn a_high_saw_does_not_fold_back_down() {
        // The whole reason for PolyBLEP. A naive saw at 5 kHz puts its harmonics
        // at 10, 15, 20 kHz — and everything past 24 kHz folds back as
        // inharmonic tones that move downward as you play upward.
        let mut osc = osc(Wave::Sawtooth, 5000.0);
        let values = take(&mut osc, 9600);
        let fundamental = energy_at(&values, 5000.0);
        // 30 kHz would fold to 18 kHz; 35 kHz to 13 kHz. Neither should be
        // anywhere near the fundamental.
        for alias in [18_000.0, 13_000.0, 8_000.0] {
            let ratio = energy_at(&values, alias) / fundamental;
            assert!(ratio < 0.1, "alias at {alias} Hz is {ratio} of the fundamental");
        }
    }

    #[test]
    fn frequency_clamps_below_nyquist() {
        let mut osc = osc(Wave::Sawtooth, 1.0e9);
        assert!(osc.frequency() < RATE * 0.5, "ran past Nyquist: {}", osc.frequency());
        assert!(take(&mut osc, 1000).iter().all(|v| v.is_finite()));
    }

    #[test]
    fn a_non_finite_frequency_is_refused() {
        // Pitch is a modulation destination, and a matrix fed a NaN would
        // otherwise silence the voice for ever.
        let mut osc = osc(Wave::Sawtooth, 440.0);
        osc.set_frequency(f32::NAN);
        assert!(osc.frequency().is_finite());
        assert!(take(&mut osc, 100).iter().all(|v| v.is_finite()));
    }

    #[test]
    fn a_zero_frequency_is_silent_rather_than_stuck() {
        let mut osc = osc(Wave::Sine, 0.0);
        let values = take(&mut osc, 1000);
        assert!(values.iter().all(|v| v.is_finite()));
    }

    #[test]
    fn phase_decides_where_a_note_starts() {
        let mut a = osc(Wave::Sine, 440.0);
        let mut b = osc(Wave::Sine, 440.0);
        b.set_phase(0.25);
        // A quarter turn into a sine is its peak.
        assert!(a.next().abs() < 1e-6);
        assert!((b.next() - 1.0).abs() < 1e-6);
    }

    #[test]
    fn the_same_note_sounds_identical_every_time() {
        // Determinism, again for §31.2's render-from-data.
        let mut a = osc(Wave::Pulse, 330.0);
        let mut b = osc(Wave::Pulse, 330.0);
        a.set_width(0.3);
        b.set_width(0.3);
        for i in 0..10_000 {
            assert_eq!(a.next(), b.next(), "diverged at {i}");
        }
    }

    #[test]
    fn pitch_is_the_same_at_any_sample_rate() {
        let mut slow = Osc::new(44_100.0);
        let mut fast = Osc::new(96_000.0);
        slow.set_wave(Wave::Sine);
        fast.set_wave(Wave::Sine);
        slow.set_frequency(440.0);
        fast.set_frequency(440.0);
        // One full second at each rate ends at the same point in the cycle.
        for _ in 0..44_100 {
            slow.next();
        }
        for _ in 0..96_000 {
            fast.next();
        }
        assert!((slow.next() - fast.next()).abs() < 0.02);
    }

    #[test]
    fn the_wire_protocol_round_trips() {
        for value in 0..=4 {
            assert_eq!(Wave::from_u32(value).map(|w| w as u32), Some(value));
        }
        assert_eq!(Wave::from_u32(5), None);
    }

    #[test]
    fn reset_returns_to_the_start() {
        // Compared against a fresh oscillator rather than against -1: at the
        // discontinuity a band-limited saw sits at the midpoint of the step,
        // not at the bottom of it. That is the anti-aliasing working, and
        // asserting the naive value here would be asserting the bug.
        let mut used = osc(Wave::Sawtooth, 440.0);
        take(&mut used, 500);
        used.reset();
        let mut fresh = osc(Wave::Sawtooth, 440.0);
        for (a, b) in take(&mut used, 512).iter().zip(take(&mut fresh, 512).iter()) {
            assert_eq!(a, b);
        }
    }
}
