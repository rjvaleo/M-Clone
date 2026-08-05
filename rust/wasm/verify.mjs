/**
 * Drives the real `.wasm` the way the AudioWorklet will.
 *
 * The Rust tests in `dsp-core` prove the modules; this proves the *seam* — that
 * the exports exist under the names the worklet imports, that a buffer written
 * from JavaScript reaches a module, and that what comes back is the signal.
 * Nothing in `wasm/src/lib.rs` can be unit tested from Rust, so this is the only
 * thing standing between a working shim and a silent one.
 *
 *   cargo build -p idmlab-engine --target wasm32-unknown-unknown --release
 *   node rust/wasm/verify.mjs
 */
import { readFile } from "node:fs/promises";

const WASM = new URL(
  "../target/wasm32-unknown-unknown/release/idmlab_engine.wasm",
  import.meta.url,
);

/** Matches `ModuleKind` in dsp-core/src/modules.rs — reordering breaks this. */
const KIND = { HOST_INPUT: 0, GAIN: 1, AUDIO_OUTPUT: 2, SYNTH: 3 };
/** Matches `Gain::GAIN` / `LEVEL` / `MUTE`. */
const GAIN_PARAM = { GAIN: 0, LEVEL: 1, MUTE: 2 };
/** Matches the `Synth` constants in dsp-core/src/modules.rs. */
const SYNTH_PARAM = { LEVEL: 0, LFO1_RATE: 28 + 2 };
/** `ModSource` and `ModDest` in dsp-core/src/modmatrix.rs. */
const MOD = { LFO1: 0, VOLUME: 11 };
const SAMPLE_RATE = 48000;

let failures = 0;
const check = (label, condition, detail = "") => {
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
};
const near = (a, b, tolerance = 1e-5) => Math.abs(a - b) < tolerance;

/**
 * WASM has no unsigned integers at the ABI, so a `u32` return arrives in JS
 * already reinterpreted as a signed `i32` — `u32::MAX` shows up as `-1`. Every
 * module id has to come back through here, or `NO_MODULE` silently becomes a
 * plausible-looking negative id.
 */
const u32 = (value) => value >>> 0;
const NO_MODULE = 0xffffffff;

const { instance } = await WebAssembly.instantiate(await readFile(WASM), {});
const api = instance.exports;

console.log("exports:", Object.keys(api).sort().join(", "));

// ---- the shape of the ABI ---------------------------------------------------
for (const name of [
  "init", "add_module", "remove_module", "connect", "disconnect", "set_param",
  "set_bypassed", "set_io", "reset", "input_ptr", "output_ptr", "quantum_size",
  "module_count", "cable_count", "process_quantum", "memory",
]) {
  check(`exports ${name}`, name in api);
}

const QUANTUM = api.quantum_size();
check("quantum is one Web Audio render block", QUANTUM === 128, `got ${QUANTUM}`);

// ---- build the patch --------------------------------------------------------
api.init(SAMPLE_RATE);
const input = u32(api.add_module(KIND.HOST_INPUT));
const gain = u32(api.add_module(KIND.GAIN));
const output = u32(api.add_module(KIND.AUDIO_OUTPUT));
check("three modules exist", api.module_count() === 3, `got ${api.module_count()}`);
check("an unknown kind is refused", u32(api.add_module(999)) === NO_MODULE);

check("input → gain", api.connect(input, 0, gain, 0) === 1);
check("gain → output", api.connect(gain, 0, output, 0) === 1);
check("two cables", api.cable_count() === 2, `got ${api.cable_count()}`);
check("a duplicate cable is refused", api.connect(input, 0, gain, 0) === 0);
check("a cable to a port that is not there is refused", api.connect(input, 9, gain, 0) === 0);

api.set_io(input, output);
api.set_param(gain, GAIN_PARAM.LEVEL, 1.0);

// ---- run it -----------------------------------------------------------------
const inBuf = new Float32Array(api.memory.buffer, api.input_ptr(), QUANTUM);
const outBuf = new Float32Array(api.memory.buffer, api.output_ptr(), QUANTUM);

/** Hold a constant until every 5 ms ramp has arrived, then report the tail. */
const settle = (value, blocks = 8) => {
  for (let b = 0; b < blocks; b++) {
    inBuf.fill(value);
    api.process_quantum();
  }
  return outBuf[QUANTUM - 1];
};

check("unity gain passes the signal", near(settle(0.5), 0.5), `got ${settle(0.5)}`);

api.set_param(gain, GAIN_PARAM.GAIN, 0.5);
check("gain scales the signal", near(settle(0.8), 0.4), `got ${settle(0.8)}`);

api.set_param(gain, GAIN_PARAM.GAIN, 1000);
check("gain clamps to its declared range", near(settle(1.0), 2.0), `got ${settle(1.0)}`);

api.set_param(gain, GAIN_PARAM.GAIN, 1.0);
api.set_param(gain, GAIN_PARAM.MUTE, 1);
check("mute silences", settle(1.0) === 0);
api.set_param(gain, GAIN_PARAM.MUTE, 0);
check("unmute restores", near(settle(1.0), 1.0));

// A NaN from the host must not poison the graph for ever.
inBuf.fill(Number.NaN);
api.process_quantum();
const afterNan = settle(0.25);
check("a NaN input does not poison the graph", near(afterNan, 0.25), `got ${afterNan}`);

// Silence in, silence out — catches a shim that leaks the previous block.
check("silence in, silence out", settle(0) === 0);

// ---- teardown of the effect chain -------------------------------------------
check("removing a module drops its cables", api.remove_module(gain) === 1 && api.cable_count() === 0);
check("removing it twice is refused", api.remove_module(gain) === 0);
api.process_quantum();
check("a broken patch is silent rather than a crash", outBuf[0] === 0);

// ---- the synth --------------------------------------------------------------
// A different shape from the effect chain above: no host input, notes instead
// of a buffer. This is the path nothing in Rust can test, because the note verbs
// only exist at the ABI.
{
  api.init(SAMPLE_RATE);
  const synth = u32(api.add_module(KIND.SYNTH));
  const out = u32(api.add_module(KIND.AUDIO_OUTPUT));
  check("built a synth", synth !== NO_MODULE);
  check("synth → output", api.connect(synth, 0, out, 0) === 1);
  api.set_io(NO_MODULE, out);
  api.set_param(synth, SYNTH_PARAM.LEVEL, 1.0);

  const outBuf2 = new Float32Array(api.memory.buffer, api.output_ptr(), QUANTUM);
  const run = (blocks) => {
    let loudest = 0;
    for (let b = 0; b < blocks; b++) {
      api.process_quantum();
      for (let i = 0; i < QUANTUM; i++) loudest = Math.max(loudest, Math.abs(outBuf2[i]));
    }
    return loudest;
  };

  check("silent before any note", run(4) === 0);

  api.note_on(synth, 60, 1.0, 0.0);
  check("a note over the ABI makes sound", run(16) > 0.01);

  api.note_off(synth, 60);
  run(200);
  check("note off eventually silences it", run(8) === 0);

  // Partial renders, which is what makes note timing sample-accurate.
  api.note_on(synth, 60, 1.0, 0.0);
  api.process_quantum();
  outBuf2.fill(0);
  api.process_range(0, 64);
  const firstHalf = outBuf2.slice(0, 64).some((v) => v !== 0);
  const secondHalfUntouched = outBuf2.slice(64).every((v) => v === 0);
  check("process_range renders only the range it was given", firstHalf && secondHalfUntouched);

  outBuf2.fill(7);
  api.process_range(0, QUANTUM + 1);
  check("a range past the end of the buffer renders nothing [R-ABI-03]", outBuf2.every((v) => v === 7));
  api.all_notes_off(synth);
  run(400);

  // The tuning library's far end. That the detune *moves the pitch* is proved
  // in `modules.rs`; what only this can prove is that a fourth argument
  // crosses the real ABI without poisoning the frequency, which would show up
  // as silence rather than as a wrong note.
  api.note_on(synth, 60, 1.0, -33.4);
  check("a detuned note over the ABI makes sound", run(16) > 0.01);
  api.all_notes_off(synth);
  run(400);

  // The stage's headline, at the boundary the browser actually calls.
  api.set_param(synth, SYNTH_PARAM.LFO1_RATE, 8);
  api.set_modulation(synth, MOD.LFO1, MOD.VOLUME, 1.0);
  api.note_on(synth, 60, 1.0, 0.0);
  const windows = [];
  for (let w = 0; w < 6; w++) windows.push(run(6));
  const spread = Math.max(...windows) - Math.min(...windows);
  check(`an LFO routed over the ABI moves the sound (spread ${spread.toFixed(3)})`, spread > 0.01);

  api.all_notes_off(synth);
  run(400);
  check("all notes off reaches the bank", run(8) === 0);

  // Nonsense must not take down the callback.
  api.note_on(synth, 9999, 1.0, 0.0);
  api.note_on(synth, 60, Number.NaN, 0.0);
  api.note_on(synth, 60, 1.0, Number.NaN);
  api.set_modulation(synth, 99, 99, 1.0);
  api.set_modulation(synth, 0, 0, Number.NaN);
  check("bad note and routing data is refused, not fatal [R-ABI-04]", Number.isFinite(run(4)));
  api.all_notes_off(synth);
}


// ---- samples ---------------------------------------------------------------
//
// The seam granular processing depends on: audio written from JavaScript has to
// arrive intact in the engine's own memory. The hazard being proved against is
// that `sample_alloc` may grow linear memory, which detaches any view taken
// before it — so the view is always taken afterwards.
{
  const FRAMES = 4096;
  const CHANNELS = 2;
  const ok = api.sample_alloc(0, CHANNELS, FRAMES, 44100);
  check("sample_alloc accepts a real buffer shape", ok === 1);
  check("sample_len reports channels x frames", api.sample_len(0) === CHANNELS * FRAMES);

  const pointer = api.sample_ptr(0);
  check("sample_ptr is not null after allocating", pointer !== 0);

  // Deliberately re-read after the allocation, exactly as sampleTransfer.ts does.
  const target = new Float32Array(api.memory.buffer, pointer, CHANNELS * FRAMES);
  for (let i = 0; i < FRAMES; i++) {
    target[i] = i / FRAMES;
    target[FRAMES + i] = -(i / FRAMES);
  }
  const readBack = new Float32Array(api.memory.buffer, api.sample_ptr(0), CHANNELS * FRAMES);
  check("audio written from JavaScript survives in engine memory",
    readBack[0] === 0 && Math.abs(readBack[FRAMES - 1] - (FRAMES - 1) / FRAMES) < 1e-6);
  check("channels stay separate in the planar layout",
    Math.abs(readBack[FRAMES + 100] + 100 / FRAMES) < 1e-6);

  check("sample_count sees it", api.sample_count() === 1);
  check("a shape that cannot hold audio is refused", api.sample_alloc(1, 0, 10, 44100) === 0);
  check("an unknown id has no pointer", api.sample_ptr(99) === 0);

  api.sample_free(0);
  check("freeing releases the slot", api.sample_count() === 0 && api.sample_ptr(0) === 0);
  api.sample_free(99); // must not fault
  check("freeing nothing is not fatal", true);
}

console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
