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
static mut OUTPUT: [f32; QUANTUM] = [0.0; QUANTUM];

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
fn output_buffer() -> &'static mut [f32; QUANTUM] {
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

/// Where the host reads one quantum of output.
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
    let (input_module, output_module) = unsafe { (INPUT_MODULE, OUTPUT_MODULE) };
    let input = input_buffer();
    let output = output_buffer();

    let Some(engine) = engine() else {
        output.fill(0.0);
        return;
    };

    for i in 0..QUANTUM {
        if input_module != NO_MODULE {
            engine.set_param(input_module, HostInput::SAMPLE, input[i]);
        }
        engine.process();
        output[i] =
            if output_module != NO_MODULE { engine.output_of(output_module, 0) } else { 0.0 };
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
