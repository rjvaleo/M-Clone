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
const KIND = { HOST_INPUT: 0, GAIN: 1, AUDIO_OUTPUT: 2 };
/** Matches `Gain::GAIN` / `LEVEL` / `MUTE`. */
const GAIN_PARAM = { GAIN: 0, LEVEL: 1, MUTE: 2 };
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

// ---- teardown ---------------------------------------------------------------
check("removing a module drops its cables", api.remove_module(gain) === 1 && api.cable_count() === 0);
check("removing it twice is refused", api.remove_module(gain) === 0);
api.process_quantum();
check("a broken patch is silent rather than a crash", outBuf[0] === 0);

console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
