# Engine Architecture — the Rust core

**Status:** decided; partially implemented
**Supersedes:** the audio-layer half of `TECH_STACK.md`
**Complements:** `NATIVE_PLUGIN_SPEC.md`, `AUDIO_ENGINE_SPEC.md`, `MIDI_RELIABILITY_SPEC.md`

## 1. The decision

**One Rust engine owns the sample clock and runs the entire module graph at
sample rate. Everything else observes.**

The reference point is VCV Rack, and the property worth stealing is not that it
is native — it is that a single engine advances every module one sample at a
time on the audio thread, with the UI strictly outside the path. Sample-accurate
CV, working feedback, a module SDK anyone can write against, and timing that
cannot be perturbed by a dropped frame all fall out of that one arrangement.

The current architecture cannot get there by increments. It has two separate
worlds — a TypeScript musical engine driving Zustand, and a Web Audio node graph
making sound — and they have no shared clock. Every timing guarantee in
`NATIVE_PLUGIN_SPEC.md` §4 is unreachable while that is true.

## 2. What gets thrown away

Listed with what it costs, because each one is load-bearing today.

### 2.1 `EffectContext` and the Web Audio node graph — **toss**

`src/modular/audio/nodes.ts` abstracts Web Audio behind an interface, which was
the right call for a browser app and is the wrong shape for a portable one: it
is nodes-and-connections, not samples. `NATIVE_PLUGIN_SPEC.md` §10 already
forbids it from reaching the core protocol.

- **Cost:** all twelve audio modules rewritten in Rust. The `inputFor`/`outputFor`
  multi-port work becomes redundant — the whole rack becomes one Rust graph, so
  there is no adapter left to teach about ports.
- **Gain:** one DSP implementation for web, standalone and plugin. Removes the
  three ceilings documented in `rust/README.md`, and unblocks roughly 48 DP/4+
  algorithms that a node graph cannot express at all.
- **Verdict:** unambiguous. The seam is still the right *place* to cut; a
  WASM-backed implementation slots in behind it during migration.

### 2.2 Cycle rejection and `feedbackBreak` — **toss**

`validateGraph.ts` rejects patches whose graph has a cycle, and the delay module
carries a `feedbackBreak` descriptor to be granted an exception.

**Replace with: every cable carries one sample of delay.** A reader sees what a
writer produced on the previous sample, so any graph is computable. Cycle
detection, topological sort and the exception mechanism all disappear together.

- **Cost:** 20.8 µs of phase per cable at 48 kHz. Two chained modules are two
  samples behind. Inaudible, and it is what a physical patch cable does anyway.
- **Gain:** musicians can patch an output back to its own input — the single
  most obvious thing to try in a modular rack, currently a validation error.
  It also makes evaluation order irrelevant, which means the engine is
  parallelisable later with no further design work.
- **Verdict:** take it. Implemented and tested in `rust/dsp-core/src/engine.rs`.

### 2.3 The musical engine in TypeScript — **port to Rust, on its own thread**

The hard one, and the largest single job. `planner.ts`, `runtime.ts`,
`transform.ts`, `scheduling.ts` are the product's brain and are not real-time
safe: they allocate, backtrack, and think.

They must **not** be made real-time safe. They belong on a dedicated non-UI
**composer thread** running ahead of the clock, writing timestamped events into
a lock-free queue that the audio thread drains sample-accurately.

- **Cost:** the biggest migration in the plan. Determinism must be preserved
  exactly — same seed, same project, same tempo map, same event trace.
- **Gain:** `NATIVE_PLUGIN_SPEC.md` §4 becomes satisfiable. Identical musical
  decisions in standalone and plugin, and no coupling to frame rate, because the
  planner is not on the UI thread and never was going to be fast enough to be.
- **Verdict:** required. Nothing else makes the plugin target real.

### 2.4 GitHub Pages as the web deployment — **move, don't drop**

`SharedArrayBuffer` needs COOP/COEP headers and Pages cannot set them.

- **Cost:** move to a host that can (Cloudflare Pages, Netlify). Roughly an hour.
- **Alternative:** `coi-serviceworker` injects the headers and works, at the cost
  of a service worker in the critical path.
- **Verdict:** move the host. The web build stays; only its address changes.

### 2.5 `vite-plugin-singlefile` — **keep, with a caveat**

The self-contained HTML build survives, but a WASM core has to be base64-inlined,
which costs 33% size. Fine for a demo artefact; not the primary distribution.

### 2.6 100% coverage on `engine/state` — **keep, split it**

Becomes two gates: `cargo llvm-cov` for Rust, V8 for the remaining TypeScript.
No loss, some CI plumbing.

## 3. Shape

```
┌───────────────────────────────────────────────────────────────┐
│  UI — React, in a webview                                     │
│  · rack surface, cables, module faces, project editing        │
│  · observes telemetry; never in the audio path                │
└──────────────┬────────────────────────────────────────────────┘
               │ commands ↓            telemetry ↑
               │ (lock-free ring buffers, no locks either way)
┌──────────────┴────────────────────────────────────────────────┐
│  Composer thread — the musical engine, ported                 │
│  · planner, transforms, scheduling, document model            │
│  · runs ~200 ms ahead of the clock                            │
│  · emits timestamped events into the event queue              │
│  · may allocate, may think; is not real-time                  │
└──────────────┬────────────────────────────────────────────────┘
               │ timestamped events
┌──────────────┴────────────────────────────────────────────────┐
│  Audio thread — Engine                                        │
│  · owns the sample clock                                      │
│  · drains events to the exact sample                          │
│  · advances every module one sample at a time                 │
│  · allocates nothing, locks nothing, never blocks             │
└───────────────────────────────────────────────────────────────┘
```

Host adapters wrap the audio thread and nothing else: `cpal` for standalone,
a plugin framework for VST3/AU/CLAP, an `AudioWorklet` for the web.

## 4. Targets and the framework choice

`NATIVE_PLUGIN_SPEC.md` names Logic Pro in the candidate host matrix, and
**Logic does not load VST3.** That single fact decides the plugin framework:

| Option | VST3 | CLAP | AU | Notes |
|---|---|---|---|---|
| `nih-plug` | yes | yes | **no** | Pure Rust, excellent, cannot reach Logic |
| `nih-plug` + `clap-wrapper` | yes | yes | yes | Wraps CLAP as AUv2. Less battle-tested |
| JUCE + Rust staticlib | yes | via wrapper | yes | C++ shell, `cbindgen` FFI, proven at this matrix |

**Recommendation: start on `nih-plug` for CLAP and VST3**, because it keeps the
whole stack in one language and one build. Add AU via `clap-wrapper` and fall
back to a JUCE shell only if the host matrix demands it. Do not commit to JUCE
before the certification matrix says it is needed — a C++ shell is a permanent
tax on every build.

Standalone: **Tauri v2 + `cpal` + `midir`**, already named as a candidate in
`TECH_STACK.md`.

## 5. UI

**Keep React, run it in a webview.** Tauri for standalone; the plugin's webview
for hosted builds.

- 250 KB of working, tested UI survives. `ModularApp.tsx` alone is 89 KB.
- The audio thread is fully independent, so webview jank costs frames, not notes
  — which is precisely the separation `NATIVE_PLUGIN_SPEC.md` §8 asks for.
- **Risk:** VCV renders hundreds of modules and live cables in OpenGL. A webview
  dragging a cable across a large rack may not hold 60 fps.
- **Mitigation:** the rack surface is already a browser app at today's module
  counts, so the risk is measurable rather than theoretical. Profile at 100
  modules before committing further; a native surface can replace only the rack
  canvas later without touching the rest of the UI.

## 6. Migration order

Each step leaves the app working.

| # | Step | Done when |
|---|---|---|
| 1 | **DSP core in Rust** — primitives, FDN, filters, dynamics, Blackhole | ✅ 57 tests passing, clippy clean |
| 2 | **Engine** — modules, cables, one-sample delay, sample-rate handling | ✅ implemented and tested |
| 3 | **WASM build verified** — `wasm32-unknown-unknown`, size and speed measured | ✅ 17 KB gzipped, 113× realtime, 0.88% of a core per Blackhole — see [`rust/README.md`](../rust/README.md#the-wasm-number) |
| 4 | Port the remaining audio modules to Rust `Module` impls | — |
| 5 | Swap the browser audio layer for one `AudioWorklet` hosting the engine | web build sounds identical |
| 6 | Command/telemetry ring buffers; UI drives the engine through them | Zustand no longer touches audio |
| 7 | Port the musical engine to the composer thread | determinism traces match TypeScript exactly |
| 8 | `cpal` standalone shell under Tauri | audio without a browser |
| 9 | `nih-plug` CLAP/VST3; AU via `clap-wrapper` | loads in Live and Logic |
| 10 | Host certification matrix | per `NATIVE_PLUGIN_SPEC.md` §6 |

Steps 3–5 are the ones that de-risk everything after them, because they prove the
same Rust code runs in a browser and natively with no divergence.

## 7. Non-negotiables

Carried from `NATIVE_PLUGIN_SPEC.md` §7 and enforced in the Rust core:

- Nothing allocates after construction. Add an `assert_no_alloc` gate in CI.
- Nothing panics. Every index is masked, every parameter clamped.
- Everything is sample-rate independent; coefficients derive from `sample_rate`.
- Denormals are flushed explicitly — WASM has **no** flush-to-zero mode, so the
  platform will not do it for us.
- Determinism: seeded PRNGs only, no wall-clock reads, no `Math.random`.
