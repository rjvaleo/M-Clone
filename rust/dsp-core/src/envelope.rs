//! ADSR, per sample.
//!
//! `ModularAudio_FuncSpec_v11` §9.4 and §9.5: an amplitude envelope and a
//! separate filter envelope, each feeding the modulation matrix as a source in
//! its own right (§9.7 lists `AmpEnv` and `FilterEnv`).
//!
//! # Progress, not a leaky filter
//!
//! The usual analogue-style ADSR runs a one-pole toward an overshot target, so
//! a stage "finishes" when it gets close enough. That is cheap and it never
//! arrives exactly: a release decays toward zero without reaching it, so a
//! voice either lingers below the hearing threshold holding a slot or is cut
//! at some arbitrary floor.
//!
//! This one tracks progress through each stage and shapes it, so a stage of
//! *t* seconds takes exactly *t* seconds and ends exactly on its target. That
//! matters more here than the last few percent of analogue character: a voice
//! that reaches silence exactly is a voice the bank can free without a policy.

use crate::clamp;

/// Shortest usable stage. Zero would be a click and a divide-by-zero; this is
/// under a millisecond, which reads as instant.
pub const MIN_STAGE_SEC: f32 = 0.0005;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Stage {
    Idle,
    Attack,
    Decay,
    Sustain,
    Release,
}

/// Ease-out, hitting its endpoints exactly.
///
/// Cubic rather than a true exponential because `exp` never arrives: the point
/// of this envelope is that stages end where they say they do.
#[inline]
fn eased(progress: f32) -> f32 {
    let remaining = 1.0 - progress;
    1.0 - remaining * remaining * remaining
}

#[derive(Clone)]
pub struct Adsr {
    sample_rate: f32,
    attack: f32,
    decay: f32,
    sustain: f32,
    release: f32,
    stage: Stage,
    /// Progress through the current stage, `[0, 1]`.
    progress: f32,
    /// Current output.
    value: f32,
    /// Where the current stage started, so a release from mid-decay is smooth.
    stage_start: f32,
}

impl Adsr {
    pub fn new(sample_rate: f32) -> Self {
        Self {
            sample_rate: if sample_rate > 0.0 { sample_rate } else { 48_000.0 },
            attack: 0.01,
            decay: 0.1,
            sustain: 0.7,
            release: 0.2,
            stage: Stage::Idle,
            progress: 0.0,
            value: 0.0,
            stage_start: 0.0,
        }
    }

    pub fn set_sample_rate(&mut self, sample_rate: f32) {
        if sample_rate > 0.0 {
            self.sample_rate = sample_rate;
        }
    }

    pub fn set_attack(&mut self, seconds: f32) {
        self.attack = seconds.max(MIN_STAGE_SEC);
    }
    pub fn set_decay(&mut self, seconds: f32) {
        self.decay = seconds.max(MIN_STAGE_SEC);
    }
    pub fn set_sustain(&mut self, level: f32) {
        self.sustain = clamp(level, 0.0, 1.0);
    }
    pub fn set_release(&mut self, seconds: f32) {
        self.release = seconds.max(MIN_STAGE_SEC);
    }

    pub fn stage(&self) -> Stage {
        self.stage
    }

    pub fn value(&self) -> f32 {
        self.value
    }

    /// Still producing sound, or about to.
    ///
    /// What a voice bank asks before reusing a slot. False only once a release
    /// has genuinely finished — which it can be, because it lands on zero.
    pub fn is_active(&self) -> bool {
        self.stage != Stage::Idle
    }

    /// Note on.
    ///
    /// Starts from wherever the envelope currently is rather than from zero, so
    /// retriggering a sounding voice does not click.
    pub fn gate_on(&mut self) {
        self.stage = Stage::Attack;
        self.progress = 0.0;
        self.stage_start = self.value;
    }

    /// Note off. Releases from wherever it is, including mid-attack.
    pub fn gate_off(&mut self) {
        if self.stage == Stage::Idle {
            return;
        }
        self.stage = Stage::Release;
        self.progress = 0.0;
        self.stage_start = self.value;
    }

    /// Silence immediately, with no release. For voice stealing, where the
    /// slot is needed now.
    pub fn kill(&mut self) {
        self.stage = Stage::Idle;
        self.progress = 0.0;
        self.value = 0.0;
        self.stage_start = 0.0;
    }

    #[inline]
    fn step(&self, seconds: f32) -> f32 {
        1.0 / (seconds * self.sample_rate).max(1.0)
    }

    /// Advance one sample and return the new level.
    #[allow(clippy::should_implement_trait)]
    #[inline]
    pub fn next(&mut self) -> f32 {
        match self.stage {
            Stage::Idle => self.value = 0.0,
            Stage::Attack => {
                self.progress += self.step(self.attack);
                if self.progress >= 1.0 {
                    self.value = 1.0;
                    self.stage = Stage::Decay;
                    self.progress = 0.0;
                    self.stage_start = 1.0;
                } else {
                    // Linear attack: the one stage where a curve is felt as
                    // sluggishness rather than as character.
                    self.value = self.stage_start + (1.0 - self.stage_start) * self.progress;
                }
            }
            Stage::Decay => {
                self.progress += self.step(self.decay);
                if self.progress >= 1.0 {
                    self.value = self.sustain;
                    self.stage = Stage::Sustain;
                    self.progress = 0.0;
                } else {
                    self.value =
                        self.stage_start + (self.sustain - self.stage_start) * eased(self.progress);
                }
            }
            Stage::Sustain => self.value = self.sustain,
            Stage::Release => {
                self.progress += self.step(self.release);
                if self.progress >= 1.0 {
                    // Exactly zero, exactly on time — which is what lets the
                    // voice bank free this slot without a threshold.
                    self.value = 0.0;
                    self.stage = Stage::Idle;
                    self.progress = 0.0;
                    self.stage_start = 0.0;
                } else {
                    self.value = self.stage_start * (1.0 - eased(self.progress));
                }
            }
        }
        self.value
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const RATE: f32 = 48_000.0;

    fn adsr(a: f32, d: f32, s: f32, r: f32) -> Adsr {
        let mut env = Adsr::new(RATE);
        env.set_attack(a);
        env.set_decay(d);
        env.set_sustain(s);
        env.set_release(r);
        env
    }

    fn run(env: &mut Adsr, seconds: f32) -> Vec<f32> {
        (0..(seconds * RATE) as usize).map(|_| env.next()).collect()
    }

    #[test]
    fn idle_until_a_note_arrives() {
        let mut env = adsr(0.01, 0.1, 0.7, 0.2);
        assert!(!env.is_active());
        for _ in 0..1000 {
            assert_eq!(env.next(), 0.0);
        }
    }

    #[test]
    fn attack_reaches_exactly_one_in_the_time_given() {
        let mut env = adsr(0.05, 0.1, 0.7, 0.2);
        env.gate_on();
        let values = run(&mut env, 0.05);
        assert!((values[values.len() - 1] - 1.0).abs() < 0.01, "peaked at {}", values[values.len() - 1]);
        // Monotonic on the way up — an attack that dips is a click.
        for pair in values.windows(2) {
            assert!(pair[1] >= pair[0] - 1e-6);
        }
    }

    #[test]
    fn decay_settles_on_the_sustain_level() {
        let mut env = adsr(0.001, 0.05, 0.4, 0.2);
        env.gate_on();
        run(&mut env, 0.2);
        assert_eq!(env.stage(), Stage::Sustain);
        assert!((env.value() - 0.4).abs() < 1e-6);
    }

    #[test]
    fn sustain_holds_for_as_long_as_the_note_does() {
        let mut env = adsr(0.001, 0.01, 0.6, 0.2);
        env.gate_on();
        run(&mut env, 0.1);
        // Ten seconds of holding, unchanged.
        for _ in 0..(RATE as usize * 10) {
            assert!((env.next() - 0.6).abs() < 1e-6);
        }
    }

    #[test]
    fn release_reaches_exactly_zero_and_goes_idle() {
        // The property the whole design is for: a voice bank can free this slot
        // without guessing at a silence threshold.
        let mut env = adsr(0.001, 0.01, 0.8, 0.05);
        env.gate_on();
        run(&mut env, 0.05);
        env.gate_off();
        run(&mut env, 0.05);
        assert_eq!(env.value(), 0.0);
        assert_eq!(env.stage(), Stage::Idle);
        assert!(!env.is_active());
    }

    #[test]
    fn a_stage_takes_the_time_it_says() {
        let mut env = adsr(0.1, 0.001, 1.0, 0.001);
        env.gate_on();
        // Half way through a 100 ms attack, roughly half way up.
        let half = run(&mut env, 0.05);
        let value = half[half.len() - 1];
        assert!((value - 0.5).abs() < 0.02, "half way through attack was {value}");
    }

    #[test]
    fn releasing_mid_attack_starts_from_where_it_got_to() {
        // Otherwise a short note jumps to full level before releasing, which is
        // a click on every staccato note.
        let mut env = adsr(0.5, 0.1, 0.8, 0.1);
        env.gate_on();
        run(&mut env, 0.05);
        let caught = env.value();
        assert!(caught > 0.0 && caught < 0.5, "expected mid-attack, got {caught}");
        env.gate_off();
        let first = env.next();
        assert!(first <= caught, "jumped from {caught} to {first}");
    }

    #[test]
    fn retriggering_a_sounding_voice_does_not_jump_to_zero() {
        let mut env = adsr(0.05, 0.1, 0.7, 0.2);
        env.gate_on();
        run(&mut env, 0.2);
        let held = env.value();
        env.gate_on();
        let first = env.next();
        assert!((first - held).abs() < 0.05, "retrigger jumped from {held} to {first}");
    }

    #[test]
    fn gate_off_before_any_note_does_nothing() {
        let mut env = adsr(0.01, 0.1, 0.7, 0.2);
        env.gate_off();
        assert_eq!(env.stage(), Stage::Idle);
        assert_eq!(env.next(), 0.0);
    }

    #[test]
    fn kill_silences_immediately_for_voice_stealing() {
        let mut env = adsr(0.001, 0.01, 0.9, 5.0);
        env.gate_on();
        run(&mut env, 0.05);
        assert!(env.value() > 0.5);
        env.kill();
        assert_eq!(env.value(), 0.0);
        assert!(!env.is_active());
    }

    #[test]
    fn a_zero_sustain_makes_a_percussive_envelope() {
        let mut env = adsr(0.001, 0.05, 0.0, 0.1);
        env.gate_on();
        run(&mut env, 0.2);
        assert_eq!(env.stage(), Stage::Sustain);
        assert_eq!(env.value(), 0.0);
    }

    #[test]
    fn stage_times_clamp_rather_than_dividing_by_zero() {
        let mut env = adsr(0.0, 0.0, 0.5, 0.0);
        env.gate_on();
        for _ in 0..1000 {
            assert!(env.next().is_finite());
        }
        env.gate_off();
        for _ in 0..1000 {
            assert!(env.next().is_finite());
        }
        // Negative times are nonsense from a hand-edited document, not a crash.
        let mut env = adsr(-1.0, -1.0, -1.0, -1.0);
        env.gate_on();
        for _ in 0..1000 {
            let value = env.next();
            assert!(value.is_finite() && (0.0..=1.0).contains(&value));
        }
    }

    #[test]
    fn the_output_never_leaves_zero_to_one() {
        // It is a modulation source as well as a gain, and §9.7's summing rule
        // assumes every source is in range.
        let mut env = adsr(0.02, 0.03, 0.5, 0.04);
        env.gate_on();
        for value in run(&mut env, 0.1) {
            assert!((0.0..=1.0).contains(&value), "{value} out of range");
        }
        env.gate_off();
        for value in run(&mut env, 0.1) {
            assert!((0.0..=1.0).contains(&value), "{value} out of range");
        }
    }

    #[test]
    fn a_patch_sounds_the_same_at_any_sample_rate() {
        // Rule three. The envelope is in seconds, so both rates must trace the
        // same shape.
        let mut slow = Adsr::new(44_100.0);
        let mut fast = Adsr::new(96_000.0);
        for env in [&mut slow, &mut fast] {
            env.set_attack(0.1);
            env.set_decay(0.1);
            env.set_sustain(0.5);
            env.set_release(0.1);
            env.gate_on();
        }
        for _ in 0..4_410 {
            slow.next();
        }
        for _ in 0..9_600 {
            fast.next();
        }
        assert!((slow.value() - fast.value()).abs() < 0.01);
    }
}
