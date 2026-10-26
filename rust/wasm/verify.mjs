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
const SYNTH_PARAM = {
  LEVEL: 0, CUTOFF: 16, AMP_ATTACK: 20, AMP_SUSTAIN: 22, AMP_RELEASE: 23, LFO1_RATE: 28 + 2,
  VOLUME: 39, CLASSIC: 44, SLFO_BASE: 45, DELAY_NOTE: 57, DELAY_FEEDBACK: 58, DELAY_WET: 59, TAPE: 62, TEMPO: 63,
};
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
  "set_bypassed", "set_io", "reset", "set_slot_shape", "input_ptr", "output_ptr", "quantum_size",
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
// Two quanta now: left then right.
const outBuf = new Float32Array(api.memory.buffer, api.output_ptr(), QUANTUM);
const outRight = new Float32Array(api.memory.buffer, api.output_ptr() + QUANTUM * 4, QUANTUM);

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
  const outBuf2R = new Float32Array(api.memory.buffer, api.output_ptr() + QUANTUM * 4, QUANTUM);
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

  // Stereo across the real ABI. Only port 0 is patched on this bench, so the
  // right channel must be silent — which is the proof that the two channels are
  // genuinely separate rather than one signal copied twice.
  api.note_on(synth, 60, 1.0, 0.0);
  run(16);
  const leftEnergy = outBuf2.reduce((a, v) => a + Math.abs(v), 0);
  const rightEnergy = outBuf2R.reduce((a, v) => a + Math.abs(v), 0);
  check("left and right are independent channels [R-FRAME-05]",
    leftEnergy > 0.01 && rightEnergy === 0, `L ${leftEnergy.toFixed(3)} R ${rightEnergy.toFixed(3)}`);
  api.all_notes_off(synth);
  run(400);

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

// ---- the scale sequencer's parts of the synth -------------------------------
// The classic shared filter, the ping-pong delay at a tempo, its tape glide and
// the original's LFOs, each driven across the real ABI. The laws are proved in
// `modules.rs`; this proves the indices and the module reach the browser.
{
  api.init(SAMPLE_RATE);
  const synth = u32(api.add_module(KIND.SYNTH));
  const out = u32(api.add_module(KIND.AUDIO_OUTPUT));
  api.connect(synth, 0, out, 0);
  api.connect(synth, 1, out, 1);
  api.set_io(NO_MODULE, out);
  api.set_param(synth, SYNTH_PARAM.LEVEL, 1.0);
  const left = () => new Float32Array(api.memory.buffer, api.output_ptr(), QUANTUM);
  const right = () => new Float32Array(api.memory.buffer, api.output_ptr() + QUANTUM * 4, QUANTUM);
  /** Render `blocks`, returning the frame of the first sound and the loudest. */
  const listen = (blocks) => {
    let first = -1;
    let loudest = 0;
    let lopsided = 0;
    for (let b = 0; b < blocks; b++) {
      api.process_quantum();
      const l = left();
      const r = right();
      for (let i = 0; i < QUANTUM; i++) {
        const level = Math.max(Math.abs(l[i]), Math.abs(r[i]));
        if (first < 0 && level > 1e-4) first = b * QUANTUM + i;
        loudest = Math.max(loudest, level);
        lopsided = Math.max(lopsided, Math.abs(l[i] - r[i]));
      }
    }
    return { first, loudest, lopsided };
  };

  api.set_param(synth, SYNTH_PARAM.CLASSIC, 1);
  api.process_quantum();
  api.note_on(synth, 60, 1.0, 0.0);
  const classic = listen(16);
  check("classic plays through the shared filter over the ABI", classic.loudest > 0.01, `peak ${classic.loudest}`);
  check("classic voices are mono, as the original's filter was", classic.lopsided < 1e-6);
  api.all_notes_off(synth);

  // All wet, no feedback, 1/16 at 240 BPM: the echo alone, 62.5 ms late. A
  // fresh rack, so the delay is timed from these values when it is built.
  api.init(SAMPLE_RATE);
  {
    const s = u32(api.add_module(KIND.SYNTH));
    const o = u32(api.add_module(KIND.AUDIO_OUTPUT));
    api.connect(s, 0, o, 0);
    api.connect(s, 1, o, 1);
    api.set_io(NO_MODULE, o);
    for (const [index, value] of [
      [SYNTH_PARAM.LEVEL, 1], [SYNTH_PARAM.TEMPO, 240], [SYNTH_PARAM.DELAY_NOTE, 1],
      [SYNTH_PARAM.DELAY_WET, 1], [SYNTH_PARAM.DELAY_FEEDBACK, 0], [SYNTH_PARAM.AMP_ATTACK, 0],
      [SYNTH_PARAM.AMP_RELEASE, 1], [SYNTH_PARAM.TAPE, 5],
    ]) api.set_param(s, index, value);
    api.process_quantum();
    api.note_on(s, 69, 1.0, 0.0);
    api.process_quantum();
    api.note_off(s, 69);
    const echo = listen(40);
    check(`the delay answers one sixteenth at 240 BPM later (${echo.first} frames)`,
      Math.abs(echo.first + QUANTUM - 3000) <= 2);
    listen(100);

    // Retimed to an eighth on the slowest tape: it glides there, then holds.
    api.set_param(s, SYNTH_PARAM.DELAY_NOTE, 3);
    listen(Math.ceil(0.4 * SAMPLE_RATE / QUANTUM));
    api.note_on(s, 69, 1.0, 0.0);
    api.process_quantum();
    api.note_off(s, 69);
    const glided = listen(80);
    check(`after its tape glide the delay is an eighth (${glided.first} frames)`,
      Math.abs(glided.first + QUANTUM - 6000) <= 2);
    listen(200);

    // An original LFO on the volume, at 4 Hz and full depth, swings the level.
    api.set_param(s, SYNTH_PARAM.DELAY_WET, 0);
    api.set_param(s, SYNTH_PARAM.AMP_SUSTAIN, 1);
    api.set_param(s, SYNTH_PARAM.SLFO_BASE, 4);
    api.set_param(s, SYNTH_PARAM.SLFO_BASE + 1, 1);
    api.set_param(s, SYNTH_PARAM.SLFO_BASE + 3, 3);
    api.note_on(s, 60, 1.0, 0.0);
    const swings = [];
    for (let w = 0; w < 8; w++) swings.push(listen(12).loudest);
    const swing = Math.max(...swings) - Math.min(...swings);
    check(`an original LFO on the volume moves it over the ABI (swing ${swing.toFixed(3)})`, swing > 0.05);
    api.all_notes_off(s);
  }
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

// ---- stereo through the mixer, a reverb and the DP/4 ------------------------
// The modules that let Rust become the default, through the real ABI: the
// mixer's channels on their own port pairs, a reverb that plays back wide, and
// the four-unit DP/4 built from a packed variant.
{
  const MIXER = 16;
  const REVERB = 8;
  const DP4_MACHINE = 18;
  const mixerLevel = (channel) => channel * 4;
  const mixerPan = (channel) => channel * 4 + 1;
  const MIXER_FADE = 16;
  const REVERB_PARAM = { MIX: 3, LEVEL: 4 };
  const DP4_FADE = 24;

  // Views are made per call: adding a module can grow linear memory, which
  // detaches every view made before it.
  const sides = (blocks, skip = 0) => {
    for (let b = 0; b < skip; b++) api.process_quantum();
    const left = new Float32Array(api.memory.buffer, api.output_ptr(), QUANTUM);
    const right = new Float32Array(api.memory.buffer, api.output_ptr() + QUANTUM * 4, QUANTUM);
    let l = 0;
    let r = 0;
    for (let b = 0; b < blocks; b++) {
      api.process_quantum();
      for (let i = 0; i < QUANTUM; i++) {
        l = Math.max(l, Math.abs(left[i]));
        r = Math.max(r, Math.abs(right[i]));
      }
    }
    return [l, r];
  };

  api.init(SAMPLE_RATE);
  const synth = u32(api.add_module(KIND.SYNTH));
  const mixer = u32(api.add_module(MIXER));
  const out = u32(api.add_module(KIND.AUDIO_OUTPUT));
  check("built a mixer", mixer !== NO_MODULE);
  // Channel 2 is ports 2 and 3.
  check("synth → mixer channel 2",
    api.connect(synth, 0, mixer, 2) === 1 && api.connect(synth, 1, mixer, 3) === 1);
  check("mixer → output", api.connect(mixer, 0, out, 0) === 1 && api.connect(mixer, 1, out, 1) === 1);
  api.set_io(NO_MODULE, out);
  api.set_param(synth, SYNTH_PARAM.LEVEL, 1.0);
  api.set_param(mixer, MIXER_FADE, 1.0);
  api.set_param(mixer, mixerLevel(1), 1.0);
  api.set_param(mixer, mixerPan(1), -1.0);
  api.note_on(synth, 60, 1.0, 0.0);
  // Past the pan's glide from the centre.
  const [dryL, dryR] = sides(32, 32);
  check("a hard-left mixer channel sounds on the left only", dryL > 0.01 && dryR < 1e-6,
    `L ${dryL.toFixed(4)} R ${dryR.toFixed(6)}`);

  const reverb = u32(api.add_module(REVERB));
  api.disconnect(mixer, 0, out, 0);
  api.disconnect(mixer, 1, out, 1);
  for (const port of [0, 1]) {
    api.connect(mixer, port, reverb, port);
    api.connect(reverb, port, out, port);
  }
  api.set_param(reverb, REVERB_PARAM.MIX, 1.0);
  api.set_param(reverb, REVERB_PARAM.LEVEL, 1.0);
  const [wetL, wetR] = sides(200);
  check("the reverb plays a left-only sound back on both sides", wetL > 1e-3 && wetR > 1e-3,
    `L ${wetL.toFixed(4)} R ${wetR.toFixed(4)}`);
  api.all_notes_off(synth);

  api.init(SAMPLE_RATE);
  const voice = u32(api.add_module(KIND.SYNTH));
  // The descriptor's defaults: config 1, A→B serial, C→D parallel, AB↔CD
  // serial; large plate, small room, hall, small plate.
  const variant = 0 | (0 << 2) | (1 << 4) | (0 << 6) | (1 << 7) | (2 << 10) | (4 << 13) | (0 << 16);
  const dp4 = u32(api.add_module_variant(DP4_MACHINE, variant));
  const master = u32(api.add_module(KIND.AUDIO_OUTPUT));
  check("built the DP/4 machine from a packed variant", dp4 !== NO_MODULE);
  check("synth → DP/4 in 1 → out 1 and 2",
    api.connect(voice, 0, dp4, 0) === 1 &&
      api.connect(dp4, 0, master, 0) === 1 &&
      api.connect(dp4, 1, master, 1) === 1);
  api.set_io(NO_MODULE, master);
  api.set_param(voice, SYNTH_PARAM.LEVEL, 1.0);
  api.set_param(dp4, DP4_FADE, 1.0);
  api.note_on(voice, 64, 1.0, 0.0);
  const [dpL, dpR] = sides(64);
  check("the DP/4 sounds on both of its first outputs", dpL > 0.01 && dpR > 0.01,
    `L ${dpL.toFixed(4)} R ${dpR.toFixed(4)}`);
}

// ---- a prism effect ---------------------------------------------------------
// Built by kind 19 and the effect's code: Tremolo is code 1, its depth index 1,
// and its fade follows its four controls.
{
  const PRISM = 19;
  api.init(SAMPLE_RATE);
  const source = u32(api.add_module(KIND.HOST_INPUT));
  const tremolo = u32(api.add_module_variant(PRISM, 1));
  const out = u32(api.add_module(KIND.AUDIO_OUTPUT));
  check("built Tremolo from prism-fx", tremolo !== NO_MODULE);
  check("input → Tremolo → output",
    api.connect(source, 0, tremolo, 0) === 1 && api.connect(source, 0, tremolo, 1) === 1 &&
      api.connect(tremolo, 0, out, 0) === 1 && api.connect(tremolo, 1, out, 1) === 1);
  api.set_io(source, out);
  api.set_param(tremolo, 4, 1.0);
  api.set_param(tremolo, 1, 1.0);
  let low = Infinity;
  let high = 0;
  for (let b = 0; b < 400; b++) {
    const feed = new Float32Array(api.memory.buffer, api.input_ptr(), QUANTUM);
    feed.fill(0.5);
    api.process_quantum();
    const left = new Float32Array(api.memory.buffer, api.output_ptr(), QUANTUM);
    if (b < 40) continue;
    for (let i = 0; i < QUANTUM; i++) {
      low = Math.min(low, left[i]);
      high = Math.max(high, left[i]);
    }
  }
  check("Tremolo moves a steady input at full depth", high - low > 0.3,
    `${low.toFixed(3)} to ${high.toFixed(3)}`);
}

// ---- an LFO moving a knob ---------------------------------------------------
// LfoModule is kind 20; a route from its output scales by half the knob's
// range. Here it sweeps a gain's level (index 0, range 0–2) at 5 Hz.
{
  const LFO = 20;
  api.init(SAMPLE_RATE);
  const source = u32(api.add_module(KIND.HOST_INPUT));
  const gain = u32(api.add_module(KIND.GAIN));
  const lfo = u32(api.add_module(LFO));
  const out = u32(api.add_module(KIND.AUDIO_OUTPUT));
  check("built an LFO", lfo !== NO_MODULE);
  api.connect(source, 0, gain, 0);
  api.connect(gain, 0, out, 0);
  api.set_io(source, out);
  api.set_param(gain, GAIN_PARAM.LEVEL, 1.0);
  api.set_param(lfo, 0, 5.0);
  api.set_param(lfo, 2, 1.0);
  check("routes the LFO to the gain", api.connect_param(lfo, 0, gain, GAIN_PARAM.GAIN, 1.0, 0.0, 2.0) === 1);
  check("refuses a route to a parameter that is not there", api.connect_param(lfo, 0, gain, 40, 1.0, 0.0, 2.0) === 0);
  let low = Infinity;
  let high = 0;
  for (let b = 0; b < 400; b++) {
    new Float32Array(api.memory.buffer, api.input_ptr(), QUANTUM).fill(0.5);
    api.process_quantum();
    const left = new Float32Array(api.memory.buffer, api.output_ptr(), QUANTUM);
    if (b < 40) continue;
    for (let i = 0; i < QUANTUM; i++) {
      low = Math.min(low, left[i]);
      high = Math.max(high, left[i]);
    }
  }
  check("the LFO sweeps the sound", low < 0.1 && high > 0.9, `${low.toFixed(3)} to ${high.toFixed(3)}`);
  const phase = api.module_telemetry(lfo);
  check("the LFO reports its phase", phase >= 0 && phase < 1, `${phase}`);
  check("and its output", Number.isFinite(api.module_output(lfo, 0)));
  check("unroutes it", api.disconnect_param(lfo, 0, gain, GAIN_PARAM.GAIN) === 1);
}

// ---- MultiGrainLive's engine, through the real ABI --------------------------
// GrainEngineModule is kind 21. A one-second 220 Hz sine in the bank: free
// running it sounds with no note; gated it waits for one, and a note an octave
// over the root plays it an octave up.
{
  const GRAIN_ENGINE = 21;
  const P = { SEMITONES: 2, ROOT: 19, FREE_RUN: 20, FADE: 21 };
  const FRAMES = SAMPLE_RATE;
  api.init(SAMPLE_RATE);
  check("allocates the engine's sample", api.sample_alloc(7, 2, FRAMES, SAMPLE_RATE) === 1);
  const bank = new Float32Array(api.memory.buffer, api.sample_ptr(7), 2 * FRAMES);
  for (let i = 0; i < FRAMES; i++) {
    bank[i] = bank[FRAMES + i] = 0.5 * Math.sin((2 * Math.PI * 220 * i) / SAMPLE_RATE);
  }
  const build = (free) => {
    api.init(SAMPLE_RATE);
    api.sample_alloc(7, 2, FRAMES, SAMPLE_RATE);
    const b = new Float32Array(api.memory.buffer, api.sample_ptr(7), 2 * FRAMES);
    for (let i = 0; i < FRAMES; i++) b[i] = b[FRAMES + i] = 0.5 * Math.sin((2 * Math.PI * 220 * i) / SAMPLE_RATE);
    const grain = u32(api.add_module(GRAIN_ENGINE));
    const out = u32(api.add_module(KIND.AUDIO_OUTPUT));
    api.connect(grain, 0, out, 0);
    api.connect(grain, 1, out, 1);
    api.set_io(NO_MODULE, out);
    api.set_sample_slot(grain, 0, 7);
    api.set_param(grain, P.FADE, 1.0);
    api.set_param(grain, 0, 0); // WSOLA: the pitch is the clearest to count
    api.set_param(grain, P.FREE_RUN, free ? 1 : 0);
    return grain;
  };
  const listen = (quanta) => {
    const got = [];
    for (let b = 0; b < quanta; b++) {
      api.process_quantum();
      got.push(...new Float32Array(api.memory.buffer, api.output_ptr(), QUANTUM));
    }
    return got;
  };
  const peak = (xs) => xs.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  const hz = (xs) => {
    let n = 0;
    for (let i = 1; i < xs.length; i++) if ((xs[i - 1] < 0) !== (xs[i] < 0)) n++;
    return (n / 2) * (SAMPLE_RATE / xs.length);
  };
  check("built the grain engine", build(true) !== NO_MODULE);
  check("free running, it plays with no note", peak(listen(200).slice(4800)) > 0.05);
  const gated = build(false);
  check("gated, it is silent before a note", peak(listen(100)) === 0);
  api.note_on(gated, 72, 1.0, 0.0);
  const up = listen(300).slice(9600);
  check("a note plays it", peak(up) > 0.05);
  const f = hz(up);
  check("an octave over the root plays an octave up", Math.abs(f - 440) < 25, `${f.toFixed(1)} Hz`);
}

// ---- the kit's pads, through the real ABI ----------------------------------
// Percussion is kind 13. The browser kit's hit: level 0.8, pad gain 0.9, pan
// +0.35, velocity 64 — level × gain × velocity², then Web Audio's mono panner
// law. Two hats in choke group 1: the closed one fades the open one out.
{
  const PERCUSSION = 13;
  const P = { DECAY: 1, MIX: 2, LEVEL: 3 };
  api.init(SAMPLE_RATE);
  check("exports set_slot_shape", typeof api.set_slot_shape === "function");
  api.sample_alloc(3, 1, SAMPLE_RATE * 2, SAMPLE_RATE);
  new Float32Array(api.memory.buffer, api.sample_ptr(3), SAMPLE_RATE * 2).fill(1);
  const kit = u32(api.add_module(PERCUSSION));
  const out = u32(api.add_module(KIND.AUDIO_OUTPUT));
  api.connect(kit, 0, out, 0);
  api.connect(kit, 1, out, 1);
  api.set_io(NO_MODULE, out);
  api.set_param(kit, P.LEVEL, 0.8);
  api.set_param(kit, P.MIX, 1);
  api.set_param(kit, P.DECAY, 0.5);
  api.set_sample_slot(kit, 46, 3);
  api.sample_alloc(4, 1, SAMPLE_RATE, SAMPLE_RATE); // silence: a hat heard only by its choke
  api.set_sample_slot(kit, 42, 4);
  api.set_slot_shape(kit, 46, 0.9, 0.35, 1);
  api.set_slot_shape(kit, 42, 1, 0, 1);
  for (let b = 0; b < 20; b++) api.process_quantum();
  const sides = () => [
    Array.from(new Float32Array(api.memory.buffer, api.output_ptr(), QUANTUM)),
    Array.from(new Float32Array(api.memory.buffer, api.output_ptr() + QUANTUM * 4, QUANTUM)),
  ];
  const v = 64 / 127;
  api.note_on(kit, 46, v, 0);
  api.process_quantum();
  const [l, r] = sides();
  const start = 0.8 * 0.9 * v * v;
  const angle = (0.35 + 1) * Math.PI / 4;
  check("a pad starts at level × gain × velocity²", near(l[1], start * Math.cos(angle), 1e-5), `${l[1]}`);
  check("and sits where its pan puts it", near(r[1], start * Math.sin(angle), 1e-5), `${r[1]}`);
  api.note_on(kit, 42, 1, 0);
  for (let b = 0; b < 17; b++) api.process_quantum(); // past the 40 ms fade and the output's one frame
  const [after] = sides();
  check("the closed hat chokes the open one out", after.every((x) => x === 0), `${Math.max(...after.map(Math.abs))}`);
}

console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
