//! The AudioWorklet's view of the rack.
//!
//! Deliberately the thinnest thing that works: every function here either moves
//! a number across the ABI or forwards one call to `dsp_core::engine`. No
//! decisions, no DSP, no state beyond the engine itself and two scratch
//! buffers — because this is the one layer that cannot be unit tested from
//! Rust, so anything living here is untested by construction.
//!
//! # Why `static mut`
//!
//! An `AudioWorkletGlobalScope` is single-threaded and each worklet gets its own
//! WASM instance, so there is exactly one caller and no concurrency to protect
//! against. A `Mutex` would be a lock on the audio thread — the thing every
//! real-time guide tells you never to do — to guard against a race that the
//! platform makes impossible.
//!
//! # The one-sample latency
//!
//! Every cable carries one sample of delay (see `engine.rs`), so a signal
//! through *n* modules emerges *n* samples later. At 48 kHz a three-module chain
//! is 63 µs. That is the price of legal feedback and arbitrary evaluation order,
//! and it is well under the threshold where anything is audible.

use dsp_core::engine::{Engine, PortRef};
use dsp_core::modules::{HostInput, ModuleKind};
use dsp_core::samples::SampleBank;

/// One render quantum. Web Audio has always handed a worklet exactly this many
/// frames and the spec fixes it, so the buffers can be sized once.
const QUANTUM: usize = 128;

/// Returned where a `u32` is really a module id and the call failed.
const NO_MODULE: u32 = u32::MAX;

static mut ENGINE: Option<Engine> = None;

static mut INPUT: [f32; QUANTUM] = [0.0; QUANTUM];
/// Interleaved-by-channel: the left quantum, then the right.
///
/// Planar rather than interleaved because that is the shape an `AudioWorklet`
/// hands out — `outputs[0][0]` and `outputs[0][1]` are separate arrays — so the
/// host copies each half with one `set` and no stride.
static mut OUTPUT: [f32; QUANTUM * 2] = [0.0; QUANTUM * 2];

/// Where the host's audio enters and leaves. Set by `set_io`.
static mut INPUT_MODULE: u32 = NO_MODULE;
static mut OUTPUT_MODULE: u32 = NO_MODULE;

// One caller, one thread, one instance — see the module docs. The lint exists
// for the multi-threaded case this platform cannot reach.
#[allow(static_mut_refs)]
fn engine() -> Option<&'static mut Engine> {
    unsafe { ENGINE.as_mut() }
}

/// The bank lives inside the engine, so `process` can lend it to modules
/// without the host passing it in on the audio path.
fn samples() -> Option<&'static mut SampleBank> {
    engine().map(|engine| engine.samples_mut())
}

#[allow(static_mut_refs)]
fn input_buffer() -> &'static [f32; QUANTUM] {
    unsafe { &INPUT }
}

#[allow(static_mut_refs)]
fn output_buffer() -> &'static mut [f32; QUANTUM * 2] {
    unsafe { &mut OUTPUT }
}

/// Build the rack. Safe to call again — it replaces whatever was there.
#[no_mangle]
pub extern "C" fn init(sample_rate: f32) {
    let rate = if sample_rate.is_finite() && sample_rate > 0.0 { sample_rate } else { 48_000.0 };
    unsafe {
        ENGINE = Some(Engine::new(rate));
        INPUT_MODULE = NO_MODULE;
        OUTPUT_MODULE = NO_MODULE;
    }
}

/// Add a module of `kind`, returning its id — or `NO_MODULE` if the host named
/// a kind this build does not have, which is what a version skew looks like.
#[no_mangle]
pub extern "C" fn add_module(kind: u32) -> u32 {
    let Some(kind) = ModuleKind::from_u32(kind) else { return NO_MODULE };
    match engine() {
        // Built at the engine's rate rather than a default one, so a module
        // holding envelopes or delay lines never has a second initialisation
        // path to get wrong.
        Some(engine) => {
            let rate = engine.sample_rate();
            engine.add(kind.build_at(rate))
        }
        None => NO_MODULE,
    }
}

/// Add a module with a structural variant — the DP/4's algorithm, Non Lin's
/// flavour. Kinds with no variants ignore it, so this is a superset of
/// `add_module` rather than a replacement for it.
#[no_mangle]
pub extern "C" fn add_module_variant(kind: u32, variant: u32) -> u32 {
    let Some(kind) = ModuleKind::from_u32(kind) else { return NO_MODULE };
    let Some(engine) = engine() else { return NO_MODULE };
    let rate = engine.sample_rate();
    engine.add(kind.build_variant_at(variant, rate))
}

#[no_mangle]
pub extern "C" fn remove_module(id: u32) -> u32 {
    u32::from(engine().map(|e| e.remove(id)).unwrap_or(false))
}

#[no_mangle]
pub extern "C" fn connect(from_module: u32, from_port: u32, to_module: u32, to_port: u32) -> u32 {
    let from = PortRef { module: from_module, port: from_port as u8 };
    let to = PortRef { module: to_module, port: to_port as u8 };
    u32::from(engine().map(|e| e.connect(from, to)).unwrap_or(false))
}

#[no_mangle]
pub extern "C" fn disconnect(from_module: u32, from_port: u32, to_module: u32, to_port: u32) -> u32 {
    let from = PortRef { module: from_module, port: from_port as u8 };
    let to = PortRef { module: to_module, port: to_port as u8 };
    u32::from(engine().map(|e| e.disconnect(from, to)).unwrap_or(false))
}

/// Drive `param` of `to_module` from an output: `value + source × scale`, held
/// inside `min..=max`. A second call for the same source and parameter
/// replaces the first.
#[no_mangle]
pub extern "C" fn connect_param(
    from_module: u32,
    from_port: u32,
    to_module: u32,
    param: u32,
    scale: f32,
    min: f32,
    max: f32,
) -> u32 {
    let from = PortRef { module: from_module, port: from_port as u8 };
    u32::from(engine().map(|e| e.connect_param(from, to_module, param as usize, scale, min, max)).unwrap_or(false))
}

#[no_mangle]
pub extern "C" fn disconnect_param(from_module: u32, from_port: u32, to_module: u32, param: u32) -> u32 {
    let from = PortRef { module: from_module, port: from_port as u8 };
    u32::from(engine().map(|e| e.disconnect_param(from, to_module, param as usize)).unwrap_or(false))
}

/// A module's last output on one port, for a face to draw — an LFO's value.
#[no_mangle]
pub extern "C" fn module_output(module: u32, port: u32) -> f32 {
    engine().map(|e| e.output_of(module, port as usize)).unwrap_or(0.0)
}

/// What a module reports about itself — an LFO's phase — or NaN.
#[no_mangle]
pub extern "C" fn module_telemetry(module: u32) -> f32 {
    engine().map(|e| e.telemetry_of(module)).unwrap_or(f32::NAN)
}

/// Keep a module's input and output peaks for a meter (`on` 1), or stop (0).
/// 1 if the module exists.
#[no_mangle]
pub extern "C" fn set_metered(module: u32, on: u32) -> u32 {
    u32::from(engine().map(|e| e.set_metered(module, on != 0)).unwrap_or(false))
}

/// A metered module's loudest input (`side` 0) or output (1) since its levels
/// were last cleared; NaN for a module that is not metered, or another side.
#[no_mangle]
pub extern "C" fn module_level(module: u32, side: u32) -> f32 {
    match engine().and_then(|e| e.levels_of(module)) {
        Some(levels) if side == 0 => levels.input,
        Some(levels) if side == 1 => levels.output,
        _ => f32::NAN,
    }
}

/// Start a metered module's next interval from silence, once its levels are read.
#[no_mangle]
pub extern "C" fn clear_levels(module: u32) {
    if let Some(engine) = engine() {
        engine.take_levels(module);
    }
}

#[no_mangle]
pub extern "C" fn set_param(module: u32, index: u32, value: f32) {
    // A non-finite parameter is dropped rather than clamped: it means the host
    // computed something wrong, and guessing a substitute hides that.
    if !value.is_finite() {
        return;
    }
    if let Some(engine) = engine() {
        engine.set_param(module, index as usize, value);
    }
}

/// Notes reach a module by id rather than down a cable.
///
/// An event is not a signal: giving notes a port would mean a second kind of
/// cable carrying neither audio nor CV, and every module in the rack would have
/// to know about it. Only instruments implement these; everything else inherits
/// a no-op from the trait.
#[no_mangle]
pub extern "C" fn note_on(module: u32, note: u32, velocity: f32, detune_cents: f32) {
    if !velocity.is_finite() || note > 127 {
        return;
    }
    // Unlike velocity, a non-finite detune is dropped to zero rather than
    // dropping the note: the pitch is a refinement of a note that was already
    // asked for, and silence is the worse of the two failures.
    let cents = if detune_cents.is_finite() { detune_cents } else { 0.0 };
    if let Some(engine) = engine() {
        engine.note_on(module, note as u8, velocity, cents);
    }
}

/// A sequenced note that knows its step — its slot in the sequence, in
/// seconds — which the synth's pulse LFOs advance by. The step never sets the
/// note's length: it holds until `note_off`.
#[no_mangle]
pub extern "C" fn note_on_with_step(module: u32, note: u32, velocity: f32, detune_cents: f32, step_sec: f32) {
    if !velocity.is_finite() || note > 127 {
        return;
    }
    let cents = if detune_cents.is_finite() { detune_cents } else { 0.0 };
    if let Some(engine) = engine() {
        if step_sec.is_finite() && step_sec > 0.0 {
            engine.note_on_with_step(module, note as u8, velocity, cents, step_sec);
        } else {
            engine.note_on(module, note as u8, velocity, cents);
        }
    }
}

#[no_mangle]
pub extern "C" fn note_off(module: u32, note: u32) {
    if note > 127 {
        return;
    }
    if let Some(engine) = engine() {
        engine.note_off(module, note as u8);
    }
}

#[no_mangle]
pub extern "C" fn all_notes_off(module: u32) {
    if let Some(engine) = engine() {
        engine.all_notes_off(module);
    }
}

/// Set one cell of a module's modulation matrix.
///
/// Not a parameter index: 96 cells would bury the twenty controls a person
/// actually turns among ninety-six they never touch directly.
#[no_mangle]
pub extern "C" fn set_modulation(module: u32, source: u32, dest: u32, amount: f32) {
    if !amount.is_finite() {
        return;
    }
    if let Some(engine) = engine() {
        engine.set_modulation(module, source, dest, amount);
    }
}

#[no_mangle]
pub extern "C" fn set_bypassed(module: u32, bypassed: u32) {
    if let Some(engine) = engine() {
        engine.set_bypassed(module, bypassed != 0);
    }
}

/// Name the modules the host reads and writes through.
#[no_mangle]
pub extern "C" fn set_io(input_module: u32, output_module: u32) {
    unsafe {
        INPUT_MODULE = input_module;
        OUTPUT_MODULE = output_module;
    }
}

#[no_mangle]
pub extern "C" fn reset() {
    if let Some(engine) = engine() {
        engine.reset();
    }
}

/// Where the host writes one quantum of input.
#[no_mangle]
pub extern "C" fn input_ptr() -> *mut f32 {
    &raw mut INPUT as *mut f32
}

/// Where the host reads one quantum of output: `QUANTUM` left samples followed
/// by `QUANTUM` right samples.
#[no_mangle]
pub extern "C" fn output_ptr() -> *mut f32 {
    &raw mut OUTPUT as *mut f32
}

#[no_mangle]
pub extern "C" fn quantum_size() -> u32 {
    QUANTUM as u32
}

#[no_mangle]
pub extern "C" fn module_count() -> u32 {
    engine().map(|e| e.module_count() as u32).unwrap_or(0)
}

#[no_mangle]
pub extern "C" fn cable_count() -> u32 {
    engine().map(|e| e.cable_count() as u32).unwrap_or(0)
}

/// Advance the rack by one render quantum.
///
/// The whole hot path: push a sample in through the `HostInput` parameter,
/// advance every module by one sample, take what the output module produced.
/// Allocation-free — every buffer was sized before this was ever called.
#[no_mangle]
pub extern "C" fn process_quantum() {
    process_range(0, QUANTUM as u32);
}

/// Advance the rack by part of a quantum, writing to `output[start..start+len]`.
///
/// This is what makes note timing sample-accurate. A quantum is 128 frames —
/// 2.7 ms at 48 kHz — and a note that may only start on a quantum boundary
/// inherits every bit of that as jitter, which is audible on anything with a
/// sharp attack and is exactly what a sequencer must not do. Rendering a
/// quantum as several ranges lets the host fire each note at the frame the
/// score asked for and render around it.
///
/// Not a separate render path: `process_quantum` *is* this call with the whole
/// buffer, so there is no second copy of the hot loop to keep in step.
///
/// A range outside the buffer renders nothing rather than clamping. Clamping
/// would turn an arithmetic mistake in the host's scheduler into audio that is
/// subtly in the wrong place, which is far harder to see than silence.
#[no_mangle]
pub extern "C" fn process_range(start: u32, len: u32) {
    let (start, len) = (start as usize, len as usize);
    let Some(end) = start.checked_add(len).filter(|end| *end <= QUANTUM) else {
        return;
    };

    let (input_module, output_module) = unsafe { (INPUT_MODULE, OUTPUT_MODULE) };
    let input = input_buffer();
    let output = output_buffer();

    let Some(engine) = engine() else {
        output[start..end].fill(0.0);
        output[QUANTUM + start..QUANTUM + end].fill(0.0);
        return;
    };

    for i in start..end {
        if input_module != NO_MODULE {
            engine.set_param(input_module, HostInput::SAMPLE, input[i]);
        }
        engine.process();
        let (left, right) = if output_module != NO_MODULE {
            (engine.output_of(output_module, 0), engine.output_of(output_module, 1))
        } else {
            (0.0, 0.0)
        };
        output[i] = left;
        output[QUANTUM + i] = right;
    }
}

// ---- samples ---------------------------------------------------------------
//
// Transfer is two calls, not one: the host allocates, then writes straight into
// the pointer it gets back. Passing the audio *through* the ABI would mean
// copying it twice — once into WASM's memory to hand over and once into the
// bank — for buffers that run to megabytes.
//
// **Allocating can grow WASM linear memory, which detaches every existing
// JavaScript view into it.** The host must therefore re-read `memory.buffer`
// *after* `sample_alloc` returns and before writing. That is not a subtlety it
// can discover safely: a stale view throws on write, or worse, writes into a
// buffer nothing is reading any more.

/// Point one of a module's sample slots at audio in the bank.
///
/// For a percussion kit `slot` is the MIDI note; for the looper and the grain
/// cloud there is one source and the slot is ignored.
#[no_mangle]
pub extern "C" fn set_sample_slot(module: u32, slot: u32, sample: u32) {
    if let Some(engine) = engine() {
        engine.set_sample_slot(module, slot, sample);
    }
}

/// A kit pad's gain, pan (−1 to +1) and choke group. The group arrives as a
/// float, the one number type the bridge sends, and is taken whole.
#[no_mangle]
pub extern "C" fn set_slot_shape(module: u32, slot: u32, gain: f32, pan: f32, choke_group: f32) {
    if let Some(engine) = engine() {
        let group = if choke_group.is_finite() { choke_group.trunc() as i32 } else { 0 };
        engine.set_slot_shape(module, slot, gain, pan, group);
    }
}

/// Reserve zeroed room for a sample. Returns 1 on success, 0 on a shape that
/// cannot hold audio. Replaces whatever the id already held.
#[no_mangle]
pub extern "C" fn sample_alloc(id: u32, channels: u32, frames: u32, sample_rate: f32) -> u32 {
    match samples() {
        Some(bank) => u32::from(bank.allocate(id, channels as usize, frames as usize, sample_rate)),
        None => 0,
    }
}

/// Where to write a sample's audio, channel-major. Null if the id holds
/// nothing — the host must check, because writing to null is not recoverable.
#[no_mangle]
pub extern "C" fn sample_ptr(id: u32) -> *mut f32 {
    match samples().and_then(|bank| bank.get_mut(id)) {
        Some(sample) => sample.data_mut().as_mut_ptr(),
        None => core::ptr::null_mut(),
    }
}

/// How many floats `sample_ptr` points at: channels x frames.
#[no_mangle]
pub extern "C" fn sample_len(id: u32) -> u32 {
    match samples().and_then(|bank| bank.get(id)) {
        Some(sample) => (sample.channels() * sample.frames()) as u32,
        None => 0,
    }
}

/// Release a sample. Freeing an id that holds nothing is not an error.
#[no_mangle]
pub extern "C" fn sample_free(id: u32) {
    if let Some(bank) = samples() {
        bank.free(id);
    }
}

/// How many samples the rack is holding, for the host to assert against.
#[no_mangle]
pub extern "C" fn sample_count() -> u32 {
    samples().map_or(0, |bank| bank.len() as u32)
}

// ---- slow builds, made off the audio thread --------------------------------
//
// The Grain Engine's transient map and the hybrid's separation take seconds on
// a long file. In the worklet they are asked for (`set_deferred_builds`), made
// by a second instance of this module in a worker, and handed back here. The
// worker uses the reading half; the worklet the asking and accepting halves.

static mut MAP_SCRATCH: Vec<f64> = Vec::new();
static mut PARTS_SCRATCH: [Vec<f32>; 3] = [Vec::new(), Vec::new(), Vec::new()];

#[allow(static_mut_refs)]
fn map_scratch() -> &'static mut Vec<f64> {
    unsafe { &mut MAP_SCRATCH }
}

#[allow(static_mut_refs)]
fn parts_scratch(which: u32) -> Option<&'static mut Vec<f32>> {
    unsafe { PARTS_SCRATCH.get_mut(which as usize) }
}

/// Ask for this module's slow builds rather than making them on this thread.
#[no_mangle]
pub extern "C" fn set_deferred_builds(module: u32, on: u32) {
    if let Some(engine) = engine() {
        engine.set_deferred_builds(module, on != 0);
    }
}

/// The waiting build's number, or 0 when nothing is waiting.
#[no_mangle]
pub extern "C" fn build_request_seq(module: u32) -> u32 {
    engine().and_then(|e| e.build_request(module)).map_or(0, |r| r.seq)
}

/// What the waiting build needs: 1 the transient map, 2 the separation.
#[no_mangle]
pub extern "C" fn build_request_flags(module: u32) -> u32 {
    engine().and_then(|e| e.build_request(module)).map_or(0, |r| u32::from(r.map) | (u32::from(r.parts) << 1))
}

/// The settings the waiting build is for, as the module's parameters.
#[no_mangle]
pub extern "C" fn build_request_params_ptr(module: u32) -> *const f32 {
    engine().map_or(core::ptr::null(), |e| e.build_request_params(module).as_ptr())
}

#[no_mangle]
pub extern "C" fn build_request_params_len(module: u32) -> u32 {
    engine().map_or(0, |e| e.build_request_params(module).len() as u32)
}

/// The anchors of the map this module made, or u32::MAX for none (a straight
/// line). Copies them where `built_map_ptr` points, input then output each.
#[no_mangle]
pub extern "C" fn built_map_len(module: u32) -> u32 {
    let Some(map) = engine().and_then(|e| e.built_map(module)) else { return u32::MAX };
    let scratch = map_scratch();
    scratch.clear();
    for &(input, output) in map.anchors() {
        scratch.push(input);
        scratch.push(output);
    }
    map.anchor_count() as u32
}

#[no_mangle]
pub extern "C" fn built_map_ptr() -> *const f64 {
    map_scratch().as_ptr()
}

/// The frames of the separation this module made, or 0 for none.
#[no_mangle]
pub extern "C" fn built_parts_frames(module: u32) -> u32 {
    engine().and_then(|e| e.built_parts(module)).map_or(0, |p| p.frames() as u32)
}

#[no_mangle]
pub extern "C" fn built_parts_channels(module: u32) -> u32 {
    engine().and_then(|e| e.built_parts(module)).map_or(0, |p| p.channels as u32)
}

/// One part, interleaved: 0 harmonic, 1 percussive, 2 residual.
#[no_mangle]
pub extern "C" fn built_parts_ptr(module: u32, which: u32) -> *const f32 {
    match engine().and_then(|e| e.built_parts(module)) {
        Some(p) => match which {
            0 => p.harmonic.as_ptr(),
            1 => p.percussive.as_ptr(),
            2 => p.residual.as_ptr(),
            _ => core::ptr::null(),
        },
        None => core::ptr::null(),
    }
}

/// Room for `anchors` pairs of a map on its way in.
#[no_mangle]
pub extern "C" fn accept_map_alloc(anchors: u32) -> *mut f64 {
    let scratch = map_scratch();
    scratch.clear();
    scratch.resize(anchors as usize * 2, 0.0);
    scratch.as_mut_ptr()
}

/// The map for request `seq`, from `accept_map_alloc`'s room; `present` 0 is
/// a straight line.
#[no_mangle]
pub extern "C" fn accept_map(module: u32, seq: u32, anchors: u32, present: u32) {
    let Some(engine) = engine() else { return };
    let map = (present != 0).then(|| {
        map_scratch()[..anchors as usize * 2].chunks_exact(2).map(|p| (p[0], p[1])).collect()
    });
    engine.accept_map(module, seq, map);
}

/// Room for one part of a separation on its way in (0 harmonic, 1
/// percussive, 2 residual), `len` floats interleaved.
#[no_mangle]
pub extern "C" fn accept_parts_alloc(which: u32, len: u32) -> *mut f32 {
    match parts_scratch(which) {
        Some(scratch) => {
            scratch.clear();
            scratch.resize(len as usize, 0.0);
            scratch.as_mut_ptr()
        }
        None => core::ptr::null_mut(),
    }
}

/// The separation for request `seq`, from `accept_parts_alloc`'s room.
#[no_mangle]
pub extern "C" fn accept_parts(module: u32, seq: u32, channels: u32) {
    let Some(engine) = engine() else { return };
    let take = |which| parts_scratch(which).map(core::mem::take).unwrap_or_default();
    let parts = dsp_core::modules::Parts {
        harmonic: take(0),
        percussive: take(1),
        residual: take(2),
        channels: channels as usize,
        split: None,
    };
    engine.accept_parts(module, seq, parts);
}
