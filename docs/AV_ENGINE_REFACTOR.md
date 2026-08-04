# The AV Refactor — what the spec asked for, and what Rust makes possible

**Date:** 2026-08-04
**Status:** proposed
**Source spec:** `ModularAudio_FuncSpec_v11 (1).docx` (33 sections, ~99 KB of text),
read in full for the first time — `MODULAR_AV_SALVAGE_PLAN.md` flagged it as an
open question and analysed only the prototype's JavaScript.
**Builds on:** [`ENGINE_ARCHITECTURE.md`](ENGINE_ARCHITECTURE.md), which decided
the Rust engine. This decides what to do with it.

**The one requirement:** it still runs in a browser, from a URL, with no install.
Everything else — React, Zustand, Vite, the current audio layer — is negotiable.

---

## 1. The finding

The functional spec has a section 33, *Out of Scope — Version 1*. Read it as a
product document and it looks like scoping. Read it next to the Web Audio API
and it is something else: **most of those exclusions are not product decisions,
they are the platform's limits written down as if they were choices.**

| §33 exclusion | Actually excluded because | Under a Rust engine |
|---|---|---|
| CV / modulation routing between nodes | Web Audio has no sample-rate control bus between arbitrary nodes | A cable is a cable; `Frame` already carries 16 channels |
| Multi-channel beyond stereo | Node graph is hardwired to mono/stereo topologies | `MAX_CHANNELS = 16`, already implemented in `engine.rs` |
| Offline / faster-than-realtime bounce | `OfflineAudioContext` cannot host arbitrary custom DSP deterministically | Run the sample loop with no soundcard attached |
| XY Performance Pad | Needs the CV routing above | Falls out of it |
| Tempo sync to DAW | Needs the plugin target | Needs Rust either way |

And two of the **six core pillars** (§1.2) are blocked outright, not merely
degraded:

### Pillar 3 — Live AV Composition

§19.2 defines two visual streams per node and says of the second one:

> Both are already computed by the audio engine — no additional rendering work
> is required.

That sentence is true of an engine you own and false of Web Audio. Stream 2 is
*Playback Data Visualization*: reverb decay curve and RT60 over time, compressor
gain reduction and threshold-crossing events, granular grain positions and
scatter distribution, spectral freeze's frozen spectrum, pitch shifter voice
positions on a pitch grid. **None of that is observable from outside a
`ConvolverNode` or a `DynamicsCompressorNode`.** `AnalyserNode` sees a node's
output, never its internals.

So the spec's central AV idea — "the image is the music" — cannot be built on
Web Audio at all. It can be built almost for free on an engine that already has
those numbers in registers.

### Pillar 6 — Performance Capture and Render

§31.2 Type 3 is *Render from Data*:

> Deterministic — same data produces same output every time.

Web Audio's node implementations are browser-specific and version-specific.
Convolution, compression and oscillator anti-aliasing all differ between Chrome,
Firefox and Safari, and none of them promise bit-reproducibility across
versions. A capture format whose whole premise is "audio is a consequence of the
performance" needs an engine that is deterministic by construction — which is
exactly what `rust/README.md`'s non-negotiables already require (seeded PRNGs
only, no wall-clock reads, explicit denormal flushing).

### The module suite

§20 lists thirteen modules. Four of them have never been attempted, and the
reason is the same each time:

| Module | Needs | Web Audio |
|---|---|---|
| §20.4 Pitch Shifter / Harmonizer, 1–4 voices, **formant correction** | Phase vocoder or PSOLA | No primitive; formants impossible |
| §20.6 Spectral Freeze / Shimmer, **blur** | FFT with per-bin manipulation and resynthesis | No FFT primitive at all |
| §20.10 Granular **Processor** (on a live signal, not a buffer) | Sample-accurate windowed reads of a moving history | A `BufferSource` per grain, of a buffer that doesn't exist yet |
| §20.5 Saturation with Tube / Tape / Clip / Fold **character** | Waveshaping with dynamic bias and hysteresis | One static `WaveShaper` curve |

Plus §21.3's feedback architecture, where any column can route into any other:
Web Audio enforces a minimum of one render quantum (128 samples, 2.7 ms) in any
cycle. `engine.rs` already makes every cable one sample, which is what a physical
patch cable does.

**Summary: two pillars, five §33 exclusions and four modules are gated on the
same decision.** That is a stronger case for the engine than performance ever
was — the 0.88%-per-Blackhole measurement says speed was never going to be the
constraint.

---

## 2. What this refactor is not

**It is not a rewrite of the app.** The parts of idMLab that are good are good
for reasons that have nothing to do with the audio backend, and replacing them
would burn the project's biggest asset: 1,752 tests over a document model,
compiler and runtime that are already correct.

**React stays.** The user's requirement is "runs in a browser"; React is not in
the audio path and never was. Swapping it costs every node face, every editor,
the canvas, the theming system and the DOM-harness work still pending — and buys
nothing measurable. The faces are already a projection of document state, which
is the property that matters.

**The document model, compiler, registry and `.mmod`/`.mmodpack` formats stay.**
They are platform-independent already.

**The musical engine stays in TypeScript for now.** `processors.ts` and
`engine.ts` decide *what notes happen*. They allocate and backtrack by design and
`ENGINE_ARCHITECTURE.md` §2.3 is right that they must not be made real-time safe.
They move to a composer thread eventually for the plugin target, not for this.

What actually gets replaced is **`src/modular/audio/`** — about 5,000 lines that
exist to drive Web Audio nodes.

---

## 3. Target architecture

```
┌─ Main thread ────────────────────────────────────────────┐
│  React faces · canvas · Zustand document                 │
│  compiler · registry · musical runtime (unchanged)       │
└──────────────┬───────────────────────────▲───────────────┘
               │ patch + parameters        │ telemetry
               │ (postMessage)             │ (transferable buffers)
┌──────────────▼───────────────────────────┴───────────────┐
│  AudioWorklet — one node, hosting one WASM instance      │
│  ┌────────────────────────────────────────────────────┐  │
│  │ dsp-core::Engine                                    │  │
│  │   every module a Rust `Module`                      │  │
│  │   one-sample-delay cables · 16-channel frames       │  │
│  │   per-node telemetry taps  ← Pillar 3 lives here    │  │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

**No `SharedArrayBuffer`, deliberately.** SAB is the textbook answer and it
requires COOP/COEP headers, which GitHub Pages cannot set — `ENGINE_ARCHITECTURE.md`
§2.4 flags this as a hosting migration. But the engine does not need SAB to be
correct: the WASM instance lives *inside* the worklet, so audio never crosses a
thread boundary. Only control and telemetry do, and `postMessage` with
transferable `ArrayBuffer`s handles both at 60 Hz without breaking a sweat.

That keeps the deploy story exactly as it is today, and leaves SAB available
later as an optimisation for the composer thread rather than a precondition for
anything. **This removes the only blocking dependency in the whole plan.**

### The seam

`nodes.ts` — the `EffectContext` interface abstracting Web Audio — is what gets
cut. `ENGINE_ARCHITECTURE.md` §2.1 already calls it "the right *place* to cut."
Everything upstream of it survives:

| Layer | Fate |
|---|---|
| `compileAudioPlan.ts` | Kept. Emits an engine patch description instead of a Web Audio plan |
| `audioPlan.ts` structure/parameter split | Kept, and gets simpler — a Rust patch swap needs no crossfade protocol |
| `graphAdapter.ts` | Becomes a message encoder |
| `params.ts` (`rampParam`, the `.value =` ban) | Replaced by `Smoothed` in Rust; the ban becomes structural |
| `transitions.ts` | Mostly unnecessary — swapping a patch in the engine is atomic |
| `nodes.ts`, `effects.ts`, `dp4.ts`, `blackhole.ts`, `reverbTank.ts` | → Rust |
| `synthVoice.ts`, `synthPlayer.ts`, `voices.ts`, `grains.ts`, `voicePool.ts` | → Rust |
| `modMatrix.ts` | → Rust, and finally continuous (see below) |

---

## 4. Staged migration

Ordered so **the app is playable at the end of every stage**, and so the
integration seam is proven before anything is built on top of it — this project
has twice shipped a fully green test suite over an app that made no sound,
because nothing exercised the wire *between* layers.

### Stage 1 — The seam, proven on one module

A `rust/wasm` crate exporting the engine over a quantum buffer; an AudioWorklet
that hosts it; the Gain module and nothing else. Wire it beside the existing
Web Audio path behind a flag, so both can run and be compared.

**Done when:** a patch with one Gain sounds identical through either path, and
an end-to-end test drives document → compiler → worklet → output.

**Status (2026-08-04): proven in a browser; not wired into the app.** The seam
works end to end — the Rust engine makes sound through an AudioWorklet, verified
by rendering and confirmed audibly by ear. Nothing in the app imports it, so the
Web Audio path is still the only one users get.

`public/engine-test.html` is the bench: oscillator → `HostInput` → Rust `Gain` →
`AudioOutput`, with a gain slider for hearing the in-module smoothing. Rendered
through an `OfflineAudioContext`, gain 1.0 gives peak 1.0000, 0.5 gives 0.5000,
1000 clamps to 2.0000, and mute gives 0.0000.

| Piece | Where | Proof |
|---|---|---|
| First production modules — `HostInput`, `Gain`, `AudioOutput` | `dsp-core/src/modules.rs` | 69 `cargo test` |
| The WASM shim | `wasm/src/lib.rs` | 34 checks in `wasm/verify.mjs`, against the real `.wasm` |
| Plan → engine commands | `audio/wasm/engineBridge.ts` | 18 tests, 100% lines/statements/functions |
| The worklet and its build | `audio/wasm/rackWorklet.ts`, `npm run build:engine` | both artifacts build; 31 KB wasm, 22 KB worklet |

Three findings worth carrying forward.

`Engine::add` seeded every parameter to zero, so a module's own defaults were
unreachable and **a gain of 1 read as silence** — the same shape as the missing
note processors, and caught only because the tests were written first. Modules
declare `param_default` now.

WASM has no unsigned integers, so the `NO_MODULE` sentinel (`u32::MAX`) arrives
in JavaScript as `-1`; stored unchecked it becomes a plausible-looking module id.

And the one no unit test could have caught: **`set_io` says where samples are
written, not what is connected.** The host input is a module no document
mentions, so it appears in no plan, and the rack built, wired, reported a
correct graph and rendered silence. The host now feeds every audio input the
patch leaves open — §12.1's Channel source, excluding the Audio Output so an
idle rack stays quiet. It took a browser to see it; `verify.mjs` passed
throughout because it patches that cable by hand.

### The in-app A/B is deferred to Stage 3

The plan called for a flag running both paths side by side. That is being held
back deliberately: the Rust engine has two of the twelve audio modules, so
switching a real patch to it would render mostly silence, and wiring it in now
means either double-rendering the output or a body of conditional code that
Stage 3 deletes. **A comparison is only worth making once both sides can express
the same patch.**

The bench stays the Rust path's proving ground until then — which is also the
arrangement that caught the host-input bug, because the bench went in alongside
the code rather than after it.

**Remaining before Stage 3 can close this out:** the main-thread loader
(`rackNode.ts` has the tested half — the protocol and the engine choice; the
fetch/compile/`addModule` glue is not written), and the A/B itself.

### Stage 2 — The synth, and the LFOs that were never possible

Port `SynthVoice` and the modulation matrix. This is first because it is the
clearest present-day product failure: **the two LFOs are wired to literal zeros**
(`synthPlayer.ts:208`) because the matrix is evaluated once at note-on. §9.6
specifies seven waveforms, tempo sync, phase, and three trigger modes; §9.7
specifies eight sources by twelve destinations, all bipolar, all summing. Making
that continuous in Web Audio needs a `GainNode` per live cell per voice, rebuilt
whenever a routing changes. In Rust it is a loop.

It also removes 9 native nodes constructed and destroyed *per note-on*.

**Done when:** an LFO visibly and audibly modulates a destination, and the matrix
face edits routings live.

**Status (2026-08-04): the synth plays, polyphonically, with a live LFO
routing, in a browser.** Notes cross the full path — keyboard → `WasmRackNode`
→ worklet message → `WasmRack.noteOn` → `Engine::note_on` → `Synth::note_on` →
`VoiceBank` — and a modulation routing set from the page reaches the matrix the
same way. `synthPlayer.ts:208`'s two zeros are no longer the ceiling; the Rust
LFO runs continuously and the matrix is evaluated every sample.

| Piece | Where | Proof |
|---|---|---|
| Oscillator, LFO, envelope, matrix, voice, bank | `dsp-core/src/{osc,lfo,envelope,modmatrix,voice,bank}.rs` | 187 `cargo test` |
| `Synth` engine module, note verbs on `Module`/`Engine` | `dsp-core/src/modules.rs`, `engine.rs` | included above |
| Note and modulation verbs on the WASM ABI | `wasm/src/lib.rs` | `wasm/verify.mjs` sends a note and a routing across the real boundary |
| Plan bridge knows `m.synth`'s 41 parameters | `audio/wasm/engineBridge.ts` | 28 tests |
| Worklet carries notes and routings, not just plans | `audio/wasm/rackWorklet.ts` | protocol extended: `note-on`, `note-off`, `all-notes-off`, `modulation` |
| Main thread can send them | `audio/wasm/rackNode.ts` | 15 tests, including that notes are never deduplicated the way plans are |
| The bench plays it | `public/engine-test.html` | keyboard, filter, envelope, LFO 1 and one live matrix routing, defaulting to LFO 1 → filter cutoff |

Verified by rendering, not by assertion. Through the real worklet in a browser,
with the default routing (LFO 1 → filter cutoff, depth 0.6, rate 2 Hz):

- silent before any note (peak 0.0000)
- a note sounds (peak 0.217–0.267 across runs)
- the timbre visibly tracks the LFO: a normalised-brightness measurement taken
  in ten 100 ms windows across one note reads `0.050, 0.163, 0.050, 0.163, …` —
  a clean, repeating swing, not noise
- note-off silences it once the release finishes, and stays silent

One thing the tests could not catch, because it lives at the message boundary
rather than in either language: **`OfflineAudioContext`'s timeline does not
advance until `startRendering()` is called**, so a `postMessage` sent beforehand
and a `setTimeout` wait beforehand both land at *audio* time zero, not offset
from each other. A first attempt at verifying this stage sent plan, note-on and
note-off all before rendering started and measured total silence — not an engine
bug, a test bug. Fixed by using `ctx.suspend(t)` to act at a specific point in
the rendered timeline, which is also why `rust/wasm/verify.mjs`'s own pattern
waits *before* calling `startRendering()`, never after.

**Known limitation, not fixed here:** `AudioOutput` is mono, and the bench's
`s → out` connection only wires the synth's left output port. Both speaker
channels hear identical audio; pan is real inside the voice (tested at
`voice.rs`) but never reaches two ears from this bench. Stereo through the graph
is its own step — `HostInput`, `Gain` and `AudioOutput` all need to widen, and
the bridge needs to wire two cables per connection instead of one.

**Remaining:** the modulation-matrix *editor* face — the bench exposes exactly
one routing; a real UI for all 96 cells is Stage 4 or later. Oscillators 2 and
3, the filter envelope, and LFO 2 are implemented and tested in Rust but not
yet exposed on the bench page, since the plan scoped the bench to the minimum
that makes the point audible.

### Stage 3 — The effect rack

Port the twelve existing modules onto the proven seam, then add the four that
were never reachable: pitch shifter with formant correction, spectral freeze
(needs an FFT — the first dependency worth taking), granular processor, and the
saturation character models. `dynamics.rs` already demonstrates the pattern.

**Done when:** every §20 module exists and the DP/4's feedback routings run at
one sample instead of 20 ms.

### Stage 4 — Telemetry, and Pillar 3

Per-node telemetry taps: each module publishes its Stream 2 data into a
fixed-size ring the worklet drains once per render callback and posts as a
transferable buffer. The visualisation work from the scale sequencer
(oscilloscopes) lands here, driven by real data rather than an `AnalyserNode`.

**Done when:** a compressor's gain reduction and a granular's grain positions are
drawn from engine data, and §19.1's five visualisation points all render.

### Stage 5 — Deterministic render

With the engine owning every sample, §31.2 Type 3 becomes: replay the delta
stream against the initial snapshot with no audio device attached. Also delivers
the §33 "offline bounce" exclusion and per-column stems.

**Done when:** rendering the same capture twice produces byte-identical audio,
and a test asserts it.

### Stage 6 — CV routing and the free-patch graph

§33's first exclusion. Once cables carry `Frame`s at sample rate, a modulation
output is just a port. The XY Performance Pad falls out of it, as does §21.3's
feedback architecture with real CPU-headroom reporting.

---

## 5. What this costs, honestly

- **Roughly 5,000 lines of TypeScript deleted and rewritten in Rust.** The DSP
  designs are all settled — the effects, players and matrix are working code with
  tests, not open problems. This is translation, not invention.
- **The coverage story changes shape.** v8 coverage cannot see into WASM. Rust
  gets its own `cargo test` gate (57 tests today); the TypeScript gate keeps its
  100% over a smaller surface. Both must be green — neither replaces the other.
- **Two toolchains in CI.** Node and Rust, plus `wasm32` in the build.
- **Debugging gets harder.** A bad sample in Rust is not a breakpoint in DevTools.
  This argues for keeping the fake-context test discipline that already exists and
  porting it into the Rust crate.

## 6. What is not answered yet

- **FFT dependency.** Spectral freeze needs one. `rustfft` is the obvious choice
  and would be the crate's first dependency, against a `Cargo.toml` that argues
  at length for having none. Worth revisiting when Stage 3 gets there.
- **Sample memory.** Players read from decoded audio that currently lives in JS.
  Moving it into WASM linear memory needs a transfer protocol and a budget.
- **The `assert_no_alloc` gate** named in `ENGINE_ARCHITECTURE.md` §7 still does
  not exist.

---

## 7. Immediate next step

Stage 1 is small and settles the riskiest question. Before it, two things on the
floor are worth clearing: the coverage gate is red (task #59 — DP/4 and Blackhole
parameter handlers have never executed), and `rust/` is still untracked
(task #60).
