//! The rack's production modules.
//!
//! `engine.rs` defines what a module *is*; until now the only implementations
//! were test doubles, so the engine had nothing to run. These are the first
//! real ones, and they exist to prove the seam from a browser document all the
//! way to a sample rather than to be a complete rack — the remaining twelve
//! port onto the same trait once the path is known to work.
//!
//! # Why every parameter is smoothed here
//!
//! The TypeScript layer's hardest-won rule is that no parameter is ever
//! assigned directly: `params.ts` makes `rampParam` the only writer and a
//! source-scanning test fails the build on any `.value =` in the folder. That
//! rule exists because Web Audio gave each parameter a settable field, and the
//! discipline had to be imposed from outside.
//!
//! Here it is structural instead. `Ports::param` hands a module the raw value
//! the host last wrote, and a module that used it directly would zipper. Each
//! one owns a `Smoothed` per movable parameter and follows the raw value toward
//! it, so the ramp is a property of the module rather than of everyone who
//! remembers to call the right setter.

use crate::bank::{VoiceBank, DEFAULT_POLYPHONY, MAX_POLYPHONY};
use crate::engine::{Module, Ports, ProcessContext};
use crate::lfo::{LfoShape, LfoTrigger};
use crate::modmatrix::{ModDest, ModSource};
use crate::osc::Wave;
use crate::delay::DelayLine;
use crate::dp4::{Dp4Algorithm, Dp4Reverb, NonLin, NonLinVariant, NONLIN_TAPS};
use crate::dynamics::{DynamicsMode, EnvelopeFollower, GainComputer};
use crate::fdn::{Fdn, MixMatrix};
use crate::filter::{Biquad, BiquadKind, OnePole};
use crate::grain::{GrainCloud, GrainSettings};
use crate::sampler::{semitone_ratio, Sampler, SamplerSettings, NO_SAMPLE};
use crate::reverb::Blackhole;
use crate::voice::{
    AdsrSettings, LfoSettings, VoiceSettings, MAX_CUTOFF_HZ, MIN_CUTOFF_HZ, OSC_COUNT,
};
use crate::{clamp, Smoothed};

/// How long a parameter takes to reach a new value.
///
/// Five milliseconds is under the ~10 ms where a level change starts to be
/// heard as an event rather than a move, and long enough that a full-scale jump
/// is inaudible as a click.
pub const PARAM_RAMP_SEC: f32 = 0.005;

fn ramp_steps(sample_rate: f32) -> u32 {
    (sample_rate * PARAM_RAMP_SEC).max(1.0) as u32
}

/// Follows a raw parameter, ramping instead of jumping.
///
/// Retargeting only when the value actually changes matters: `set_target`
/// recomputes the step from the *current* position, so calling it every sample
/// with an unchanged target would restart the ramp every sample and the value
/// would crawl toward it asymptotically instead of arriving.
struct Tracked {
    smoothed: Smoothed,
    last_raw: f32,
    steps: u32,
}

impl Tracked {
    fn new(initial: f32) -> Self {
        Self { smoothed: Smoothed::new(initial), last_raw: initial, steps: 1 }
    }

    fn set_sample_rate(&mut self, sample_rate: f32) {
        self.steps = ramp_steps(sample_rate);
    }

    #[inline(always)]
    fn follow(&mut self, raw: f32) -> f32 {
        if raw != self.last_raw {
            self.last_raw = raw;
            self.smoothed.set_target(raw, self.steps);
        }
        self.smoothed.next()
    }

    /// Drop the in-flight ramp and sit exactly where the host last asked.
    ///
    /// Not a return to the construction default: `reset` is a transport sync,
    /// and a parameter the performer has moved must survive one.
    fn reset(&mut self) {
        self.smoothed.reset(self.last_raw);
    }
}

/// Where the host's audio enters the rack.
///
/// Zero inputs and one output: the worklet writes the current sample into
/// parameter 0 before each `Engine::process`, so the graph sees live audio
/// through the same mechanism as everything else. Deliberately *not* smoothed —
/// this parameter is a signal, not a control.
#[derive(Default)]
pub struct HostInput;

impl Module for HostInput {
    fn process(&mut self, _ctx: &ProcessContext, ports: &mut Ports) {
        let sample = ports.param(Self::SAMPLE);
        ports.output(0, if sample.is_finite() { sample } else { 0.0 });
    }
    fn input_count(&self) -> usize {
        0
    }
    fn output_count(&self) -> usize {
        1
    }
    fn param_count(&self) -> usize {
        1
    }
}

impl HostInput {
    pub const SAMPLE: usize = 0;
}

/// `m.audio-gain` — one knob, one mute.
///
/// `LEVEL` is the shell's fade handle rather than a user control. The
/// TypeScript adapter fades a module in and out through the output gain that
/// every effect exposes, and keeping that here means a crossfade during a
/// rebuild works identically once the rest of the rack lands.
pub struct Gain {
    gain: Tracked,
    level: Tracked,
}

impl Gain {
    pub const GAIN: usize = 0;
    pub const LEVEL: usize = 1;
    pub const MUTE: usize = 2;

    /// Matches the registry descriptor: `numberParam("gain", …, 1, 0, 2, 0.01)`.
    pub const MAX_GAIN: f32 = 2.0;
    pub const DEFAULT_GAIN: f32 = 1.0;
}

impl Default for Gain {
    fn default() -> Self {
        Self { gain: Tracked::new(Self::DEFAULT_GAIN), level: Tracked::new(0.0) }
    }
}

impl Module for Gain {
    fn process(&mut self, _ctx: &ProcessContext, ports: &mut Ports) {
        let gain = self.gain.follow(clamp(ports.param(Self::GAIN), 0.0, Self::MAX_GAIN));
        let level = self.level.follow(clamp(ports.param(Self::LEVEL), 0.0, 1.0));
        // Mute is a hard gate rather than a ramp target: it multiplies the
        // smoothed result, so the level ramp underneath it is undisturbed and
        // unmuting returns to exactly where it was.
        let muted = ports.param(Self::MUTE) >= 0.5;
        let input = ports.input(0);
        ports.output(0, if muted { 0.0 } else { input * gain * level });
    }

    fn set_sample_rate(&mut self, sample_rate: f32) {
        self.gain.set_sample_rate(sample_rate);
        self.level.set_sample_rate(sample_rate);
    }

    fn reset(&mut self) {
        self.gain.reset();
        self.level.reset();
    }

    fn input_count(&self) -> usize {
        1
    }
    fn output_count(&self) -> usize {
        1
    }
    fn param_count(&self) -> usize {
        3
    }

    fn param_default(&self, index: usize) -> f32 {
        // Level is the exception: every module is built silent so the adapter
        // can fade it in, which is what keeps a rebuild from popping.
        if index == Self::GAIN {
            Self::DEFAULT_GAIN
        } else {
            0.0
        }
    }
}

/// `m.audio-output` — what the host reads.
///
/// A passthrough with a level, so the master fade lives in the graph rather
/// than in the shim around it.
pub struct AudioOutput {
    level: Tracked,
}

impl AudioOutput {
    pub const LEVEL: usize = 0;
}

impl Default for AudioOutput {
    fn default() -> Self {
        Self { level: Tracked::new(1.0) }
    }
}

impl Module for AudioOutput {
    fn process(&mut self, _ctx: &ProcessContext, ports: &mut Ports) {
        let level = self.level.follow(clamp(ports.param(Self::LEVEL), 0.0, 1.0));
        ports.output(0, ports.input(0) * level);
    }

    fn set_sample_rate(&mut self, sample_rate: f32) {
        self.level.set_sample_rate(sample_rate);
    }

    fn reset(&mut self) {
        self.level.reset();
    }

    fn input_count(&self) -> usize {
        1
    }
    fn output_count(&self) -> usize {
        1
    }
    fn param_count(&self) -> usize {
        1
    }

    fn param_default(&self, _index: usize) -> f32 {
        // Unlike an effect, the master is not faded in by an adapter — if it
        // arrived silent the rack would have no way to ever be heard.
        1.0
    }
}

/// `m.synth` — the three-oscillator polysynth.
///
/// Two audio outputs rather than one: this is the first stereo source in the
/// rack, and folding it to mono here would throw away the pan that §9.7 lists
/// as a modulation destination.
///
/// Parameters are flat indices rather than a struct because that is what the
/// ABI carries. The matrix is *not* among them — see `Module::set_modulation`.
pub struct Synth {
    bank: VoiceBank,
    level: Tracked,
    /// Rebuilt from the flat parameters once per sample. Cheap, and it keeps
    /// the mapping in one readable place instead of scattered across setters.
    settings: VoiceSettings,
}

impl Synth {
    pub const LEVEL: usize = 0;
    /// Per oscillator: wave, semitones, cents, level, width — five each.
    pub const OSC_BASE: usize = 1;
    pub const OSC_STRIDE: usize = 5;
    pub const OSC_WAVE: usize = 0;
    pub const OSC_SEMIS: usize = 1;
    pub const OSC_CENTS: usize = 2;
    pub const OSC_LEVEL: usize = 3;
    pub const OSC_WIDTH: usize = 4;

    pub const CUTOFF: usize = 16;
    pub const RESONANCE: usize = 17;
    pub const FILTER_ENV_OCTAVES: usize = 18;
    pub const KEY_FOLLOW: usize = 19;

    pub const AMP_ATTACK: usize = 20;
    pub const AMP_DECAY: usize = 21;
    pub const AMP_SUSTAIN: usize = 22;
    pub const AMP_RELEASE: usize = 23;

    pub const FILTER_ATTACK: usize = 24;
    pub const FILTER_DECAY: usize = 25;
    pub const FILTER_SUSTAIN: usize = 26;
    pub const FILTER_RELEASE: usize = 27;

    /// Per LFO: shape, trigger, rate, depth, phase — five each.
    pub const LFO_BASE: usize = 28;
    pub const LFO_STRIDE: usize = 5;
    pub const LFO_SHAPE: usize = 0;
    pub const LFO_TRIGGER: usize = 1;
    pub const LFO_RATE: usize = 2;
    pub const LFO_DEPTH: usize = 3;
    pub const LFO_PHASE: usize = 4;

    pub const PAN: usize = 38;
    pub const VOLUME: usize = 39;
    pub const MOD_WHEEL: usize = 40;
    /// Polyphony. A knob rather than a construction argument because the bank
    /// allocates its whole pool up front and only limits how much of it
    /// `claim` may use — see `set_capacity` in `bank.rs`.
    pub const MAX_VOICES: usize = 41;

    pub const PARAM_COUNT: usize = 42;

    pub fn new(sample_rate: f32) -> Self {
        Self {
            // Allocated at the maximum and limited by the parameter, so that
            // turning polyphony up mid-performance never allocates.
            bank: VoiceBank::new(sample_rate, MAX_POLYPHONY, 0x1D_1AB),
            level: Tracked::new(0.0),
            settings: VoiceSettings::default(),
        }
    }

    pub fn active_voices(&self) -> usize {
        self.bank.active_count()
    }

    /// Read the flat parameter array into the shape a voice wants.
    fn read(&mut self, ports: &Ports) {
        for index in 0..OSC_COUNT {
            let base = Self::OSC_BASE + index * Self::OSC_STRIDE;
            self.settings.waves[index] =
                Wave::from_u32(ports.param(base + Self::OSC_WAVE) as u32).unwrap_or(Wave::Sawtooth);
            self.settings.detune_semis[index] = clamp(ports.param(base + Self::OSC_SEMIS), -48.0, 48.0);
            self.settings.detune_cents[index] = clamp(ports.param(base + Self::OSC_CENTS), -100.0, 100.0);
            self.settings.levels[index] = clamp(ports.param(base + Self::OSC_LEVEL), 0.0, 1.0);
            self.settings.pulse_width[index] = ports.param(base + Self::OSC_WIDTH);
        }

        self.settings.cutoff_hz = clamp(ports.param(Self::CUTOFF), MIN_CUTOFF_HZ, MAX_CUTOFF_HZ);
        self.settings.resonance = clamp(ports.param(Self::RESONANCE), 0.0, 1.0);
        self.settings.filter_env_octaves = clamp(ports.param(Self::FILTER_ENV_OCTAVES), -8.0, 8.0);
        self.settings.key_follow = clamp(ports.param(Self::KEY_FOLLOW), 0.0, 1.0);

        self.settings.amp = AdsrSettings {
            attack: ports.param(Self::AMP_ATTACK),
            decay: ports.param(Self::AMP_DECAY),
            sustain: clamp(ports.param(Self::AMP_SUSTAIN), 0.0, 1.0),
            release: ports.param(Self::AMP_RELEASE),
        };
        self.settings.filter_env = AdsrSettings {
            attack: ports.param(Self::FILTER_ATTACK),
            decay: ports.param(Self::FILTER_DECAY),
            sustain: clamp(ports.param(Self::FILTER_SUSTAIN), 0.0, 1.0),
            release: ports.param(Self::FILTER_RELEASE),
        };

        for index in 0..2 {
            let base = Self::LFO_BASE + index * Self::LFO_STRIDE;
            self.settings.lfo[index] = LfoSettings {
                shape: LfoShape::from_u32(ports.param(base + Self::LFO_SHAPE) as u32)
                    .unwrap_or(LfoShape::Sine),
                trigger: LfoTrigger::from_u32(ports.param(base + Self::LFO_TRIGGER) as u32)
                    .unwrap_or(LfoTrigger::Free),
                rate_hz: ports.param(base + Self::LFO_RATE),
                depth: clamp(ports.param(base + Self::LFO_DEPTH), 0.0, 1.0),
                phase_degrees: ports.param(base + Self::LFO_PHASE),
            };
        }

        self.settings.pan = clamp(ports.param(Self::PAN), -1.0, 1.0);
        self.settings.volume = clamp(ports.param(Self::VOLUME), 0.0, 1.0);
    }
}

impl Module for Synth {
    fn process(&mut self, _ctx: &ProcessContext, ports: &mut Ports) {
        self.read(ports);
        // The matrix lives on the bank rather than in the parameter array, so
        // it survives being overwritten here every sample.
        let matrix = self.bank.settings().matrix.clone();
        self.settings.matrix = matrix;
        self.bank.set_settings(self.settings.clone());
        self.bank.set_mod_wheel(ports.param(Self::MOD_WHEEL));
        // Clamped and rounded here rather than trusted: the value arrives as
        // an f32 over the ABI and a NaN would otherwise reach a `usize` cast.
        let voices = ports.param(Self::MAX_VOICES);
        self.bank
            .set_capacity(if voices.is_finite() { voices.round().max(0.0) as usize } else { DEFAULT_POLYPHONY });

        let level = self.level.follow(clamp(ports.param(Self::LEVEL), 0.0, 1.0));
        let sample = self.bank.next();
        ports.output(0, sample.left * level);
        ports.output(1, sample.right * level);
    }

    fn set_sample_rate(&mut self, sample_rate: f32) {
        self.level.set_sample_rate(sample_rate);
        self.bank.set_sample_rate(sample_rate);
    }

    fn reset(&mut self) {
        self.level.reset();
        self.bank.panic();
    }

    fn note_on(&mut self, note: u8, velocity: f32, detune_cents: f32) {
        self.bank.note_on(note, velocity, detune_cents);
    }

    fn note_off(&mut self, note: u8) {
        self.bank.note_off(note);
    }

    fn all_notes_off(&mut self) {
        self.bank.all_notes_off();
    }

    fn set_modulation(&mut self, source: u32, dest: u32, amount: f32) {
        // An unknown source or destination is dropped rather than throwing:
        // it means the document is newer than this build of the engine.
        let (Some(source), Some(dest)) = (ModSource::from_u32(source), ModDest::from_u32(dest))
        else {
            return;
        };
        self.bank.settings_mut().matrix.set(source, dest, amount);
    }

    fn input_count(&self) -> usize {
        0
    }
    fn output_count(&self) -> usize {
        2
    }
    fn param_count(&self) -> usize {
        Self::PARAM_COUNT
    }

    fn param_default(&self, index: usize) -> f32 {
        let defaults = VoiceSettings::default();
        for osc in 0..OSC_COUNT {
            let base = Self::OSC_BASE + osc * Self::OSC_STRIDE;
            match index.checked_sub(base) {
                Some(Self::OSC_WAVE) => return defaults.waves[osc] as u32 as f32,
                Some(Self::OSC_SEMIS) => return defaults.detune_semis[osc],
                Some(Self::OSC_CENTS) => return defaults.detune_cents[osc],
                Some(Self::OSC_LEVEL) => return defaults.levels[osc],
                Some(Self::OSC_WIDTH) => return defaults.pulse_width[osc],
                _ => {}
            }
        }
        for lfo in 0..2 {
            let base = Self::LFO_BASE + lfo * Self::LFO_STRIDE;
            match index.checked_sub(base) {
                Some(Self::LFO_SHAPE) => return defaults.lfo[lfo].shape as u32 as f32,
                Some(Self::LFO_TRIGGER) => return defaults.lfo[lfo].trigger as u32 as f32,
                Some(Self::LFO_RATE) => return defaults.lfo[lfo].rate_hz,
                Some(Self::LFO_DEPTH) => return defaults.lfo[lfo].depth,
                Some(Self::LFO_PHASE) => return defaults.lfo[lfo].phase_degrees,
                _ => {}
            }
        }
        match index {
            // Built silent, like every other module — the adapter fades it in.
            Self::LEVEL => 0.0,
            Self::MAX_VOICES => DEFAULT_POLYPHONY as f32,
            Self::CUTOFF => defaults.cutoff_hz,
            Self::RESONANCE => defaults.resonance,
            Self::FILTER_ENV_OCTAVES => defaults.filter_env_octaves,
            Self::KEY_FOLLOW => defaults.key_follow,
            Self::AMP_ATTACK => defaults.amp.attack,
            Self::AMP_DECAY => defaults.amp.decay,
            Self::AMP_SUSTAIN => defaults.amp.sustain,
            Self::AMP_RELEASE => defaults.amp.release,
            Self::FILTER_ATTACK => defaults.filter_env.attack,
            Self::FILTER_DECAY => defaults.filter_env.decay,
            Self::FILTER_SUSTAIN => defaults.filter_env.sustain,
            Self::FILTER_RELEASE => defaults.filter_env.release,
            Self::PAN => defaults.pan,
            Self::VOLUME => defaults.volume,
            _ => 0.0,
        }
    }
}

/// `m.audio-blackhole` — the H90's reverb as a rack module.
///
/// The DSP is `reverb::Blackhole`; this is only the shell that gives it
/// parameter indices, a wet/dry mix and the fade handle every effect needs.
///
/// **This build does something the browser one could not.** The TypeScript
/// Blackhole approximates Gravity's negative half — the manual's "inverse
/// mode" — by dropping diffusion and stretching the pre-tank delay, because a
/// graph of native Web Audio nodes has no envelope follower and therefore no
/// way to detect an onset. `reverb::Blackhole` has one, so the left half of
/// Gravity is a real reverse envelope here rather than a swell that resembles
/// one. That is the first place the two backends genuinely differ in what they
/// can produce, rather than only in how they produce it.
///
/// # Why the setters are driven on change
///
/// `set_gravity` recomputes the tank's per-line decay gains and `set_shelves`
/// rebuilds two biquads. Those are cheap once and ruinous at forty-eight
/// thousand times a second, so each is called only when its parameter actually
/// moves. The wet/dry mix and the fade level are different — they move every
/// sample by design, so they are smoothed rather than gated.
pub struct BlackholeVerb {
    verb: Blackhole,
    mix: Tracked,
    level: Tracked,
    /// Last raw value seen for each setter-driven parameter, in the order of
    /// the `SETTER_*` indices below.
    seen: [f32; Self::SETTER_COUNT],
}

impl BlackholeVerb {
    pub const GRAVITY: usize = 0;
    pub const SIZE: usize = 1;
    pub const PREDELAY: usize = 2;
    pub const LOW_DB: usize = 3;
    pub const HIGH_DB: usize = 4;
    pub const MOD_DEPTH: usize = 5;
    pub const MOD_RATE: usize = 6;
    pub const FEEDBACK: usize = 7;
    pub const RESONANCE: usize = 8;
    pub const MIX: usize = 9;
    pub const LEVEL: usize = 10;
    pub const MUTE: usize = 11;
    pub const PARAM_COUNT: usize = 12;

    /// The parameters that reach the DSP through a setter rather than by being
    /// read every sample. Indices 0..=8, so the cache is indexed by the
    /// parameter index itself.
    const SETTER_COUNT: usize = 9;

    pub fn new(sample_rate: f32) -> Self {
        let mut verb = Blackhole::new(sample_rate);
        // The registry's defaults, so a freshly added node sounds the way its
        // face says it does before anything is written to it.
        verb.set_gravity(0.5);
        verb.set_size(0.5);
        verb.set_predelay_seconds(0.0);
        verb.set_shelves(0.0, 0.0, 0.0);
        verb.set_modulation(0.3, 0.3);
        verb.set_feedback(0.0);
        Self {
            verb,
            mix: Tracked::new(0.35),
            level: Tracked::new(0.0),
            // NaN forces the first sync: no real parameter value equals it, so
            // every setter runs once on the first block rather than the cache
            // starting out agreeing with a DSP it has never spoken to.
            seen: [f32::NAN; Self::SETTER_COUNT],
        }
    }

    /// Push any moved parameter into the DSP.
    fn sync(&mut self, raw: &[f32; Self::SETTER_COUNT]) {
        if raw[Self::GRAVITY] != self.seen[Self::GRAVITY] {
            self.verb.set_gravity(raw[Self::GRAVITY]);
        }
        if raw[Self::SIZE] != self.seen[Self::SIZE] {
            self.verb.set_size(raw[Self::SIZE]);
        }
        if raw[Self::PREDELAY] != self.seen[Self::PREDELAY] {
            self.verb.set_predelay_seconds(raw[Self::PREDELAY]);
        }
        // One call takes all three, so any of them moving reapplies the set.
        if raw[Self::LOW_DB] != self.seen[Self::LOW_DB]
            || raw[Self::HIGH_DB] != self.seen[Self::HIGH_DB]
            || raw[Self::RESONANCE] != self.seen[Self::RESONANCE]
        {
            self.verb.set_shelves(raw[Self::LOW_DB], raw[Self::HIGH_DB], raw[Self::RESONANCE]);
        }
        if raw[Self::MOD_DEPTH] != self.seen[Self::MOD_DEPTH]
            || raw[Self::MOD_RATE] != self.seen[Self::MOD_RATE]
        {
            self.verb.set_modulation(raw[Self::MOD_DEPTH], raw[Self::MOD_RATE]);
        }
        // Feedback last: it decides the tank's infinite state and re-derives
        // the outer loop from the decay the gravity above may have just set.
        if raw[Self::FEEDBACK] != self.seen[Self::FEEDBACK] {
            self.verb.set_feedback(raw[Self::FEEDBACK]);
        }
        self.seen = *raw;
    }
}

impl Module for BlackholeVerb {
    fn process(&mut self, _ctx: &ProcessContext, ports: &mut Ports) {
        let raw = [
            ports.param(Self::GRAVITY),
            ports.param(Self::SIZE),
            ports.param(Self::PREDELAY),
            ports.param(Self::LOW_DB),
            ports.param(Self::HIGH_DB),
            ports.param(Self::MOD_DEPTH),
            ports.param(Self::MOD_RATE),
            ports.param(Self::FEEDBACK),
            ports.param(Self::RESONANCE),
        ];
        self.sync(&raw);

        let input = ports.input(0);
        let wet = self.verb.process(input);
        let mix = self.mix.follow(clamp(ports.param(Self::MIX), 0.0, 1.0));
        let level = self.level.follow(clamp(ports.param(Self::LEVEL), 0.0, 1.0));
        let muted = ports.param(Self::MUTE) >= 0.5;
        let mixed = input * (1.0 - mix) + wet * mix;
        ports.output(0, if muted { 0.0 } else { mixed * level });
    }

    fn set_sample_rate(&mut self, sample_rate: f32) {
        // `Blackhole` sizes its delay lines at construction, so a rate change
        // is a rebuild. The trait guarantees this runs off the audio thread,
        // which is the only reason allocating here is allowed.
        self.verb = Blackhole::new(sample_rate);
        self.mix.set_sample_rate(sample_rate);
        self.level.set_sample_rate(sample_rate);
        // The new tank has never been told anything, so every setter has to
        // run again on the next block.
        self.seen = [f32::NAN; Self::SETTER_COUNT];
    }

    fn reset(&mut self) {
        self.verb.clear();
        self.mix.reset();
        self.level.reset();
    }

    fn input_count(&self) -> usize {
        1
    }
    fn output_count(&self) -> usize {
        1
    }
    fn param_count(&self) -> usize {
        Self::PARAM_COUNT
    }

    /// The registry descriptor's defaults, so a node that has never been
    /// written to sounds the way its face says it does. Without this a fresh
    /// Blackhole would arrive at Gravity 0 and Mix 0 — a dry, mid-sweep reverb
    /// that looks nothing like the panel above it.
    fn param_default(&self, index: usize) -> f32 {
        match index {
            Self::GRAVITY => 0.5,
            Self::SIZE => 0.5,
            Self::MOD_DEPTH => 0.3,
            Self::MOD_RATE => 0.3,
            Self::MIX => 0.35,
            // Level stays 0: like every other effect, the adapter fades it in,
            // which is what stops a rebuild from popping.
            _ => 0.0,
        }
    }
}


// ---- the effect rack -------------------------------------------------------
//
// Eight shells over DSP that already existed in this crate. Each one owns the
// same three shell parameters as every other effect — a wet/dry `MIX`, the
// adapter's fade `LEVEL`, and a hard `MUTE` — so the host treats them
// identically and a crossfade during a rebuild works the same everywhere.
//
// `mix` is deliberately per-module rather than something the graph applies:
// the dry path has to skip the effect's own latency and colouring, which only
// the effect knows about.

/// The wet/dry, fade and mute every effect shares, in that order after the
/// module's own parameters.
struct Shell {
    mix: Tracked,
    level: Tracked,
}

impl Shell {
    fn new(default_mix: f32) -> Self {
        Self { mix: Tracked::new(default_mix), level: Tracked::new(0.0) }
    }

    fn set_sample_rate(&mut self, sample_rate: f32) {
        self.mix.set_sample_rate(sample_rate);
        self.level.set_sample_rate(sample_rate);
    }

    fn reset(&mut self) {
        self.mix.reset();
        self.level.reset();
    }

    /// Blend, fade and gate one sample.
    #[inline]
    fn finish(&mut self, ports: &Ports, dry: f32, wet: f32, mix_index: usize) -> f32 {
        let mix = self.mix.follow(clamp(ports.param(mix_index), 0.0, 1.0));
        let level = self.level.follow(clamp(ports.param(mix_index + 1), 0.0, 1.0));
        let muted = ports.param(mix_index + 2) >= 0.5;
        if muted {
            return 0.0;
        }
        (dry * (1.0 - mix) + wet * mix) * level
    }
}

/// `m.audio-dp4-reverb` — the plate, room and hall algorithms.
pub struct Dp4ReverbModule {
    verb: Dp4Reverb,
    shell: Shell,
    algorithm: Dp4Algorithm,
    seen: [f32; Self::SETTER_COUNT],
}

impl Dp4ReverbModule {
    pub const DECAY: usize = 0;
    pub const PREDELAY: usize = 1;
    pub const LF_DECAY: usize = 2;
    pub const HF_DAMPING: usize = 3;
    pub const HF_BANDWIDTH: usize = 4;
    pub const DIFFUSION_1: usize = 5;
    pub const DIFFUSION_2: usize = 6;
    pub const DECAY_DEFINITION: usize = 7;
    pub const DETUNE_RATE: usize = 8;
    pub const DETUNE_DEPTH: usize = 9;
    pub const PRIMARY_SEND: usize = 10;
    pub const REF_1_LEVEL: usize = 11;
    pub const REF_1_SEND: usize = 12;
    pub const REF_2_LEVEL: usize = 13;
    pub const REF_2_SEND: usize = 14;
    pub const EARLY_REFS: usize = 15;
    pub const MIX: usize = 16;
    pub const LEVEL: usize = 17;
    pub const MUTE: usize = 18;
    pub const PARAM_COUNT: usize = 19;
    const SETTER_COUNT: usize = 16;

    pub fn new(algorithm: Dp4Algorithm, sample_rate: f32) -> Self {
        let mut verb = Dp4Reverb::new(algorithm, sample_rate);
        verb.set_decay_seconds(2.0);
        verb.set_hf_damping(0.35);
        verb.set_hf_bandwidth(0.75);
        verb.set_diffusion(0.75, 0.625);
        Self {
            verb,
            shell: Shell::new(0.3),
            algorithm,
            seen: [f32::NAN; Self::SETTER_COUNT],
        }
    }

    pub fn algorithm(&self) -> Dp4Algorithm {
        self.algorithm
    }

    fn sync(&mut self, raw: &[f32; Self::SETTER_COUNT]) {
        if raw[Self::DECAY] != self.seen[Self::DECAY] {
            self.verb.set_decay_seconds(raw[Self::DECAY]);
        }
        if raw[Self::PREDELAY] != self.seen[Self::PREDELAY] {
            self.verb.set_predelay_seconds(raw[Self::PREDELAY]);
        }
        if raw[Self::LF_DECAY] != self.seen[Self::LF_DECAY] {
            self.verb.set_lf_decay(raw[Self::LF_DECAY]);
        }
        if raw[Self::HF_DAMPING] != self.seen[Self::HF_DAMPING] {
            self.verb.set_hf_damping(raw[Self::HF_DAMPING]);
        }
        if raw[Self::HF_BANDWIDTH] != self.seen[Self::HF_BANDWIDTH] {
            self.verb.set_hf_bandwidth(raw[Self::HF_BANDWIDTH]);
        }
        if raw[Self::DIFFUSION_1] != self.seen[Self::DIFFUSION_1]
            || raw[Self::DIFFUSION_2] != self.seen[Self::DIFFUSION_2]
        {
            self.verb.set_diffusion(raw[Self::DIFFUSION_1], raw[Self::DIFFUSION_2]);
        }
        if raw[Self::DECAY_DEFINITION] != self.seen[Self::DECAY_DEFINITION] {
            self.verb.set_decay_definition(raw[Self::DECAY_DEFINITION]);
        }
        if raw[Self::DETUNE_RATE] != self.seen[Self::DETUNE_RATE]
            || raw[Self::DETUNE_DEPTH] != self.seen[Self::DETUNE_DEPTH]
        {
            self.verb.set_detune(raw[Self::DETUNE_RATE], raw[Self::DETUNE_DEPTH]);
        }
        if raw[Self::PRIMARY_SEND] != self.seen[Self::PRIMARY_SEND] {
            self.verb.set_primary_send(raw[Self::PRIMARY_SEND]);
        }
        if raw[Self::REF_1_LEVEL] != self.seen[Self::REF_1_LEVEL]
            || raw[Self::REF_1_SEND] != self.seen[Self::REF_1_SEND]
        {
            self.verb.set_reference(0, raw[Self::REF_1_LEVEL], raw[Self::REF_1_SEND]);
        }
        if raw[Self::REF_2_LEVEL] != self.seen[Self::REF_2_LEVEL]
            || raw[Self::REF_2_SEND] != self.seen[Self::REF_2_SEND]
        {
            self.verb.set_reference(1, raw[Self::REF_2_LEVEL], raw[Self::REF_2_SEND]);
        }
        if raw[Self::EARLY_REFS] != self.seen[Self::EARLY_REFS] {
            self.verb.set_early_refs(raw[Self::EARLY_REFS]);
        }
        self.seen = *raw;
    }
}

impl Module for Dp4ReverbModule {
    fn process(&mut self, _ctx: &ProcessContext, ports: &mut Ports) {
        let mut raw = [0.0; Self::SETTER_COUNT];
        for (index, slot) in raw.iter_mut().enumerate() {
            *slot = ports.param(index);
        }
        self.sync(&raw);
        let dry = ports.input(0);
        let wet = self.verb.process(dry);
        let out = self.shell.finish(ports, dry, wet, Self::MIX);
        ports.output(0, out);
    }

    fn set_sample_rate(&mut self, sample_rate: f32) {
        self.verb = Dp4Reverb::new(self.algorithm, sample_rate);
        self.shell.set_sample_rate(sample_rate);
        self.seen = [f32::NAN; Self::SETTER_COUNT];
    }

    fn reset(&mut self) {
        self.verb.clear();
        self.shell.reset();
    }

    fn input_count(&self) -> usize { 1 }
    fn output_count(&self) -> usize { 1 }
    fn param_count(&self) -> usize { Self::PARAM_COUNT }

    fn param_default(&self, index: usize) -> f32 {
        match index {
            Self::DECAY => 2.0,
            Self::HF_DAMPING => 0.35,
            Self::HF_BANDWIDTH => 0.75,
            Self::DIFFUSION_1 => 0.75,
            Self::DIFFUSION_2 => 0.625,
            Self::DECAY_DEFINITION => 0.5,
            Self::PRIMARY_SEND => 0.8,
            Self::MIX => 0.3,
            _ => 0.0,
        }
    }
}

/// `m.audio-dp4-nonlin` — the drawn-envelope reverbs.
pub struct Dp4NonLinModule {
    verb: NonLin,
    shell: Shell,
    variant: NonLinVariant,
    seen: [f32; Self::SETTER_COUNT],
}

impl Dp4NonLinModule {
    /// Envelope points 1..9 occupy indices 0..=8.
    pub const ENVELOPE_BASE: usize = 0;
    pub const HF_DAMPING: usize = 9;
    pub const HF_BANDWIDTH: usize = 10;
    pub const DIFFUSION_1: usize = 11;
    pub const DIFFUSION_2: usize = 12;
    pub const DENSITY_1: usize = 13;
    pub const DENSITY_2: usize = 14;
    pub const MIX: usize = 15;
    pub const LEVEL: usize = 16;
    pub const MUTE: usize = 17;
    pub const PARAM_COUNT: usize = 18;
    const SETTER_COUNT: usize = 15;

    pub fn new(variant: NonLinVariant, sample_rate: f32) -> Self {
        let mut verb = NonLin::new(variant, sample_rate);
        verb.set_diffusion(0.7, 0.6);
        verb.set_density(0.6, 0.6);
        Self { verb, shell: Shell::new(0.35), variant, seen: [f32::NAN; Self::SETTER_COUNT] }
    }

    pub fn variant(&self) -> NonLinVariant {
        self.variant
    }

    fn sync(&mut self, raw: &[f32; Self::SETTER_COUNT]) {
        for i in 0..NONLIN_TAPS {
            if raw[Self::ENVELOPE_BASE + i] != self.seen[Self::ENVELOPE_BASE + i] {
                self.verb.set_envelope(i, raw[Self::ENVELOPE_BASE + i]);
            }
        }
        if raw[Self::HF_DAMPING] != self.seen[Self::HF_DAMPING] {
            self.verb.set_hf_damping(raw[Self::HF_DAMPING]);
        }
        if raw[Self::HF_BANDWIDTH] != self.seen[Self::HF_BANDWIDTH] {
            self.verb.set_hf_bandwidth(raw[Self::HF_BANDWIDTH]);
        }
        if raw[Self::DIFFUSION_1] != self.seen[Self::DIFFUSION_1]
            || raw[Self::DIFFUSION_2] != self.seen[Self::DIFFUSION_2]
        {
            self.verb.set_diffusion(raw[Self::DIFFUSION_1], raw[Self::DIFFUSION_2]);
        }
        if raw[Self::DENSITY_1] != self.seen[Self::DENSITY_1]
            || raw[Self::DENSITY_2] != self.seen[Self::DENSITY_2]
        {
            self.verb.set_density(raw[Self::DENSITY_1], raw[Self::DENSITY_2]);
        }
        self.seen = *raw;
    }
}

impl Module for Dp4NonLinModule {
    fn process(&mut self, _ctx: &ProcessContext, ports: &mut Ports) {
        let mut raw = [0.0; Self::SETTER_COUNT];
        for (index, slot) in raw.iter_mut().enumerate() {
            *slot = ports.param(index);
        }
        self.sync(&raw);
        let dry = ports.input(0);
        let wet = self.verb.process(dry);
        let out = self.shell.finish(ports, dry, wet, Self::MIX);
        ports.output(0, out);
    }

    fn set_sample_rate(&mut self, sample_rate: f32) {
        self.verb = NonLin::new(self.variant, sample_rate);
        self.shell.set_sample_rate(sample_rate);
        self.seen = [f32::NAN; Self::SETTER_COUNT];
    }

    fn reset(&mut self) {
        self.verb.clear();
        self.shell.reset();
    }

    fn input_count(&self) -> usize { 1 }
    fn output_count(&self) -> usize { 1 }
    fn param_count(&self) -> usize { Self::PARAM_COUNT }

    fn param_default(&self, index: usize) -> f32 {
        match index {
            // A flat, fully open envelope: the neutral starting shape a person
            // then draws a gate or a swell out of.
            0..=8 => 0.5,
            Self::HF_DAMPING => 0.3,
            Self::HF_BANDWIDTH => 0.75,
            Self::DIFFUSION_1 => 0.7,
            Self::DIFFUSION_2 => 0.6,
            Self::DENSITY_1 | Self::DENSITY_2 => 0.6,
            Self::MIX => 0.35,
            _ => 0.0,
        }
    }
}

/// `m.audio-delay` — one line with feedback.
pub struct DelayModule {
    line: DelayLine,
    feedback_state: f32,
    delay_samples: Tracked,
    feedback: Tracked,
    shell: Shell,
    sample_rate: f32,
}

impl DelayModule {
    pub const DELAY_SECONDS: usize = 0;
    pub const FEEDBACK: usize = 1;
    pub const MIX: usize = 2;
    pub const LEVEL: usize = 3;
    pub const MUTE: usize = 4;
    pub const PARAM_COUNT: usize = 5;
    /// Matches the descriptor's `max-delay-seconds` ceiling.
    pub const MAX_DELAY_SECONDS: f32 = 4.0;
    /// Below unity, always: a delay at exactly 1.0 never decays, and one above
    /// it is an oscillator that takes the speakers with it.
    pub const MAX_FEEDBACK: f32 = 0.95;

    pub fn new(sample_rate: f32) -> Self {
        let rate = if sample_rate > 0.0 { sample_rate } else { 48_000.0 };
        Self {
            line: DelayLine::new(Self::MAX_DELAY_SECONDS + 0.01, rate),
            feedback_state: 0.0,
            delay_samples: Tracked::new(0.25 * rate),
            feedback: Tracked::new(0.3),
            shell: Shell::new(0.35),
            sample_rate: rate,
        }
    }
}

impl Module for DelayModule {
    fn process(&mut self, _ctx: &ProcessContext, ports: &mut Ports) {
        let seconds = clamp(ports.param(Self::DELAY_SECONDS), 0.0, Self::MAX_DELAY_SECONDS);
        let samples = self.delay_samples.follow(seconds * self.sample_rate);
        let feedback = self.feedback.follow(clamp(ports.param(Self::FEEDBACK), 0.0, Self::MAX_FEEDBACK));

        let dry = ports.input(0);
        self.line.push(dry + self.feedback_state * feedback);
        let wet = self.line.read(samples);
        self.feedback_state = wet;
        let out = self.shell.finish(ports, dry, wet, Self::MIX);
        ports.output(0, out);
    }

    fn set_sample_rate(&mut self, sample_rate: f32) {
        self.sample_rate = sample_rate;
        self.line = DelayLine::new(Self::MAX_DELAY_SECONDS + 0.01, sample_rate);
        self.delay_samples.set_sample_rate(sample_rate);
        self.feedback.set_sample_rate(sample_rate);
        self.shell.set_sample_rate(sample_rate);
    }

    fn reset(&mut self) {
        self.line.clear();
        self.feedback_state = 0.0;
        self.delay_samples.reset();
        self.feedback.reset();
        self.shell.reset();
    }

    fn input_count(&self) -> usize { 1 }
    fn output_count(&self) -> usize { 1 }
    fn param_count(&self) -> usize { Self::PARAM_COUNT }

    fn param_default(&self, index: usize) -> f32 {
        match index {
            Self::DELAY_SECONDS => 0.25,
            Self::FEEDBACK => 0.3,
            Self::MIX => 0.35,
            _ => 0.0,
        }
    }
}

/// `m.audio-reverb` — the general-purpose tank.
///
/// The TypeScript build convolves a generated impulse response. An FDN is used
/// here instead: it is what this crate has, it is cheaper, and it takes a decay
/// control directly rather than by regenerating and re-uploading an impulse
/// every time the knob moves. `impulse-seed` therefore no longer means
/// anything, which is why it is not in the parameter table.
pub struct ReverbModule {
    tank: Fdn,
    damping: OnePole,
    shell: Shell,
    sample_rate: f32,
    seen_decay: f32,
    seen_damping: f32,
}

impl ReverbModule {
    pub const DAMPING_HZ: usize = 0;
    pub const TAIL_SECONDS: usize = 1;
    pub const DECAY_RATE: usize = 2;
    pub const MIX: usize = 3;
    pub const LEVEL: usize = 4;
    pub const MUTE: usize = 5;
    pub const PARAM_COUNT: usize = 6;

    pub fn new(sample_rate: f32) -> Self {
        let rate = if sample_rate > 0.0 { sample_rate } else { 48_000.0 };
        let mut tank = Fdn::new(8, rate, MixMatrix::Hadamard);
        tank.set_decay(2.0, 2.0);
        let mut damping = OnePole::new();
        damping.set_cutoff(8_000.0, rate);
        Self {
            tank,
            damping,
            shell: Shell::new(0.3),
            sample_rate: rate,
            seen_decay: f32::NAN,
            seen_damping: f32::NAN,
        }
    }
}

impl Module for ReverbModule {
    fn process(&mut self, _ctx: &ProcessContext, ports: &mut Ports) {
        let tail = clamp(ports.param(Self::TAIL_SECONDS), 0.1, 20.0);
        let rate = clamp(ports.param(Self::DECAY_RATE), 0.1, 4.0);
        let decay = clamp(tail / rate, 0.1, 60.0);
        if decay != self.seen_decay {
            self.seen_decay = decay;
            self.tank.set_decay(decay, decay);
        }
        let hz = clamp(ports.param(Self::DAMPING_HZ), 200.0, 20_000.0);
        if hz != self.seen_damping {
            self.seen_damping = hz;
            self.damping.set_cutoff(hz, self.sample_rate);
        }

        let dry = ports.input(0);
        let wet = self.damping.process(self.tank.process(dry));
        let out = self.shell.finish(ports, dry, wet, Self::MIX);
        ports.output(0, out);
    }

    fn set_sample_rate(&mut self, sample_rate: f32) {
        self.sample_rate = sample_rate;
        self.tank = Fdn::new(8, sample_rate, MixMatrix::Hadamard);
        self.shell.set_sample_rate(sample_rate);
        self.seen_decay = f32::NAN;
        self.seen_damping = f32::NAN;
    }

    fn reset(&mut self) {
        self.tank.clear();
        self.damping.clear();
        self.shell.reset();
    }

    fn input_count(&self) -> usize { 1 }
    fn output_count(&self) -> usize { 1 }
    fn param_count(&self) -> usize { Self::PARAM_COUNT }

    fn param_default(&self, index: usize) -> f32 {
        match index {
            Self::DAMPING_HZ => 8_000.0,
            Self::TAIL_SECONDS => 2.0,
            Self::DECAY_RATE => 1.0,
            Self::MIX => 0.3,
            _ => 0.0,
        }
    }
}

/// `m.audio-eq` — low shelf, peaking mid, high shelf.
pub struct EqModule {
    low: Biquad,
    mid: Biquad,
    high: Biquad,
    shell: Shell,
    sample_rate: f32,
    seen: [f32; 7],
}

impl EqModule {
    pub const LOW_GAIN_DB: usize = 0;
    pub const LOW_FREQUENCY: usize = 1;
    pub const MID_GAIN_DB: usize = 2;
    pub const MID_FREQUENCY: usize = 3;
    pub const MID_Q: usize = 4;
    pub const HIGH_GAIN_DB: usize = 5;
    pub const HIGH_FREQUENCY: usize = 6;
    pub const MIX: usize = 7;
    pub const LEVEL: usize = 8;
    pub const MUTE: usize = 9;
    pub const PARAM_COUNT: usize = 10;

    pub fn new(sample_rate: f32) -> Self {
        let rate = if sample_rate > 0.0 { sample_rate } else { 48_000.0 };
        Self {
            low: Biquad::identity(),
            mid: Biquad::identity(),
            high: Biquad::identity(),
            // An EQ is not a send effect: it is fully wet or it is not doing
            // anything, so its mix starts at 1 unlike every other effect here.
            shell: Shell::new(1.0),
            sample_rate: rate,
            seen: [f32::NAN; 7],
        }
    }
}

impl Module for EqModule {
    fn process(&mut self, _ctx: &ProcessContext, ports: &mut Ports) {
        let mut raw = [0.0; 7];
        for (index, slot) in raw.iter_mut().enumerate() {
            *slot = ports.param(index);
        }
        if raw != self.seen {
            self.seen = raw;
            self.low.set(
                BiquadKind::LowShelf,
                clamp(raw[Self::LOW_FREQUENCY], 20.0, 2_000.0),
                0.7,
                clamp(raw[Self::LOW_GAIN_DB], -24.0, 24.0),
                self.sample_rate,
            );
            self.mid.set(
                BiquadKind::Peaking,
                clamp(raw[Self::MID_FREQUENCY], 100.0, 12_000.0),
                clamp(raw[Self::MID_Q], 0.1, 18.0),
                clamp(raw[Self::MID_GAIN_DB], -24.0, 24.0),
                self.sample_rate,
            );
            self.high.set(
                BiquadKind::HighShelf,
                clamp(raw[Self::HIGH_FREQUENCY], 1_000.0, 20_000.0),
                0.7,
                clamp(raw[Self::HIGH_GAIN_DB], -24.0, 24.0),
                self.sample_rate,
            );
        }

        let dry = ports.input(0);
        let wet = self.high.process(self.mid.process(self.low.process(dry)));
        let out = self.shell.finish(ports, dry, wet, Self::MIX);
        ports.output(0, out);
    }

    fn set_sample_rate(&mut self, sample_rate: f32) {
        self.sample_rate = sample_rate;
        self.shell.set_sample_rate(sample_rate);
        self.seen = [f32::NAN; 7];
    }

    fn reset(&mut self) {
        self.low.clear();
        self.mid.clear();
        self.high.clear();
        self.shell.reset();
    }

    fn input_count(&self) -> usize { 1 }
    fn output_count(&self) -> usize { 1 }
    fn param_count(&self) -> usize { Self::PARAM_COUNT }

    fn param_default(&self, index: usize) -> f32 {
        match index {
            Self::LOW_FREQUENCY => 200.0,
            Self::MID_FREQUENCY => 1_000.0,
            Self::MID_Q => 1.0,
            Self::HIGH_FREQUENCY => 6_000.0,
            Self::MIX => 1.0,
            _ => 0.0,
        }
    }
}

/// `m.audio-compressor` — envelope follower into a gain computer.
pub struct CompressorModule {
    follower: EnvelopeFollower,
    computer: GainComputer,
    shell: Shell,
    sample_rate: f32,
    seen: [f32; 5],
}

impl CompressorModule {
    pub const THRESHOLD_DB: usize = 0;
    pub const KNEE_DB: usize = 1;
    pub const RATIO: usize = 2;
    pub const ATTACK_SECONDS: usize = 3;
    pub const RELEASE_SECONDS: usize = 4;
    pub const MAKEUP_GAIN: usize = 5;
    pub const MIX: usize = 6;
    pub const LEVEL: usize = 7;
    pub const MUTE: usize = 8;
    pub const PARAM_COUNT: usize = 9;

    pub fn new(sample_rate: f32) -> Self {
        let rate = if sample_rate > 0.0 { sample_rate } else { 48_000.0 };
        let mut follower = EnvelopeFollower::new();
        follower.set_times(0.01, 0.1, rate);
        Self {
            follower,
            computer: GainComputer { threshold_db: -24.0, ratio: 12.0, mode: DynamicsMode::Compress, knee_db: 30.0 },
            shell: Shell::new(1.0),
            sample_rate: rate,
            seen: [f32::NAN; 5],
        }
    }
}

impl Module for CompressorModule {
    fn process(&mut self, _ctx: &ProcessContext, ports: &mut Ports) {
        let mut raw = [0.0; 5];
        for (index, slot) in raw.iter_mut().enumerate() {
            *slot = ports.param(index);
        }
        if raw != self.seen {
            self.seen = raw;
            self.computer = GainComputer {
                threshold_db: clamp(raw[Self::THRESHOLD_DB], -60.0, 0.0),
                ratio: clamp(raw[Self::RATIO], 1.0, 20.0),
                mode: DynamicsMode::Compress,
                // 40 dB, matching the descriptor's own range — a clamp
                // narrower than the control it serves is a knob whose top end
                // silently does nothing.
                knee_db: clamp(raw[Self::KNEE_DB], 0.0, 40.0),
            };
            self.follower.set_times(
                clamp(raw[Self::ATTACK_SECONDS], 0.0001, 1.0),
                clamp(raw[Self::RELEASE_SECONDS], 0.001, 4.0),
                self.sample_rate,
            );
        }

        let dry = ports.input(0);
        let env = self.follower.process(dry);
        let makeup = clamp(ports.param(Self::MAKEUP_GAIN), 0.0, 4.0);
        let wet = dry * self.computer.gain_linear(env) * makeup;
        let out = self.shell.finish(ports, dry, wet, Self::MIX);
        ports.output(0, out);
    }

    fn set_sample_rate(&mut self, sample_rate: f32) {
        self.sample_rate = sample_rate;
        self.shell.set_sample_rate(sample_rate);
        self.seen = [f32::NAN; 5];
    }

    fn reset(&mut self) {
        self.follower.clear();
        self.shell.reset();
    }

    fn input_count(&self) -> usize { 1 }
    fn output_count(&self) -> usize { 1 }
    fn param_count(&self) -> usize { Self::PARAM_COUNT }

    fn param_default(&self, index: usize) -> f32 {
        match index {
            Self::THRESHOLD_DB => -24.0,
            Self::KNEE_DB => 30.0,
            Self::RATIO => 12.0,
            Self::ATTACK_SECONDS => 0.003,
            Self::RELEASE_SECONDS => 0.25,
            Self::MAKEUP_GAIN => 1.0,
            Self::MIX => 1.0,
            _ => 0.0,
        }
    }
}

/// `m.audio-limiter` — a brick wall.
///
/// Mix defaults fully wet, which is what a safety limiter wants, but it is a
/// real control: parallel limiting is a technique, not a mistake, and blending
/// a crushed copy under the dry one is how a lot of drum busses are built.
pub struct LimiterModule {
    follower: EnvelopeFollower,
    computer: GainComputer,
    shell: Shell,
    sample_rate: f32,
    seen: [f32; 2],
}

impl LimiterModule {
    pub const CEILING_DB: usize = 0;
    pub const RELEASE_SECONDS: usize = 1;
    pub const MIX: usize = 2;
    pub const LEVEL: usize = 3;
    pub const MUTE: usize = 4;
    pub const PARAM_COUNT: usize = 5;

    pub fn new(sample_rate: f32) -> Self {
        let rate = if sample_rate > 0.0 { sample_rate } else { 48_000.0 };
        let mut follower = EnvelopeFollower::new();
        follower.set_times(0.0005, 0.05, rate);
        Self {
            follower,
            computer: GainComputer { threshold_db: -1.0, ratio: 1.0e6, mode: DynamicsMode::Compress, knee_db: 0.0 },
            shell: Shell::new(1.0),
            sample_rate: rate,
            seen: [f32::NAN; 2],
        }
    }
}

impl Module for LimiterModule {
    fn process(&mut self, _ctx: &ProcessContext, ports: &mut Ports) {
        let raw = [ports.param(Self::CEILING_DB), ports.param(Self::RELEASE_SECONDS)];
        if raw != self.seen {
            self.seen = raw;
            // A limiter is compression at the ratio's limit; `gain_db` models
            // infinity as 1e6 precisely so the curve stays continuous there.
            self.computer = GainComputer {
                threshold_db: clamp(raw[0], -24.0, 0.0),
                ratio: 1.0e6,
                mode: DynamicsMode::Compress,
                // Hard knee, and that is the point: a brick wall with a soft
                // corner starts limiting below its ceiling, which is exactly
                // what a ceiling is supposed to not do.
                knee_db: 0.0,
            };
            // A fixed, very fast attack: a limiter that let a transient through
            // while it ramped would not be one.
            self.follower.set_times(0.0005, clamp(raw[1], 0.001, 1.0), self.sample_rate);
        }

        let dry = ports.input(0);
        let env = self.follower.process(dry);
        let wet = dry * self.computer.gain_linear(env);
        let out = self.shell.finish(ports, dry, wet, Self::MIX);
        ports.output(0, out);
    }

    fn set_sample_rate(&mut self, sample_rate: f32) {
        self.sample_rate = sample_rate;
        self.shell.set_sample_rate(sample_rate);
        self.seen = [f32::NAN; 2];
    }

    fn reset(&mut self) {
        self.follower.clear();
        self.shell.reset();
    }

    fn input_count(&self) -> usize { 1 }
    fn output_count(&self) -> usize { 1 }
    fn param_count(&self) -> usize { Self::PARAM_COUNT }

    fn param_default(&self, index: usize) -> f32 {
        match index {
            Self::CEILING_DB => -1.0,
            Self::RELEASE_SECONDS => 0.05,
            Self::MIX => 1.0,
            _ => 0.0,
        }
    }
}

/// `m.audio-bitcrusher` — quantise, then filter what that produced.
pub struct BitcrusherModule {
    tone: OnePole,
    shell: Shell,
    sample_rate: f32,
    seen_tone: f32,
}

impl BitcrusherModule {
    pub const TONE_HZ: usize = 0;
    pub const BIT_DEPTH: usize = 1;
    pub const MIX: usize = 2;
    pub const LEVEL: usize = 3;
    pub const MUTE: usize = 4;
    pub const PARAM_COUNT: usize = 5;

    pub fn new(sample_rate: f32) -> Self {
        let rate = if sample_rate > 0.0 { sample_rate } else { 48_000.0 };
        let mut tone = OnePole::new();
        tone.set_cutoff(6_000.0, rate);
        Self { tone, shell: Shell::new(0.5), sample_rate: rate, seen_tone: f32::NAN }
    }
}

impl Module for BitcrusherModule {
    fn process(&mut self, _ctx: &ProcessContext, ports: &mut Ports) {
        let hz = clamp(ports.param(Self::TONE_HZ), 200.0, 20_000.0);
        if hz != self.seen_tone {
            self.seen_tone = hz;
            self.tone.set_cutoff(hz, self.sample_rate);
        }
        let bits = clamp(ports.param(Self::BIT_DEPTH), 1.0, 16.0);
        // Levels per unit, so 1 bit is two levels and 16 is 65536.
        let levels = 2.0f32.powf(bits);
        let dry = ports.input(0);
        // Round rather than truncate: truncation biases every sample toward
        // zero, which is a DC offset on top of the intended distortion.
        let crushed = (dry * levels).round() / levels;
        let wet = self.tone.process(crushed);
        let out = self.shell.finish(ports, dry, wet, Self::MIX);
        ports.output(0, out);
    }

    fn set_sample_rate(&mut self, sample_rate: f32) {
        self.sample_rate = sample_rate;
        self.shell.set_sample_rate(sample_rate);
        self.seen_tone = f32::NAN;
    }

    fn reset(&mut self) {
        self.tone.clear();
        self.shell.reset();
    }

    fn input_count(&self) -> usize { 1 }
    fn output_count(&self) -> usize { 1 }
    fn param_count(&self) -> usize { Self::PARAM_COUNT }

    fn param_default(&self, index: usize) -> f32 {
        match index {
            Self::TONE_HZ => 6_000.0,
            Self::BIT_DEPTH => 8.0,
            Self::MIX => 0.5,
            _ => 0.0,
        }
    }
}


// ---- the samplers ----------------------------------------------------------
//
// The last three, and the ones that could not move until the engine had its
// own memory for audio. All three are *instruments*: they take notes rather
// than an audio input, and they read the bank `ProcessContext` lends them.
//
// Notes reach a sample through `set_sample_slot` rather than a parameter — a
// percussion kit has sixteen assignments and none of them is a value anyone
// turns. See `sampler.rs`.


/// Notes waiting for the next `process`.
///
/// `Module::note_on` has no access to the sample bank — the bank is lent
/// through `ProcessContext`, which only `process` receives — so a sampler
/// cannot start a voice at the moment the note arrives. It records the note
/// and starts it on the next sample instead.
///
/// That is at most one sample of latency, about 20 µs, which is four hundred
/// times under the threshold where anything is audible and far less than the
/// scheduling jitter the note already survived getting here. The alternative
/// is widening the trait so every module carries a bank reference it does not
/// want.
#[derive(Clone, Copy, Default)]
struct PendingNotes {
    /// Note, velocity, detune in cents.
    notes: [(u8, f32, f32); 8],
    count: usize,
}

impl PendingNotes {
    fn push(&mut self, note: u8, velocity: f32, detune_cents: f32) {
        // A full queue drops the oldest rather than the newest: in a burst the
        // most recent notes are the ones being played right now.
        if self.count == self.notes.len() {
            self.notes.copy_within(1.., 0);
            self.count -= 1;
        }
        self.notes[self.count] = (note, velocity, detune_cents);
        self.count += 1;
    }

    fn take(&mut self) -> ([(u8, f32, f32); 8], usize) {
        let taken = (self.notes, self.count);
        self.count = 0;
        taken
    }
}

/// `m.percussion` — a kit, one sample per note.
pub struct PercussionModule {
    sampler: Sampler,
    shell: Shell,
    pending: PendingNotes,
}

impl PercussionModule {
    pub const PITCH_SEMITONES: usize = 0;
    pub const DECAY_SECONDS: usize = 1;
    pub const MIX: usize = 2;
    pub const LEVEL: usize = 3;
    pub const MUTE: usize = 4;
    pub const PARAM_COUNT: usize = 5;

    pub fn new(sample_rate: f32) -> Self {
        Self {
            sampler: Sampler::new(sample_rate),
            shell: Shell::new(1.0),
            pending: PendingNotes::default(),
        }
    }

    fn settings(&self, ports: &Ports) -> SamplerSettings {
        SamplerSettings {
            pitch_semitones: clamp(ports.param(Self::PITCH_SEMITONES), -24.0, 24.0),
            decay_sec: clamp(ports.param(Self::DECAY_SECONDS), 0.02, 4.0),
            // A hit runs to the end whatever the key does. That is what makes
            // this a kit rather than a keyboard.
            gate: false,
            ..SamplerSettings::default()
        }
    }
}

impl Module for PercussionModule {
    fn process(&mut self, ctx: &ProcessContext, ports: &mut Ports) {
        let settings = self.settings(ports);
        let (notes, count) = self.pending.take();
        for &(note, velocity, detune_cents) in &notes[..count] {
            self.sampler.note_on(ctx.samples, note, velocity, detune_cents, &settings);
        }
        let wet = self.sampler.process(ctx.samples, &settings);
        // A source has no dry path — there is no input to blend against — so
        // the shell sees silence as its dry signal and `mix` behaves as a
        // straight wet level.
        let out = self.shell.finish(ports, 0.0, wet, Self::MIX);
        ports.output(0, out);
    }

    fn set_sample_rate(&mut self, sample_rate: f32) {
        self.sampler.set_sample_rate(sample_rate);
        self.shell.set_sample_rate(sample_rate);
    }

    fn reset(&mut self) {
        self.sampler.clear();
        self.shell.reset();
    }

    fn set_sample_slot(&mut self, slot: u32, sample: u32) {
        self.sampler.set_slot(slot, sample);
    }

    fn note_on(&mut self, note: u8, velocity: f32, detune_cents: f32) {
        self.pending.push(note, velocity, detune_cents);
    }

    fn note_off(&mut self, note: u8) {
        // Ungated by design, so this only marks the voice released; the hit
        // still runs to the end.
        self.sampler.note_off(note, &SamplerSettings { gate: false, ..SamplerSettings::default() });
    }

    fn all_notes_off(&mut self) {
        self.sampler.all_notes_off();
    }

    // Sources have no audio input.
    fn input_count(&self) -> usize { 0 }
    fn output_count(&self) -> usize { 1 }
    fn param_count(&self) -> usize { Self::PARAM_COUNT }

    fn param_default(&self, index: usize) -> f32 {
        match index {
            Self::DECAY_SECONDS => 0.5,
            Self::MIX => 1.0,
            _ => 0.0,
        }
    }
}

/// `m.looper` — one sample, with loop points and a rate.
///
/// # Two engines behind one control
///
/// Plain playback changes pitch with rate, the way tape does. Time-stretch
/// re-emits overlapping grains at a fixed pitch while the scan moves at the
/// rate, so speed and pitch come apart — which is the whole reason the mode
/// exists. `GrainCloud` already separates the two: `stretch` moves the scan
/// and `rate` sets the pitch.
///
/// It is a structural variant rather than a parameter because it decides which
/// engine runs, and swapping engines mid-note would cut the sound. The
/// document already treats `time-stretch` as structural, so changing it
/// rebuilds the node behind the usual crossfade.
pub struct LooperModule {
    sampler: Sampler,
    cloud: GrainCloud,
    /// Which engine this instance was built with. Fixed for its lifetime.
    stretching: bool,
    /// The sample to scan, for the stretch engine. The plain engine reaches
    /// its audio through the sampler's own note-to-slot table.
    sample: u32,
    shell: Shell,
    pending: PendingNotes,
    /// The gate flag as of the last `process`, so `note_off` releases with the
    /// setting the voice was started under rather than a default.
    gated: bool,
}

impl LooperModule {
    pub const RATE: usize = 0;
    pub const PITCH_SHIFT: usize = 1;
    pub const LOOP_START: usize = 2;
    pub const LOOP_END: usize = 3;
    pub const LOOP: usize = 4;
    pub const REVERSE: usize = 5;
    pub const GATE: usize = 6;
    pub const MIX: usize = 7;
    pub const LEVEL: usize = 8;
    pub const MUTE: usize = 9;
    pub const PARAM_COUNT: usize = 10;

    pub fn new(sample_rate: f32) -> Self {
        Self::new_variant(sample_rate, 0)
    }

    /// Variant 0 plays; variant 1 time-stretches. See the type's docs.
    pub fn new_variant(sample_rate: f32, variant: u32) -> Self {
        Self {
            sampler: Sampler::new(sample_rate),
            // Both engines are built either way. A `GrainCloud` is a fixed
            // array of grains and costs a few kilobytes, and holding one
            // unconditionally is cheaper than the branch it would take to
            // avoid it — and keeps every instance the same shape.
            cloud: GrainCloud::new(sample_rate, 0x100_9e5),
            stretching: variant == 1,
            sample: NO_SAMPLE,
            shell: Shell::new(1.0),
            pending: PendingNotes::default(),
            gated: false,
        }
    }

    /// What the stretch engine reads from the same controls.
    ///
    /// `stretch` takes the rate, so speed is the rate; `rate` takes the pitch
    /// shift, so pitch is only what the pitch control asks for. That is the
    /// separation the mode exists to provide.
    fn grain_settings(&self, ports: &Ports) -> GrainSettings {
        GrainSettings {
            size_sec: 0.08,
            spacing_sec: 0.02,
            position: clamp(ports.param(Self::LOOP_START), 0.0, 1.0),
            jitter: 0.0,
            stretch: clamp(ports.param(Self::RATE), 0.05, 4.0),
            freeze: false,
            rate: semitone_ratio(clamp(ports.param(Self::PITCH_SHIFT), -24.0, 24.0)),
        }
    }

    fn settings(&self, ports: &Ports) -> SamplerSettings {
        SamplerSettings {
            rate: clamp(ports.param(Self::RATE), 0.05, 4.0),
            pitch_semitones: clamp(ports.param(Self::PITCH_SHIFT), -24.0, 24.0),
            looping: ports.param(Self::LOOP) >= 0.5,
            loop_start: clamp(ports.param(Self::LOOP_START), 0.0, 1.0),
            loop_end: clamp(ports.param(Self::LOOP_END), 0.0, 1.0),
            reverse: ports.param(Self::REVERSE) >= 0.5,
            gate: ports.param(Self::GATE) >= 0.5,
            decay_sec: 0.02,
        }
    }
}

impl Module for LooperModule {
    fn process(&mut self, ctx: &ProcessContext, ports: &mut Ports) {
        let settings = self.settings(ports);
        self.gated = settings.gate;
        let (notes, count) = self.pending.take();

        let wet = if self.stretching {
            // A note restarts the scan; the cloud then runs on by itself.
            if count > 0 {
                self.cloud.retrigger(clamp(ports.param(Self::LOOP_START), 0.0, 1.0));
            }
            if self.sample == NO_SAMPLE {
                0.0
            } else {
                self.cloud.process(ctx.samples, self.sample, &self.grain_settings(ports))
            }
        } else {
            for &(note, velocity, detune_cents) in &notes[..count] {
                self.sampler.note_on(ctx.samples, note, velocity, detune_cents, &settings);
            }
            self.sampler.process(ctx.samples, &settings)
        };

        let out = self.shell.finish(ports, 0.0, wet, Self::MIX);
        ports.output(0, out);
    }

    fn set_sample_rate(&mut self, sample_rate: f32) {
        self.sampler.set_sample_rate(sample_rate);
        self.cloud.set_sample_rate(sample_rate);
        self.shell.set_sample_rate(sample_rate);
    }

    fn reset(&mut self) {
        self.sampler.clear();
        self.cloud.clear();
        self.shell.reset();
    }

    fn set_sample_slot(&mut self, slot: u32, sample: u32) {
        self.sampler.set_slot(slot, sample);
        // One source, whichever engine is running: the stretch path scans a
        // sample rather than looking one up per note, so it needs the id here.
        self.sample = sample;
    }

    fn note_on(&mut self, note: u8, velocity: f32, detune_cents: f32) {
        self.pending.push(note, velocity, detune_cents);
    }

    fn note_off(&mut self, note: u8) {
        self.sampler.note_off(
            note,
            &SamplerSettings { gate: self.gated, ..SamplerSettings::default() },
        );
    }

    fn all_notes_off(&mut self) {
        self.sampler.all_notes_off();
    }

    fn input_count(&self) -> usize { 0 }
    fn output_count(&self) -> usize { 1 }
    fn param_count(&self) -> usize { Self::PARAM_COUNT }

    fn param_default(&self, index: usize) -> f32 {
        match index {
            Self::RATE => 1.0,
            Self::LOOP_END => 1.0,
            Self::LOOP => 1.0,
            Self::MIX => 1.0,
            _ => 0.0,
        }
    }
}

/// `m.granular` — the grain cloud.
pub struct GranularModule {
    cloud: GrainCloud,
    shell: Shell,
    sample: u32,
}

impl GranularModule {
    pub const GRAIN_SIZE: usize = 0;
    pub const GRAIN_SPACING: usize = 1;
    pub const POSITION: usize = 2;
    pub const JITTER: usize = 3;
    pub const STRETCH: usize = 4;
    pub const FREEZE: usize = 5;
    pub const FREE_RUN: usize = 6;
    pub const MIX: usize = 7;
    pub const LEVEL: usize = 8;
    pub const MUTE: usize = 9;
    pub const PARAM_COUNT: usize = 10;

    pub fn new(sample_rate: f32) -> Self {
        Self {
            // A fixed seed rather than a random one: a granular patch has to
            // sound the same every time a project opens.
            cloud: GrainCloud::new(sample_rate, 0x5eed),
            shell: Shell::new(1.0),
            sample: NO_SAMPLE,
        }
    }
}

impl Module for GranularModule {
    fn process(&mut self, ctx: &ProcessContext, ports: &mut Ports) {
        if self.sample == NO_SAMPLE {
            ports.output(0, 0.0);
            return;
        }
        let settings = GrainSettings {
            size_sec: clamp(ports.param(Self::GRAIN_SIZE), 0.005, 2.0),
            spacing_sec: clamp(ports.param(Self::GRAIN_SPACING), 0.005, 1.0),
            position: clamp(ports.param(Self::POSITION), 0.0, 1.0),
            jitter: clamp(ports.param(Self::JITTER), 0.0, 1.0),
            stretch: clamp(ports.param(Self::STRETCH), 0.05, 8.0),
            freeze: ports.param(Self::FREEZE) >= 0.5,
            rate: 1.0,
        };
        let wet = self.cloud.process(ctx.samples, self.sample, &settings);
        let out = self.shell.finish(ports, 0.0, wet, Self::MIX);
        ports.output(0, out);
    }

    fn set_sample_rate(&mut self, sample_rate: f32) {
        self.cloud.set_sample_rate(sample_rate);
        self.shell.set_sample_rate(sample_rate);
    }

    fn reset(&mut self) {
        self.cloud.clear();
        self.shell.reset();
    }

    /// One source, so every slot names the same thing and the last one wins.
    fn set_sample_slot(&mut self, _slot: u32, sample: u32) {
        self.sample = sample;
    }

    /// A note restarts the scan unless the cloud is free-running, which is the
    /// difference between playing it and letting it drift.
    fn note_on(&mut self, _note: u8, _velocity: f32, _detune_cents: f32) {
        self.cloud.retrigger(0.0);
    }

    fn all_notes_off(&mut self) {
        self.cloud.clear();
    }

    fn input_count(&self) -> usize { 0 }
    fn output_count(&self) -> usize { 1 }
    fn param_count(&self) -> usize { Self::PARAM_COUNT }

    fn param_default(&self, index: usize) -> f32 {
        match index {
            Self::GRAIN_SIZE => 0.2,
            Self::GRAIN_SPACING => 0.08,
            Self::POSITION => 0.5,
            Self::JITTER => 0.1,
            Self::STRETCH => 1.0,
            Self::MIX => 1.0,
            _ => 0.0,
        }
    }
}

/// Every module the host can name, so the shim never matches on strings.
///
/// The discriminants are part of the wire protocol between TypeScript and
/// WASM — appending is safe, reordering is not.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u32)]
pub enum ModuleKind {
    HostInput = 0,
    Gain = 1,
    AudioOutput = 2,
    Synth = 3,
    Blackhole = 4,
    Dp4Reverb = 5,
    Dp4NonLin = 6,
    Delay = 7,
    Reverb = 8,
    Eq = 9,
    Compressor = 10,
    Limiter = 11,
    Bitcrusher = 12,
    Percussion = 13,
    Looper = 14,
    Granular = 15,
}

impl ModuleKind {
    pub fn from_u32(value: u32) -> Option<Self> {
        match value {
            0 => Some(Self::HostInput),
            1 => Some(Self::Gain),
            2 => Some(Self::AudioOutput),
            3 => Some(Self::Synth),
            4 => Some(Self::Blackhole),
            5 => Some(Self::Dp4Reverb),
            6 => Some(Self::Dp4NonLin),
            7 => Some(Self::Delay),
            8 => Some(Self::Reverb),
            9 => Some(Self::Eq),
            10 => Some(Self::Compressor),
            11 => Some(Self::Limiter),
            12 => Some(Self::Bitcrusher),
            13 => Some(Self::Percussion),
            14 => Some(Self::Looper),
            15 => Some(Self::Granular),
            _ => None,
        }
    }

    /// Build at a sample rate.
    ///
    /// Anything holding delay lines or envelopes needs the rate at
    /// construction; `Engine::add` calls `set_sample_rate` too, but a module
    /// that had to survive being built at the wrong rate first is a module with
    /// two initialisation paths.
    pub fn build_at(self, sample_rate: f32) -> Box<dyn Module> {
        self.build_variant_at(0, sample_rate)
    }

    /// Build with a structural variant — the DP/4's algorithm, Non Lin's
    /// flavour.
    ///
    /// Separate from a parameter because it decides *topology*: how many delay
    /// lines the tank has, whether there is a pre-echo section at all. Those
    /// are fixed at construction and allocate, so they cannot be a value
    /// arriving on the audio thread. The host already treats such controls as
    /// structural and rebuilds the node when one changes, which is exactly the
    /// remove-then-add this pairs with. Kinds with no variants ignore it.
    pub fn build_variant_at(self, variant: u32, sample_rate: f32) -> Box<dyn Module> {
        match self {
            Self::HostInput => Box::<HostInput>::default(),
            Self::Gain => Box::<Gain>::default(),
            Self::AudioOutput => Box::<AudioOutput>::default(),
            Self::Synth => Box::new(Synth::new(sample_rate)),
            Self::Blackhole => Box::new(BlackholeVerb::new(sample_rate)),
            Self::Dp4Reverb => {
                Box::new(Dp4ReverbModule::new(Dp4Algorithm::from_u32(variant), sample_rate))
            }
            Self::Dp4NonLin => {
                Box::new(Dp4NonLinModule::new(NonLinVariant::from_u32(variant), sample_rate))
            }
            Self::Delay => Box::new(DelayModule::new(sample_rate)),
            Self::Reverb => Box::new(ReverbModule::new(sample_rate)),
            Self::Eq => Box::new(EqModule::new(sample_rate)),
            Self::Compressor => Box::new(CompressorModule::new(sample_rate)),
            Self::Limiter => Box::new(LimiterModule::new(sample_rate)),
            Self::Bitcrusher => Box::new(BitcrusherModule::new(sample_rate)),
            Self::Percussion => Box::new(PercussionModule::new(sample_rate)),
            Self::Looper => Box::new(LooperModule::new_variant(sample_rate, variant)),
            Self::Granular => Box::new(GranularModule::new(sample_rate)),
        }
    }

    /// Build at the default rate. The engine corrects it on `add`.
    pub fn build(self) -> Box<dyn Module> {
        self.build_at(48_000.0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::{Engine, PortRef};

    const RATE: f32 = 48_000.0;

    /// input → blackhole → output, with the shell level opened up.
    fn verb_chain() -> (Engine, u32, u32, u32) {
        let mut engine = Engine::new(RATE);
        let input = engine.add(ModuleKind::HostInput.build());
        let verb = engine.add(ModuleKind::Blackhole.build());
        let output = engine.add(ModuleKind::AudioOutput.build());
        engine.connect(PortRef { module: input, port: 0 }, PortRef { module: verb, port: 0 });
        engine.connect(PortRef { module: verb, port: 0 }, PortRef { module: output, port: 0 });
        engine.set_param(verb, BlackholeVerb::LEVEL, 1.0);
        (engine, input, verb, output)
    }

    /// Strike once, then run silent and report the loudest sample of the tail.
    fn tail_peak(engine: &mut Engine, input: u32, output: u32, samples: usize) -> f32 {
        engine.set_param(input, HostInput::SAMPLE, 1.0);
        engine.process();
        engine.set_param(input, HostInput::SAMPLE, 0.0);
        let mut peak = 0.0f32;
        for _ in 0..samples {
            engine.process();
            peak = peak.max(engine.output_of(output, 0).abs());
        }
        peak
    }

    /// input → effect → output, with the shell's fade opened.
    fn effect_chain(kind: ModuleKind, level_index: usize) -> (Engine, u32, u32, u32) {
        let mut engine = Engine::new(RATE);
        let input = engine.add(ModuleKind::HostInput.build());
        let fx = engine.add(kind.build());
        let output = engine.add(ModuleKind::AudioOutput.build());
        engine.connect(PortRef { module: input, port: 0 }, PortRef { module: fx, port: 0 });
        engine.connect(PortRef { module: fx, port: 0 }, PortRef { module: output, port: 0 });
        engine.set_param(fx, level_index, 1.0);
        (engine, input, fx, output)
    }

    /// Every effect, with the index of its MIX parameter — MIX, LEVEL and MUTE
    /// are always consecutive, which is the shell contract.
    const EFFECTS: [(ModuleKind, usize); 8] = [
        (ModuleKind::Dp4Reverb, Dp4ReverbModule::MIX),
        (ModuleKind::Dp4NonLin, Dp4NonLinModule::MIX),
        (ModuleKind::Delay, DelayModule::MIX),
        (ModuleKind::Reverb, ReverbModule::MIX),
        (ModuleKind::Eq, EqModule::MIX),
        (ModuleKind::Compressor, CompressorModule::MIX),
        (ModuleKind::Limiter, LimiterModule::MIX),
        (ModuleKind::Bitcrusher, BitcrusherModule::MIX),
    ];

    #[test]
    fn every_effect_is_reachable_by_its_wire_number() {
        for (index, kind) in [
            (5, ModuleKind::Dp4Reverb),
            (6, ModuleKind::Dp4NonLin),
            (7, ModuleKind::Delay),
            (8, ModuleKind::Reverb),
            (9, ModuleKind::Eq),
            (10, ModuleKind::Compressor),
            (11, ModuleKind::Limiter),
            (12, ModuleKind::Bitcrusher),
        ] {
            assert_eq!(ModuleKind::from_u32(index), Some(kind), "kind {index} drifted");
            assert_eq!(kind as u32, index);
        }
    }

    #[test]
    fn every_effect_passes_the_dry_signal_at_zero_mix() {
        // The shell contract. A mix of zero has to be a clean bypass on all of
        // them, or automating mix to zero is not the escape hatch it looks like.
        for (kind, mix) in EFFECTS {
            let (mut engine, input, fx, output) = effect_chain(kind, mix + 1);
            engine.set_param(fx, mix, 0.0);
            settle(&mut engine);
            let out = steady(&mut engine, input, output, 0.5);
            assert!((out - 0.5).abs() < 1e-3, "{kind:?} did not pass dry at zero mix: {out}");
        }
    }

    #[test]
    fn every_effect_goes_silent_when_muted() {
        for (kind, mix) in EFFECTS {
            let (mut engine, input, fx, output) = effect_chain(kind, mix + 1);
            engine.set_param(fx, mix + 2, 1.0);
            settle(&mut engine);
            assert_eq!(steady(&mut engine, input, output, 1.0), 0.0, "{kind:?} was audible muted");
        }
    }

    #[test]
    fn every_effect_is_silent_before_its_fade_is_opened() {
        // Modules are built silent so the adapter can fade them in; that is
        // what keeps a rebuild from popping.
        for (kind, mix) in EFFECTS {
            let mut engine = Engine::new(RATE);
            let input = engine.add(ModuleKind::HostInput.build());
            let fx = engine.add(kind.build());
            let output = engine.add(ModuleKind::AudioOutput.build());
            engine.connect(PortRef { module: input, port: 0 }, PortRef { module: fx, port: 0 });
            engine.connect(PortRef { module: fx, port: 0 }, PortRef { module: output, port: 0 });
            let _ = mix;
            settle(&mut engine);
            assert_eq!(steady(&mut engine, input, output, 1.0), 0.0, "{kind:?} was audible unfaded");
        }
    }

    #[test]
    fn every_effect_stays_finite_under_a_hostile_sweep() {
        for (kind, mix) in EFFECTS {
            let (mut engine, input, fx, output) = effect_chain(kind, mix + 1);
            let count = kind.build().param_count();
            for step in 0..=6 {
                let t = step as f32 / 6.0;
                for index in 0..count {
                    // Deliberately nonsense for most parameters: every one is
                    // swept over a range far wider than its descriptor allows.
                    engine.set_param(fx, index, t * 2.0 - 1.0);
                }
                engine.set_param(fx, mix + 1, 1.0);
                for i in 0..1_500 {
                    engine.set_param(input, HostInput::SAMPLE, if i % 97 == 0 { 1.0 } else { 0.0 });
                    engine.process();
                    let out = engine.output_of(output, 0);
                    assert!(out.is_finite(), "{kind:?} went non-finite at step {step}");
                    assert!(out.abs() < 50.0, "{kind:?} ran away at step {step}: {out}");
                }
            }
        }
    }

    #[test]
    fn a_structural_variant_reaches_the_module_it_builds() {
        // The whole reason `build_variant_at` exists: the algorithm decides the
        // topology and cannot arrive later as a parameter.
        let hall = ModuleKind::Dp4Reverb.build_variant_at(Dp4Algorithm::Hall as u32, RATE);
        assert_eq!(hall.param_count(), Dp4ReverbModule::PARAM_COUNT);
        let nonlin = ModuleKind::Dp4NonLin.build_variant_at(NonLinVariant::NonLin2 as u32, RATE);
        assert_eq!(nonlin.param_count(), Dp4NonLinModule::PARAM_COUNT);
        // A kind with no variants ignores it rather than refusing to build.
        assert_eq!(ModuleKind::Gain.build_variant_at(7, RATE).param_count(), 3);
    }

    #[test]
    fn the_delay_actually_delays() {
        let (mut engine, input, fx, output) = effect_chain(ModuleKind::Delay, DelayModule::MIX + 1);
        engine.set_param(fx, DelayModule::MIX, 1.0);
        engine.set_param(fx, DelayModule::DELAY_SECONDS, 0.01);
        engine.set_param(fx, DelayModule::FEEDBACK, 0.0);
        settle(&mut engine);
        engine.set_param(input, HostInput::SAMPLE, 1.0);
        engine.process();
        engine.set_param(input, HostInput::SAMPLE, 0.0);
        // Nothing at once…
        let mut early = 0.0f32;
        for _ in 0..((RATE * 0.005) as usize) {
            engine.process();
            early = early.max(engine.output_of(output, 0).abs());
        }
        // …then the repeat.
        let mut later = 0.0f32;
        for _ in 0..((RATE * 0.02) as usize) {
            engine.process();
            later = later.max(engine.output_of(output, 0).abs());
        }
        assert!(early < 1e-4, "the delay was not delaying: {early}");
        assert!(later > 1e-3, "the repeat never arrived: {later}");
    }

    #[test]
    fn the_bitcrusher_quantises_without_a_dc_offset() {
        // Rounding rather than truncating: truncation biases every sample
        // toward zero, which is DC on top of the intended distortion.
        let (mut engine, input, fx, output) =
            effect_chain(ModuleKind::Bitcrusher, BitcrusherModule::MIX + 1);
        engine.set_param(fx, BitcrusherModule::MIX, 1.0);
        engine.set_param(fx, BitcrusherModule::BIT_DEPTH, 2.0);
        engine.set_param(fx, BitcrusherModule::TONE_HZ, 20_000.0);
        settle(&mut engine);
        let positive = steady(&mut engine, input, output, 0.3);
        let negative = steady(&mut engine, input, output, -0.3);
        assert!((positive + negative).abs() < 0.05, "asymmetric crush: {positive} vs {negative}");
    }

    #[test]
    fn the_limiter_holds_the_ceiling() {
        let (mut engine, input, fx, output) =
            effect_chain(ModuleKind::Limiter, LimiterModule::MIX + 1);
        engine.set_param(fx, LimiterModule::MIX, 1.0);
        engine.set_param(fx, LimiterModule::CEILING_DB, -6.0);
        settle(&mut engine);
        let loud = steady(&mut engine, input, output, 1.0).abs();
        // -6 dB is about 0.5; allow the follower's own slop.
        assert!(loud < 0.75, "the limiter let {loud} through a -6 dB ceiling");
    }

    #[test]
    fn the_eq_is_flat_at_zero_gain_and_not_at_others() {
        let (mut engine, input, fx, output) = effect_chain(ModuleKind::Eq, EqModule::MIX + 1);
        engine.set_param(fx, EqModule::MIX, 1.0);
        engine.set_param(fx, EqModule::LOW_FREQUENCY, 200.0);
        engine.set_param(fx, EqModule::MID_FREQUENCY, 1_000.0);
        engine.set_param(fx, EqModule::MID_Q, 1.0);
        engine.set_param(fx, EqModule::HIGH_FREQUENCY, 6_000.0);
        settle(&mut engine);
        let flat = steady(&mut engine, input, output, 0.5);
        assert!((flat - 0.5).abs() < 1e-2, "a flat EQ coloured DC: {flat}");
        engine.set_param(fx, EqModule::LOW_GAIN_DB, 12.0);
        settle(&mut engine);
        let boosted = steady(&mut engine, input, output, 0.5);
        assert!(boosted > flat, "a low shelf boost did nothing at DC");
    }

    /// A sampler wired to the output, with one second of DC loaded in slot 0
    /// and every note pointed at it.
    fn sampler_chain(kind: ModuleKind, level: usize) -> (Engine, u32, u32) {
        let mut engine = Engine::new(RATE);
        engine.samples_mut().allocate(0, 1, RATE as usize, RATE);
        for slot in engine.samples_mut().get_mut(0).unwrap().data_mut() {
            *slot = 1.0;
        }
        let player = engine.add(kind.build());
        let output = engine.add(ModuleKind::AudioOutput.build());
        engine.connect(PortRef { module: player, port: 0 }, PortRef { module: output, port: 0 });
        engine.set_param(player, level, 1.0);
        engine.set_sample_slot(player, 60, 0);
        (engine, player, output)
    }

    fn render_peak(engine: &mut Engine, output: u32, samples: usize) -> f32 {
        let mut peak = 0.0f32;
        for _ in 0..samples {
            engine.process();
            peak = peak.max(engine.output_of(output, 0).abs());
        }
        peak
    }

    #[test]
    fn every_sampler_is_reachable_by_its_wire_number() {
        assert_eq!(ModuleKind::from_u32(13), Some(ModuleKind::Percussion));
        assert_eq!(ModuleKind::from_u32(14), Some(ModuleKind::Looper));
        assert_eq!(ModuleKind::from_u32(15), Some(ModuleKind::Granular));
    }

    #[test]
    fn the_samplers_are_sources_with_no_audio_input() {
        for kind in [ModuleKind::Percussion, ModuleKind::Looper, ModuleKind::Granular] {
            let module = kind.build();
            assert_eq!(module.input_count(), 0, "{kind:?} claimed an audio input");
            assert_eq!(module.output_count(), 1);
        }
    }

    #[test]
    fn percussion_plays_the_sample_a_note_points_at() {
        let (mut engine, _, output) = sampler_chain(ModuleKind::Percussion, PercussionModule::LEVEL);
        engine.set_param(0, PercussionModule::MIX, 1.0);
        settle(&mut engine);
        assert!(render_peak(&mut engine, output, 100) < 1e-6, "it sounded before any note");
        engine.note_on(0, 60, 1.0, 0.0);
        assert!(render_peak(&mut engine, output, 2_000) > 0.1, "the note never sounded");
    }

    #[test]
    fn percussion_ignores_a_note_with_no_sample_behind_it() {
        // Half a kit filled is normal; the empty slots must do nothing.
        let (mut engine, _, output) = sampler_chain(ModuleKind::Percussion, PercussionModule::LEVEL);
        engine.set_param(0, PercussionModule::MIX, 1.0);
        settle(&mut engine);
        engine.note_on(0, 61, 1.0, 0.0);
        assert!(render_peak(&mut engine, output, 2_000) < 1e-6);
    }

    #[test]
    fn a_percussion_hit_survives_its_note_off() {
        // The whole difference between a kit and a keyboard.
        let (mut engine, _, output) = sampler_chain(ModuleKind::Percussion, PercussionModule::LEVEL);
        engine.set_param(0, PercussionModule::MIX, 1.0);
        settle(&mut engine);
        engine.note_on(0, 60, 1.0, 0.0);
        render_peak(&mut engine, output, 100);
        engine.note_off(0, 60);
        assert!(render_peak(&mut engine, output, 2_000) > 0.1, "the hit was cut off");
    }

    #[test]
    fn the_looper_loops_past_the_end_of_its_sample() {
        let (mut engine, _, output) = sampler_chain(ModuleKind::Looper, LooperModule::LEVEL);
        engine.set_param(0, LooperModule::MIX, 1.0);
        engine.set_param(0, LooperModule::LOOP, 1.0);
        engine.set_param(0, LooperModule::LOOP_END, 0.05);
        engine.set_param(0, LooperModule::RATE, 1.0);
        settle(&mut engine);
        engine.note_on(0, 60, 1.0, 0.0);
        // Well past the 50 ms loop; a one-shot would have finished long ago.
        render_peak(&mut engine, output, (RATE * 0.3) as usize);
        assert!(render_peak(&mut engine, output, 2_000) > 0.1, "the loop ended");
    }

    /// The looper built in its time-stretch variant, otherwise as above.
    fn stretch_chain() -> (Engine, u32, u32) {
        let mut engine = Engine::new(RATE);
        engine.samples_mut().allocate(0, 1, RATE as usize, RATE);
        for slot in engine.samples_mut().get_mut(0).unwrap().data_mut() {
            *slot = 1.0;
        }
        let player = engine.add(ModuleKind::Looper.build_variant_at(1, RATE));
        let output = engine.add(ModuleKind::AudioOutput.build());
        engine.connect(PortRef { module: player, port: 0 }, PortRef { module: output, port: 0 });
        engine.set_param(player, LooperModule::LEVEL, 1.0);
        engine.set_param(player, LooperModule::MIX, 1.0);
        engine.set_sample_slot(player, 60, 0);
        (engine, player, output)
    }

    #[test]
    fn the_time_stretch_looper_sounds() {
        // Variant 1 runs a grain cloud instead of the sampler. Before this it
        // ran the sampler either way, so the mode was a control that did
        // nothing on this backend while working on the other.
        let (mut engine, _, output) = stretch_chain();
        settle(&mut engine);
        engine.note_on(0, 60, 1.0, 0.0);
        assert!(render_peak(&mut engine, output, (RATE * 0.2) as usize) > 0.05);
    }

    #[test]
    fn the_time_stretch_looper_is_silent_without_a_sample() {
        let mut engine = Engine::new(RATE);
        let player = engine.add(ModuleKind::Looper.build_variant_at(1, RATE));
        let output = engine.add(ModuleKind::AudioOutput.build());
        engine.connect(PortRef { module: player, port: 0 }, PortRef { module: output, port: 0 });
        engine.set_param(player, LooperModule::LEVEL, 1.0);
        engine.set_param(player, LooperModule::MIX, 1.0);
        settle(&mut engine);
        engine.note_on(0, 60, 1.0, 0.0);
        assert_eq!(render_peak(&mut engine, output, 2_000), 0.0);
    }

    #[test]
    fn the_two_looper_engines_are_genuinely_different() {
        // Both make sound from the same DC sample, so the cheap assertion is
        // that they are not the same object twice: the plain engine plays one
        // continuous read, the cloud overlaps windowed grains, so their output
        // over the same span cannot match sample for sample.
        let (mut plain, _, plain_out) = sampler_chain(ModuleKind::Looper, LooperModule::LEVEL);
        plain.set_param(0, LooperModule::MIX, 1.0);
        settle(&mut plain);
        plain.note_on(0, 60, 1.0, 0.0);

        let (mut stretched, _, stretch_out) = stretch_chain();
        settle(&mut stretched);
        stretched.note_on(0, 60, 1.0, 0.0);

        let mut differed = false;
        for _ in 0..4_000 {
            plain.process();
            stretched.process();
            if (plain.output_of(plain_out, 0) - stretched.output_of(stretch_out, 0)).abs() > 1e-4 {
                differed = true;
            }
        }
        assert!(differed, "the stretch variant rendered the same as the plain one");
    }

    #[test]
    fn granular_needs_a_source_and_then_makes_a_cloud() {
        let mut engine = Engine::new(RATE);
        engine.samples_mut().allocate(0, 1, RATE as usize, RATE);
        for slot in engine.samples_mut().get_mut(0).unwrap().data_mut() {
            *slot = 1.0;
        }
        let cloud = engine.add(ModuleKind::Granular.build());
        let output = engine.add(ModuleKind::AudioOutput.build());
        engine.connect(PortRef { module: cloud, port: 0 }, PortRef { module: output, port: 0 });
        engine.set_param(cloud, GranularModule::LEVEL, 1.0);
        engine.set_param(cloud, GranularModule::MIX, 1.0);
        settle(&mut engine);
        // No source assigned yet: silence rather than a fault.
        assert!(render_peak(&mut engine, output, 1_000) < 1e-6);

        engine.set_sample_slot(cloud, 0, 0);
        assert!(render_peak(&mut engine, output, (RATE * 0.3) as usize) > 0.1, "no grains");
    }

    #[test]
    fn every_sampler_stays_finite_under_a_hostile_sweep() {
        for (kind, level, count) in [
            (ModuleKind::Percussion, PercussionModule::LEVEL, PercussionModule::PARAM_COUNT),
            (ModuleKind::Looper, LooperModule::LEVEL, LooperModule::PARAM_COUNT),
            (ModuleKind::Granular, GranularModule::LEVEL, GranularModule::PARAM_COUNT),
        ] {
            let (mut engine, player, output) = sampler_chain(kind, level);
            engine.set_sample_slot(player, 0, 0);
            for step in 0..=6 {
                let t = step as f32 / 6.0;
                for index in 0..count {
                    engine.set_param(player, index, t * 4.0 - 2.0);
                }
                engine.set_param(player, level, 1.0);
                engine.note_on(player, 60, 1.0, 0.0);
                for _ in 0..1_500 {
                    engine.process();
                    let out = engine.output_of(output, 0);
                    assert!(out.is_finite(), "{kind:?} non-finite at step {step}");
                    assert!(out.abs() < 50.0, "{kind:?} ran away at step {step}: {out}");
                }
            }
        }
    }

    #[test]
    fn blackhole_is_reachable_by_its_wire_number() {
        // The discriminant is the protocol; if this drifts, every saved patch
        // naming module 4 becomes a different module.
        assert_eq!(ModuleKind::from_u32(4), Some(ModuleKind::Blackhole));
        assert_eq!(ModuleKind::Blackhole as u32, 4);
    }

    #[test]
    fn blackhole_exposes_every_parameter_its_descriptor_declares() {
        let module = ModuleKind::Blackhole.build();
        assert_eq!(module.param_count(), BlackholeVerb::PARAM_COUNT);
        assert_eq!(module.input_count(), 1);
        assert_eq!(module.output_count(), 1);
    }

    #[test]
    fn blackhole_rings_on_after_the_input_stops() {
        // The whole point of a reverb: energy outlives its cause.
        let (mut engine, input, verb, output) = verb_chain();
        engine.set_param(verb, BlackholeVerb::MIX, 1.0);
        settle(&mut engine);
        assert!(tail_peak(&mut engine, input, output, 8_000) > 1e-5);
    }

    #[test]
    fn blackhole_passes_the_dry_signal_through_at_zero_mix() {
        let (mut engine, input, verb, output) = verb_chain();
        engine.set_param(verb, BlackholeVerb::MIX, 0.0);
        settle(&mut engine);
        assert!((steady(&mut engine, input, output, 0.5) - 0.5).abs() < 1e-3);
    }

    #[test]
    fn blackhole_mute_silences_wet_and_dry_alike() {
        let (mut engine, input, verb, output) = verb_chain();
        engine.set_param(verb, BlackholeVerb::MIX, 0.5);
        engine.set_param(verb, BlackholeVerb::MUTE, 1.0);
        settle(&mut engine);
        assert_eq!(steady(&mut engine, input, output, 1.0), 0.0);
    }

    #[test]
    fn blackhole_freeze_closes_the_input_but_keeps_the_tail() {
        // `[DOC]` Freeze "sets the reverberation time to infinite, and does not
        // allow incoming signal". Energy already inside must survive; new
        // energy must not get in.
        let (mut engine, input, verb, output) = verb_chain();
        engine.set_param(verb, BlackholeVerb::MIX, 1.0);
        settle(&mut engine);
        let before = tail_peak(&mut engine, input, output, 4_000);
        engine.set_param(verb, BlackholeVerb::FEEDBACK, 1.0);
        settle(&mut engine);
        let frozen = tail_peak(&mut engine, input, output, 4_000);
        assert!(before > 1e-5);
        assert!(frozen > 1e-6);
    }

    #[test]
    fn blackhole_stays_finite_across_its_whole_parameter_range() {
        // A feedback network is the one place a bad coefficient does not merely
        // sound wrong — it runs away and takes the output with it.
        let (mut engine, input, verb, output) = verb_chain();
        engine.set_param(verb, BlackholeVerb::MIX, 1.0);
        for step in 0..=10 {
            let t = step as f32 / 10.0;
            engine.set_param(verb, BlackholeVerb::GRAVITY, t * 2.0 - 1.0);
            engine.set_param(verb, BlackholeVerb::SIZE, t);
            engine.set_param(verb, BlackholeVerb::FEEDBACK, t);
            engine.set_param(verb, BlackholeVerb::RESONANCE, t);
            engine.set_param(verb, BlackholeVerb::LOW_DB, t * 12.0);
            engine.set_param(verb, BlackholeVerb::HIGH_DB, t * 12.0);
            engine.set_param(input, HostInput::SAMPLE, 1.0);
            for _ in 0..2_000 {
                engine.process();
                let sample = engine.output_of(output, 0);
                assert!(sample.is_finite(), "non-finite output at gravity step {step}");
                assert!(sample.abs() < 50.0, "runaway output {sample} at step {step}");
            }
        }
    }

    #[test]
    fn blackhole_reset_clears_the_tail() {
        let (mut engine, input, verb, output) = verb_chain();
        engine.set_param(verb, BlackholeVerb::MIX, 1.0);
        settle(&mut engine);
        // Long enough for a default-sized tank to have said anything at all:
        // Size defaults to 0.5, which is a ~2x scale, so the first energy out
        // of the network arrives well after a couple of thousand samples.
        assert!(tail_peak(&mut engine, input, output, 8_000) > 1e-5);
        engine.reset();
        engine.set_param(verb, BlackholeVerb::LEVEL, 1.0);
        engine.set_param(verb, BlackholeVerb::MIX, 1.0);
        settle(&mut engine);
        engine.set_param(input, HostInput::SAMPLE, 0.0);
        engine.process();
        assert!(engine.output_of(output, 0).abs() < 1e-6);
    }

    /// Long enough for any 5 ms ramp to have arrived.
    fn settle(engine: &mut Engine) {
        for _ in 0..(RATE * PARAM_RAMP_SEC * 3.0) as usize {
            engine.process();
        }
    }

    /// input → gain → output, with the shell level opened up.
    fn chain() -> (Engine, u32, u32, u32) {
        let mut engine = Engine::new(RATE);
        let input = engine.add(ModuleKind::HostInput.build());
        let gain = engine.add(ModuleKind::Gain.build());
        let output = engine.add(ModuleKind::AudioOutput.build());
        engine.connect(PortRef { module: input, port: 0 }, PortRef { module: gain, port: 0 });
        engine.connect(PortRef { module: gain, port: 0 }, PortRef { module: output, port: 0 });
        engine.set_param(gain, Gain::LEVEL, 1.0);
        (engine, input, gain, output)
    }

    /// Feed a constant and read what comes out, once everything has settled.
    fn steady(engine: &mut Engine, input: u32, output: u32, value: f32) -> f32 {
        for _ in 0..(RATE * PARAM_RAMP_SEC * 3.0) as usize {
            engine.set_param(input, HostInput::SAMPLE, value);
            engine.process();
        }
        engine.output_of(output, 0)
    }

    #[test]
    fn unity_gain_passes_the_signal_through() {
        let (mut engine, input, _, output) = chain();
        assert!((steady(&mut engine, input, output, 0.5) - 0.5).abs() < 1e-6);
    }

    #[test]
    fn gain_scales_the_signal() {
        let (mut engine, input, gain, output) = chain();
        engine.set_param(gain, Gain::GAIN, 0.5);
        assert!((steady(&mut engine, input, output, 0.8) - 0.4).abs() < 1e-6);
    }

    #[test]
    fn gain_ramps_rather_than_jumping() {
        // The zipper test. A step from 0 to 2 must not appear at the output in
        // one sample, or a knob drag is a burst of clicks.
        let (mut engine, input, gain, output) = chain();
        engine.set_param(gain, Gain::GAIN, 0.0);
        steady(&mut engine, input, output, 1.0);

        engine.set_param(gain, Gain::GAIN, 2.0);
        engine.set_param(input, HostInput::SAMPLE, 1.0);
        engine.process();
        engine.process();
        let immediately = engine.output_of(output, 0);
        assert!(immediately < 0.1, "jumped to {immediately} in two samples");

        assert!((steady(&mut engine, input, output, 1.0) - 2.0).abs() < 1e-6);
    }

    #[test]
    fn gain_clamps_to_its_declared_range() {
        // A hand-edited document can carry anything; the descriptor says 0..2.
        let (mut engine, input, gain, output) = chain();
        engine.set_param(gain, Gain::GAIN, 1000.0);
        assert!((steady(&mut engine, input, output, 1.0) - Gain::MAX_GAIN).abs() < 1e-6);

        engine.set_param(gain, Gain::GAIN, -1000.0);
        assert!(steady(&mut engine, input, output, 1.0).abs() < 1e-6);
    }

    #[test]
    fn mute_silences_without_disturbing_the_level_underneath() {
        let (mut engine, input, gain, output) = chain();
        engine.set_param(gain, Gain::GAIN, 0.75);
        let before = steady(&mut engine, input, output, 1.0);

        engine.set_param(gain, Gain::MUTE, 1.0);
        assert_eq!(steady(&mut engine, input, output, 1.0), 0.0);

        // Unmuting returns to exactly where it was, with no re-ramp.
        engine.set_param(gain, Gain::MUTE, 0.0);
        assert!((steady(&mut engine, input, output, 1.0) - before).abs() < 1e-6);
    }

    #[test]
    fn a_module_arrives_silent_so_the_adapter_can_fade_it_in() {
        // Matches the TypeScript contract that every effect is built at level 0
        // and faded up, so a rebuild never pops.
        let mut engine = Engine::new(RATE);
        let input = engine.add(ModuleKind::HostInput.build());
        let gain = engine.add(ModuleKind::Gain.build());
        let output = engine.add(ModuleKind::AudioOutput.build());
        engine.connect(PortRef { module: input, port: 0 }, PortRef { module: gain, port: 0 });
        engine.connect(PortRef { module: gain, port: 0 }, PortRef { module: output, port: 0 });
        assert_eq!(steady(&mut engine, input, output, 1.0), 0.0);
    }

    #[test]
    fn a_non_finite_input_sample_never_reaches_the_graph() {
        // The host writes this parameter every sample from a buffer it does not
        // own. One NaN would otherwise poison every smoother downstream for ever.
        let (mut engine, input, _, output) = chain();
        settle(&mut engine);
        engine.set_param(input, HostInput::SAMPLE, f32::NAN);
        engine.process();
        engine.process();
        assert!(engine.output_of(output, 0).is_finite());
    }

    #[test]
    fn output_level_scales_the_master() {
        let (mut engine, input, _, output) = chain();
        engine.set_param(output, AudioOutput::LEVEL, 0.25);
        assert!((steady(&mut engine, input, output, 1.0) - 0.25).abs() < 1e-6);
    }

    #[test]
    fn kinds_round_trip_through_the_wire_protocol() {
        for (value, kind) in [
            (0, ModuleKind::HostInput),
            (1, ModuleKind::Gain),
            (2, ModuleKind::AudioOutput),
            (3, ModuleKind::Synth),
        ] {
            assert_eq!(ModuleKind::from_u32(value), Some(kind));
            assert_eq!(kind as u32, value);
        }
        assert_eq!(ModuleKind::from_u32(99), None);
    }

    #[test]
    fn every_kind_builds_with_the_port_count_the_host_expects() {
        for value in 0..=3 {
            let kind = ModuleKind::from_u32(value).expect("kind");
            let module = kind.build();
            assert!(module.output_count() >= 1, "{kind:?} produces nothing");
            assert!(module.input_count() <= 1, "{kind:?} has more inputs than the shim wires");
        }
    }

    // ---- the synth ---------------------------------------------------------

    /// A synth wired to an output, with the fade handles opened.
    fn synth_rack() -> (Engine, u32, u32) {
        let mut engine = Engine::new(RATE);
        let synth = engine.add(ModuleKind::Synth.build_at(RATE));
        let output = engine.add(ModuleKind::AudioOutput.build());
        engine.connect(PortRef { module: synth, port: 0 }, PortRef { module: output, port: 0 });
        engine.set_param(synth, Synth::LEVEL, 1.0);
        (engine, synth, output)
    }

    fn play(engine: &mut Engine, output: u32, seconds: f32) -> Vec<f32> {
        (0..(seconds * RATE) as usize)
            .map(|_| {
                engine.process();
                engine.output_of(output, 0)
            })
            .collect()
    }

    fn loudest(samples: &[f32]) -> f32 {
        samples.iter().fold(0.0f32, |acc, v| acc.max(v.abs()))
    }

    #[test]
    fn a_synth_is_silent_until_a_note_arrives() {
        let (mut engine, _, output) = synth_rack();
        assert_eq!(loudest(&play(&mut engine, output, 0.05)), 0.0);
    }

    #[test]
    fn a_note_sent_by_id_reaches_the_synth_and_sounds() {
        // Notes travel by module id rather than down a cable: an event is not a
        // signal, and giving it a port would mean a second kind of cable.
        let (mut engine, synth, output) = synth_rack();
        engine.note_on(synth, 60, 1.0, 0.0);
        assert!(loudest(&play(&mut engine, output, 0.1)) > 0.01);
    }

    #[test]
    fn releasing_the_note_eventually_silences_it() {
        let (mut engine, synth, output) = synth_rack();
        engine.set_param(synth, Synth::AMP_RELEASE, 0.05);
        engine.note_on(synth, 60, 1.0, 0.0);
        play(&mut engine, output, 0.1);
        engine.note_off(synth, 60);
        play(&mut engine, output, 0.3);
        assert_eq!(loudest(&play(&mut engine, output, 0.05)), 0.0);
    }

    #[test]
    fn a_note_for_a_module_that_is_not_there_is_ignored() {
        // A note arriving for a module the host just deleted is a race, not a
        // bug, and must not take down the audio callback.
        let (mut engine, _, output) = synth_rack();
        engine.note_on(9_999, 60, 1.0, 0.0);
        engine.note_off(9_999, 60);
        engine.all_notes_off(9_999);
        engine.set_modulation(9_999, 0, 0, 1.0);
        assert!(play(&mut engine, output, 0.02).iter().all(|v| v.is_finite()));
    }

    #[test]
    fn the_synth_is_stereo() {
        // §9.7 lists pan as a modulation destination, which needs two outputs
        // to mean anything.
        let module = ModuleKind::Synth.build();
        assert_eq!(module.output_count(), 2);

        let (mut engine, synth, _) = synth_rack();
        engine.set_param(synth, Synth::PAN, -1.0);
        engine.note_on(synth, 60, 1.0, 0.0);
        let mut left = 0.0f32;
        let mut right = 0.0f32;
        for _ in 0..(RATE * 0.1) as usize {
            engine.process();
            left = left.max(engine.output_of(synth, 0).abs());
            right = right.max(engine.output_of(synth, 1).abs());
        }
        assert!(right < left * 0.05, "hard left leaked right: {left} vs {right}");
    }

    #[test]
    fn a_synth_arrives_silent_so_the_adapter_can_fade_it_in() {
        let mut engine = Engine::new(RATE);
        let synth = engine.add(ModuleKind::Synth.build_at(RATE));
        let output = engine.add(ModuleKind::AudioOutput.build());
        engine.connect(PortRef { module: synth, port: 0 }, PortRef { module: output, port: 0 });
        engine.note_on(synth, 60, 1.0, 0.0);
        assert_eq!(loudest(&play(&mut engine, output, 0.05)), 0.0);
    }

    #[test]
    fn every_parameter_reads_its_declared_default() {
        // The defect this prevents is the one param_default was added for: a
        // cutoff that defaults to zero is an instrument that builds, wires,
        // takes notes and makes no sound.
        let synth = Synth::new(RATE);
        assert_eq!(synth.param_default(Synth::LEVEL), 0.0);
        assert!(synth.param_default(Synth::CUTOFF) > 1_000.0);
        assert!(synth.param_default(Synth::VOLUME) > 0.0);
        assert_eq!(synth.param_default(Synth::OSC_BASE + Synth::OSC_LEVEL), 1.0);
        // The second and third oscillators are off, so a fresh synth is one
        // clean voice rather than three stacked at unity.
        assert_eq!(synth.param_default(Synth::OSC_BASE + Synth::OSC_STRIDE + Synth::OSC_LEVEL), 0.0);
        assert!(synth.param_default(Synth::LFO_BASE + Synth::LFO_RATE) > 0.0);
    }

    #[test]
    fn an_lfo_routed_to_volume_is_audible_through_the_engine() {
        // The whole point of the stage, asserted at the level the host sees:
        // a routing set over the ABI moves the sound.
        let (mut engine, synth, output) = synth_rack();
        engine.set_param(synth, Synth::LFO_BASE + Synth::LFO_RATE, 8.0);
        engine.set_modulation(synth, ModSource::Lfo1 as u32, ModDest::Volume as u32, 1.0);
        engine.note_on(synth, 60, 1.0, 0.0);
        let samples = play(&mut engine, output, 0.4);

        let chunk = (RATE / 8.0 / 4.0) as usize;
        let a = loudest(&samples[chunk..chunk * 2]);
        let b = loudest(&samples[chunk * 2..chunk * 3]);
        assert!((a - b).abs() > 0.01, "no tremolo through the engine: {a} and {b}");
    }

    #[test]
    fn an_unknown_modulation_route_is_dropped_rather_than_thrown_on() {
        let (mut engine, synth, output) = synth_rack();
        engine.set_modulation(synth, 99, 99, 1.0);
        engine.note_on(synth, 60, 1.0, 0.0);
        assert!(play(&mut engine, output, 0.05).iter().all(|v| v.is_finite()));
    }

    #[test]
    fn the_synth_plays_a_chord() {
        let (mut engine, synth, output) = synth_rack();
        for note in [60, 64, 67] {
            engine.note_on(synth, note, 0.8, 0.0);
        }
        let chord = loudest(&play(&mut engine, output, 0.1));

        let (mut single, one, out) = synth_rack();
        single.note_on(one, 60, 0.8, 0.0);
        let alone = loudest(&play(&mut single, out, 0.1));
        assert!(chord > alone, "three notes were no louder than one");
    }

    #[test]
    fn the_filter_parameters_change_the_sound_at_the_indices_the_host_sends() {
        // The other half of a bug worth naming. The host's table said
        // `filter-cutoff` where the document said `cutoff`, so the whole filter
        // section was inert on this backend — and nothing here could see it,
        // because no test asserted that these *indices* do anything.
        //
        // `engineBridge.test.ts` now pins the name to the index; this pins the
        // index to the sound. Neither half is enough on its own.
        let render = |cutoff: f32| {
            let (mut engine, synth, output) = synth_rack();
            engine.set_param(synth, Synth::CUTOFF, cutoff);
            engine.note_on(synth, 60, 1.0, 0.0);
            play(&mut engine, output, 0.2)
        };
        let dark = crate::testutil::brightness(&render(300.0));
        let bright = crate::testutil::brightness(&render(12_000.0));
        assert!(bright > dark * 1.5, "cutoff did not open the filter: {dark} → {bright}");
    }

    #[test]
    fn resonance_changes_the_sound_at_the_index_the_host_sends() {
        let peak_at = |resonance: f32| {
            let (mut engine, synth, output) = synth_rack();
            engine.set_param(synth, Synth::CUTOFF, 800.0);
            engine.set_param(synth, Synth::RESONANCE, resonance);
            engine.note_on(synth, 60, 1.0, 0.0);
            loudest(&play(&mut engine, output, 0.2))
        };
        let flat = peak_at(0.0);
        let peaky = peak_at(0.9);
        assert!((peaky - flat).abs() > 1e-3, "resonance did nothing: {flat} vs {peaky}");
    }

    #[test]
    fn polyphony_at_the_hosts_index_limits_the_voices() {
        // `max-voices` had no index at all, so the control was inert.
        // Rendered once before the notes: every parameter is read inside
        // `process`, so a limit set and then immediately played against would
        // still be the previous one.
        let chord_peak = |voices: f32| {
            let (mut engine, synth, output) = synth_rack();
            engine.set_param(synth, Synth::MAX_VOICES, voices);
            play(&mut engine, output, 0.01);
            for note in [60, 64, 67] {
                engine.note_on(synth, note, 1.0, 0.0);
            }
            loudest(&play(&mut engine, output, 0.1))
        };
        let one = chord_peak(1.0);
        let three = chord_peak(16.0);
        assert!(three > one, "a chord limited to one voice was no quieter: {one} vs {three}");
    }

    #[test]
    fn a_notes_detune_reaches_the_oscillator_through_the_engine() {
        // The end of the wire the scale quantisers feed. Every microtonal scale
        // in the library arrives as a MIDI note plus a remainder, and if the
        // remainder stops anywhere between the ABI and the oscillator, all
        // eighty-one of them sound like 12-TET.
        let crossings = |cents: f32| {
            let (mut engine, synth, output) = synth_rack();
            engine.note_on(synth, 60, 1.0, cents);
            let rendered = play(&mut engine, output, 0.3);
            rendered.windows(2).filter(|p| p[0] <= 0.0 && p[1] > 0.0).count()
        };
        let plain = crossings(0.0);
        let octave_up = crossings(1200.0);
        assert!(plain > 0, "the plain note made no sound to compare against");
        let ratio = octave_up as f32 / plain as f32;
        assert!((ratio - 2.0).abs() < 0.2, "expected 2x, got {ratio}");
    }

    #[test]
    fn all_notes_off_reaches_the_bank() {
        let (mut engine, synth, output) = synth_rack();
        engine.set_param(synth, Synth::AMP_RELEASE, 0.02);
        for note in [60, 64, 67] {
            engine.note_on(synth, note, 1.0, 0.0);
        }
        play(&mut engine, output, 0.05);
        engine.all_notes_off(synth);
        play(&mut engine, output, 0.2);
        assert_eq!(loudest(&play(&mut engine, output, 0.05)), 0.0);
    }

    #[test]
    fn a_nonsense_wave_index_falls_back_rather_than_going_silent() {
        // Wave is an enum crossing a float ABI. A document written by a newer
        // build must not silence the instrument.
        let (mut engine, synth, output) = synth_rack();
        engine.set_param(synth, Synth::OSC_BASE + Synth::OSC_WAVE, 99.0);
        engine.note_on(synth, 60, 1.0, 0.0);
        assert!(loudest(&play(&mut engine, output, 0.1)) > 0.01);
    }

    #[test]
    fn reset_clears_state_without_discarding_what_the_performer_set() {
        // A reset is a transport sync, not a preset recall. It drops in-flight
        // ramps and buffered state; a knob the performer moved has to survive
        // one, or every sync would snap the mix back to its defaults.
        let (mut engine, input, gain, output) = chain();
        engine.set_param(gain, Gain::GAIN, 2.0);
        let before = steady(&mut engine, input, output, 1.0);
        assert!((before - 2.0).abs() < 1e-6);

        engine.reset();
        assert_eq!(engine.frame(), 0);
        assert!((steady(&mut engine, input, output, 1.0) - before).abs() < 1e-6);
    }

    #[test]
    fn a_parameter_nobody_writes_still_reads_its_declared_default() {
        // The defect this prevents: params start at zero, so a gain of 1 that
        // the host never wrote would be silence — correct code, no sound, and
        // nothing in any single-module test able to see it.
        let gain = Gain::default();
        assert_eq!(gain.param_default(Gain::GAIN), Gain::DEFAULT_GAIN);
        assert_eq!(gain.param_default(Gain::LEVEL), 0.0);
        assert_eq!(AudioOutput::default().param_default(AudioOutput::LEVEL), 1.0);

        // And the engine actually seeds from it rather than zeroing.
        let mut engine = Engine::new(RATE);
        let input = engine.add(ModuleKind::HostInput.build());
        let unwritten = engine.add(ModuleKind::Gain.build());
        let output = engine.add(ModuleKind::AudioOutput.build());
        engine.connect(PortRef { module: input, port: 0 }, PortRef { module: unwritten, port: 0 });
        engine.connect(PortRef { module: unwritten, port: 0 }, PortRef { module: output, port: 0 });
        // Only the fade handle is opened; gain is never written.
        engine.set_param(unwritten, Gain::LEVEL, 1.0);
        assert!((steady(&mut engine, input, output, 0.3) - 0.3).abs() < 1e-6);
    }
}
