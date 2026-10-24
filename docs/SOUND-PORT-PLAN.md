# MultiGrainLive's sound, effects and synths in idMLab

*23 October 2026. Agreed with RJ. Steps 1, 2 and 3's LFO built (branch `sound-port`).*

Bring MultiGrainLive's whole sound engine and every effect into idMLab, add
modulators that can be mapped to any knob, port the scale-sequencer synth in
full, and add drum step programming. Automation is not ported.

## Decisions

- **The Rust engine becomes idMLab's default.** The ported sound engine and
  the prism effects exist only there; the Web Audio backend stays as a
  fallback for the modules it already has.
- **Effects are shared, not copied.** The 16 prism-fx effects arrive through
  the adapter planned in MultiGrainLive's `docs/SHARED-FX.md` (§ idMLab).
  MultiGrainLive's other ~33 effects (shape set, Dattorro set, Schroeder and
  Moorer reverbs, phaser, EQ, compressor, maximiser; ~5.7k lines) move into
  prism-fx as kernels, and MultiGrainLive switches to them.
- **The sound engine is shared too.** Its pure DSP (grain planning, the five
  streamers — granular, WSOLA, vocoder, PVSOLA, hybrid — the stretcher with
  its cloud layer, the block renderer) moves out of MultiGrainLive's `fx` and
  `engine` crates into a sibling crate (the `prism-grain` of SHARED-FX.md's
  "Later"). Device, thread, lock and `Instant` code stays in MultiGrainLive.
  idMLab wraps it as a module with a block adapter.
- **Modulators map by clicking.** Each modulator (LFO first) shows its amount
  beside it and has a **Map** button: press it, click a knob, and that knob
  gets a ring in the modulator's colour while its value indicator moves with
  the modulation. A modulator can drive several knobs; unmapping is from the
  ring or the modulator.
- **The synth is both.** The existing `m.synth` becomes a superset of the
  scale-sequencer synth, plus a *classic* switch that reproduces the
  original's one shared filter across all notes.

## Order

1. **Groundwork.** The Rust engine as default, with a check that every
   existing module still sounds. Fix: the wet/mix knob never reaches Rust
   effects (`audio/wasm/engineBridge.ts`).
   **Built.** Rust is the default (`?engine=web-audio` for the browser's
   nodes; a build where the rack cannot load still falls back by itself).
   What that took, beyond the default:
   - the mix knob reaches Rust effects;
   - every Rust effect is stereo — delay, EQ, crusher, gain and Non Lin as
     two mono halves; compressor and limiter linked; reverb, Blackhole and
     the DP/4 reverb fed the sum and read out wide from their tanks' even and
     odd lines, the mid exactly what they made before;
   - the bridge wires each document port to its own engine ports (the
     mixer's four stereo channels, the DP/4's four mono ins and outs);
   - the mixer (16), the widener (17) and the four-unit DP/4 (18) are ported,
     so no audio module renders silence on Rust. The DP/4's feedback send
     also ducks while the pair is over its limiter, where the Web Audio
     build only limits it; at its defaults a looped pair's gain is above one.
     In the Web Audio build both feedback modes return to A's input — kept,
     so the two backends agree.
   Also: values the plan files as structure for Web Audio's sake — a
   reverb's tail and decay rate, a crusher's bit depth, the synth's waves —
   now reach Rust; before, those knobs did nothing there.
2. **The prism effects in idMLab.** **Built.**
   - `dsp-core` depends on prism-fx by path. `ModuleKind::Prism` is 19 (not
     the 16 SHARED-FX.md assumed; 16–18 went to the ports above), built from
     the descriptor's `code`. `PrismModule` runs the kernel frame by frame in
     true stereo, hands a control over only when it moves, and puts the fade
     after the kernel's controls. A test renders every effect in the
     catalogue against its kernel run alone, sample for sample.
   - `rust/prism-gen` writes `src/modular/registry/prismCatalog.generated.ts`
     (`npm run gen:prism`, run by `build:wasm`); its test fails while that
     file is behind the crate. `prismModules.ts` turns it into the sixteen
     `m.prism-*` modules, faces in the originals' groups, and the bridge's
     tables. Nothing in idMLab restates a range.
   - A choice travels as its option's index; an effect's own `mix` is the
     plan's wet; a sound (Convolution's impulse, Spectral Dynamics' threshold
     sound) is an `asset-id` sample slot, handed to the kernel from the bank.
   - On Web Audio a prism module passes its input through untouched.
   - Checked in the app: the Add menu lists all sixteen, and ++delay patched
     between M's synth and the output sounds on the Rust default.
3. **Modulators and the mixer.**
   **LFO built.**
   - **Rust.** `Engine::connect_param` routes a module output to any
     module's parameter: each sample the module reads the host's value plus
     `source × scale`, held inside the knob's range, without the host value
     ever being overwritten. `LfoModule` (kind 20) runs the synth's `Lfo` —
     sine, triangle, saw up and down, square, sample-and-hold, smooth random —
     scaled by its amount, and reports its phase. The ABI has
     `connect_param`, `disconnect_param`, `module_output` and
     `module_telemetry`.
   - **The plan** carries LFOs as `modulators` and each mapping as a
     `modulations` route scaled by half the knob's range; only numbers the
     plan carries as values are mappable (not structure, mix or mute). Each
     rack report carries every LFO's phase and output.
   - **The face.** The LFO has its colour (each new one takes one no other
     LFO wears), Rate, Shape, Amount and Phase, a **Map** button and the list
     of knobs it moves, each with ×. Map, then click a knob: it gets a ring in
     the LFO's colour (two rings for two LFOs), a second pointer and a live
     value that move with the LFO, drawn at frame rate without a render from
     the reported phase carried forward. Esc stops mapping; Alt-click on a
     knob lets its last LFO go. Works on standard faces and the synth's.
   - Web Audio does not modulate: the routes exist only in Rust.
   - Not built yet: the envelope follower and the ADSR on a gate (S&H and
     smooth random are LFO shapes), tempo sync, more mixer channels or sends.
4. **The sound engine, hooked to M.**
   - The shared crate, with MultiGrainLive moved onto it first and its tests
     kept passing (Echo-style parity on renders).
   - The idMLab module: source sample from the asset pool, every engine and
     its controls, the cloud layer, rack-free (effects are idMLab modules).
   - **Notes:** `notes-in` from M NoteSeq / Orchestra sets pitch as semitones
     from a root note (default 60), polyphonic voices on the voice tag where
     the engine allows. **Free run:** a switch that plays continuously, with
     notes ignored or only retuning.
   - Every control mappable by the modulators.
5. **MultiGrainLive's other effects into prism-fx**, each against a render of
   the original, then offered in idMLab automatically.
6. **Synth parity and drums** (independent of 4–5; can run in parallel).
   - Synth: three LFOs with the original's targets, pulse width, filter
     envelope amount and key follow as the original, ping-pong delay with tape
     glide and hi-cut, the 20 presets (fixing the LFO1 key bug), preset morph,
     and the *classic* shared-filter switch. Both backends' `m.synth`.
   - Drums: a drum step-programming module (Numerology DrumSeq look: rows per
     pad, per-step velocity, probability, flam/ratchet, swing, per-row length)
     driving `m.percussion`; a 909 starter kit from `Audio - Archival
     LIBRARY/rj_s 909` loadable from the library.

## Known facts this rests on

- idMLab's Rust engine runs modules a sample at a time (`dsp-core` `Module`,
  one-sample cable delay); MultiGrainLive's engine is block-based (≤ 8192).
- `m.granular` exists but ignores note pitch; `m.percussion` exists without a
  step sequencer; `m.audio-mixer` is Web Audio only; no LFO module exists.
- prism-fx is a local repo with no commits and no remote; MultiGrainLive
  depends on it by path, and idMLab will too.
