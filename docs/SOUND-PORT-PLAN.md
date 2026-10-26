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
     **Synth built** (branch `sound-synth`). The laws are `audio/synthLaws.ts`,
     restated in `dsp-core` (`voice.rs`, `tape.rs`) and pinned on both sides
     to the numbers `app.js` computes.
     - **Filter.** Key follow from MIDI 60 by the note's true pitch, clamped
       above only; envelope amount `filter-env` −100…+100 %, linear in hertz
       (`base + amt·base·15`, sustain scaled, 20 Hz–20 kHz) alongside idMLab's
       octave amount. Web Audio's lowpass on both backends (Rust:
       `webaudio::WebLowpass`, Q in dB), and a note's filter envelope is an
       offset from the cutoff knob, as the original sums them.
     - **Classic** (`classic`): classic voices skip their filter and pan and
       feed one shared filter whose frequency is knob + envelope offset + LFO;
       every note retriggers the offset and the newest note's key-up releases
       it. Classic ignores pan (the original is mono).
     - **LFOs** `lfo-a/b/c`: sine/triangle/saw, 0.05–20 Hz, depth, target none /
       filter (depth·cutoff Hz into every filter) / resonance (10 Q) / volume /
       pulse width / delay wet. Pulse width is read per note as
       `sin(phase)·depth·0.45`, held 5–95 %; widths 5–95 % now. Separate from
       the matrix's LFOs and from `m.lfo`. Depth starts at zero.
     - **Delay**: ping-pong of two 4 s lines, hi-cut (Q 0.5 dB) and feedback in
       each leg, spread panning, dry `1 − wet`, then `volume` (the master; the
       original's `volume·0.3`). Synced to `tempo` (the synth's own until the
       transport reaches the audio plan) at the original's eleven note values,
       its "1/4T" = 1.33333 beats included. Retiming glides on tape — six
       speeds, `|Δv|/12` s, overrun cap — as the browser's half-millisecond
       curve, which the Rust line reads point for point. Wet starts at zero.
     - **Presets and morph** (`audio/synthPresets.ts`): the twenty presets
       read through every slider law, LFO 1's stale `lfoRateSlider` /
       `lfoDepthSlider` / `lfoWaveSelect` keys mapped to LFO 1, unstored
       controls at the original's page defaults, classic on, one oscillator.
       Morph moves in slider space in whole slider steps over `morph-time`;
       menus switch at the start. On the face: Load / Morph.
     - **Rust fixes this needed**: envelope times were read as seconds (a 10 ms
       attack took 10 s), resonance as 0–1, detune clamped to ±100 ¢, three
       oscillators averaged, velocity linear, the descriptor's `level` on the
       fade handle, and `RackNotePlayer` sent MIDI velocity where the engine
       takes 0–1, so every Rust instrument played every note at full velocity.
       The matrix's cutoff and resonance ranges now match the browser's.
     - **Exact since** (Web Audio's own maths in `rust/dsp-core/src/webaudio.rs`,
       its reference `src/modular/audio/webAudioLaws.ts`, the same numbers
       pinned on both sides; checked against Chromium's source, not memory):
       - *Oscillators.* Rust plays Web Audio's band-limited tables: the spec's
         Fourier series (sine `b₁ = 1`, square `4/(nπ)` odd, saw
         `(−1)ⁿ⁺¹·2/(nπ)`, triangle `8·sin(nπ/2)/(nπ)²`) as
         `GenerateBasicWaveform` computes them, a table per third of an
         octave keeping `N/2·2^(−r/3)` partials (N = 4096 at 44.1/48 kHz),
         DC and Nyquist cleared, all normalised by the fullest table's peak;
         a note blends the two tables either side of `1 + 3·log2(f/f_low)`,
         interpolating linearly within each, or by 3- and 5-point Lagrange
         below 0.3 entries a sample, its read position in double. The LFOs
         are the same oscillators. The PolyBLEP oscillator and the
         peak-normalising gain are gone from the synth. Frequency is set as
         the browser voice sets it: the note's hertz as a float, times
         `2^(detune/1200)`.
       - *Pulse.* The original's own `PeriodicWave`: 256 cosine terms
         `2/(nπ)·sin(nπw)`, its DC term dropped by the wave, normalised the
         same way — built per note at the note's width and kept for its life,
         on both backends (Rust used to read the width live).
       - *Gate.* A sequenced note now knows its step when it starts (the
         runtime carries `stepSec` on the note-on: the note's slot before any
         gate shortened it) and releases at 85 % of it — `gate`, default 0.85
         — with its release written with the rest of its envelope, as
         `playNote` writes all five calls at once. The browser's timeline
         sorts them, so a gate inside the attack holds silence until the gate
         and jumps to the sustain, exactly as the original; Rust evaluates the
         same timeline (`ParamTimeline`). Its note-off changes nothing. The
         oscillators stop 50 ms after the release ends. A live note writes
         the same release at its key-up, over what is scheduled rather than
         cancelling it.
       - *Cutoff glide.* `cancelAndHoldAtTime` + `setTargetAtTime(cutoff, now,
         0.015)` on Web Audio; on Rust the same curve (`TargetGlide`: the
         discrete time constant `1 − e^(−1/(fs·τ))`, converged at a render
         quantum as Chromium checks it). That one gliding value is every
         filter's base — the classic filter's and every voice's — so a
         sounding per-voice note follows the knob identically on both.
       - *Volume and delay-wet LFOs* swing by `depth × level as of the LFO's
         last touch` (its rate, depth, wave or target moving), as
         `updateVol`/`updateDelay` never rescale them. A preset load or morph
         frame touches all three (`lfo-touch`), as the original fires every
         LFO slider's handler; a touch takes the levels of its whole moment.
       - *Pulse LFO.* Advances step by step, rests included, before the step
         plays: from one note to the next, through the steps after the
         earlier note's and its own; a run's first note by its own step.
       - *Also found and fixed:* the lowpass and the delay hi-cuts run as
         Chromium runs a biquad (double precision, direct form I); the tape
         delay reads its position in double, as Chromium's `Delay` does (an
         f32 position kept only 1/64 of a sample at four seconds); a note
         struck again is a new voice while the last rings out its release
         (Rust used to retrigger the old voice from where it was); the
         classic filter runs always, as a node does (Rust stopped it half a
         second after the last classic note); the face's width knobs reach
         5–95 %.
     - **Not exact, and why**:
       - Chromium's inverse FFT runs in single precision; the Rust tables are
         computed in double and rounded once, so table entries agree to about
         one part in ten million rather than bit for bit.
       - Everything crossing the wasm ABI is an f32 (parameters, a note's
         step), where the browser keeps JavaScript doubles; a time can differ
         by under a microsecond, which moves an event by a frame only when it
         falls that close to a frame boundary.
       - Rust starts a note on a sample; the browser starts an oscillator and
         its automation at the exact fractional time, with a sub-sample phase.
       - The original's timing on its main thread cannot be reproduced: it
         schedules up to 100 ms ahead from a 25 ms timer, so a classic note's
         `cancelScheduledValues` can land after the previous note's release
         ramp has started (jumping it back to the sustain) or not, run to run;
         and in the browser a knob move lands at the next render quantum, in
         Rust at the next sample.
       - A live note (no step) cannot know its gate in advance: from its
         key-up it follows the original's curve, but a key-up inside the
         attack cannot give the silence the original's sorted events give
         before the gate. Sequenced notes are exact.
       - Loading a preset, the original applies the delay wet after the LFO
         sliders, so an LFO whose menus the preset does not store keeps the
         wet from before the preset; here a load is one moment and every LFO
         takes the preset's wet (and LFO 1's stale keys stay fixed, as
         agreed).
       - idMLab's own, not the original's, by RJ's choice (26 Oct 2026):
         velocity is heard (the original plays every note at full level;
         idMLab's sequencers send velocities). Also idMLab's own: the voice
         ceiling (held notes only; the original has none) and all-notes-off
         (Rust releases, Web Audio fades).
       - A fresh synth starts where the original's page does: LFO 1 at 20 % on
         the filter, LFO 2 at 25 % on the pulse width, LFO 3 off, the delay
         25 % wet. A patch saved before those controls existed is given zero
         for them (`missingValue`), so it sounds as it did.
   - Drums: a drum step-programming module (Numerology DrumSeq look: rows per
     pad, per-step velocity, probability, flam/ratchet, swing, per-row length)
     driving `m.percussion`; a 909 starter kit from `Audio - Archival
     LIBRARY/rj_s 909` loadable from the library.
     **Drums built** (branch `sound-drums`).
     - `m.drum-seq` (Sequencers): sixteen rows, ten in play by default, each
       a note (36/38/42/46 first, then the 909 kit's pads and GM's), a name,
       a mute and its own length (polymeter; "Pat" follows the pattern
       length, and *free rows* stops the pattern restarting them). Per step:
       on/off, velocity, chance, flam (grace note up to half a step early, at
       the Flam level) and ratchet (1–8 repeats). MPC swing 50–75 %, rate,
       pattern length up to 64, Play/Stop (stopped keeps its place), ⏮, Sync
       In. Chances are drawn from the project seed, the module's Seed, the row
       and the step's count since the reset, so playback repeats exactly.
       Model `drums/drumSeq.ts`, processor `runtime/drumSeqProcessor.ts`,
       face `ui/mlab/DrumSeqFace.tsx` (the N4 kit, in red).
     - The 909 kit is a manifest (`drums/drumKits.ts`: 36 files, ten pads
       mapped onto Percussion's slots and the first ten rows, hats choked
       together). It loads two ways, through the pool's ordinary decode, so
       the samples get content-hash ids and no audio enters the repo:
       *from the library* — the dev server serves the gitignored library at
       `/__library/<folder>/<file>` (`vite.library.ts`; it looks in
       `$IDMLAB_LIBRARY`, this checkout, then a worktree's main checkout) —
       or *from a folder* the user picks, which also works in a built app.
       Buttons: Percussion's slots (that module) and the sound pool (every
       Percussion module). The Percussion face now shows every slot a kit
       brings and keeps each slot's pan when edited.
     - File › Drum Machine: transport → Drum Sequencer → Percussion → output.
     - No Rust change: the sequencer only sends notes.

## Known facts this rests on

- idMLab's Rust engine runs modules a sample at a time (`dsp-core` `Module`,
  one-sample cable delay); MultiGrainLive's engine is block-based (≤ 8192).
- `m.granular` exists but ignores note pitch; `m.percussion` exists without a
  step sequencer; `m.audio-mixer` is Web Audio only; no LFO module exists.
- prism-fx is a local repo with no commits and no remote; MultiGrainLive
  depends on it by path, and idMLab will too.
