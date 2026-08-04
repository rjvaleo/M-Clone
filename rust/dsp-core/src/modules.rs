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

use crate::bank::{VoiceBank, DEFAULT_POLYPHONY};
use crate::engine::{Module, Ports, ProcessContext};
use crate::lfo::{LfoShape, LfoTrigger};
use crate::modmatrix::{ModDest, ModSource};
use crate::osc::Wave;
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

    pub const PARAM_COUNT: usize = 41;

    pub fn new(sample_rate: f32) -> Self {
        Self {
            bank: VoiceBank::new(sample_rate, DEFAULT_POLYPHONY, 0x1D_1AB),
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

    fn note_on(&mut self, note: u8, velocity: f32) {
        self.bank.note_on(note, velocity);
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
}

impl ModuleKind {
    pub fn from_u32(value: u32) -> Option<Self> {
        match value {
            0 => Some(Self::HostInput),
            1 => Some(Self::Gain),
            2 => Some(Self::AudioOutput),
            3 => Some(Self::Synth),
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
        match self {
            Self::HostInput => Box::<HostInput>::default(),
            Self::Gain => Box::<Gain>::default(),
            Self::AudioOutput => Box::<AudioOutput>::default(),
            Self::Synth => Box::new(Synth::new(sample_rate)),
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
        engine.note_on(synth, 60, 1.0);
        assert!(loudest(&play(&mut engine, output, 0.1)) > 0.01);
    }

    #[test]
    fn releasing_the_note_eventually_silences_it() {
        let (mut engine, synth, output) = synth_rack();
        engine.set_param(synth, Synth::AMP_RELEASE, 0.05);
        engine.note_on(synth, 60, 1.0);
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
        engine.note_on(9_999, 60, 1.0);
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
        engine.note_on(synth, 60, 1.0);
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
        engine.note_on(synth, 60, 1.0);
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
        engine.note_on(synth, 60, 1.0);
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
        engine.note_on(synth, 60, 1.0);
        assert!(play(&mut engine, output, 0.05).iter().all(|v| v.is_finite()));
    }

    #[test]
    fn the_synth_plays_a_chord() {
        let (mut engine, synth, output) = synth_rack();
        for note in [60, 64, 67] {
            engine.note_on(synth, note, 0.8);
        }
        let chord = loudest(&play(&mut engine, output, 0.1));

        let (mut single, one, out) = synth_rack();
        single.note_on(one, 60, 0.8);
        let alone = loudest(&play(&mut single, out, 0.1));
        assert!(chord > alone, "three notes were no louder than one");
    }

    #[test]
    fn all_notes_off_reaches_the_bank() {
        let (mut engine, synth, output) = synth_rack();
        engine.set_param(synth, Synth::AMP_RELEASE, 0.02);
        for note in [60, 64, 67] {
            engine.note_on(synth, note, 1.0);
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
        engine.note_on(synth, 60, 1.0);
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
