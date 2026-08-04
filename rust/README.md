# `rust/` — the portable DSP core

**Status:** standing on its own. Builds, tests, and is **not yet wired into the app.**
57 tests passing, clippy clean, no dependencies. Verified on real hardware
(aarch64-apple-darwin, Rust 1.97.1) and on `wasm32-unknown-unknown` — see
[The WASM number](#the-wasm-number).

Architecture and migration order: [`docs/ENGINE_ARCHITECTURE.md`](../docs/ENGINE_ARCHITECTURE.md).

```
cargo test  --manifest-path rust/dsp-core/Cargo.toml
cargo clippy --manifest-path rust/dsp-core/Cargo.toml --all-targets
```

## Why this exists

`docs/NATIVE_PLUGIN_SPEC.md` §10 says the browser's `AudioContext` and Web Audio
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

| Module | Contents |
|---|---|
| `lib.rs` | `flush`, `Smoothed`, `Rng`, `log_map`, the three rules |
| `delay.rs` | `DelayLine` (Hermite), `Allpass`, `DiffuserChain` |
| `filter.rs` | `OnePole`, `Biquad` (RBJ, with a real shelf slope) |
| `fdn.rs` | `Fdn` — Hadamard/Householder, Jot two-band decay, level normalisation |
| `dynamics.rs` | `EnvelopeFollower`, `GainComputer`, `HysteresisGate` |
| `reverb.rs` | `Blackhole` |
| `engine.rs` | `Engine`, `Module`, `Frame` — the rack itself |

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

- **The crate has no `cdylib`.** It builds for `wasm32-unknown-unknown` as an
  `.rlib`, which proves the code is portable but produces nothing loadable. The
  measurement above used a throwaway shell crate. Step 5 needs a real one — a
  thin `wasm/` member exporting the engine over a shared buffer.
- **Not wired to the app.** `src/modular/audio/` still uses its Web Audio node
  graph. Migration path is in `docs/` — the `EffectContext` seam is where a
  WASM-backed implementation slots in without touching the registry or the UI.
- **DP/4 tanks not ported.** Only `Blackhole` is here. The plate/room/hall
  profiles and Non Lin live in `src/modular/audio/dp4.ts` and port onto `Fdn`
  and `DiffuserChain` directly.
- **No `assert_no_alloc` gate.** The crate allocates only in `new`, but nothing
  enforces it yet.
