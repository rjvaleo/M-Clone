//! The ENSONIQ DP/4+ reverbs.
//!
//! Ported from `src/modular/audio/dp4.ts`, which is worth reading for the
//! manual citations; the short version is that **Jon Dattorro co-authored the
//! DP/4+ manual**, and a year later published "Effect Design Part 1", whose
//! plate topology is now the industry reference. The machine's reverb
//! parameters are that paper's block diagram with the labels changed:
//!
//! | DP/4 control            | Dattorro                       |
//! |-------------------------|--------------------------------|
//! | Diffusion 1 / 2         | input diffusion 1 / 2          |
//! | Decay Definition        | decay diffusion                |
//! | HF Bandwidth            | bandwidth — the *input* lowpass |
//! | HF Damping              | damping — the *in-tank* lowpass |
//! | Detune Rate / Depth     | the modulated allpass          |
//!
//! So these are not reverse-engineered by ear. Two things the manual is precise
//! about and which are easy to get backwards:
//!
//! - **Bandwidth and Damping are different filters in different places.**
//!   Bandwidth is on the way *in* ("like a tone control on a guitar"); Damping
//!   is inside the loop ("the rate of attenuation of high frequencies in the
//!   decay"). Bandwidth high = brighter. Damping high = darker.
//! - **The Non Lin reverbs have no feedback at all.** "Unlike the hall, room
//!   and plate reverbs, Non Lin 1, 2, and 3 pass the input signal through the
//!   reverb diffusers only once." Nine level taps read that single pass, which
//!   is how one structure gives a gate, a reverse swell or a bloom.

use crate::clamp;
use crate::delay::{DelayLine, DiffuserChain};
use crate::fdn::{Fdn, MixMatrix};
use crate::filter::OnePole;

/// The five reverb algorithms. Order is the wire protocol; appending is safe.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u32)]
pub enum Dp4Algorithm {
    SmallPlate = 0,
    LargePlate = 1,
    SmallRoom = 2,
    LargeRoom = 3,
    Hall = 4,
}

impl Dp4Algorithm {
    pub fn from_u32(value: u32) -> Self {
        match value {
            0 => Self::SmallPlate,
            2 => Self::SmallRoom,
            3 => Self::LargeRoom,
            4 => Self::Hall,
            // Large Plate is the fallback, matching `dp4Algorithm` in the
            // TypeScript: an unknown algorithm should still be a reverb.
            _ => Self::LargePlate,
        }
    }

    pub fn profile(self) -> AlgorithmProfile {
        match self {
            Self::SmallPlate => AlgorithmProfile {
                size_scale: 0.55,
                max_decay_seconds: 100.0,
                max_predelay_seconds: 0.5,
                line_count: 6,
                detune: false,
                pre_echoes: false,
            },
            Self::LargePlate => AlgorithmProfile {
                size_scale: 1.0,
                max_decay_seconds: 140.0,
                max_predelay_seconds: 0.43,
                line_count: 6,
                detune: false,
                pre_echoes: false,
            },
            Self::SmallRoom => AlgorithmProfile {
                size_scale: 0.45,
                max_decay_seconds: 100.0,
                max_predelay_seconds: 0.45,
                line_count: 8,
                detune: true,
                pre_echoes: true,
            },
            Self::LargeRoom => AlgorithmProfile {
                size_scale: 0.85,
                max_decay_seconds: 150.0,
                max_predelay_seconds: 0.45,
                line_count: 8,
                detune: true,
                pre_echoes: true,
            },
            Self::Hall => AlgorithmProfile {
                size_scale: 1.6,
                // "0.70 to 250.0 sec." — the longest published decay in the machine.
                max_decay_seconds: 250.0,
                max_predelay_seconds: 0.45,
                line_count: 8,
                detune: true,
                pre_echoes: true,
            },
        }
    }
}

/// "The internal values of the components (not user programmable) differentiate
/// the large and small plate reverbs" — same code, different constants.
///
/// `plate` variants have no pre-echo section and no detune; `room` and `hall`
/// do. That asymmetry is in the manual's own diagrams and is not tidied away.
#[derive(Clone, Copy, Debug)]
pub struct AlgorithmProfile {
    pub size_scale: f32,
    pub max_decay_seconds: f32,
    pub max_predelay_seconds: f32,
    pub line_count: usize,
    pub detune: bool,
    pub pre_echoes: bool,
}

/// "LF Decay Time … boosts (positive) or cuts (negative) the rate at which low
/// frequencies will decay." Normalised to ±1 here.
///
/// A multiplier on the low-frequency RT60, bipolar about unity. Positive means
/// lows ring longer than highs, which is what a large hall does; negative means
/// they die first, which no real room does and is exactly why the control
/// exists.
pub fn lf_decay_scale(amount: f32) -> f32 {
    2.0f32.powf(clamp(amount, -1.0, 1.0) * 1.5)
}

/// HF Bandwidth 01–99: the input lowpass. Higher = brighter.
pub fn bandwidth_hz(amount: f32) -> f32 {
    200.0 * (20_000.0f32 / 200.0).powf(clamp(amount, 0.0, 1.0))
}

/// HF Damping 00–99: the in-tank lowpass. Higher = darker.
pub fn damping_hz(amount: f32) -> f32 {
    18_000.0 * (600.0f32 / 18_000.0).powf(clamp(amount, 0.0, 1.0))
}

/// The two pre-echoes rooms and halls have. "Ref 1 Time … 0 to 120 ms".
const PRE_ECHO_COUNT: usize = 2;
/// The four early reflections plates have instead.
const EARLY_REF_COUNT: usize = 4;

struct PreEcho {
    line: DelayLine,
    delay_samples: f32,
    to_tank: f32,
    to_output: f32,
}

struct EarlyRef {
    line: DelayLine,
    delay_samples: f32,
    level: f32,
}

/// One DP/4 tank.
///
/// ```text
///   in ─► bandwidth(LPF) ─► preDelay ─► D1 ─► D2 ─┬─► primary send ─► tank ─► LPF ─┬─► out
///                                                  │                               │
///                                                  └─► pre-echo taps ──────────────┘
/// ```
///
/// The pre-echo section is the part people miss: each echo has *two*
/// destinations with independent levels — "Ref 1 Level … controls the echo send
/// to the Definition" and "Ref 1 Send … with the echo routed directly to the
/// output". One goes into the reverb, one goes around it. Both are wired.
pub struct Dp4Reverb {
    sample_rate: f32,
    profile: AlgorithmProfile,

    bandwidth: OnePole,
    predelay: DelayLine,
    predelay_samples: f32,
    diffusion1: DiffuserChain,
    diffusion2: DiffuserChain,
    /// Dattorro's decay diffusion. His sits *inside* the tank loop; `Fdn`
    /// exposes no hook there, so it is applied to the tank's feed instead.
    /// The difference is that a smeared impulse enters the loop once rather
    /// than being re-smeared on every circulation — audibly close at moderate
    /// settings and thinner at extreme ones. Noted rather than hidden; moving
    /// it inside means adding an allpass stage to `Fdn` itself.
    definition: DiffuserChain,
    tank: Fdn,
    output_filter: OnePole,

    pre_echoes: [PreEcho; PRE_ECHO_COUNT],
    early_refs: [EarlyRef; EARLY_REF_COUNT],

    primary_send: f32,
    decay_seconds: f32,
    lf_decay: f32,
    damping: f32,
}

impl Dp4Reverb {
    pub fn new(algorithm: Dp4Algorithm, sample_rate: f32) -> Self {
        let profile = algorithm.profile();
        let rate = if sample_rate > 0.0 { sample_rate } else { 48_000.0 };

        let mut bandwidth = OnePole::new();
        bandwidth.set_cutoff(12_000.0, rate);
        let mut output_filter = OnePole::new();
        output_filter.set_cutoff(16_000.0, rate);

        let mut tank = Fdn::new(profile.line_count, rate, MixMatrix::Hadamard);
        tank.set_size(profile.size_scale);
        tank.set_decay(2.0, 2.0);
        if profile.detune {
            tank.set_mod_rate(0.4);
        }

        // "Diffusion 1 controls the high frequency ranges", "Diffusion 2
        // controls lower frequency ranges" — which in a diffuser means shorter
        // and longer delays, so they are two chains rather than one.
        let diffusion1 = DiffuserChain::new(&[0.0048, 0.0036], 0.75, rate);
        let diffusion2 = DiffuserChain::new(&[0.0127, 0.0093], 0.625, rate);
        let definition = DiffuserChain::new(&[0.0089, 0.0061], 0.5, rate);

        let pre_echo = |i: usize| PreEcho {
            line: DelayLine::new(0.13, rate),
            delay_samples: (0.02 + i as f32 * 0.017) * rate,
            to_tank: 0.3,
            to_output: 0.2,
        };
        let early_ref = |i: usize| EarlyRef {
            line: DelayLine::new(0.06, rate),
            delay_samples: (0.004 + i as f32 * 0.0037) * rate,
            level: 0.0,
        };

        Self {
            sample_rate: rate,
            profile,
            bandwidth,
            predelay: DelayLine::new(profile.max_predelay_seconds.max(0.05) + 0.01, rate),
            predelay_samples: 0.0,
            diffusion1,
            diffusion2,
            definition,
            tank,
            output_filter,
            pre_echoes: [pre_echo(0), pre_echo(1)],
            early_refs: [early_ref(0), early_ref(1), early_ref(2), early_ref(3)],
            primary_send: 0.8,
            decay_seconds: 2.0,
            lf_decay: 0.0,
            damping: 0.35,
        }
    }

    pub fn profile(&self) -> AlgorithmProfile {
        self.profile
    }

    /// Master RT60, clamped to the algorithm's published maximum.
    pub fn set_decay_seconds(&mut self, seconds: f32) {
        self.decay_seconds = clamp(seconds, 0.1, self.profile.max_decay_seconds);
        self.apply_decay();
    }

    /// The low-frequency decay multiplier, −1…+1.
    pub fn set_lf_decay(&mut self, amount: f32) {
        self.lf_decay = clamp(amount, -1.0, 1.0);
        self.apply_decay();
    }

    fn apply_decay(&mut self) {
        // The tank takes a high-band and a low-band RT60, so the DP/4's two
        // controls map straight onto it: the master decay is the high band and
        // the LF multiplier scales the low one. The TypeScript build had one
        // RT60 and approximated this by biasing the damping instead; here it
        // is the real thing.
        let low = clamp(self.decay_seconds * lf_decay_scale(self.lf_decay), 0.1, 400.0);
        self.tank.set_decay(self.decay_seconds, low);
    }

    pub fn set_predelay_seconds(&mut self, seconds: f32) {
        let limit = self.profile.max_predelay_seconds;
        self.predelay_samples = clamp(seconds, 0.0, limit) * self.sample_rate;
    }

    /// The in-tank lowpass — how fast highs die in the decay.
    pub fn set_hf_damping(&mut self, amount: f32) {
        self.damping = clamp(amount, 0.0, 1.0);
        let hz = damping_hz(self.damping);
        self.output_filter.set_cutoff(hz, self.sample_rate);
    }

    /// The input lowpass — a tone control on what enters the reverb.
    pub fn set_hf_bandwidth(&mut self, amount: f32) {
        self.bandwidth.set_cutoff(bandwidth_hz(amount), self.sample_rate);
    }

    pub fn set_diffusion(&mut self, first: f32, second: f32) {
        self.diffusion1.set_gain(clamp(first, 0.0, 1.0) * 0.78);
        self.diffusion2.set_gain(clamp(second, 0.0, 1.0) * 0.7);
    }

    /// Dattorro's decay diffusion: how smeared the tank's own recirculation is.
    pub fn set_decay_definition(&mut self, amount: f32) {
        self.definition.set_gain(clamp(amount, 0.0, 1.0) * 0.7);
    }

    /// Plates ring on purpose and have no detune; rooms and halls do.
    pub fn set_detune(&mut self, rate: f32, depth: f32) {
        if !self.profile.detune {
            return;
        }
        self.tank.set_mod_rate(0.05 + clamp(rate, 0.0, 1.0) * 2.0);
        self.tank.set_mod_depth_seconds(clamp(depth, 0.0, 1.0) * 0.0012);
    }

    pub fn set_primary_send(&mut self, level: f32) {
        self.primary_send = clamp(level, 0.0, 1.0);
    }

    /// One pre-echo's two destinations. Ignored on a plate, which has none.
    pub fn set_reference(&mut self, index: usize, to_tank: f32, to_output: f32) {
        if !self.profile.pre_echoes || index >= PRE_ECHO_COUNT {
            return;
        }
        self.pre_echoes[index].to_tank = clamp(to_tank, 0.0, 1.0);
        self.pre_echoes[index].to_output = clamp(to_output, 0.0, 1.0);
    }

    /// "Early Ref Level 1–4 … range −99 to +99" — bipolar, so the sign inverts
    /// the tap. Plates only.
    pub fn set_early_ref(&mut self, index: usize, level: f32) {
        if self.profile.pre_echoes || index >= EARLY_REF_COUNT {
            return;
        }
        self.early_refs[index].level = clamp(level, -1.0, 1.0);
    }

    /// Set all four early reflections from one control, which is what the
    /// module's single `early-refs` parameter drives.
    pub fn set_early_refs(&mut self, level: f32) {
        for index in 0..EARLY_REF_COUNT {
            self.set_early_ref(index, level);
        }
    }

    pub fn clear(&mut self) {
        self.bandwidth.clear();
        self.predelay.clear();
        self.diffusion1.clear();
        self.diffusion2.clear();
        self.definition.clear();
        self.tank.clear();
        self.output_filter.clear();
        for echo in &mut self.pre_echoes {
            echo.line.clear();
        }
        for tap in &mut self.early_refs {
            tap.line.clear();
        }
    }

    #[inline]
    pub fn process(&mut self, input: f32) -> f32 {
        let entered = self.bandwidth.process(input);
        self.predelay.push(entered);
        let delayed = self.predelay.read(self.predelay_samples);

        let early_source = self.diffusion1.process(delayed);
        let diffused = self.diffusion2.process(early_source);

        let mut to_tank = diffused * self.primary_send;
        let mut direct = 0.0;

        if self.profile.pre_echoes {
            for echo in &mut self.pre_echoes {
                echo.line.push(diffused);
                let tap = echo.line.read(echo.delay_samples);
                to_tank += tap * echo.to_tank;
                direct += tap * echo.to_output;
            }
        } else {
            // Plates take their early reflections off the *first* diffuser,
            // before the second — closer to the input, as the manual puts it.
            for tap in &mut self.early_refs {
                tap.line.push(early_source);
                to_tank += tap.line.read(tap.delay_samples) * tap.level;
            }
        }

        let shaped = self.definition.process(to_tank);
        let tail = self.output_filter.process(self.tank.process(shaped));
        tail + direct
    }
}

// ---- Non Lin ---------------------------------------------------------------

/// Nine level taps, which is what makes the envelope drawable.
pub const NONLIN_TAPS: usize = 9;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u32)]
pub enum NonLinVariant {
    NonLin1 = 0,
    NonLin2 = 1,
    NonLin3 = 2,
}

impl NonLinVariant {
    pub fn from_u32(value: u32) -> Self {
        match value {
            1 => Self::NonLin2,
            2 => Self::NonLin3,
            _ => Self::NonLin1,
        }
    }

    /// Note that Non Lin 2's reflection times are *shorter* than 1 and 3's
    /// despite its longer overall duration (0–85 ms against 0–600 ms). That is
    /// in the manual and it is not a typo.
    fn profile(self) -> (f32, f32) {
        match self {
            // (duration seconds, spread)
            Self::NonLin1 => (0.5, 1.0),
            Self::NonLin2 => (1.5, 1.0),
            // "sonically similar to Non Lin 1, but there is less stereo
            // movement, making it better suited for drum tracks."
            Self::NonLin3 => (0.5, 0.25),
        }
    }
}

/// A single-pass diffusion line with nine level taps.
///
/// **No feedback anywhere** — the defining property, and why this cannot ring
/// and cannot be made infinite. The envelope is drawn by the nine levels, so
/// one structure gives a gate (early taps up, late down), a reverse swell (the
/// opposite), or a bloom (a hump in the middle).
///
/// "We recommend the average Envelope Level not to exceed a value of 45 to
/// prevent overdriving these three reverbs" — hence the −6 dB trim on the sum,
/// so following that advice lands at a sane level.
pub struct NonLin {
    bandwidth: OnePole,
    diffusion1: DiffuserChain,
    diffusion2: DiffuserChain,
    stages: Vec<DiffuserChain>,
    taps: [f32; NONLIN_TAPS],
    damping: OnePole,
    sample_rate: f32,
}

impl NonLin {
    pub fn new(variant: NonLinVariant, sample_rate: f32) -> Self {
        let rate = if sample_rate > 0.0 { sample_rate } else { 48_000.0 };
        let (duration, spread) = variant.profile();
        let step = duration / NONLIN_TAPS as f32;

        let mut bandwidth = OnePole::new();
        bandwidth.set_cutoff(12_000.0, rate);
        let mut damping = OnePole::new();
        damping.set_cutoff(14_000.0, rate);

        // Each tap sees more diffusion than the one before it, so echo density
        // rises along the line exactly as the manual describes.
        let stages = (0..NONLIN_TAPS)
            .map(|_| {
                DiffuserChain::new(&[step * 0.61 * spread + 0.003, step * 0.37 + 0.002], 0.6, rate)
            })
            .collect();

        let mut taps = [0.3; NONLIN_TAPS];
        taps[0] = 0.5;

        Self {
            bandwidth,
            diffusion1: DiffuserChain::new(&[0.0051, 0.0037], 0.7, rate),
            diffusion2: DiffuserChain::new(&[0.0131, 0.0097], 0.6, rate),
            stages,
            taps,
            damping,
            sample_rate: rate,
        }
    }

    /// One point of the drawn envelope, 0..=8.
    pub fn set_envelope(&mut self, index: usize, level: f32) {
        if index < NONLIN_TAPS {
            self.taps[index] = clamp(level, 0.0, 1.0);
        }
    }

    pub fn set_hf_bandwidth(&mut self, amount: f32) {
        self.bandwidth.set_cutoff(bandwidth_hz(amount), self.sample_rate);
    }

    pub fn set_hf_damping(&mut self, amount: f32) {
        self.damping.set_cutoff(damping_hz(amount), self.sample_rate);
    }

    pub fn set_diffusion(&mut self, first: f32, second: f32) {
        self.diffusion1.set_gain(clamp(first, 0.0, 1.0) * 0.78);
        self.diffusion2.set_gain(clamp(second, 0.0, 1.0) * 0.7);
    }

    /// "the reverb diffusers are called Density, to distinguish them from the
    /// other reverb diffusers (called Definition)" — the per-stage smearing.
    pub fn set_density(&mut self, first: f32, second: f32) {
        let front = clamp(first, 0.0, 1.0) * 0.72;
        let back = clamp(second, 0.0, 1.0) * 0.72;
        let last = self.stages.len().saturating_sub(1).max(1);
        for (index, stage) in self.stages.iter_mut().enumerate() {
            // Interpolated along the line, so Density 1 shapes the early half
            // and Density 2 the late.
            let t = index as f32 / last as f32;
            stage.set_gain(front + (back - front) * t);
        }
    }

    pub fn clear(&mut self) {
        self.bandwidth.clear();
        self.diffusion1.clear();
        self.diffusion2.clear();
        for stage in &mut self.stages {
            stage.clear();
        }
        self.damping.clear();
    }

    #[inline]
    pub fn process(&mut self, input: f32) -> f32 {
        let entered = self.bandwidth.process(input);
        let mut node = self.diffusion2.process(self.diffusion1.process(entered));
        let mut sum = 0.0;
        for (index, stage) in self.stages.iter_mut().enumerate() {
            node = stage.process(node);
            sum += node * self.taps[index];
        }
        // The −6 dB trim named in the doc comment above.
        self.damping.process(sum * 0.5)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const RATE: f32 = 48_000.0;

    fn strike(verb: &mut Dp4Reverb, samples: usize) -> f32 {
        let mut peak = verb.process(1.0).abs();
        for _ in 0..samples {
            peak = peak.max(verb.process(0.0).abs());
        }
        peak
    }

    #[test]
    fn every_algorithm_has_the_published_shape() {
        // The profile table is the manual, so it is pinned rather than trusted.
        assert_eq!(Dp4Algorithm::Hall.profile().max_decay_seconds, 250.0);
        assert_eq!(Dp4Algorithm::SmallPlate.profile().line_count, 6);
        assert_eq!(Dp4Algorithm::LargeRoom.profile().line_count, 8);
        assert!(!Dp4Algorithm::LargePlate.profile().detune);
        assert!(Dp4Algorithm::Hall.profile().detune);
        // Plates have early refs instead of pre-echoes; rooms and halls the
        // other way round. The asymmetry is the manual's, not an oversight.
        assert!(!Dp4Algorithm::SmallPlate.profile().pre_echoes);
        assert!(Dp4Algorithm::SmallRoom.profile().pre_echoes);
    }

    #[test]
    fn an_unknown_algorithm_is_still_a_reverb() {
        assert_eq!(Dp4Algorithm::from_u32(99), Dp4Algorithm::LargePlate);
    }

    #[test]
    fn bandwidth_brightens_and_damping_darkens() {
        // The pair that is easy to get backwards, so it is pinned by direction.
        assert!(bandwidth_hz(1.0) > bandwidth_hz(0.0));
        assert!(damping_hz(1.0) < damping_hz(0.0));
        assert!((bandwidth_hz(0.0) - 200.0).abs() < 1e-3);
        assert!((damping_hz(0.0) - 18_000.0).abs() < 1e-3);
    }

    #[test]
    fn lf_decay_is_bipolar_about_unity() {
        assert!((lf_decay_scale(0.0) - 1.0).abs() < 1e-6);
        assert!(lf_decay_scale(1.0) > 1.0);
        assert!(lf_decay_scale(-1.0) < 1.0);
    }

    #[test]
    fn a_struck_tank_rings_on() {
        let mut verb = Dp4Reverb::new(Dp4Algorithm::LargePlate, RATE);
        verb.set_decay_seconds(3.0);
        assert!(strike(&mut verb, 12_000) > 1e-5);
    }

    #[test]
    fn a_longer_decay_rings_longer() {
        let tail = |seconds: f32| {
            let mut verb = Dp4Reverb::new(Dp4Algorithm::LargePlate, RATE);
            verb.set_decay_seconds(seconds);
            verb.process(1.0);
            for _ in 0..20_000 {
                verb.process(0.0);
            }
            let mut energy = 0.0;
            for _ in 0..4_000 {
                energy += verb.process(0.0).abs();
            }
            energy
        };
        assert!(tail(8.0) > tail(0.5));
    }

    #[test]
    fn the_predelay_holds_the_tail_off() {
        let mut verb = Dp4Reverb::new(Dp4Algorithm::LargePlate, RATE);
        verb.set_decay_seconds(3.0);
        verb.set_predelay_seconds(0.2);
        verb.process(1.0);
        // Nothing should have arrived yet a few milliseconds in.
        let mut early = 0.0f32;
        for _ in 0..(RATE * 0.05) as usize {
            early = early.max(verb.process(0.0).abs());
        }
        assert!(early < 1e-6, "tail arrived before the pre-delay elapsed: {early}");
    }

    #[test]
    fn a_plate_ignores_pre_echo_settings_and_a_room_uses_them() {
        // Setting a control the algorithm does not have must be a no-op rather
        // than a panic — the host sends every parameter to every algorithm.
        let mut plate = Dp4Reverb::new(Dp4Algorithm::LargePlate, RATE);
        plate.set_reference(0, 1.0, 1.0);
        plate.set_reference(9, 1.0, 1.0);
        assert!(strike(&mut plate, 4_000).is_finite());

        let mut room = Dp4Reverb::new(Dp4Algorithm::LargeRoom, RATE);
        room.set_early_ref(0, 1.0);
        room.set_reference(0, 0.8, 0.8);
        assert!(strike(&mut room, 4_000) > 1e-5);
    }

    #[test]
    fn stays_finite_across_the_whole_control_surface() {
        // A tank with feedback is where a bad coefficient does not merely sound
        // wrong — it runs away.
        for algorithm in [
            Dp4Algorithm::SmallPlate,
            Dp4Algorithm::LargePlate,
            Dp4Algorithm::SmallRoom,
            Dp4Algorithm::LargeRoom,
            Dp4Algorithm::Hall,
        ] {
            let mut verb = Dp4Reverb::new(algorithm, RATE);
            for step in 0..=10 {
                let t = step as f32 / 10.0;
                verb.set_decay_seconds(t * 200.0);
                verb.set_lf_decay(t * 2.0 - 1.0);
                verb.set_hf_damping(t);
                verb.set_hf_bandwidth(t);
                verb.set_diffusion(t, 1.0 - t);
                verb.set_decay_definition(t);
                verb.set_detune(t, t);
                verb.set_primary_send(t);
                verb.set_reference(0, t, t);
                verb.set_early_refs(t * 2.0 - 1.0);
                for i in 0..2_000 {
                    let out = verb.process(if i == 0 { 1.0 } else { 0.0 });
                    assert!(out.is_finite(), "{algorithm:?} went non-finite at step {step}");
                    assert!(out.abs() < 50.0, "{algorithm:?} ran away at step {step}: {out}");
                }
            }
        }
    }

    #[test]
    fn reset_clears_the_tail() {
        let mut verb = Dp4Reverb::new(Dp4Algorithm::LargePlate, RATE);
        verb.set_decay_seconds(5.0);
        assert!(strike(&mut verb, 8_000) > 1e-5);
        verb.clear();
        assert!(verb.process(0.0).abs() < 1e-9);
    }

    // ---- Non Lin -----------------------------------------------------------

    #[test]
    fn nonlin_cannot_ring_because_it_has_no_feedback() {
        // The defining property. After the line's own length has passed, a
        // struck Non Lin must be *silent* — not quiet, done.
        let mut verb = NonLin::new(NonLinVariant::NonLin1, RATE);
        verb.process(1.0);
        for _ in 0..(RATE * 4.0) as usize {
            verb.process(0.0);
        }
        let mut peak = 0.0f32;
        for _ in 0..4_000 {
            peak = peak.max(verb.process(0.0).abs());
        }
        assert!(peak < 1e-6, "a feedback-free reverb was still ringing: {peak}");
    }

    #[test]
    fn nonlin_envelope_taps_shape_the_output() {
        let energy = |levels: [f32; NONLIN_TAPS]| {
            let mut verb = NonLin::new(NonLinVariant::NonLin1, RATE);
            for (i, level) in levels.iter().enumerate() {
                verb.set_envelope(i, *level);
            }
            let mut sum = verb.process(1.0).abs();
            for _ in 0..20_000 {
                sum += verb.process(0.0).abs();
            }
            sum
        };
        let silent = energy([0.0; NONLIN_TAPS]);
        let open = energy([1.0; NONLIN_TAPS]);
        assert!(silent < 1e-6, "all taps closed should be silent, got {silent}");
        assert!(open > silent);
    }

    #[test]
    fn nonlin_ignores_a_tap_that_is_not_there() {
        let mut verb = NonLin::new(NonLinVariant::NonLin1, RATE);
        verb.set_envelope(99, 1.0);
        assert!(verb.process(1.0).is_finite());
    }

    #[test]
    fn nonlin_variants_differ_in_length() {
        // Non Lin 2 is the long one — 1.5 s against 0.5 s.
        let tail = |variant: NonLinVariant| {
            let mut verb = NonLin::new(variant, RATE);
            verb.process(1.0);
            for _ in 0..(RATE * 0.7) as usize {
                verb.process(0.0);
            }
            let mut peak = 0.0f32;
            for _ in 0..8_000 {
                peak = peak.max(verb.process(0.0).abs());
            }
            peak
        };
        assert!(tail(NonLinVariant::NonLin2) > tail(NonLinVariant::NonLin1));
    }

    #[test]
    fn nonlin_stays_finite_across_its_controls() {
        for variant in [NonLinVariant::NonLin1, NonLinVariant::NonLin2, NonLinVariant::NonLin3] {
            let mut verb = NonLin::new(variant, RATE);
            for step in 0..=10 {
                let t = step as f32 / 10.0;
                verb.set_hf_bandwidth(t);
                verb.set_hf_damping(t);
                verb.set_diffusion(t, 1.0 - t);
                verb.set_density(t, 1.0 - t);
                for i in 0..NONLIN_TAPS {
                    verb.set_envelope(i, t);
                }
                for i in 0..2_000 {
                    let out = verb.process(if i == 0 { 1.0 } else { 0.0 });
                    assert!(out.is_finite() && out.abs() < 50.0, "{variant:?} misbehaved");
                }
            }
        }
    }

    #[test]
    fn nonlin_reset_clears_it() {
        let mut verb = NonLin::new(NonLinVariant::NonLin1, RATE);
        verb.process(1.0);
        verb.clear();
        assert!(verb.process(0.0).abs() < 1e-9);
    }
}
