//! Delay lines and allpass diffusers.
//!
//! The single most important difference from the Web Audio build: a delay here
//! can be **one sample long**, and a feedback loop around it closes in one
//! sample. Web Audio enforces a minimum of one render quantum — 128 samples,
//! 2.7 ms — in any cycle, which is why the browser DP/4+ had to fake its
//! feedback routings with a 20 ms loop. Nothing in this file has that limit.

use crate::{clamp, flush};

/// A power-of-two ring buffer with fractional reads.
pub struct DelayLine {
    buffer: Vec<f32>,
    mask: usize,
    write: usize,
}

impl DelayLine {
    /// Allocate for `max_seconds` at `sample_rate`.
    ///
    /// Rounded up to a power of two so the wrap is a mask rather than a modulo
    /// or a branch — this read happens several times per sample per line, and in
    /// an eight-line network that is the hot loop.
    pub fn new(max_seconds: f32, sample_rate: f32) -> Self {
        let needed = (max_seconds.max(0.001) * sample_rate).ceil() as usize + 4;
        let capacity = needed.next_power_of_two();
        Self { buffer: vec![0.0; capacity], mask: capacity - 1, write: 0 }
    }

    pub fn capacity(&self) -> usize {
        self.buffer.len()
    }

    /// The longest delay this line can return, in samples.
    ///
    /// Four short of the buffer because the cubic kernel reaches one sample
    /// behind and two ahead of the read position.
    pub fn max_delay_samples(&self) -> f32 {
        (self.buffer.len() - 4) as f32
    }

    pub fn clear(&mut self) {
        self.buffer.iter_mut().for_each(|s| *s = 0.0);
        self.write = 0;
    }

    #[inline(always)]
    pub fn push(&mut self, x: f32) {
        self.buffer[self.write] = flush(x);
        self.write = (self.write + 1) & self.mask;
    }

    /// Read at an integer delay. The cheapest option, for taps that never move.
    #[inline(always)]
    pub fn read_int(&self, delay_samples: usize) -> f32 {
        // Clamped both ways. The upper clamp is not defensive decoration: an
        // unclamped `usize::MAX` underflows the subtraction and panics, and a
        // panic in an audio callback is silence rather than an error message.
        let d = delay_samples.clamp(1, self.buffer.len() - 1);
        let index = (self.write + self.buffer.len() - d) & self.mask;
        self.buffer[index]
    }

    /// Read at a fractional delay, cubic Hermite.
    ///
    /// Four-point Catmull-Rom. Linear interpolation would be cheaper and is what
    /// most hobby reverbs use; it is also a lowpass whose corner moves with the
    /// fractional part, so a modulated line built on it loses high frequencies
    /// in time with its own modulation — audible as a tail that breathes.
    ///
    /// Not allpass (Thiran) interpolation, which is tempting because it is
    /// exact: its pole makes the group delay lurch when the fraction moves, so
    /// it belongs on fixed taps and nowhere near a modulated one.
    #[inline(always)]
    pub fn read(&self, delay_samples: f32) -> f32 {
        let d = clamp(delay_samples, 1.0, self.max_delay_samples());
        let base = self.write + self.buffer.len();
        let integer = d.floor();
        let frac = d - integer;
        let i = base - integer as usize;

        let xm1 = self.buffer[(i + 1) & self.mask];
        let x0 = self.buffer[i & self.mask];
        let x1 = self.buffer[(i - 1) & self.mask];
        let x2 = self.buffer[(i - 2) & self.mask];

        let c0 = x0;
        let c1 = 0.5 * (x1 - xm1);
        let c2 = xm1 - 2.5 * x0 + 2.0 * x1 - 0.5 * x2;
        let c3 = 0.5 * (x2 - xm1) + 1.5 * (x0 - x1);
        ((c3 * frac + c2) * frac + c1) * frac + c0
    }
}

/// A Schroeder allpass.
///
/// ```text
/// v[n] = x[n] + g·v[n−M]
/// y[n] = v[n−M] − g·v[n]
/// ```
///
/// Unity magnitude at every frequency, dispersive phase: it smears a transient
/// without colouring it. That is what every "Diffusion" control on both machines
/// actually adjusts.
pub struct Allpass {
    line: DelayLine,
    delay_samples: f32,
    gain: f32,
}

impl Allpass {
    pub fn new(delay_seconds: f32, gain: f32, sample_rate: f32) -> Self {
        let line = DelayLine::new(delay_seconds * 2.0 + 0.01, sample_rate);
        Self { line, delay_samples: (delay_seconds * sample_rate).max(1.0), gain: clamp(gain, -0.95, 0.95) }
    }

    pub fn set_gain(&mut self, gain: f32) {
        // Capped short of unity: at |g| = 1 the allpass is a pure oscillator and
        // the "diffusion" knob becomes a feedback knob with the wrong label.
        self.gain = clamp(gain, -0.95, 0.95);
    }

    pub fn set_delay_seconds(&mut self, seconds: f32, sample_rate: f32) {
        self.delay_samples = clamp(seconds * sample_rate, 1.0, self.line.max_delay_samples());
    }

    pub fn clear(&mut self) {
        self.line.clear();
    }

    #[inline(always)]
    pub fn process(&mut self, x: f32) -> f32 {
        let delayed = self.line.read(self.delay_samples);
        let v = x + self.gain * delayed;
        self.line.push(v);
        delayed - self.gain * v
    }
}

/// Allpasses in series, longest first.
///
/// Each stage multiplies the echo density of the one before it, so ordering
/// long-to-short gives the density the whole chain to build across instead of
/// letting the final short stage set it.
pub struct DiffuserChain {
    stages: Vec<Allpass>,
}

impl DiffuserChain {
    pub fn new(delays_seconds: &[f32], gain: f32, sample_rate: f32) -> Self {
        Self { stages: delays_seconds.iter().map(|&d| Allpass::new(d, gain, sample_rate)).collect() }
    }

    pub fn set_gain(&mut self, gain: f32) {
        for stage in &mut self.stages {
            stage.set_gain(gain);
        }
    }

    pub fn clear(&mut self) {
        for stage in &mut self.stages {
            stage.clear();
        }
    }

    #[inline(always)]
    pub fn process(&mut self, x: f32) -> f32 {
        self.stages.iter_mut().fold(x, |acc, stage| stage.process(acc))
    }

    pub fn len(&self) -> usize {
        self.stages.len()
    }

    pub fn is_empty(&self) -> bool {
        self.stages.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SR: f32 = 48_000.0;

    #[test]
    fn integer_read_returns_what_was_written() {
        let mut line = DelayLine::new(0.01, SR);
        for i in 1..=10 {
            line.push(i as f32);
        }
        assert_eq!(line.read_int(1), 10.0);
        assert_eq!(line.read_int(10), 1.0);
    }

    #[test]
    fn fractional_read_matches_integer_at_whole_delays() {
        let mut line = DelayLine::new(0.01, SR);
        for i in 1..=64 {
            line.push(i as f32);
        }
        for d in [4usize, 8, 16, 32] {
            let exact = line.read_int(d);
            let interpolated = line.read(d as f32);
            assert!(
                (exact - interpolated).abs() < 1.0e-3,
                "delay {d}: int {exact} vs frac {interpolated}"
            );
        }
    }

    #[test]
    fn hermite_interpolation_is_accurate_on_a_sine() {
        // Feed a known waveform, read at a half-sample delay, compare against
        // the analytic value.
        //
        // The `+ 1.0` is the line's convention and worth stating once: `read` is
        // written to be called *before* `push` in a feedback loop, so `read(d)`
        // returns the sample pushed `d` calls ago counting the pending one. A
        // test that pushes first is one step ahead of that.
        let freq = 1000.0f32;
        let mut line = DelayLine::new(0.05, SR);
        let mut worst: f32 = 0.0;
        for n in 0..2000 {
            let phase = 2.0 * std::f32::consts::PI * freq * n as f32 / SR;
            line.push(phase.sin());
            if n > 100 {
                let got = line.read(10.5);
                let want_phase =
                    2.0 * std::f32::consts::PI * freq * (n as f32 - 10.5 + 1.0) / SR;
                worst = worst.max((got - want_phase.sin()).abs());
            }
        }
        assert!(worst < 0.01, "worst Hermite error {worst}");
    }

    #[test]
    fn delay_line_never_panics_on_absurd_requests() {
        // Rule 2: an audio callback that panics is silence, so every input is
        // clamped rather than trusted.
        let mut line = DelayLine::new(0.01, SR);
        line.push(1.0);
        let _ = line.read(-500.0);
        let _ = line.read(f32::MAX);
        let _ = line.read(0.0);
        let _ = line.read_int(0);
        let _ = line.read_int(usize::MAX);
    }

    #[test]
    fn allpass_has_flat_magnitude() {
        // The defining property. If this fails the diffuser is colouring the
        // signal and every reverb built on it inherits the tint.
        let mut ap = Allpass::new(0.007, 0.7, SR);
        for freq in [100.0f32, 440.0, 1000.0, 4000.0, 10_000.0] {
            ap.clear();
            let mut energy_in = 0.0f64;
            let mut energy_out = 0.0f64;
            for n in 0..48_000 {
                let x = (2.0 * std::f32::consts::PI * freq * n as f32 / SR).sin();
                let y = ap.process(x);
                // Skip the transient: the tail of the allpass has to fill first.
                if n > 4_000 {
                    energy_in += (x * x) as f64;
                    energy_out += (y * y) as f64;
                }
            }
            let ratio = (energy_out / energy_in).sqrt();
            assert!(
                (ratio - 1.0).abs() < 0.02,
                "allpass at {freq} Hz has gain {ratio}, expected 1.0"
            );
        }
    }

    #[test]
    fn allpass_at_zero_gain_is_a_pure_delay() {
        // Falls out of the algebra, and it is what makes "Diffusion 0" on the
        // DP/4 produce the documented "mechanical stutter" rather than silence.
        let mut ap = Allpass::new(0.001, 0.0, SR);
        let delay = (0.001 * SR) as usize;
        let mut out = Vec::new();
        for n in 0..(delay + 8) {
            out.push(ap.process(if n == 0 { 1.0 } else { 0.0 }));
        }
        let arrived = out
            .iter()
            .position(|v| v.abs() > 0.5)
            .unwrap_or_else(|| panic!("impulse never arrived"));
        assert_eq!(arrived, delay, "impulse arrived at {arrived}, expected {delay}");
        assert!((out[arrived] - 1.0).abs() < 1.0e-4, "impulse amplitude {}", out[arrived]);
        for (n, v) in out.iter().enumerate() {
            if n != arrived {
                assert!(v.abs() < 1.0e-4, "unexpected energy at {n}: {v}");
            }
        }
    }

    #[test]
    fn allpass_gain_is_capped_below_unity() {
        let mut ap = Allpass::new(0.005, 0.99, SR);
        ap.set_gain(5.0);
        // Drive it hard and confirm it settles rather than growing without bound.
        let mut peak = 0.0f32;
        for n in 0..200_000 {
            let y = ap.process(if n < 100 { 1.0 } else { 0.0 });
            peak = peak.max(y.abs());
            assert!(y.is_finite(), "allpass diverged at {n}");
        }
        assert!(peak < 100.0, "allpass peak {peak} suggests runaway");
    }

    #[test]
    fn hermite_interpolation_costs_high_frequency_energy() {
        // Worth its own test because it caught a wrong assumption, and because
        // it constrains the FDN: **a fractional read is not energy-preserving on
        // full-band noise.** A four-point kernel is an interpolating lowpass, so
        // content approaching Nyquist is attenuated.
        //
        // Measured: a *pure delay* (allpass gain 0) at a fractional length
        // returns ~0.82 of broadband white-noise energy — about −1.7 dB, all of
        // it above ~10 kHz. Nothing is wrong with the allpass; the loss is the
        // interpolator, and any test that feeds a diffuser white noise and
        // expects unity is measuring the wrong thing.
        let mut pure_delay = Allpass::new(0.0207, 0.0, SR);
        let mut rng = crate::Rng::new(1);
        let (mut ein, mut eout) = (0.0f64, 0.0f64);
        for n in 0..96_000 {
            let x = rng.next_bipolar() * 0.25;
            let y = pure_delay.process(x);
            if n > 8_000 {
                ein += (x * x) as f64;
                eout += (y * y) as f64;
            }
        }
        let ratio = (eout / ein).sqrt();
        assert!(
            (0.75..0.90).contains(&ratio),
            "broadband loss through a fractional delay was {ratio}, expected ~0.82"
        );
    }

    #[test]
    fn diffuser_chain_preserves_energy_in_band() {
        // The real property: within the band where the interpolator is accurate,
        // four allpasses in series are transparent. Band-limited by construction
        // — a sum of tones rather than white noise, so the measurement is not
        // dominated by the interpolator's behaviour at Nyquist.
        let tones = [110.0f32, 220.0, 440.0, 880.0, 1760.0, 3520.0];
        let mut chain = DiffuserChain::new(&[0.0207, 0.0127, 0.0083, 0.0047], 0.7, SR);
        let mut energy_in = 0.0f64;
        let mut energy_out = 0.0f64;
        for n in 0..192_000 {
            let t = n as f32 / SR;
            let x: f32 = tones
                .iter()
                .map(|f| (2.0 * std::f32::consts::PI * f * t).sin())
                .sum::<f32>()
                / tones.len() as f32;
            let y = chain.process(x);
            if n > 16_000 {
                energy_in += (x * x) as f64;
                energy_out += (y * y) as f64;
            }
        }
        let ratio = (energy_out / energy_in).sqrt();
        assert!((ratio - 1.0).abs() < 0.05, "in-band chain gain {ratio}");
    }
}
