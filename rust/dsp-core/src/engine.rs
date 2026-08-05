//! The rack engine.
//!
//! Modelled on VCV Rack's central insight, which is not that it is native but
//! that **one engine owns the sample clock and runs the whole graph at sample
//! rate.** Everything else follows from that: sample-accurate CV, feedback that
//! actually works, modules that can be written by anyone, and a UI that cannot
//! affect timing because it is not in the path.
//!
//! # Cables carry one sample of delay
//!
//! The single most important decision here, and it is stolen wholesale.
//!
//! A patch graph with a cycle in it has no valid topological order, so the
//! usual answer is to detect cycles and reject them — which is what
//! `validateGraph.ts` does today, and why the delay module needs a
//! `feedbackBreak` descriptor to be allowed through. That is a lot of machinery
//! to express "this patch is illegal", and it forbids patches that musicians
//! reasonably want.
//!
//! Instead: **every cable is a one-sample delay.** A reader sees what a writer
//! produced on the previous sample. Cycles become legal and cost 20.8 µs of
//! phase at 48 kHz, which is inaudible and is anyway what a physical patch cable
//! does. Topological sort disappears. `feedbackBreak` disappears. Cycle
//! detection disappears. Modules stop caring whether they are in a loop.
//!
//! The price is that evaluation order within one sample no longer matters, so
//! there is no "correct" order to compute — every module reads last sample's
//! outputs and writes this sample's. That is a feature: it makes the engine
//! trivially parallelisable later, because no module depends on another having
//! run first.
//!
//! # What is *not* here
//!
//! Event generation. The musical planner is not real-time safe and should never
//! be made so — it allocates, it backtracks, it thinks. It belongs on a
//! dedicated non-UI thread running ahead of the clock, writing timestamped
//! events into [`EventQueue`], which the audio thread drains sample-accurately.
//! That is what lets `NATIVE_PLUGIN_SPEC.md` §4 hold: identical musical
//! decisions in standalone and plugin, and no coupling to frame rate.

use crate::samples::SampleBank;
use crate::clamp;

/// How many channels one port carries.
///
/// Sixteen, following VCV, because it is the width that makes polyphony free:
/// a mono cable is a poly cable with one channel, so no module needs two code
/// paths and no patch needs an adapter.
pub const MAX_CHANNELS: usize = 16;

/// A port's payload for one sample.
#[derive(Clone, Copy, Debug)]
pub struct Frame {
    pub values: [f32; MAX_CHANNELS],
    pub channels: u8,
}

impl Default for Frame {
    fn default() -> Self {
        Self { values: [0.0; MAX_CHANNELS], channels: 1 }
    }
}

impl Frame {
    pub fn mono(value: f32) -> Self {
        let mut f = Self::default();
        f.values[0] = value;
        f
    }

    #[inline(always)]
    pub fn get(&self, channel: usize) -> f32 {
        if channel < self.channels as usize {
            self.values[channel]
        } else {
            0.0
        }
    }

    #[inline(always)]
    pub fn set(&mut self, channel: usize, value: f32) {
        if channel < MAX_CHANNELS {
            self.values[channel] = value;
            if channel as u8 >= self.channels {
                self.channels = channel as u8 + 1;
            }
        }
    }

    /// Sum of all active channels — what a mono destination hears.
    #[inline(always)]
    pub fn sum(&self) -> f32 {
        let mut total = 0.0;
        for i in 0..self.channels as usize {
            total += self.values[i];
        }
        total
    }

    pub fn clear(&mut self) {
        self.values = [0.0; MAX_CHANNELS];
        self.channels = 1;
    }
}

/// A module's identity in the graph.
pub type ModuleId = u32;

/// One end of a cable.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct PortRef {
    pub module: ModuleId,
    pub port: u8,
}

/// A patch cable. Carries exactly one sample of delay — see the module docs.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Cable {
    pub from: PortRef,
    pub to: PortRef,
}

/// What a module is told on every sample.
// Not Copy or Debug any more: it borrows the sample bank, which is neither.
#[derive(Clone)]
pub struct ProcessContext<'a> {
    /// Audio the host transferred in, for the modules that read samples.
    ///
    /// Borrowed rather than owned by each module because a sample outlives any
    /// one node and several may read the same one — a percussion kit and a
    /// looper pointed at the same file should not hold two copies of it in
    /// linear memory.
    pub samples: &'a SampleBank,
    pub sample_rate: f32,
    pub sample_time: f32,
    /// Samples since the transport started. Wraps after ~27 hours at 48 kHz;
    /// anything needing longer should track its own `f64` position.
    pub frame: u64,
}

/// Everything a module may touch during `process`.
pub struct Ports<'a> {
    pub inputs: &'a [Frame],
    pub outputs: &'a mut [Frame],
    pub params: &'a [f32],
}

impl Ports<'_> {
    #[inline(always)]
    pub fn input(&self, port: usize) -> f32 {
        self.inputs.get(port).map(|f| f.sum()).unwrap_or(0.0)
    }

    #[inline(always)]
    pub fn output(&mut self, port: usize, value: f32) {
        if let Some(frame) = self.outputs.get_mut(port) {
            *frame = Frame::mono(value);
        }
    }

    #[inline(always)]
    pub fn param(&self, index: usize) -> f32 {
        self.params.get(index).copied().unwrap_or(0.0)
    }
}

/// A rack module.
///
/// One method on the hot path, taking one sample. Deliberately not a block
/// interface: a block API would make the one-sample cable delay impossible and
/// would push every module into managing its own sub-block bookkeeping.
pub trait Module: Send {
    fn process(&mut self, ctx: &ProcessContext, ports: &mut Ports);

    /// Rebuild anything derived from the sample rate. Called off the audio
    /// thread, never during `process`.
    fn set_sample_rate(&mut self, _sample_rate: f32) {}

    /// Return to a known state without reallocating.
    fn reset(&mut self) {}

    fn input_count(&self) -> usize;
    fn output_count(&self) -> usize;
    fn param_count(&self) -> usize {
        0
    }

    /// A note arrived for this module.
    ///
    /// Default no-op, because most modules are effects and an effect that had
    /// to acknowledge notes would be carrying an empty method for the benefit
    /// of the two instruments that care. Notes reach a module by id rather than
    /// down a cable: an event is not a signal, and giving it a port would mean
    /// inventing a second kind of cable that carries neither audio nor CV.
    /// Point one of this module's slots at a sample in the bank.
    ///
    /// A separate call rather than a parameter for the same reason
    /// `set_modulation` is: a percussion kit has sixteen note-to-sample
    /// assignments, and sixteen parameters carrying opaque ids would bury the
    /// handful of controls a person actually turns. Default no-op, because
    /// most modules are not samplers.
    fn set_sample_slot(&mut self, _slot: u32, _sample: u32) {}

    fn note_on(&mut self, _note: u8, _velocity: f32) {}
    fn note_off(&mut self, _note: u8) {}
    fn all_notes_off(&mut self) {}

    /// Set one cell of this module's modulation matrix, if it has one.
    ///
    /// Deliberately not a parameter index: an 8 × 12 matrix is 96 cells, and
    /// exposing them as parameters would bury the twenty controls a person
    /// actually turns among ninety-six they never touch directly.
    fn set_modulation(&mut self, _source: u32, _dest: u32, _amount: f32) {}

    /// What a parameter reads before the host has written it.
    ///
    /// Without this every parameter starts at zero, so a module whose resting
    /// value is anything else — a gain of 1, a filter wide open — is silent or
    /// wrong until someone remembers to write it. That is the same class of
    /// defect as an instrument with no processor: correct everywhere, audible
    /// nowhere. The module owns its own defaults instead.
    fn param_default(&self, _index: usize) -> f32 {
        0.0
    }
}

struct Slot {
    module: Box<dyn Module>,
    inputs: Vec<Frame>,
    outputs: Vec<Frame>,
    /// Last sample's outputs — what readers see. This is the cable delay.
    previous: Vec<Frame>,
    params: Vec<f32>,
    bypassed: bool,
}

/// The rack.
///
/// Owns every module and cable, and advances all of them one sample at a time.
pub struct Engine {
    slots: Vec<Option<Slot>>,
    cables: Vec<Cable>,
    sample_rate: f32,
    frame: u64,
    /// Owned by the engine so `process` can lend it to every module without
    /// the host having to pass it in on the audio path.
    samples: SampleBank,
}

impl Engine {
    pub fn new(sample_rate: f32) -> Self {
        Self {
            slots: Vec::new(),
            cables: Vec::new(),
            sample_rate,
            frame: 0,
            samples: SampleBank::new(),
        }
    }

    /// The sample bank, for the host to load audio into off the audio thread.
    pub fn samples(&self) -> &SampleBank {
        &self.samples
    }

    pub fn samples_mut(&mut self) -> &mut SampleBank {
        &mut self.samples
    }

    pub fn sample_rate(&self) -> f32 {
        self.sample_rate
    }

    pub fn frame(&self) -> u64 {
        self.frame
    }

    pub fn module_count(&self) -> usize {
        self.slots.iter().filter(|s| s.is_some()).count()
    }

    pub fn cable_count(&self) -> usize {
        self.cables.len()
    }

    /// Add a module. Off the audio thread — this allocates.
    pub fn add(&mut self, mut module: Box<dyn Module>) -> ModuleId {
        module.set_sample_rate(self.sample_rate);
        let inputs = vec![Frame::default(); module.input_count()];
        let outputs = vec![Frame::default(); module.output_count()];
        let previous = outputs.clone();
        let params: Vec<f32> = (0..module.param_count()).map(|i| module.param_default(i)).collect();
        let slot = Slot { module, inputs, outputs, previous, params, bypassed: false };

        if let Some(index) = self.slots.iter().position(|s| s.is_none()) {
            self.slots[index] = Some(slot);
            index as ModuleId
        } else {
            self.slots.push(Some(slot));
            (self.slots.len() - 1) as ModuleId
        }
    }

    /// Remove a module and every cable touching it.
    pub fn remove(&mut self, id: ModuleId) -> bool {
        let index = id as usize;
        if self.slots.get(index).map(|s| s.is_none()).unwrap_or(true) {
            return false;
        }
        self.slots[index] = None;
        self.cables.retain(|c| c.from.module != id && c.to.module != id);
        true
    }

    /// Patch two ports together.
    ///
    /// **Cycles are legal.** No sort, no validation, no rejection — the cable's
    /// one-sample delay makes any graph computable. An input may be fed by
    /// several cables; they sum, which is what a mult does and what every mixer
    /// input expects.
    pub fn connect(&mut self, from: PortRef, to: PortRef) -> bool {
        let valid_from = self
            .slot(from.module)
            .map(|s| (from.port as usize) < s.outputs.len())
            .unwrap_or(false);
        let valid_to =
            self.slot(to.module).map(|s| (to.port as usize) < s.inputs.len()).unwrap_or(false);
        if !valid_from || !valid_to {
            return false;
        }
        let cable = Cable { from, to };
        if self.cables.contains(&cable) {
            return false;
        }
        self.cables.push(cable);
        true
    }

    pub fn disconnect(&mut self, from: PortRef, to: PortRef) -> bool {
        let before = self.cables.len();
        self.cables.retain(|c| !(c.from == from && c.to == to));
        self.cables.len() != before
    }

    pub fn set_param(&mut self, id: ModuleId, index: usize, value: f32) {
        if let Some(slot) = self.slot_mut(id) {
            if let Some(p) = slot.params.get_mut(index) {
                *p = value;
            }
        }
    }

    /// Point one of a module's sample slots at audio in the bank. Ignored by
    /// modules that are not samplers, and by ids that no longer exist.
    pub fn set_sample_slot(&mut self, id: ModuleId, slot: u32, sample: u32) {
        if let Some(target) = self.slot_mut(id) {
            target.module.set_sample_slot(slot, sample);
        }
    }

    /// Send a note to one module. Unknown ids are ignored rather than a panic —
    /// a note arriving for a module the host just deleted is a race, not a bug.
    pub fn note_on(&mut self, id: ModuleId, note: u8, velocity: f32) {
        if let Some(slot) = self.slot_mut(id) {
            slot.module.note_on(note, velocity);
        }
    }

    pub fn note_off(&mut self, id: ModuleId, note: u8) {
        if let Some(slot) = self.slot_mut(id) {
            slot.module.note_off(note);
        }
    }

    pub fn all_notes_off(&mut self, id: ModuleId) {
        if let Some(slot) = self.slot_mut(id) {
            slot.module.all_notes_off();
        }
    }

    pub fn set_modulation(&mut self, id: ModuleId, source: u32, dest: u32, amount: f32) {
        if let Some(slot) = self.slot_mut(id) {
            slot.module.set_modulation(source, dest, amount);
        }
    }

    pub fn set_bypassed(&mut self, id: ModuleId, bypassed: bool) {
        if let Some(slot) = self.slot_mut(id) {
            slot.bypassed = bypassed;
        }
    }

    pub fn set_sample_rate(&mut self, sample_rate: f32) {
        self.sample_rate = clamp(sample_rate, 8_000.0, 768_000.0);
        for slot in self.slots.iter_mut().flatten() {
            slot.module.set_sample_rate(self.sample_rate);
            slot.module.reset();
        }
    }

    pub fn reset(&mut self) {
        self.frame = 0;
        for slot in self.slots.iter_mut().flatten() {
            slot.module.reset();
            for f in slot.inputs.iter_mut() {
                f.clear();
            }
            for f in slot.outputs.iter_mut() {
                f.clear();
            }
            for f in slot.previous.iter_mut() {
                f.clear();
            }
        }
    }

    /// Read a module's output from the last completed sample.
    pub fn output_of(&self, id: ModuleId, port: usize) -> f32 {
        self.slot(id).and_then(|s| s.previous.get(port)).map(|f| f.sum()).unwrap_or(0.0)
    }

    /// Advance the whole rack by one sample.
    ///
    /// Three passes, and the order of the first two is the cable delay:
    ///
    /// 1. Clear inputs, then sum every cable's *previous* output into its
    ///    destination. Nothing reads a value produced this sample.
    /// 2. Run every module. Order is irrelevant — no module can observe
    ///    another's result until the next sample.
    /// 3. Publish this sample's outputs as next sample's `previous`.
    ///
    /// Allocation-free. Every buffer was sized in `add`.
    pub fn process(&mut self) {
        let ctx = ProcessContext {
            samples: &self.samples,
            sample_rate: self.sample_rate,
            sample_time: 1.0 / self.sample_rate,
            frame: self.frame,
        };

        for slot in self.slots.iter_mut().flatten() {
            for frame in slot.inputs.iter_mut() {
                frame.clear();
            }
        }

        for cable in &self.cables {
            let value = self
                .slots
                .get(cable.from.module as usize)
                .and_then(|s| s.as_ref())
                .and_then(|s| s.previous.get(cable.from.port as usize))
                .map(|f| f.sum())
                .unwrap_or(0.0);

            if let Some(Some(dest)) = self.slots.get_mut(cable.to.module as usize) {
                if let Some(frame) = dest.inputs.get_mut(cable.to.port as usize) {
                    // Summing, not replacing: several cables into one input is
                    // a mix, which is what every hardware mixer input does.
                    let existing = frame.values[0];
                    frame.values[0] = existing + value;
                }
            }
        }

        for slot in self.slots.iter_mut().flatten() {
            if slot.bypassed {
                for frame in slot.outputs.iter_mut() {
                    frame.clear();
                }
                continue;
            }
            let mut ports =
                Ports { inputs: &slot.inputs, outputs: &mut slot.outputs, params: &slot.params };
            slot.module.process(&ctx, &mut ports);
        }

        for slot in self.slots.iter_mut().flatten() {
            slot.previous.copy_from_slice(&slot.outputs);
        }

        self.frame = self.frame.wrapping_add(1);
    }

    fn slot(&self, id: ModuleId) -> Option<&Slot> {
        self.slots.get(id as usize).and_then(|s| s.as_ref())
    }

    fn slot_mut(&mut self, id: ModuleId) -> Option<&mut Slot> {
        self.slots.get_mut(id as usize).and_then(|s| s.as_mut())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Constant(f32);
    impl Module for Constant {
        fn process(&mut self, _ctx: &ProcessContext, ports: &mut Ports) {
            ports.output(0, self.0);
        }
        fn input_count(&self) -> usize {
            0
        }
        fn output_count(&self) -> usize {
            1
        }
    }

    struct Gain;
    impl Module for Gain {
        fn process(&mut self, _ctx: &ProcessContext, ports: &mut Ports) {
            let x = ports.input(0);
            let g = ports.param(0);
            ports.output(0, x * g);
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
    }

    /// Feeds back on itself: out = in + 1. Legal only because cables delay.
    struct Accumulate;
    impl Module for Accumulate {
        fn process(&mut self, _ctx: &ProcessContext, ports: &mut Ports) {
            ports.output(0, ports.input(0) + 1.0);
        }
        fn input_count(&self) -> usize {
            1
        }
        fn output_count(&self) -> usize {
            1
        }
    }

    const SR: f32 = 48_000.0;

    #[test]
    fn a_signal_takes_one_sample_per_cable() {
        // The cable delay, stated as a test. Two cables means two samples of
        // latency, and that is the contract every module can rely on.
        let mut engine = Engine::new(SR);
        let source = engine.add(Box::new(Constant(1.0)));
        let gain = engine.add(Box::new(Gain));
        engine.set_param(gain, 0, 2.0);
        assert!(engine.connect(PortRef { module: source, port: 0 }, PortRef { module: gain, port: 0 }));

        engine.process();
        assert_eq!(engine.output_of(gain, 0), 0.0, "gain saw the source too early");
        engine.process();
        assert_eq!(engine.output_of(gain, 0), 2.0);
    }

    #[test]
    fn cycles_are_legal_and_advance_one_step_per_sample() {
        // The patch the current TypeScript validator rejects outright. Here it
        // is an accumulator, which is exactly what a musician would expect from
        // patching an output back to its own input.
        let mut engine = Engine::new(SR);
        let acc = engine.add(Box::new(Accumulate));
        assert!(engine.connect(PortRef { module: acc, port: 0 }, PortRef { module: acc, port: 0 }));

        for expected in 1..=5 {
            engine.process();
            assert_eq!(engine.output_of(acc, 0), expected as f32);
        }
    }

    #[test]
    fn several_cables_into_one_input_sum() {
        let mut engine = Engine::new(SR);
        let a = engine.add(Box::new(Constant(1.0)));
        let b = engine.add(Box::new(Constant(2.0)));
        let gain = engine.add(Box::new(Gain));
        engine.set_param(gain, 0, 1.0);
        engine.connect(PortRef { module: a, port: 0 }, PortRef { module: gain, port: 0 });
        engine.connect(PortRef { module: b, port: 0 }, PortRef { module: gain, port: 0 });

        engine.process();
        engine.process();
        assert_eq!(engine.output_of(gain, 0), 3.0);
    }

    #[test]
    fn evaluation_order_does_not_change_the_result() {
        // The property that makes the engine parallelisable later: no module can
        // observe another's result within a sample, so there is no order to get
        // wrong.
        let build = |reverse: bool| {
            let mut engine = Engine::new(SR);
            let ids: Vec<ModuleId> = if reverse {
                let g = engine.add(Box::new(Gain));
                let s = engine.add(Box::new(Constant(3.0)));
                vec![s, g]
            } else {
                let s = engine.add(Box::new(Constant(3.0)));
                let g = engine.add(Box::new(Gain));
                vec![s, g]
            };
            engine.set_param(ids[1], 0, 2.0);
            engine.connect(
                PortRef { module: ids[0], port: 0 },
                PortRef { module: ids[1], port: 0 },
            );
            for _ in 0..4 {
                engine.process();
            }
            engine.output_of(ids[1], 0)
        };
        assert_eq!(build(false), build(true));
    }

    #[test]
    fn removing_a_module_takes_its_cables_with_it() {
        let mut engine = Engine::new(SR);
        let a = engine.add(Box::new(Constant(1.0)));
        let b = engine.add(Box::new(Gain));
        engine.connect(PortRef { module: a, port: 0 }, PortRef { module: b, port: 0 });
        assert_eq!(engine.cable_count(), 1);
        assert!(engine.remove(a));
        assert_eq!(engine.cable_count(), 0, "a dangling cable survived");
        // And the engine keeps running rather than panicking on the hole.
        engine.process();
        assert_eq!(engine.module_count(), 1);
    }

    #[test]
    fn removed_slots_are_reused() {
        let mut engine = Engine::new(SR);
        let a = engine.add(Box::new(Constant(1.0)));
        engine.remove(a);
        let b = engine.add(Box::new(Constant(2.0)));
        assert_eq!(a, b, "slot was not reused; ids would grow without bound");
    }

    #[test]
    fn connecting_a_port_that_does_not_exist_fails_quietly() {
        let mut engine = Engine::new(SR);
        let a = engine.add(Box::new(Constant(1.0)));
        // Constant has no inputs and one output.
        assert!(!engine.connect(PortRef { module: a, port: 9 }, PortRef { module: a, port: 0 }));
        assert!(!engine.connect(PortRef { module: a, port: 0 }, PortRef { module: 99, port: 0 }));
        assert_eq!(engine.cable_count(), 0);
        engine.process();
    }

    #[test]
    fn duplicate_cables_are_rejected() {
        let mut engine = Engine::new(SR);
        let a = engine.add(Box::new(Constant(1.0)));
        let b = engine.add(Box::new(Gain));
        let (from, to) = (PortRef { module: a, port: 0 }, PortRef { module: b, port: 0 });
        assert!(engine.connect(from, to));
        assert!(!engine.connect(from, to), "the same cable was patched twice");
        assert_eq!(engine.cable_count(), 1);
    }

    #[test]
    fn bypass_silences_a_module_without_unpatching_it() {
        let mut engine = Engine::new(SR);
        let a = engine.add(Box::new(Constant(1.0)));
        let g = engine.add(Box::new(Gain));
        engine.set_param(g, 0, 1.0);
        engine.connect(PortRef { module: a, port: 0 }, PortRef { module: g, port: 0 });
        for _ in 0..3 {
            engine.process();
        }
        assert_eq!(engine.output_of(g, 0), 1.0);

        engine.set_bypassed(g, true);
        engine.process();
        assert_eq!(engine.output_of(g, 0), 0.0);
        // Still patched, so lifting the bypass restores it with no re-patching.
        engine.set_bypassed(g, false);
        engine.process();
        assert_eq!(engine.output_of(g, 0), 1.0);
    }

    #[test]
    fn a_large_rack_stays_finite() {
        // 128 modules chained, with the tail patched back to the head. The kind
        // of patch that has no topological order at all.
        let mut engine = Engine::new(SR);
        let source = engine.add(Box::new(Constant(0.1)));
        let mut previous = source;
        let mut gains = Vec::new();
        for _ in 0..128 {
            let g = engine.add(Box::new(Gain));
            engine.set_param(g, 0, 0.5);
            engine.connect(
                PortRef { module: previous, port: 0 },
                PortRef { module: g, port: 0 },
            );
            gains.push(g);
            previous = g;
        }
        engine.connect(
            PortRef { module: previous, port: 0 },
            PortRef { module: gains[0], port: 0 },
        );
        for _ in 0..10_000 {
            engine.process();
        }
        for g in gains {
            assert!(engine.output_of(g, 0).is_finite());
        }
    }

    #[test]
    fn frame_advances_once_per_sample() {
        let mut engine = Engine::new(SR);
        assert_eq!(engine.frame(), 0);
        for expected in 1..=100u64 {
            engine.process();
            assert_eq!(engine.frame(), expected);
        }
        engine.reset();
        assert_eq!(engine.frame(), 0);
    }

    #[test]
    fn frames_carry_polyphony() {
        let mut f = Frame::default();
        f.set(0, 1.0);
        f.set(3, 2.0);
        assert_eq!(f.channels, 4);
        assert_eq!(f.get(3), 2.0);
        // Reading past the active channels is zero, not a panic — an unpatched
        // voice is silence.
        assert_eq!(f.get(15), 0.0);
        assert_eq!(f.get(99), 0.0);
        assert_eq!(f.sum(), 3.0);
    }
}
