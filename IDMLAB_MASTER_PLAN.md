# idMLab — The Build Plan

**Version 3.0 · "Studio Ultra" · the complete build**
**Date:** 2026-08-05 · **Branch:** `modular`

This is the single plan. It replaces every roadmap, status file, next-steps list
and staged refactor note that came before it — those are deleted, and their
content is folded in below. Nothing else in this repository says what to build.

It is written to be followed as a mandate. Where it names a decision, that
decision is made. Where it names a gate, the gate is binding. Where it defers
something, the deferral has a reason attached and a wave to come back in.

**Scope: everything.** Not an MVP. Every feature discussed anywhere in this
project's history — shipped, specified, aspirational, or noted in passing — is
captured here and placed in a wave. Nothing was dropped for being ambitious.

---

## 0. Non-negotiables

These are constraints on every line of work in every wave. A change that
violates one of these is wrong even if it works.

### 0.1 Rust only

**All audio is Rust, compiled to WASM, running in one AudioWorklet.** There is
no second audio backend, no `?engine=` switch, no Web Audio fallback, no
conditional path. `src/modular/audio/` keeps only what is not DSP: the context
lifecycle, asset decoding, the master output connection, and the message bridge.

The consequence is accepted deliberately: **a browser without AudioWorklet or
WebAssembly gets silence and an explicit error, not degraded audio.** Both have
been baseline in every current browser for years. The alternative — maintaining
two implementations of every module forever — costs more than it protects, and
the divergence between them has already produced real bugs.

Web Audio remains in use for exactly three things it is genuinely best at, none
of which are DSP: `AudioContext` lifecycle and device management,
`decodeAudioData` for compressed formats, and the single output node the
worklet writes into.

### 0.2 The engine is deterministic by construction

Seeded PRNGs only. No wall-clock reads inside `process`. Explicit denormal
flushing. No allocation, no locks, no filesystem, no logging on the audio
thread. Every one of these is a build-gate, not a guideline — Wave 0 adds the
`assert_no_alloc` gate that has been owed since the engine was written.

This is what makes offline render, performance capture and the plugin target
possible at all. It is not a stylistic preference.

### 0.3 One identity for every value

Every automatable value has exactly one `ParameterAddress`. Snapshots, macros,
automation lanes, MIDI mapping, the morph engine, host automation, the timeline
and the UI all use that one identity. No subsystem invents its own.

Getting this wrong is the single most expensive mistake available in this
codebase, because every later feature reads it. Wave 2 establishes it before
anything consumes it.

### 0.4 Contracts are total, and the compiler enforces them

Where two vocabularies must agree, a test asserts that the mapping is complete
in both directions and the build fails otherwise. The precedent is
`PARAMS_HANDLED_ELSEWHERE` / `ENGINE_ONLY_PARAMS`, added after a naming
mismatch left the synth's entire filter section inert for three commits while
every test passed.

Apply the same shape to every new registry, table or enum: a `Record<Kind, T>`
rather than a partial map, an exhaustive `match` rather than a `default`, an
explicit exclusion list with a written reason rather than silence.

### 0.5 Tests first, and the browser is the last word

Test-first for everything. 100% statements/lines/functions on `.ts`; `cargo
test` for Rust; `verify.mjs` against the real `.wasm`.

And then look at it in a browser. Every serious defect this project has had was
invisible to a green suite: players with no processor, a rack that rendered
silence because the host input was never wired, a gallery that could not
scroll, a detached `ArrayBuffer`, a filter section wired to nothing. A wave is
not done because its tests pass.

### 0.6 It runs from a URL

No install, no build step for the user, no `SharedArrayBuffer` requirement
(which would need COOP/COEP headers that the current hosting cannot set). The
WASM instance lives *inside* the worklet, so audio never crosses a thread
boundary and only control and telemetry use `postMessage`.

---

## 1. Target architecture

```
┌─ Main thread ───────────────────────────────────────────────────┐
│  React faces · canvas · document · registry · compiler          │
│  musical runtime (event generation — allocates by design)       │
│  parameter registry · morph engine · snapshot & delta store     │
└───────────┬──────────────────────────────────▲──────────────────┘
            │ patch · parameters · notes       │ telemetry
            │ (postMessage)                    │ (transferable rings)
┌───────────▼──────────────────────────────────┴──────────────────┐
│  AudioWorklet — one node, one WASM instance                     │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ dsp-core::Engine                                          │  │
│  │   every module a `Module`                                 │  │
│  │   one-sample cables · 16-channel `Frame` · sample bank    │  │
│  │   per-module telemetry taps · sample-accurate note queue  │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

**The musical runtime stays in TypeScript.** `processors.ts` decides *what notes
happen*; it backtracks and allocates by design and must not be made real-time
safe. It moves to a dedicated composer thread in Wave 10 for the plugin target,
not before, and not for performance.

**The document, registry, compiler and `.mmod`/`.mmodpack` formats stay.** They
are platform-independent already and are the project's most valuable asset.

### 1.1 The application shell — an open decision

`ModularAudio_FuncSpec_v11` §3 describes a shell that idMLab does not have, and
it is not a detail. The spec's application is **column-based and zoned**:

```
┌── Transport bar ─────────────────────────────── fixed, full width ──┐
├── Column headers — sources live here ────────── fixed, anchored ────┤
│  PLAYER    PLAYER    PLAYER    FX BUS   CHANNEL │  G │             │
│  Looper    Granular  Synth              live in │  L │  M          │
├─────────────────────────────────────────────────│  O │  A          │
│                                                 │  B │  S          │
│      effects canvas — the only fluid zone       │  A │  T          │
│      node graphs hang below each column         │  L │  E          │
│      and flow downward · scroll · zoom          │    │  R          │
├── Mixer — one strip per column ──────────────── fixed, bottom ──────┤
└─────────────────────────────────────────────────────────────────────┘
```

Sources at the top, effects in the middle, console at the bottom, master at the
right. Four column types (Player · FX Bus · Channel · Master), four Player
engines (Looper · Granular · Percussion · Synth). The visual language is
deliberately Amiga tracker — OctaMED, ProTracker — because the tracker's column
structure *is* the signal flow, not decoration.

idMLab today is a free-floating node canvas with no zones, no columns, and no
mixer. Both are coherent designs. They are not the same application.

**This plan does not decide it.** Every feature the spec describes is captured
below and every one of them can be built in either shell — a column is a
subgraph with a fixed layout policy, which P6 already gives us. But the shell
choice changes Wave 3 substantially and it belongs to the product, not to me.
Until it is decided, build features shell-agnostically: no feature below may
assume columns, and none may assume their absence.

Three options, for when it is decided:

| | Consequence |
|---|---|
| **Adopt the column shell** | Matches the spec exactly; the mixer, sends, master strip and Performance View all get a natural home; loses free node placement |
| **Keep the free canvas** | Keeps what exists and what users have learned; the mixer and global panel become panels rather than zones; column colour becomes group colour |
| **Both — a view toggle** | The document stays one graph; "column view" is a layout projection over it. Most work, most flexibility, and the only option that needs deciding *before* Wave 3 rather than during it |

---

## 2. The shared spine

This is the most important section in the plan. Almost every unbuilt feature is
blocked on one of a small number of missing primitives, and several features
that look unrelated are the *same primitive* wearing different clothes.

Build the primitive once, in the wave that first needs it, and every later
feature is assembly. Building them per-feature is how a plan this size fails.

### 2.1 Primitives that exist and must be reused, never re-implemented

| Primitive | Where | Everything that must use it |
|---|---|---|
| `Module` trait | `dsp-core/engine.rs` | every DSP node, forever |
| `Shell` (mix · level · mute, always the last three params) | `modules.rs` | every effect |
| `ProcessContext` | `engine.rs` | anything needing the bank or telemetry |
| Structural variants (`add_module_variant`) | `modules.rs` | every topology choice |
| `NoteSchedule` + `process_range` | `noteSchedule.ts`, `wasm/lib.rs` | everything time-addressed |
| `SampleBank` | `samples.rs` | every sample reader |
| `GrainCloud` | `grain.rs` | granular player, looper stretch, granular *processor*, stutter, shimmer |
| `Fdn` + allpass diffusers | `fdn.rs`, `dp4.rs` | every reverb |
| `GainComputer` | `dynamics.rs` | compressor, limiter, gate, ducker, de-esser, sidechain |
| `Biquad` | `filter.rs` | every filter, EQ band, crossover |
| `Adsr` | `envelope.rs` | every envelope |
| `Lfo` | `lfo.rs` | every modulator |
| `ModMatrix` (8 × 12) | `modmatrix.rs` | synth, and later all CV routing |
| `Tracked` / smoothing | `modules.rs` | every parameter, no exceptions |
| Tuning library (81 scales, true cents) | `tuning/` | every pitch decision |
| `PresetPad` (16 slots) | `ui/PresetPad.tsx` | every face |
| `KitFace` (14 control types) | `theme/kits/` | every face |
| `CyclicGrid` | `ui/CyclicGrid.tsx` | every 16-step editor |
| Content-addressed assets | `assets.ts` | all audio, always |
| `.mmod` / `.mmodpack` | `document/` | all persistence |

### 2.2 Primitives to build, and what each unlocks

Each row is a single piece of engineering that pays for several features. The
wave that builds it is the wave its first consumer needs it.

| # | Primitive | Wave | Unlocks |
|---|---|---|---|
| P1 | **Multichannel `Frame` through the graph** — cables carry N channels, not one sample | 1 | stereo everywhere · DP/4+ · buses · mid/side · CV routing · stems |
| P2 | **Multi-port modules** — arbitrary in/out counts, per-port signal type | 1 | DP/4+ (4×4) · mixer · sends/returns · sidechain inputs · analyzers |
| P3 | **Summing bus** | 1 | mixer · sends · returns · master · stems · per-instrument buses |
| P4 | **`ParameterAddress` registry + morph engine** | 2 | snapshots · macros · Performance View · automation lanes · timeline · MIDI mapping · host automation · conducting |
| P5 | **Delta stream** (timestamped parameter/transport/routing layers) | 2 | performance capture · timeline · overdub · deterministic replay |
| P6 | **Nested subgraph compound** (generalised from `m.stream`) | 3 | Banks · Pattern Editor expand · M Classic as one node · user-made macros |
| P7 | **Telemetry taps** — per-module fixed-size ring drained per callback | 5 | meters · node-face status · oscilloscopes · the whole visualizer · Pillar 3 |
| P8 | **History buffer** — bounded circular capture of a live signal | 4 | granular processor · stutter/glitch · live looper capture · freeze |
| P9 | **FFT** (`rustfft`, the crate's first dependency) | 4 | spectral freeze · shimmer · pitch shift with formants · spectrum analyzer · auto-tune |
| P10 | **Offline transport** — run the sample loop with no device attached | 7 | bounce · stems · deterministic render · render-from-data · regression audio fixtures |
| P11 | **UMP event layer** — MIDI 1.0 as one encoding, not the native form | 6 | MIDI in · MPE · per-note expression · MIDI 2.0 · host events |
| P12 | **Play-State stack + trigger engine** — a source holds N states; a trigger source fires one according to a mode | 3 | Looper · Granular · Percussion players · velocity layers · round robin · weighted sequential · flams |
| P13 | **Per-source transport and sync** — sync mode, start offset in bars, phase offset, retrigger, mute/solo | 3 | polyrhythmic entry · the whole §26 phase system · per-player scrub |
| P14 | **Step-sequencer core** — five step types, per-step length, probability, repeat | 3 | Mono Note Sequencer · pattern modules · any future arpeggiator |
| P15 | **Global choke bus** — 16 session-wide groups, cross-source | 3 | drum realism · hi-hat behaviour. **Does not exist in Rust at all** |

**P4 is the keystone.** Snapshots, macros, the Performance View, automation
lanes, the timeline, MIDI learn, conducting and host automation are not seven
features — they are seven surfaces over one parameter registry and one morph
engine. Built once in Wave 2, each of them afterwards is a face and a policy.

---

## 3. The complete feature catalogue

Everything, grouped by what it is. The wave column is where it gets built.

### 3.0 Three product modes, one tool

The funcspec opens with three use cases the plan must not narrow to one. Each is
the same engine with a different entry point.

| Mode | What it is |
|---|---|
| **Automated Visualization** | Drop a finished track on a channel, pick a visual preset, hit render. The system analyses the audio and generates a synchronised visual composition with no performance at all. Wave 8. |
| **Composed AV Performance** | Build inside the environment, perform it, capture it, refine it, render it. Waves 2–7. |
| **Live Performance Tool** | External audio in via the interface, a visual preset per channel, AV output projected or streamed live. Waves 1 and 5. |

### 3.1 Audio — effects

| Feature | Wave | Notes |
|---|---|---|
| Gain, Delay, Reverb (FDN), EQ, Compressor, Limiter, Bit Crusher | ✅ done | in Rust |
| Blackhole, DP/4 Reverb (5 algorithms), DP/4 Non Lin (3 variants) | ✅ done | in Rust |
| **DP/4+ four-unit** with source config and A/B/C/D routing matrix | 1 | needs P1+P2; the one audio module with no engine kind |
| **Mixer** — per-channel level, pan, mute, solo, HPF, sends | 1 | needs P3 |
| **Send / Return / Bus** | 1 | needs P3 |
| **Utility** — gain, phase invert, mono/stereo, mid/side, width | 1 | needs P1 |
| **Feedback module** — the only legal way to close an audio cycle, bounded | 1 | §9.3 requires it |
| **Saturation** — Tube / Tape / Clip / Fold character, dynamic bias, hysteresis | 4 | impossible in Web Audio; trivial in Rust |
| **Smooth Crusher** — bit + rate reduction, pre/post filter, dither, soft saturation, stereo link, transient preservation, mid/side | 4 | supersedes the current Bit Crusher |
| **Chorus / Flanger / Phaser** | 4 | one modulated-delay core, three faces |
| **Stereo Widener** — decorrelation, microshift, frequency-dependent width, mono-safe low end | 4 | |
| **Gate / Ducker / Sidechain compressor** | 4 | reuses `GainComputer` + P2 sidechain input |
| **De-esser** | 4 | `GainComputer` + `Biquad` detector |
| **Tempo Delay** — free/straight/dotted/triplet, linked or independent stereo, ping-pong, filtering, modulation, ducking, freeze/hold | 4 | tempo-aware; reuses the transport |
| **Spatial Enhancer** — room/plate/hall, early reflections, predelay, modulated tails, return EQ, ducking, freeze, infinite tail, mono-compatible low end | 4 | the flagship reverb; reuses `Fdn` |
| **Pitch Shifter / Harmonizer** — 1–4 voices, formant correction | 4 | needs P9 |
| **Granular Processor** — on a live signal | 4 | needs P8 + `GrainCloud` |
| **Granular Stutter / Glitch** — stutter, repeat, freeze, scatter, reverse, scrub, cloud, tape stop, gate, buffer jump; free or sync'd, bar→1/64, dotted/triplet, quantised trigger, probability | 4 | needs P8; the signature effect |
| **Spectral Freeze / Shimmer** — per-bin manipulation, blur | 4 | needs P9 |
| **Spectrum Analyzer** — passes audio unchanged | 5 | needs P9 + P7 |
| **Convolution reverb** | 4 | needs P9. *Previously withdrawn; back in scope for the complete build* |

Parameter detail the funcspec pins down and the plan must honour:

- **Reverb** carries an **Algorithm switch — algorithmic or convolution in one
  module**, not two modules. Plus room size, RT60, pre-delay, damping, diffusion.
- **Delay**: absolute ms *or* tempo-synced divisions, feedback, **mono / stereo /
  ping-pong mode**, **low-cut and high-cut on the feedback path**, sync toggle.
- **Parametric EQ**: four bands minimum, **per-band filter type** — bell, shelf,
  high-pass, low-pass, notch — with frequency, gain and Q each.
- **Compressor/Limiter** is one module with a **Mode switch**, plus knee, and
  wet/dry for parallel compression.
- **Bit Crusher / Decimator**: bit depth 16→4, sample-rate reduction, **noise
  floor**, **dither toggle**, output level, wet/dry for parallel crushing.
- **Spectrum Analyzer**: display range in dB, frequency range/zoom, **average
  mode — instantaneous, peak hold, or averaged**. No audio processing; present
  in the master column by default.
- **Stereo Widener**: width, **mid/side balance**, **bass-mono crossover
  frequency**.
- **Spectral Freeze**: freeze toggle, shimmer amount, **shimmer interval**
  (octave, fifth…), blur.
- **Granular Processor**: grain size, density, scatter, pitch spread, position,
  freeze.

### 3.2 Audio — instruments

| Feature | Wave | Notes |
|---|---|---|
| Synth (3 osc, filter, 2 ADSR, 2 LFO, 8×12 matrix), Percussion, Looper, Granular | ✅ done | in Rust |
| **Synth: expose LFO 1/2, osc semitones, mod wheel, pan on the face** | 1 | already in the engine, unreachable from the UI |
| **Synth: mono/poly switch, 4-voice poly**, legato, retrigger, **glide time + curve**, voice-stealing mode | 4 | today it is 16-voice poly with no mono mode and no glide |
| **OSC 2 hard sync** and **ring modulation** against OSC 1, independently toggleable and combinable | 4 | |
| Oscillator **start phase** (0–360°) and **noise waveform (white / pink)** | 4 | |
| **Filter drive** — pre-filter saturation interacting with resonance | 4 | |
| Filter types: LP12, **LP24**, HP, BP, **Notch** | 4 | |
| Filter envelope **amount is bipolar with an explicit polarity** control | 4 | |
| Amp envelope **velocity sensitivity** | 4 | |
| LFO waveforms incl. **Sample and Hold** and **Smooth Random**; tempo-sync; phase; trigger free / note / **one-shot** | 4 | |
| Synth face as tabs — OSC · FILTER · ENV · LFO · MOD · VOICE — active tab fully visible, no scrolling | 4 | sequencer stays visible below regardless of tab |
| **Modulation-matrix editor face** — all 96 cells | 2 | reuses P4's address model |
| **Role instruments: bass, lead, chord/pad** | 4 | §9.1 items 3–5; presets over the existing synth where possible |
| **12-pad drum sampler** — per-pad sample/level/pan/tune/start/end/attack/hold/decay/filter/drive/velocity/mute/solo/out, layers, round-robin, ≥4 choke groups | 5 | supersedes Percussion |
| Drum deterministic variation — pitch, decay, velocity, sample-start, alternate-sample, probability | 5 | seeded, reproducible |
| Drum specialised shaping — kick body/punch/drop, snare snap/tone, clap spread/repeats, hat tightness/variance, perc transient/resonance, cymbal wash | 5 | |
| **Monophonic bass synth** — 4-osc subtractive, PWM, mono priority, legato, glide, multimode filter, saturation, sub | 5 | macros: Shape, Weight, Bite, Movement, Decay, Glide |
| **Blip lead synth** — pitch-envelope blips, wavefolding, controlled instability | 5 | macros: Blip, Shape, Snap, Tone, Bend, Tail, Dirt, Space |
| **FM chord synth** — 4-operator, curated algorithms | 5 | macros: Ratio, Metal, Bell, Body, Motion, Decay, Spread, Space |
| **Virtual-analog chord synth** — detune, drift, unison, chorus | 5 | macros: Shape, Detune, Color, Cutoff, Movement, Envelope, Width, Air |
| **Pad sample engine** — keymaps, velocity layers, loop/crossfade, reverse, chord/octave modes | 5 | macros: Source, Blur, Color, Motion, Attack, Release, Width, Space |
| **Granular instrument** — position, scan, drift, size, density, spray, pitch variation, window, freeze, spread, bounded feedback | 5 | macros: Focus, Scatter, Cloud, Drift, Freeze, Motion, Width, Distance |
| **Sample library** with stable IDs, metadata, clearance, root note, velocity layers, loop points, choke eligibility, peak/RMS | 5 | web gets a reduced compressed subset |

### 3.2a Play States and the trigger system — P12

The spec's central performance idea, and entirely absent from idMLab. A Player
is not one sample: it is a **stack of Play States**, each a sample plus a
complete settings set, shown as tabs with waveform thumbnails. A trigger source
fires the Player; a trigger mode decides which state sounds.

| Feature | Wave |
|---|---|
| Play State tabs — add, duplicate, reorder, delete; minimum one | 3 |
| Per-state: envelope, loop mode, loop in/out, crossfade width + curve (linear / equal-power / log) | 3 |
| Per-state: playback speed 25–400 %, **time-stretch or varispeed** | 3 |
| Per-state: **playback offset in ms** — flams, humanisation, rhythmic displacement | 3 |
| Per-state: bit depth, sample-rate reduction, **noise floor**, **dither** | 4 |
| Per-state: pitch, level, pan, reverse | 3 |
| **Trigger sources**: global clock (beat/bar/subdivision) · MIDI note (notes address states directly) · manual button · combined | 3 / 6 |
| **Trigger modes**: Sequential · Weighted Sequential · Random (with per-state weights) · Round Robin · Velocity Layered · Manual | 3 |
| Weighted Sequential pattern editor — per-state play counts, cycle length | 3 |
| Percussion: velocity sensitivity per target (level / pitch / cutoff), retrigger cut-or-layer | 3 |
| **16 global choke groups**, cross-column, auto-assigned per column, group 0 = none | 3 |
| Granular: **soft crossfade between states** (10 ms–seconds), grains decay naturally, states overlap | 3 |
| Granular: position + **auto-scan LFO** (rate + direction), manual scrub, **stretch 1×–1000×**, scatter, pitch spread, freeze, stereo spread | 3 |
| Bit crush at two independent levels — per state and as a graph node — compounding | 4 |
| Per-source transport: play · pause · stop · return to start · **scrub on the waveform** | 3 |
| Per-source sync: Free · ½ · 1 · 2 · 3 · 4 bars · custom | 3 |
| **Start offset in bars** and **phase offset within the bar** | 3 |
| Retrigger to the next sync boundary; mute (keeps running in sync, re-enters cleanly); solo | 3 |
| Sources collapsible to a compact strip; user-nameable | 3 |

### 3.2b The Mono Note Sequencer — P14

Ships by default on every Synth; optional on sample players. Mono only. Notes
are quantised to **true scale pitches**, not rounded to 12-TET.

| Feature | Wave |
|---|---|
| **Five step types**: NOTE · REST · **PAUSE** (own duration, so phrases breathe off-grid) · TIE · **SKIP** (takes no time at all) | 3 |
| NOTE step: scale degree, octave, velocity, gate length, **note length independent of step length**, probability, **repeat 1–4**, **per-step step length** | 3 |
| Global: 1–64 steps, direction (forward / reverse / ping-pong / random / **random walk**), scale, transpose, swing, sync | 3 |
| **Root pitch user-definable in Hz** — not locked to A=440 | 3 |
| Per-step velocity routes into the synth mod matrix as the Velocity source | 3 |
| **108 scales in 8 categories** — the library currently holds 81 | 3 |
| Degrees displayed with **exact Hz and cent offset**; click any degree to audition | 3 |
| **88-note keyboard display** showing which keys fall in the selected scale at the current root | 3 |

The 27 scales to add: Partch 43-tone · La Monte Young Well-Tuned Piano ·
Ptolemy's Intense Diatonic · Five-limit and Seven-limit JI · harmonic series
1–16 · quarter-comma meantone · Werckmeister III · Kirnberger III · Vallotti ·
19-, 31-, 53-EDO · 17-, 22-, 72-EDO · Wendy Carlos Alpha/Beta/Gamma ·
Bohlen-Pierce · Makam Ussak · Chahargah · Segah · 22-Shruti · Pelog Selisir ·
Insen · Chinese Gong/Yu · Mongolian pentatonic · Thai Ranat · Gamelan Degung ·
Sanfen Sunyi.

### 3.3 Event modules — the 29 that render and do nothing

Every one has a face and a menu entry today; none has a processor. Grouped by
what they need.

| Group | Modules | Wave |
|---|---|---|
| **MIDI input** | MIDI Input, MIDI Monitor, MIDI Note Decoder, Channel Mapper, Source Channel Filter, CC Mapper, Program Message, MIDI Clock encoder | 6 |
| **Pattern sources** | Pattern Editor (+ expand), Pattern Recorder, Pattern Commands, Note Editor | 3 |
| **Clock utilities** | Sync Divider, Step Advance, Tap Tempo, Reset Trigger, Time Distortion | 3 |
| **Transform** | Orchestration, Sound Choice | 3 |
| **Routing** | Event Splitter, Event Merger, Step Gate, Stream (processor) | 3 |
| **Conducting & control** | Conducting Surface (XY), Position Conductor, Continuous Mapper, Tempo Conductor, Cumulative Transpose | 2 |

The conducting group lands in Wave 2 because conducting *is* the morph engine
driven by a pointer — it is a consumer of P4, not a separate mechanism.

### 3.4 Scenes, macros, performance

| Feature | Wave |
|---|---|
| `ParameterAddress` registry — one identity for every value | 2 |
| Snapshots: capture, recall, exclusions, per-scene topology opt-in | 2 |
| Morph policies: linear · exponential · logarithmic · step-start/mid/end · crossfade · excluded · immediate | 2 |
| Morph interruption from current effective values; reverse recall | 2 |
| Snapshot sequences (Slideshows) — timed record/play/pause/loop/stop | 2 |
| Macros — address, min/max, curve, polarity; effective overrides, never rewriting the base | 2 |
| Performance View | 2 |
| Hold/Do, partial stores, Blink Everything, Restore | 2 |
| Conducting: baton grid, armed arrows, tempo range, robot conductor, sync ratio, continuous conducting | 2 |
| MIDI learn / controller conducting over the same addresses | 6 |

### 3.5 Time — capture, timeline, render

| Feature | Wave |
|---|---|
| Delta stream: initial snapshot + timestamped layers | 2 (format) / 7 (UI) |
| Performance capture: Data Only · Data + Master Audio | 7 |
| Overdub (append layer) · overwrite (explicit destructive range, confirmed) | 7 |
| Editable automation lanes; copy/paste/move/loop/delete | 7 |
| Scrub reconstruction — identical effective values to playback | 7 |
| Soft takeover, in the parameter input adapter | 7 |
| Movie capture (event stream) + deterministic SMF format-1 export | 3 |
| Offline bounce, faster than real time | 7 |
| Per-bus / per-column stems | 7 |
| Render-from-data — byte-identical audio from the same capture, twice | 7 |

### 3.6 Visualisation

| Feature | Wave |
|---|---|
| Telemetry taps per module (P7) | 5 |
| Meters, gain reduction, voice counts on node faces | 5 |
| Oscilloscopes and spectrum displays | 5 |
| **Stream 2 playback visualisation** — reverb decay/RT60, compressor GR and threshold crossings, grain positions and scatter, frozen spectrum, pitch-shifter voice positions on a pitch grid | 5 |
| Detachable Visualizer surface | 8 |
| Preset-driven visual composition engine | 8 |
| **Signal flow on the wires** — amplitude glow (default) · **waveform scrolling along the wire** · frequency colour shift; combinable | 5 |
| Per-module visualisation *character* — reverb tail, delay steps, EQ curve over live spectrum, compressor squashing on transients, Lissajous for width, grain scatter dots, frozen spectrum, quantisation staircase | 5 |
| Viz points: column input · node · bank · column output · master output | 5 |
| Bypassed nodes visualise the dry passthrough; viz is never toggleable off | 5 |
| **Global audio analysis**: amplitude, band levels, transients, **spectral centroid, onset detection, pitch tracking, stereo width** | 5 |
| Visualizer **recomposes, never re-renders** — same data, no chrome, zero extra cost | 8 |
| Master preset layer: composition rules · effect stack (blur, kaleidoscope, feedback, colour mapping, particles, waveform draw, geometric, glitch) · audio mappings · exposed parameters | 8 |
| **Preset library and subscription model** — new preset sets on a cadence; presets exportable to other applications; the subscription adds, never gates | 8 |
| Fullscreen; output at 1080p / 4K / custom | 8 |
| Video capture / render integration | 8 |

### 3.6a Banks and the patch bay

A bank groups instances of one module type side by side, with its own routing
mode. Named in the plan before; specified in full here.

| Feature | Wave |
|---|---|
| Bank container, label, mode toggle, bypass, **wet/dry defaulting to 50/50** | 3 |
| Serial mode — in → A → B → C → out | 3 |
| Parallel mode — in splits to all slots | 3 |
| **Per-node output routing**: Collapse to Master · Individual Out · Individual + Master | 3 |
| Bank dry reference is the signal **as it arrived at the bank input**, before any node | 3 |
| Collapsible patch bay panel (chevron, right edge; indicator when connections exist) | 3 |
| Patch-bay ports: Master In · Master Out · **Dry Tap** · **Wet Tap** (post-processing, pre-blend) · per-slot In · per-slot Out | 3 |
| Free patch routing inside a bank — any out to any in, hybrid serial/parallel | 3 |
| External signals patchable into individual slots; slot outs patchable out of the bank | 3 |
| Cables colour-coded **by source node**; feedback connections warn and require confirmation | 3 |
| Node wet/dry default **100 % wet**; bank default 50 % | 1 |

### 3.6b The shell, views, and the flag system

Depends on §1.1 being decided. Everything here is shell-agnostic except where
marked.

| Feature | Wave |
|---|---|
| **The flag system** — every parameter is Default · Performance · Always-On, set by right-click | 2 |
| Performance-flagged parameters change to the accent colour in Edit View and render **larger** in Performance View | 2 |
| Always-On elements cannot be flagged off: transport, BPM, master level and metering, mixer faders and mutes, CPU meter, global panel | 2 |
| Edit View ↔ Performance View, instant, single button, no state change | 2 |
| Macro strip at the top of Performance View; clicking it opens the Timeline | 2 |
| **Global Panel** — right edge, full height, always visible in both views; snapshots live here. Design reference: M by Intelligent Music | 2 |
| Column/group identity colour propagating to header, cables, mixer strip, timeline lanes and viz borders | 3 |
| *(shell)* Fixed zones: transport top · headers · global panel right · mixer bottom · master strip | 3 |
| *(shell)* Fluid effects canvas — the only zone that scrolls and zooms | 3 |
| *(shell)* Four column types and right-click instantiation with an engine submenu | 3 |
| *(shell)* Default rack on new FX Bus / Channel: **Limiter → EQ → Compressor**, all active, all removable | 3 |
| *(shell)* Column reorder by dragging headers; remove with confirmation when non-empty | 3 |
| **VAST preset** shipped in the node browser — giant algorithmic reverb, tempo-synced dripping delay, chorus/flanger with depth and width | 4 |
| Amiga-tracker visual language — deep charcoal ground, monospace, uppercase headers, grid discipline, colour as signal identity | 3 |

### 3.6c Mixer, transport, and export

| Feature | Wave |
|---|---|
| Channel strip: label · **one send knob per FX Bus, appearing automatically** · pan · mute · solo · peak meter · fader | 1 |
| Sends selectable **pre- or post-fader**, per send | 1 |
| Channel source: interface input · another column's output · **combined** | 1 |
| Column-into-column: **Mute from Main Mix** vs **Keep in Main Mix** (parallel processing at column level) | 1 |
| Master strip: output viz · fader · **peak and RMS meters** · limiting indicator · graph access | 1 |
| Master default chain: Compressor → Limiter (−0.1 dBFS) → Spectrum Analyzer; cannot be removed, individually bypassable | 1 |
| **Play resets the clock to Bar 1 Beat 1**; offset columns wait silently then enter | 3 |
| **Stop is musical** — tails decay naturally. **Pause is surgical** — instant, no tails | 3 |
| Transport bar: BPM (click to edit, scroll to nudge) · tap tempo · time signature · position · master sync toggle · **CPU meter** · view switchers | 3 |
| **Export lives in the master strip, never a dialog**: REC MODE (DATA / DATA+AUDIO / RENDER) · WRITE MODE (OVERDUB / OVERWRITE, warning colour) · Record · Render · format/depth/rate (WAV / AIFF / MP3) · **video toggle** | 7 |

### 3.6d Preferences, sessions, and windows

| Feature | Wave |
|---|---|
| Audio output and input device selection; **sample rate 44.1 / 48 / 96 kHz**; buffer size showing samples *and* resulting latency | 1 |
| Input and output channel assignment to columns | 1 |
| Device disconnect → warning and fallback to the system default | 1 |
| Preferences: default session location · **autosave interval** · **undo depth (default 30)** · theme · MIDI device | 3 |
| **Undo: 30 levels, per window**, with a dismissible warning at exhaustion. Not undoable: captured audio, file operations, preferences | 3 |
| Undoable: every parameter, node/bank create-delete-move, connections, column ops, routing, Play State changes, snapshots, **flag assignments** | 3 |
| **Session folder** — session file + `audio/` + `captures/`, referenced by relative path; the folder is the portable unit | 3 |
| Every file copied in on first save; missing file → indicator on the Play State and a locate-or-replace dialog | 3 |
| Pool Manager modal — waveform previews, metadata, audition, add without assigning, remove only if unassigned, **replace a file without disturbing the states that use it** | 3 |
| **Multi-window sessions**: each session its own window, any number open, **only the foreground window makes sound**, no auto-resume on refocus | 8 |
| Save · Save As (copy becomes active, previous goes to background) · Load and New (open in a new foreground window) | 8 |

### 3.7 Canvas, interaction, accessibility

| Feature | Wave |
|---|---|
| Drag-to-patch | ✅ done |
| Measured port geometry; pointer-anchored eased zoom | ✅ done |
| **Multi-select and marquee** | 3 |
| **Node grouping** | 3 |
| **Searchable module menu**; filtered creation from a pending connection | 3 |
| **Compatible-port highlighting** | 3 |
| **Keyboard patching, and a keyboard path for every pointer gesture** | 3 |
| Non-interactive threshold below 0.6 zoom | 3 |
| Full a11y pass — labels, focus order, roles, reduced motion | standing track |
| Themes: light/dark, six palettes, Theme Studio, kit system | ✅ done |

### 3.8 Documents and persistence

| Feature | Wave |
|---|---|
| `.mmod` schema v2 with v1 migration; `.mmodpack` bundle | ✅ done |
| **Autosave + crash/reload recovery** | 3 |
| **Standard M import** with an explicit conversion report | 8 |
| Unknown-module preservation with actionable migration info | 3 |
| Workspace preferences kept out of portable project state | ✅ done |
| Preset stable IDs and schema versions across every module | 2 |
| Migration fixtures for every released schema version | standing track |

### 3.9 Native, plugin, and the far horizon

| Feature | Wave |
|---|---|
| UMP-shaped event layer (P11) | 6 |
| MPE and per-note expression | 6 |
| **CV routing between any nodes** at sample rate | 9 |
| **XY Performance Pad** | 9 |
| Signed macOS + Windows standalone | 10 |
| VST3 instrument; Audio Unit where the host behaves | 10 |
| Eight stereo buses (Main, Drums, Bass, Blip, FM, Analog, Pad, Grain + returns) | 10 |
| Host transport sync, automation queues, offline render state | 10 |
| Host certification matrix — Live, Logic, Cubase, Reaper, Bitwig, Studio One, FL | 10 |
| External MIDI clock, Start/Continue/Stop, Song Position Pointer, optional Ableton Link | 10 |
| M Classic as a single compound node inside idMLab | 9 |

---

## 4. The waves

Each wave leaves the app playable, tested, and better than it was. Each has a
gate that is a demonstration, not a checkbox.

### Wave 0 — Rust only

Delete the second audio engine.

1. Make Rust the only path. Remove `preferredEngine`, the `?engine=` parameter
   and every branch that asks which backend is running.
2. Delete `graphAdapter`, `effects`, `players`, `synthPlayer`, `synthVoice`,
   `voices`, `nodes`, `voicePool`, `grains`, `reverbTank`, `blackhole`, `dp4`,
   `transitions`, `params` — roughly 4,000 lines of source and as much test.
3. Keep and re-point: `audioEngine` (context lifecycle, master connection),
   `assets`, `decode`, `aiff`, `waveform`, `kit`, `audition`, `masterChain`.
4. Fail loudly: no AudioWorklet or no WebAssembly produces a named, visible
   error, never silence.
5. Add the `assert_no_alloc` gate to `dsp-core`.
6. Expose the synth's existing LFOs, oscillator semitones, mod wheel and pan on
   its face — they are implemented in Rust and unreachable.
7. **Do not regress choke groups.** They exist only in the Web Audio `voices.ts`
   this wave deletes, and `sampler.rs` has none. Either port a minimal choke to
   the Rust sampler in this wave or accept a named, tracked gap until P15 —
   silently losing it is not an option (D1).

**Gate:** the word "web-audio" appears nowhere in `src/modular/audio/` except in
the comment explaining why the context still exists. A patch with a synth, three
effects and a sampler plays correctly. Coverage and `cargo test` both green.

### Wave 1 — The signal spine

P1, P2, P3. This is the wave that makes the engine an audio system rather than a
chain of mono boxes.

1. `Frame` through the graph: cables carry channels, connections carry a channel
   count, the compiler validates width.
2. Stereo end to end — `AudioOutput`, `HostInput`, `Gain` widen; the worklet
   writes two real channels; the synth's pan reaches two ears for the first time.
3. Multi-port modules: arbitrary in/out counts with per-port signal type.
4. Summing bus, Mixer, Send, Return, Utility, Feedback module.
5. DP/4+ four-unit with its routing matrix — the first consumer of P2.

6. Mixer strips, sends (pre/post fader), master strip with peak and RMS meters,
   the default master chain, and the audio device / sample rate / buffer
   preferences.

**Gate:** a patch with two instruments into a mixer, one send to a shared
reverb, panned hard left and right, sounds correct in both ears; the DP/4+
routes four units; a feedback path is bounded and does not run away.

### Wave 2 — The parameter spine

P4 and P5. The keystone.

1. `ParameterAddress` registry over every module parameter.
2. Morph engine with the seven policies; interruption and reverse.
3. Snapshots: capture, recall, exclusions, optional topology.
4. Snapshot sequences.
5. Macros.
6. Performance View.
7. Conducting modules — baton grid, armed arrows, tempo range, robot, sync
   ratio, continuous conducting — as consumers of the morph engine.
8. The modulation-matrix editor face, over the same address model.
9. Delta-stream *format* (the UI is Wave 7), so capture can begin recording
   before the timeline exists to edit it.
10. **The flag system** — Default / Performance / Always-On per parameter, set
    by right-click. It is a field on the parameter address, which is why it
    lands here rather than in the canvas wave.

**Gate:** recall a snapshot mid-performance and hear a click-free morph; a macro
moves twelve parameters at once; the baton conducts tempo and three variables
simultaneously; snapshots round-trip through `.mmod` exactly.

### Wave 3 — The performance model, the event side, and the canvas

The app becomes complete as an instrument. This is the largest wave and it grew
again when the funcspec was ingested, so it runs as **two halves that can be
taken in either order**:

- **3A — the performance model.** P12, P13, P14, P15, banks, the sequencer, the
  scales. This is what the funcspec is mostly about, and none of it exists.
- **3B — the event side and the shell.** The 29 inert modules, the canvas
  interaction work, persistence, and whatever §1.1 decides.

Splitting them is allowed. Skipping the gate is not.

1. Pattern Editor with a real processor and an expand command; Note Editor;
   Pattern Recorder; Pattern Commands (ReScramble, Original→Scrambled, Swap —
   §A.1).
2. Clock utilities: Sync Divider, Step Advance, Tap Tempo, Reset Trigger, Time
   Distortion.
3. Orchestration, Sound Choice.
4. Event Splitter, Event Merger, Step Gate, Stream processor.
5. P6 — generalise `m.stream`'s compound into a reusable nested subgraph.
6. Movie capture and deterministic SMF format-1 export (§A.3).
7. **P12 — Play States and the trigger engine**; **P13 — per-source sync and
   offset**; **P14 — the step-sequencer core** and the Mono Note Sequencer;
   **P15 — the global choke bus**. These four are the spec's performance model
   and the largest single gap it exposed.
8. **P6 consumers**: Banks, their routing modes, per-node output routing, and
   the patch bay with its dry and wet taps.
9. The 27 additional scales, the exact-Hz/cent degree display, and the 88-note
   keyboard view.
10. Canvas: multi-select, marquee, grouping, searchable menu, compatible-port
    highlighting, keyboard patching, low-zoom non-interactive threshold.
11. Autosave and crash recovery; unknown-module preservation; undo bounded to 30
    and no longer cleared on save (D7).
12. Whatever §1.1 decides about the shell.

**Gate:** every module in the registry does something when patched. Four sources
with different sync modes and start offsets enter at their own bars and drift
into a new phase relationship from one Play press. A hi-hat in choke group 3
cuts another column's open hat. A complete piece can be built, played, saved,
recovered after a forced reload, and exported as a MIDI file.

### Wave 4 — The effect rack, completed

P8 and P9 arrive here.

1. History buffer (P8) and FFT (P9).
2. Saturation characters; Smooth Crusher; Chorus/Flanger/Phaser; Stereo Widener;
   Gate/Ducker/Sidechain; De-esser; Tempo Delay; Spatial Enhancer.
3. Pitch Shifter/Harmonizer with formant correction.
4. Granular Processor; Granular Stutter/Glitch.
5. Spectral Freeze/Shimmer; convolution reverb.
6. Role instruments: bass, lead, chord/pad.

**Gate:** every §20 module exists; the DP/4's feedback routings run at one
sample rather than one quantum; a spectral freeze holds a chord indefinitely.

### Wave 5 — Instruments, and telemetry

1. P7 — telemetry taps.
2. Meters, gain reduction, voice counts, oscilloscopes, spectrum displays.
3. Stream 2 playback visualisation for every module that has internals worth
   seeing.
4. The 12-pad drum sampler with deterministic variation and specialised shaping.
5. Bass, Blip, FM chord, virtual-analog chord, pad sampler, granular instrument.
6. Sample library with full metadata.

**Gate:** a compressor's gain reduction and a granular's grain positions are
drawn from engine data rather than inferred; all seven instruments play.

### Wave 6 — MIDI, properly

1. P11 — UMP-shaped event layer; MIDI 1.0 becomes one output encoding.
2. MIDI Input, Monitor, Note Decoder, Channel Mapper, Source Channel Filter,
   CC Mapper, Program Message, MIDI Clock encoder.
3. MIDI learn over `ParameterAddress`.
4. MPE and per-note expression.
5. Latency compensation; device loss, reconnect, permission failure.

**Gate:** a controller plays and conducts the app; hot-unplug leaves no hanging
notes; the 16×16 assignment matrix round-trips.

### Wave 7 — Time

P10 arrives here.

1. Offline transport — run the sample loop with no device.
2. Performance capture: Data Only and Data + Master Audio.
3. Timeline Window: lanes, scrub, overdub, explicit overwrite, copy/paste/move/
   loop/delete, soft takeover.
4. Bounce; per-bus stems; render-from-data.

**Gate:** rendering the same capture twice produces byte-identical audio, and a
test asserts it. Scrub and playback resolve identical effective values.

### Wave 8 — Visualizer, and import

1. Detachable Visualizer surface.
2. Preset-driven visual composition engine.
3. Video capture / render integration.
4. Standard M import with an explicit conversion report.

**Gate:** visual output consumes existing telemetry without altering audio or
causing back-pressure. A Classic project opens as an editable graph of ordinary
modules.

### Wave 9 — CV and the free-patch graph

1. CV routing between any nodes at sample rate — a modulation output becomes an
   ordinary port.
2. XY Performance Pad.
3. M Classic as a single compound node.
4. Real CPU-headroom reporting.

**Gate:** an LFO module patched into any parameter of any other module
modulates it at audio rate.

### Wave 10 — Native and plugin

Follow §A.5. Standalone macOS and Windows; VST3; Audio Unit where the host
behaves; eight stereo buses; host transport and automation; the certification
matrix; the composer thread.

**Gate:** the published host matrix passes. A host is advertised only after its
own matrix passes.

---

## 5. Standing tracks

Continuous, not scheduled. Every wave carries them.

- **Accessibility.** Every new control keyboard-reachable and labelled; focus
  visible; reduced motion respected. The kit sliders' null `aria-label` is the
  current known debt.
- **Browser verification.** Nothing is done until it has been seen working.
- **Migration fixtures.** Every released schema version keeps a fixture.
- **The DOM test harness.** Faces carry real behaviour now; they need coverage.
- **Documentation.** This file is the only plan. Update it in the same commit
  as the work — never a separate cleanup pass.

---

## 5a. Divergences between the funcspec and the build

Found by reading the spec against the code. Each needs a decision, and each is
cheap now and expensive after something depends on it.

| # | The spec says | The build has | Call |
|---|---|---|---|
| D1 | **16 global choke groups**, cross-column | **Nothing.** Choke lived in `voices.ts` (Web Audio) and Wave 0 deletes it; `sampler.rs` has no choke at all | Wave 0 must not ship a choke regression. Build P15 in Wave 3, or hold the deletion of that one behaviour |
| D2 | Mod sources: LFO 1/2, Filter Env, Amp Env, Velocity, **Key Follow**, Mod Wheel, **Aftertouch** | LFO 1/2, Amp Env, Filter Env, Velocity, **Note**, Mod Wheel, **Random** | `Note` *is* key follow under another name — rename. `Random` is ours and worth keeping. Aftertouch needs MIDI in, so the matrix goes to 9 sources or Random yields |
| D3 | Mod destinations include **OSC 1 PWM, OSC 2 PWM, Amp Level** | Has **LFO 1 Rate, LFO 2 Rate, Volume** instead | PWM destinations are the bigger musical win — PWM is the reason the Fourier generator exists. Widen to 15 destinations rather than trade |
| D4 | **108 scales** in 8 named categories | 81 | Add the 27 named in §3.2b |
| D5 | Synth is **mono or 4-voice poly**, with glide | 16-voice poly, no mono mode, no glide | Add mono + glide; keep the higher poly ceiling as ours |
| D6 | Sessions are **folders** — session file + `audio/` + `captures/`, relative paths | Single-file `.mmod` plus `.mmodpack` bundle | Both are right for different targets. Browser keeps the bundle; native gets folders. Do not force one |
| D7 | Undo is **30 levels, per window**, survives everything except file ops | Unbounded stack, **cleared on every New / Open / Save** | The clearing is a defect, not a policy. Fix in Wave 3 |
| D8 | Reverb has an **algorithm/convolution switch** in one module | Two separate ideas | One module, structural variant — the mechanism already exists |
| D9 | Play States, trigger modes, per-source sync | Percussion has note→sample slots only | P12 and P13. The single largest gap the spec exposed |
| D10 | **Only the foreground window makes sound** | Single window, no rule | Wave 8, with the multi-window model |

## 6. Decisions of record

Settled. Do not reopen without a stated reason.

- **Rust only.** No fallback, no flag. §0.1.
- **Bypass is a mute; `mix = 0` is the pass-through.** A bypassed node stays
  wired and costs two ramps to restore.
- **Wet at zero keeps DSP alive; bypass does not.**
- **The limiter is a safety device, not an effect** — always on, not patchable,
  after the master gain. Its knee stays hard; its mix is adjustable.
- **One filter per voice.** A shared filter is what made the source synth's
  cutoff knob cancel the envelopes of notes already scheduled.
- **Choke and note timing are scheduled on the audio clock**, never fired on
  message arrival.
- **Assets are content-addressed.** The same file dropped twice is one asset; a
  renamed file is the same sample; an edited one is not.
- **The document stores the manifest, never the audio.** `.mmodpack` is how a
  project travels.
- **Notes carry a required `detuneCents` and a required `nodeId`.** Both were
  optional once; both were silently dropped; both cost real bugs.
- **`process_range` is the only render loop.** `process_quantum` is that call
  over the whole buffer.
- **Structure rebuilds, parameters ramp.** The split is declared in the
  descriptor, not inferred.
- **Fonts are catalogued, not shipped** — licensing. Only the stacks are wired;
  DSEG and Silkscreen are the OFL replacements if this ever ships.
- **AIFF is decoded in-app** because Chromium has no decoder and a real library
  is mostly AIFF.
- **No `SharedArrayBuffer`.** §0.6.
- **Sequence import/playback stays out.** Movie export stays in.

---

## Appendix A — Inherited specifications

Folded in from documents this plan replaces, at implementation fidelity.

### A.1 Pattern commands (M 2.7 ch. 7, 21, 22)

A Pattern holds two parallel lists: **Original** (visible in the editor) and
**Scrambled** (stored, used by Cyclic Random playback), plus a
`scrambleGeneration` counter. Scrambled is Pattern-owned material, not a
transient per-Voice permutation — so two Voices reading one Pattern share one
scramble, and a command issued during playback is visible on the next window.

| Command | Whole pattern | Region |
|---|---|---|
| ReScramble | new ordering of Scrambled; Original untouched | reorder only inside the span |
| Original → Scrambled | copy Original over Scrambled | copy only the corresponding steps |
| Swap | exchange the two lists | exchange only inside the span; its own inverse |

Regions: `null` means the whole pattern, endpoints inclusive, reversed endpoints
accepted, spans clamped. The shuffle seed derives from project seed + pattern
identity + generation, never from playback time. **Don't Scramble Rests**
preserves rest positions through any reordering.

### A.2 Phrasing / Legato (M 2.7 pp. 81–84)

Phrasing is *not* a separate variable — it is the Legato Cyclic Variable.
Six Positions, one cycle per Voice, 1–16 steps, five levels (0–4). One global
set of value numericals applies everywhere; the manual's defaults are **6, 25,
50, 75, 100 %**. A Legato value is sustain as a percentage of the actual
interval from this onset to the next, after Rhythm and Time Distortion; values
may exceed 100 % (400 % overlaps the next three notes). A vertical level range
picks a level within the inclusive range, seeded. Rhythm decides when Legato and
Accent advance: every generated event *or rest* advances all three cycles one
shared step. Snapshots store the active Position only, never cycle contents.

### A.3 Movie and SMF export (M 2.7 ch. 12, 15)

Movie is a separate consumer of the planner stream — it never scrapes a view and
never records audition notes. Arm before Start; the previous completed take is
retained until the armed one receives output; Stop finalises. The 960-PPQN
transport is the canonical timestamp, so a pause creates no hole while tempo
changes are retained as tempo-map events at the first affected tick.

Export is deterministic SMF format 1: one conductor track of tempo meta-events,
one track per used Voice, 960 PPQN, channels 1–16 converted to 0–15 nybbles,
Note Off ordered before a retriggering Note On at the same tick, all data
clamped to valid MIDI ranges.

### A.4 Conducting (M 2.7 ch. 8, 15, 22)

Six-by-six dotted grid; the baton's x/y maps into each armed arrow's direction,
right and down increasing, left and up reversed. Tempo Range sets the low/high
band over which tempo is conducted; editing the range makes its midpoint the
current tempo. The Robot Conductor moves the baton automatically within
horizontal and vertical jump ranges, paced by a time base. Sync Ratio stores the
relationship between the quarter-note pulse and MIDI clock output, reversible.
Pause stops scheduling and resumes from the same musical position; Sync resets
Voices and Cyclic Variables to step 1.

Conducting targets: Tempo, Pattern Group, Note Density, Velocity Range, Note
Order, Transposition, Time Distortion, Orchestration, and the Cyclic Positions.
Velocity Range and Legato additionally support Continuous Conducting.

### A.5 Real-time safety (native and worklet alike)

The processing thread must never: allocate or free, take a lock, parse JSON,
touch UI objects, load samples, hit the filesystem or network, log
synchronously, run an unbounded algorithm, or trigger GC.

It must: preallocate every buffer and history, use bounded lock-free queues,
read immutable compiled state, publish atomically at safe boundaries, bound CPU
per block, flush denormals, and transition click-free.

Native deliverables and gates: signed macOS and Windows standalone; VST3;
Audio Unit where the host behaves; eight stereo buses; host sample position,
block size, tempo, signature, play state, loop range, seek discontinuities,
offline state, sample rate; per-host certification covering scan, instantiate,
automation, presets, bus activation, multiple instances, rate and block changes,
bypass/suspend, offline render, freeze/bounce, missing library recovery and
crash containment.

### A.6 Timing and MIDI invariants

Ten rules that must remain true after every change touching time or output.
They were earned across three phases of reliability work and are cheap to break
by accident.

1. One shared start/sync timestamp for every Voice.
2. One clock anchor per output batch.
3. Stable ordering for equal-time events.
4. Output submission occurs **before** UI telemetry.
5. Stop / Pause / Sync / output-switch cancellation precedes panic or restart.
6. Tempo and tempo-map edits never reinterpret elapsed real time.
7. Random activity in one Voice never changes another Voice.
8. No stale Note Off survives a same-pitch retrigger in the lifecycle queue.
9. Musical tick positions never depend on React, the store, Web MIDI or Web
   Audio.
10. Unsupported functionality is labelled unsupported rather than silently
    absent.

**Clock domains**, kept distinct and converted explicitly: musical tick (960
PPQN) · real time (`AudioContext` seconds) · output time (`DOMHighResTimeStamp`
for Web MIDI). The planning window is `[now, now + 120 ms)`, adaptively bounded
to 80–250 ms, with the scheduler wake injected (25 ms in the browser adapter).

**Note lifecycle.** Future Note Offs stay in the lifecycle queue until they
enter a scheduling window, keyed by destination + channel + pitch with a unique
`noteId` per instance. A repeat of the same destination/channel/pitch before the
old release: remove the old pending Note Off, insert an old-owner Note Off at
the replacement timestamp, follow it with the replacement Note On at the same
timestamp, then give the replacement its own future Note Off. This is a
deterministic retrigger policy, not reference-counted overlapping polyphony —
two Voices deliberately sharing a pitch retrigger one another. Multi-owner merge
would need an explicit product decision and new conformance traces.

Panic resets pending lifecycle state as well as device state, and is asserted
against the sounding-note shadow rather than against a CC 123 having been sent.

**Never claim zero jitter.** The browser build's honest claim is bounded,
measured scheduling with documented recovery behaviour.

### A.7 Classic heritage worth keeping

The Classic product line (on `master`) implemented a great deal that idMLab has
not yet matched: 26-location snapshots with quantised recall, nine timed
Slideshows, Hold/Do and partial stores, the Cyclic Editor, the four-lane Midi
View, the 16×16 MIDI assignment matrix, controller conducting, metronome and
24-PPQN clock output, the 640×480 scaled workspace, and six channel palettes.

These are not lost — they are the reference implementations for Waves 2, 3 and
6. Read them on `master` when building the modular equivalents.

---

## Appendix B — What was deleted, and why

**Sources fully ingested into this plan:**
`ModularAudio_FuncSpec_v11 (1).docx` — 33 sections, ~99 KB, read in full on
2026-08-05. It is the origin document for the AV product and had never been read
directly by this repository's plans, only summarised secondhand. Everything in
it is captured above; §5a records the ten places where it disagrees with what is
built.

The following were removed on 2026-08-05 when this plan replaced them. All are
recoverable from git history; their content is folded in above.

`MODULAR_IMPLEMENTATION_PLAN.md` · `MODULAR_STATUS.md` · `MODULAR_STREAM_PLAN.md`
· `MODULAR_NEXT_STEPS.md` · `MODULAR_SYNTH_PLAN.md` · `MODULAR_AV_SALVAGE_PLAN.md`
· `MODULAR_MODULE_MAP.md` · `RUST_PORT_STATUS.md` · `docs/AV_ENGINE_REFACTOR.md`
· `docs/ENGINE_ARCHITECTURE.md` · `docs/AUDIO_ENGINE_SPEC.md`
· `docs/NATIVE_PLUGIN_SPEC.md` · `docs/MIDI_RELIABILITY_SPEC.md`
· `docs/PRODUCT_RELEASE_ROADMAP.md` · `docs/STATUS.md` · `docs/TODO.md`
· `docs/NEXT_STEPS.md` · `docs/HANDOFF.md` · `docs/M-Clone_Build_Plan.md`
· `docs/STAGE2_COMPLETION_PLAN.md` · `docs/CONDUCTING_WINDOW.md`
· `docs/CYCLIC_RANDOM_COMMANDS.md` · `docs/CYCLIC_EDITOR.md` · `docs/PHRASING.md`
· `docs/MOVIES_AND_MIDI.md` · `docs/MIDI_VIEW.md` · `docs/BUILT_IN_SYNTH.md`
· `docs/MANUAL_CONFORMANCE.md` · `docs/PATTERNS_TRANSPORT_AUDIT.md`
· `docs/VISUAL_AUDIT_AND_THEMING.md` · `docs/FONT_SIZE_INVENTORY.md`
· `docs/WORKSPACE_SCALING.md` · `docs/TECH_STACK.md`
· `.github/agents/modular-next-steps.agent.md`

Kept, because they are data rather than plans: `README.md`, `CHANGELOG.md`,
`reference/**` (panel images and their catalogue), `fonts/CATALOG.md` (per-file
licence findings), `rust/README.md` (the crate's real-time non-negotiables).
