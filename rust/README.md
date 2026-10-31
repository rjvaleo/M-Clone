# `rust/` — the portable DSP core

**Status:** idMLab's default audio engine. `dsp-core` compiled to WebAssembly
(`wasm/`, the `idmlab-engine` cdylib) runs the whole rack in one AudioWorklet;
`?engine=web-audio` asks for the browser's nodes instead, and a build without
the `.wasm` falls back to them by itself. About 450 `#[test]`s across the
workspace (31 October 2026).

Three crates:

| Crate | What it is |
|---|---|
| `dsp-core` | The engine, every module, and the DSP under them |
| `wasm` | The `cdylib` the worklet loads: the engine behind a plain ABI, no `wasm-bindgen` |
| `prism-gen` | Writes `src/modular/registry/prismCatalog.generated.ts` from the prism-fx catalogue |

No dependencies but two of RJ's own, by path: `prism-fx` (the 86 effects
shared with MultiGrainLive) and `prism-grain` (its sound engine, the Grain
Engine here), from the `prism-fx` repository cloned beside this one. Neither
has dependencies of its own.

Architecture: [`IDMLAB_MASTER_PLAN.md`](../IDMLAB_MASTER_PLAN.md) and, for the
audio since October, [`docs/SOUND-PORT-PLAN.md`](../docs/SOUND-PORT-PLAN.md).

```
cargo test --manifest-path rust/Cargo.toml
npm run build:engine   # the .wasm and the worklets into public/
npm run verify:wasm    # build the .wasm and drive it from Node
```

## Why this exists

`IDMLAB_MASTER_PLAN.md` §A.5 says the browser's `AudioContext` and Web Audio
nodes "must not leak into the core protocol." The audio effects in
`src/modular/audio/` were built as a graph of Web Audio nodes, which is the
fastest way to make sound in a browser and cannot leave one. This crate is the
same DSP with no platform attached.

It is also the only way to reach the rest of the specification. Three
limitations in the browser build all have the same root cause:

| Limitation | Cause | Here |
|---|---|---|
| Blackhole's inverse Gravity is not a real reverse | no envelope follower exists in native nodes | onset detection is four lines; `inverse_gravity_suppresses_the_attack` proves it works |
| Shelf resonance is faked with a paired peaking filter | the Web Audio spec says `lowshelf`/`highshelf` **ignore `Q`** | RBJ slope `S` directly; `shelf_slope_above_one_produces_the_resonant_overshoot` |
| DP/4+ feedback routings need a 20 ms loop | Web Audio enforces ≥1 render quantum in any cycle | one sample |

And most of the DP/4+'s other 48 algorithms — splicer pitch shifters, the
Omnipressor's negative ratios, tube waveshaping with dynamic bias, the vocoder,
bit-depth quantisation *inside* a loop — were not reachable at all. `dynamics.rs`
is the proof: Web Audio offers exactly one dynamics processor with a fixed
topology and no sidechain; the six variants the DP/4 needs are forty lines here.

## Layout

`dsp-core/src`:

| Module | Contents |
|---|---|
| `lib.rs` | `flush`, `Smoothed`, `Rng`, `log_map`, the three rules |
| `engine.rs` | `Engine`, `Module`, `Frame` — the rack itself, and parameter modulation routes |
| `modules.rs` | The rack's production modules, `ModuleKind` and their wire numbers; `PrismModule` and `GrainEngineModule` among them |
| `delay.rs` | `DelayLine` (Hermite), `Allpass`, `DiffuserChain` |
| `filter.rs` | `OnePole`, `Biquad` (RBJ, with a real shelf slope) |
| `fdn.rs` | `Fdn` — Hadamard/Householder, Jot two-band decay, level normalisation |
| `dynamics.rs` | `EnvelopeFollower`, `GainComputer`, `HysteresisGate` |
| `reverb.rs` | `Blackhole` and its `Gravity` |
| `dp4.rs` | The ENSONIQ DP/4+ reverbs (`Dp4Reverb`, its algorithm profiles) and Non Lin; the four-unit `Dp4Machine` is in `modules.rs` |
| `osc.rs`, `voice.rs`, `bank.rs`, `envelope.rs`, `lfo.rs`, `modmatrix.rs` | The synth: oscillators, one voice, the voice pool, ADSR, LFOs, the 8 × 12 matrix |
| `tape.rs` | The scale sequencer's ping-pong delay and tape transport |
| `webaudio.rs` | Web Audio's own maths, so the Rust synth sounds as the browser does |
| `sampler.rs`, `samples.rs` | Sample playback (percussion kit, looper) and the bank of host-supplied audio |
| `grain.rs`, `grain_jobs.rs` | Granular scanning on the audio thread; the cloud pad's grains, built off it |

## The rack engine

`engine.rs` is the VCV-Rack-shaped part: one engine owning the sample clock,
advancing every module one sample at a time.

**Every cable carries one sample of delay.** That one decision deletes cycle
detection, topological sort, and the `feedbackBreak` descriptor the delay module
needs today to be allowed through the validator — and it makes patching an
output back into its own input legal, which is the first thing anyone tries in a
modular rack. It also makes evaluation order irrelevant, so the engine is
parallelisable later with no further design.

## Three things the tests found

Recorded because each one would have shipped silently.

**The branchless denormal flush was wrong.** `x + FLOOR − FLOOR` is the standard
trick and it only absorbs values below `f32`'s relative epsilon against `FLOOR` —
so a one-pole decaying toward zero **stalled at 1.88e−37**, right in the denormal
range the flush existed to prevent. It is a comparison now. This matters more on
the web than natively: WASM has no flush-to-zero mode at all.

**A pure delay loses 18% of broadband white-noise energy.** Not a bug — a
four-point Hermite kernel is an interpolating lowpass, so content near Nyquist is
attenuated by about 1.7 dB. The original diffuser test fed it white noise and
expected unity, which measured the interpolator rather than the allpass. Both
behaviours now have their own test.

**A small tank with a long decay is an accumulator.** A feedback network's
steady-state gain is `1/(1−g²)`; at Size 0 with a six-second decay that is ~470×,
and Blackhole peaked at **3877** from unity input. Fixed by scaling the input by
`√(1−g²)` so Size and Decay change the character of the tail and not its
loudness, plus a `tanh` ceiling for the extremes that remain legitimate.

## The WASM number

*A measurement from before the rack was wired in, kept as the reason for the
decision; the shipped module is the whole rack and much larger.*

Measured 2026-08-04 on aarch64-apple-darwin, Rust 1.97.1, release profile with
fat LTO. The module is a `cdylib` shell exporting one `Blackhole` behind a
128-sample quantum — no `wasm-bindgen`, so the size is DSP rather than bindings —
loaded and driven from Node exactly as an `AudioWorklet` would drive it.

| | |
|---|---|
| `.wasm`, raw | **42,102 bytes** |
| `.wasm`, gzipped | **17,106 bytes** |
| Realtime factor at 48 kHz | **113×** |
| One core, one Blackhole | **0.88%** |
| Per sample | 184 ns |

The whole reverb — delay lines, Hermite interpolation, the FDN, the filters —
is 17 KB over the wire and leaves room for roughly 110 instances on one core.
Size is a non-issue and the headroom is not close.

Two caveats on that number. It is Node's V8, not Safari's or Firefox's wasm
engine, and it is one module rather than the full rack, where cache pressure
across many modules is the thing that actually bites. Neither is likely to move
it by the order of magnitude that would change the decision.

## Not done yet

- **No `assert_no_alloc` gate.** Modules allocate only in `new`, and builds
  that do (the Grain Engine's maps) run off the audio thread, but nothing in
  `dsp-core` enforces it. prism-fx's own effects are held to it by its
  counting allocator.
