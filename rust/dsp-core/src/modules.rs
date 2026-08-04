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

use crate::engine::{Module, Ports, ProcessContext};
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
}

impl ModuleKind {
    pub fn from_u32(value: u32) -> Option<Self> {
        match value {
            0 => Some(Self::HostInput),
            1 => Some(Self::Gain),
            2 => Some(Self::AudioOutput),
            _ => None,
        }
    }

    pub fn build(self) -> Box<dyn Module> {
        match self {
            Self::HostInput => Box::<HostInput>::default(),
            Self::Gain => Box::<Gain>::default(),
            Self::AudioOutput => Box::<AudioOutput>::default(),
        }
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
        ] {
            assert_eq!(ModuleKind::from_u32(value), Some(kind));
            assert_eq!(kind as u32, value);
        }
        assert_eq!(ModuleKind::from_u32(99), None);
    }

    #[test]
    fn every_kind_builds_with_the_port_count_the_host_expects() {
        for value in 0..=2 {
            let kind = ModuleKind::from_u32(value).expect("kind");
            let module = kind.build();
            assert!(module.output_count() >= 1, "{kind:?} produces nothing");
            assert!(module.input_count() <= 1, "{kind:?} has more inputs than the shim wires");
        }
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
