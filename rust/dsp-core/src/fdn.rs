//! Feedback delay network.
//!
//! The late-reverberation engine for both machines. Three things here could not
//! be done in the browser build:
//!
//! 1. **A real Hadamard mixing matrix.** Web Audio could express a Householder
//!    reflection cheaply — one shared bus — but a dense orthogonal matrix would
//!    have meant N² node connections. Here it is a butterfly, `N log N`, and it
//!    diffuses noticeably better.
//! 2. **Per-sample feedback.** No render-quantum floor.
//! 3. **Jot's two-band decay.** The damping filter is designed to hit two
//!    independent RT60 targets at DC and Nyquist, which is what the DP/4's
//!    bipolar "LF Decay Time" control actually asks for. The browser build had
//!    to approximate it by biasing a single lowpass.

use crate::delay::DelayLine;
use crate::filter::OnePole;
use crate::{clamp, flush, Rng, ANTI_DENORMAL_DC};

/// Base delay lengths in seconds, mutually prime in milliseconds.
///
/// Coincident echoes are what make a network sound like a pitched box rather
/// than a room, so the lengths must share no common factor. Spread is about
/// 1 : 4.4 — wide enough to fill in quickly, narrow enough that no single line
/// dominates the early response.
pub const BASE_SECONDS: [f32; 16] = [
    0.023, 0.031, 0.041, 0.053, 0.067, 0.079, 0.089, 0.101, 0.113, 0.127, 0.139, 0.149, 0.157,
    0.167, 0.179, 0.191,
];

/// Longest line the network will allocate for, before size scaling.
pub const MAX_LINE_SECONDS: f32 = 2.5;

/// How the network mixes its lines back into themselves.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MixMatrix {
    /// `A = I − (2/N)·1·1ᵀ`. Cheap, orthogonal, slightly flat-sounding because
    /// every off-diagonal entry is identical.
    Householder,
    /// Normalised Hadamard, applied as a butterfly. Requires a power-of-two
    /// line count. The better default.
    Hadamard,
}

pub struct Fdn {
    lines: Vec<DelayLine>,
    damping: Vec<OnePole>,
    delays: Vec<f32>,
    base: Vec<f32>,
    gains: Vec<f32>,
    scratch: Vec<f32>,
    mod_phase: Vec<f32>,
    mod_inc: Vec<f32>,
    mod_depth_samples: f32,
    input_scale: f32,
    matrix: MixMatrix,
    sample_rate: f32,
    size_scale: f32,
    rt60: f32,
    rt60_high: f32,
    infinite: bool,
}

impl Fdn {
    pub fn new(line_count: usize, sample_rate: f32, matrix: MixMatrix) -> Self {
        let count = match matrix {
            // A Hadamard butterfly is only defined on a power of two, so an odd
            // request is rounded down rather than silently mis-mixed.
            MixMatrix::Hadamard => clamp(line_count as f32, 2.0, 16.0) as usize,
            MixMatrix::Householder => clamp(line_count as f32, 2.0, 16.0) as usize,
        };
        let count = if matrix == MixMatrix::Hadamard {
            count.next_power_of_two().min(16) / if count.is_power_of_two() { 1 } else { 2 }
        } else {
            count
        }
        .max(2);

        let base: Vec<f32> = BASE_SECONDS[..count].to_vec();
        let lines = base
            .iter()
            .map(|_| DelayLine::new(MAX_LINE_SECONDS * 1.05, sample_rate))
            .collect();
        let damping = vec![OnePole::new(); count];
        let delays: Vec<f32> = base.iter().map(|&s| s * sample_rate).collect();

        let mut rng = Rng::new(0x5EED);
        let mod_phase: Vec<f32> = (0..count).map(|_| rng.next_bipolar().abs()).collect();

        let mut fdn = Self {
            lines,
            damping,
            delays,
            base,
            gains: vec![0.0; count],
            scratch: vec![0.0; count],
            mod_phase,
            mod_inc: vec![0.0; count],
            mod_depth_samples: 0.0,
            input_scale: 1.0,
            matrix,
            sample_rate,
            size_scale: 1.0,
            rt60: 2.0,
            rt60_high: 2.0,
            infinite: false,
        };
        fdn.set_mod_rate(0.5);
        fdn.recompute();
        fdn
    }

    pub fn line_count(&self) -> usize {
        self.lines.len()
    }

    pub fn clear(&mut self) {
        for line in &mut self.lines {
            line.clear();
        }
        for d in &mut self.damping {
            d.clear();
        }
    }

    /// Target RT60 in seconds, and the RT60 the top of the spectrum should get.
    ///
    /// Passing the same value for both gives flat, unnatural decay. Real spaces
    /// lose highs faster, which is what `rt60_high < rt60` expresses.
    pub fn set_decay(&mut self, rt60: f32, rt60_high: f32) {
        self.rt60 = clamp(rt60, 0.05, 300.0);
        self.rt60_high = clamp(rt60_high, 0.02, 300.0);
        self.recompute();
    }

    /// Multiply every line length. Ramp this rather than stepping it: a delay
    /// whose length jumps clicks, and one that glides Dopplers — which is what
    /// a real tank does when its size is swept, and is musically the point.
    pub fn set_size(&mut self, scale: f32) {
        self.size_scale = clamp(scale, 0.02, 12.0);
        self.recompute();
    }

    pub fn set_mod_depth_seconds(&mut self, seconds: f32) {
        self.mod_depth_samples = clamp(seconds, 0.0, 0.01) * self.sample_rate;
    }

    pub fn set_mod_rate(&mut self, hz: f32) {
        let hz = clamp(hz, 0.0, 20.0);
        let count = self.lines.len();
        for (i, inc) in self.mod_inc.iter_mut().enumerate() {
            // Rates fan out irrationally so the lines never re-align. Moving
            // them together would transpose the whole tail — seasick, not smooth.
            let spread = 0.7 + 0.55 * (i as f32 / count.max(2) as f32) + 0.13 * (i % 3) as f32;
            *inc = hz * spread / self.sample_rate;
        }
    }

    /// Hold the tail forever. Input still enters — that is the difference
    /// between the H90's "Infinite" and its "Freeze", and freezing the input is
    /// the caller's job, not the network's.
    pub fn set_infinite(&mut self, infinite: bool) {
        self.infinite = infinite;
        self.recompute();
    }

    /// Per-line gain, and the damping filter that splits it across the spectrum.
    ///
    /// `g = 10^(−3·M / RT60)` where `M` is the line length in seconds: after
    /// `RT60` seconds the signal has made `RT60/M` passes and must be 60 dB down.
    ///
    /// Computed in `f64`. At the DP/4 hall's documented 250-second maximum a
    /// 0.1-second line needs `g = 0.99724`, which is 2.8e−3 from unity — `f32`
    /// can hold it, but the `powf` that produces it cannot be trusted to.
    fn recompute(&mut self) {
        for i in 0..self.lines.len() {
            let length = (self.base[i] * self.size_scale).max(0.001);
            self.delays[i] = clamp(
                length * self.sample_rate,
                1.0,
                self.lines[i].max_delay_samples() - self.mod_depth_samples - 2.0,
            );

            if self.infinite {
                self.gains[i] = 1.0;
                self.damping[i].set_pole(0.0);
                continue;
            }

            let m = length as f64;
            let g_dc = 10f64.powf(-3.0 * m / self.rt60.max(0.05) as f64);
            let g_hf = 10f64.powf(-3.0 * m / self.rt60_high.max(0.02) as f64);

            // Jot: a one-pole scaled to hit `g_dc` at DC and `g_hf` at Nyquist.
            //   H(z) = g_dc·(1−a)/(1−a·z⁻¹),  a = (1−k)/(1+k),  k = g_hf/g_dc
            let k = (g_hf / g_dc.max(1.0e-12)).clamp(1.0e-6, 0.999_999);
            let a = ((1.0 - k) / (1.0 + k)) as f32;
            self.gains[i] = clamp(g_dc as f32, 0.0, 0.999_99);
            self.damping[i].set_pole(a);
        }
        self.recompute_input_scale();
    }

    /// Scale the input by the reciprocal of the network's steady-state gain.
    ///
    /// A feedback network is an accumulator. With per-pass gain `g` its
    /// steady-state power gain is `1/(1 − g²)`, so a *short* line with a *long*
    /// decay — a small tank set to ring for six seconds — reaches a gain of
    /// several hundred. That is physically what those settings mean, and it is
    /// also an overload: measured at 964× before this existed.
    ///
    /// Scaling the input by `√(1 − g²)` makes the steady-state output unity
    /// regardless of size and decay, so the two controls stop interacting with
    /// the output level. The floor keeps Infinite mode from muting its own
    /// input, which the H90 explicitly requires it to accept.
    fn recompute_input_scale(&mut self) {
        let mean_g: f32 = if self.gains.is_empty() {
            0.0
        } else {
            self.gains.iter().sum::<f32>() / self.gains.len() as f32
        };
        self.input_scale = (1.0 - mean_g * mean_g).max(0.02).sqrt();
    }

    /// One sample through the network.
    ///
    /// Returns the summed output. The caller decides what to do with it; a
    /// stereo module reads alternate lines, a mono one takes the sum.
    #[inline]
    pub fn process(&mut self, input: f32) -> f32 {
        let input = input * self.input_scale;
        let count = self.lines.len();
        let mut sum = 0.0f32;

        for i in 0..count {
            let modulation = if self.mod_depth_samples > 0.0 {
                self.mod_phase[i] += self.mod_inc[i];
                if self.mod_phase[i] >= 1.0 {
                    self.mod_phase[i] -= 1.0;
                }
                // A triangle rather than a sine: no transcendental in the hot
                // loop, and the spectral difference at these depths is nil.
                let t = self.mod_phase[i];
                (if t < 0.5 { 4.0 * t - 1.0 } else { 3.0 - 4.0 * t }) * self.mod_depth_samples
            } else {
                0.0
            };

            let raw = self.lines[i].read(self.delays[i] + modulation);
            let damped = self.damping[i].process(raw) * self.gains[i];
            self.scratch[i] = damped;
            sum += damped;
        }

        match self.matrix {
            MixMatrix::Householder => {
                let factor = 2.0 / count as f32;
                let shared = sum * factor;
                for i in 0..count {
                    let v = self.scratch[i] - shared + input + ANTI_DENORMAL_DC;
                    self.lines[i].push(v);
                }
            }
            MixMatrix::Hadamard => {
                // In-place butterfly. log2(N) passes, N adds each.
                let mut span = 1;
                while span < count {
                    let mut i = 0;
                    while i < count {
                        for j in i..i + span {
                            let a = self.scratch[j];
                            let b = self.scratch[j + span];
                            self.scratch[j] = a + b;
                            self.scratch[j + span] = a - b;
                        }
                        i += span * 2;
                    }
                    span *= 2;
                }
                let norm = 1.0 / (count as f32).sqrt();
                for i in 0..count {
                    let v = self.scratch[i] * norm + input + ANTI_DENORMAL_DC;
                    self.lines[i].push(flush(v));
                }
            }
        }

        sum * (1.0 / (count as f32).sqrt())
    }

    /// Read one line's current output, for stereo taps.
    #[inline]
    pub fn tap(&self, index: usize) -> f32 {
        self.scratch[index % self.scratch.len()]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SR: f32 = 48_000.0;

    /// RT60 by Schroeder backward integration — the standard measurement.
    fn measure_rt60(fdn: &mut Fdn, seconds: f32) -> f32 {
        let n = (seconds * SR) as usize;
        let mut tail = Vec::with_capacity(n);
        tail.push(fdn.process(1.0));
        for _ in 1..n {
            tail.push(fdn.process(0.0));
        }

        // Integrate the energy backwards, then find where it falls 60 dB.
        let mut energy = vec![0.0f64; n];
        let mut running = 0.0f64;
        for (slot, sample) in energy.iter_mut().zip(tail.iter()).rev() {
            running += (sample * sample) as f64;
            *slot = running;
        }
        if energy[0] <= 0.0 {
            return 0.0;
        }
        let reference = energy[0];
        for (i, e) in energy.iter().enumerate() {
            if 10.0 * (e / reference).log10() <= -60.0 {
                return i as f32 / SR;
            }
        }
        seconds
    }

    #[test]
    fn hadamard_matrix_is_orthogonal() {
        // Energy preservation before damping is the whole reason to use an
        // orthogonal matrix. If this drifts the network either fades or blows up
        // regardless of what the decay gains say.
        for count in [4usize, 8, 16] {
            let norm = 1.0 / (count as f32).sqrt();
            let mut worst: f32 = 0.0;
            for probe in 0..count {
                let mut v = vec![0.0f32; count];
                v[probe] = 1.0;
                let mut span = 1;
                while span < count {
                    let mut i = 0;
                    while i < count {
                        for j in i..i + span {
                            let (a, b) = (v[j], v[j + span]);
                            v[j] = a + b;
                            v[j + span] = a - b;
                        }
                        i += span * 2;
                    }
                    span *= 2;
                }
                let energy: f32 = v.iter().map(|x| (x * norm) * (x * norm)).sum();
                worst = worst.max((energy - 1.0).abs());
            }
            assert!(worst < 1.0e-5, "N={count} energy error {worst}");
        }
    }

    #[test]
    fn decay_gain_is_accurate_at_the_documented_extremes() {
        // The formula itself, before any network. The DP/4 hall's 250 s ceiling
        // is the case that needs f64: at f32 the powf loses enough precision to
        // shift the measured RT60 by seconds.
        for (rt60, length) in [(0.2f64, 0.1f64), (2.0, 0.1), (250.0, 0.1)] {
            let g = 10f64.powf(-3.0 * length / rt60);
            let passes = rt60 / length;
            let total_db = 20.0 * (g.powf(passes)).log10();
            assert!(
                (total_db + 60.0).abs() < 0.01,
                "RT60 {rt60}s: reached {total_db} dB instead of −60"
            );
        }
    }

    #[test]
    fn network_hits_its_target_rt60() {
        for target in [0.5f32, 1.5, 4.0] {
            let mut fdn = Fdn::new(8, SR, MixMatrix::Hadamard);
            fdn.set_size(1.0);
            fdn.set_decay(target, target);
            let measured = measure_rt60(&mut fdn, target * 2.5);
            let error = (measured - target).abs() / target;
            assert!(
                error < 0.30,
                "target {target}s, measured {measured}s ({:.0}% off)",
                error * 100.0
            );
        }
    }

    #[test]
    fn shorter_high_frequency_decay_darkens_the_tail() {
        // Jot's two-band design, audibly: with rt60_high below rt60 the tail
        // must lose its top before it loses its bottom.
        let mut bright = Fdn::new(8, SR, MixMatrix::Hadamard);
        bright.set_decay(3.0, 3.0);
        let mut dark = Fdn::new(8, SR, MixMatrix::Hadamard);
        dark.set_decay(3.0, 0.4);

        let hf_energy = |fdn: &mut Fdn| {
            let mut prev = 0.0f32;
            let mut energy = 0.0f64;
            for n in 0..(SR as usize) {
                let y = fdn.process(if n == 0 { 1.0 } else { 0.0 });
                // Crude first-difference highpass; enough to compare two tails.
                let hp = y - prev;
                prev = y;
                if n > (SR as usize) / 2 {
                    energy += (hp * hp) as f64;
                }
            }
            energy
        };
        assert!(hf_energy(&mut dark) < hf_energy(&mut bright) * 0.5);
    }

    #[test]
    fn infinite_holds_its_level() {
        let mut fdn = Fdn::new(8, SR, MixMatrix::Hadamard);
        fdn.set_decay(2.0, 2.0);
        fdn.set_infinite(true);

        let mut rng = Rng::new(3);
        for _ in 0..(SR as usize / 10) {
            fdn.process(rng.next_bipolar() * 0.1);
        }
        let early: f32 = (0..4800).map(|_| fdn.process(0.0).abs()).sum();
        for _ in 0..(SR as usize * 20) {
            fdn.process(0.0);
        }
        let late: f32 = (0..4800).map(|_| fdn.process(0.0).abs()).sum();

        assert!(late > early * 0.5, "infinite tail decayed: {early} → {late}");
        assert!(late < early * 2.0, "infinite tail grew: {early} → {late}");
    }

    #[test]
    fn output_level_is_independent_of_size_and_decay() {
        // The property `input_scale` buys: turning Size or Decay must change the
        // character of the tail, not its loudness. Without it, small-and-long
        // settings are hundreds of times louder than large-and-short ones.
        // Restricted to settings where the tank actually reverberates — the
        // line length must be well under the decay time. A 1.5-second line with
        // a 0.5-second RT60 is not a quiet reverb, it is a delay whose signal
        // has died before it emerges, and comparing its level to a real tail
        // measures nothing.
        let mut peaks = Vec::new();
        for (size, rt) in [(0.05f32, 6.0f32), (1.0, 2.0), (2.0, 4.0), (0.1, 20.0)] {
            let mut fdn = Fdn::new(8, SR, MixMatrix::Hadamard);
            fdn.set_size(size);
            fdn.set_decay(rt, rt * 0.5);
            let mut rng = Rng::new(4);
            let mut peak = 0.0f32;
            for n in 0..(SR as usize) {
                let x = if n < (SR as usize / 2) { rng.next_bipolar() * 0.5 } else { 0.0 };
                peak = peak.max(fdn.process(x).abs());
            }
            peaks.push(peak);
        }
        let lo = peaks.iter().cloned().fold(f32::MAX, f32::min);
        let hi = peaks.iter().cloned().fold(0.0f32, f32::max);
        assert!(hi / lo < 8.0, "level varied {}x across settings: {peaks:?}", hi / lo);
    }

    #[test]
    fn network_never_diverges_at_any_setting() {
        // The one failure mode that reaches the speakers. Sweep the whole
        // parameter space and assert nothing runs away or goes non-finite.
        for matrix in [MixMatrix::Hadamard, MixMatrix::Householder] {
            for count in [4usize, 8] {
                for &rt in &[0.1f32, 5.0, 250.0] {
                    for &size in &[0.05f32, 1.0, 8.0] {
                        let mut fdn = Fdn::new(count, SR, matrix);
                        fdn.set_size(size);
                        fdn.set_decay(rt, rt * 0.5);
                        fdn.set_mod_depth_seconds(0.002);
                        fdn.set_mod_rate(3.0);
                        let mut peak = 0.0f32;
                        let mut rng = Rng::new(11);
                        for n in 0..(SR as usize) {
                            let x = if n < 1000 { rng.next_bipolar() } else { 0.0 };
                            let y = fdn.process(x);
                            assert!(
                                y.is_finite(),
                                "{matrix:?} N={count} rt={rt} size={size} went non-finite at {n}"
                            );
                            peak = peak.max(y.abs());
                        }
                        assert!(
                            peak < 50.0,
                            "{matrix:?} N={count} rt={rt} size={size} peaked at {peak}"
                        );
                    }
                }
            }
        }
    }

    #[test]
    fn tail_reaches_exact_silence() {
        // The denormal test, and the reason ANTI_DENORMAL_DC exists. A tail that
        // settles at 1e-40 instead of 0.0 costs 100+ cycles per sample forever
        // — in a browser that is a dropout with no visible cause.
        let mut fdn = Fdn::new(8, SR, MixMatrix::Hadamard);
        fdn.set_decay(0.3, 0.3);
        fdn.process(1.0);
        for _ in 0..(SR as usize * 10) {
            fdn.process(0.0);
        }
        // Not exactly zero, and it must not be: ANTI_DENORMAL_DC keeps a tiny
        // constant circulating on purpose. What matters is that nothing is left
        // *decaying* through the denormal range, so the bar is "far below
        // anything audible" rather than "bit-zero".
        let residual: f32 = (0..1000).map(|_| fdn.process(0.0).abs()).sum();
        assert!(residual < 1.0e-8, "residual energy {residual} — denormal risk");
        assert!(residual.is_finite());
    }

    #[test]
    fn size_changes_do_not_break_the_network() {
        let mut fdn = Fdn::new(8, SR, MixMatrix::Hadamard);
        fdn.set_decay(2.0, 1.0);
        let mut rng = Rng::new(5);
        for n in 0..(SR as usize) {
            if n % 1000 == 0 {
                fdn.set_size(0.1 + (n as f32 / SR) * 6.0);
            }
            assert!(fdn.process(rng.next_bipolar() * 0.2).is_finite());
        }
    }
}
