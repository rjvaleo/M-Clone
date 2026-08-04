# Changelog

All notable changes to M-Clone are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Pre-1.0 releases are
alpha: the interface, the audio rack, and the `.mclone` document may still
change between minor versions.

## [Unreleased] — idMLab, branch `modular`

idMLab is a separate application on the `modular` branch: a node graph with its
own document format (`.mmod`, plus the self-contained `.mmodpack`), not a mode of
M Classic Web. It shares this repository and nothing else. Its state is recorded
in [`MODULAR_STATUS.md`](MODULAR_STATUS.md).

### Added

- **Node graph runtime.** Integer ticks at 960 PPQN, counter-based deterministic
  randomness, an AudioWorklet scheduling wake, tick-matched control values, and a
  compiled plan with cycle rejection and per-node event budgets.
- **Seventeen event modules**, including the Stream and Pattern Editor compounds,
  which materialize into ordinary nodes at compile time rather than adding
  runtime machinery.
- **Audio rack.** Eight effects over one shell, a safety contract that forbids
  topology changes on parameter edits and direct `AudioParam.value` writes, and
  an always-on master limiter.
- **Sound pool.** Content-addressed assets, waveform thumbnails, drag-and-drop,
  audition, and a deterministic synthetic starter kit.
- **Sample players.** Percussion, Looper, and Granular over a shared voice bank
  with audio-clock choke groups and a lookahead grain scheduler.
- **`.mmodpack`** — patch plus audio in one checksummed container.
- **Shared preset pad.** Sixteen numbered slots, one component, every module.
- **Tuning library.** 81 scales in true cents with stable ids, and the pure maths
  that turns a scale degree into a frequency — ported from
  `rjvaleo/scale-sequencer`, with its Raga Marwa data bug and its broken
  below-the-root degrees fixed on the way in.
- **PWM generator.** Fourier coefficients for a pulse of any duty cycle, the
  first piece of the synth ([`MODULAR_SYNTH_PLAN.md`](MODULAR_SYNTH_PLAN.md)).

### Testing

- Coverage measurement extended from Classic's engine and store to **all of
  `src/modular`**, gated in `vitest.config.ts`: 100% of statements, lines and
  functions, branches at 98.5. Writing those tests found four real defects,
  including a runtime crash on a stale plan and voices started after dispose.
- Work is test-first from 2026-08-03.

## [0.8.0-alpha] — 2026-08-02

First public alpha build. M Classic Web is feature-complete against the M 2.7
manual audit apart from the deliberate exclusions listed below; the remaining
1.0 work is the role-specific Classic audio rack, release hardening, and
hardware/browser MIDI certification.

### Added

- **Generative core.** Four Voices, four Patterns, seeded deterministic
  randomness, 960-PPQN shared positions, transport continuity segments, and an
  adaptive-lookahead browser scheduler.
- **Variable Positions (a–f).** Six conductable snapshot positions for Note
  Order, Transposition, Note Density, Velocity Range, Time Distortion, and
  Orchestration, plus six Pattern Group positions.
- **Note Order mixing.** Per-Voice Original / Cyclic Random / Utterly Random
  blend with two draggable boundary handles on the segmented bar.
- **Cyclic Random material.** Pattern-owned scrambled lists with ReScramble,
  Original → Scrambled, and Swap, over a whole Pattern or a selected Region.
- **Pattern Editor.** M-style window with vertical keyboard, dotted step grid,
  region/eraser/plunger/scissors tools, View 1–4 + Size, octave shift,
  drag-to-paint, and grow-only auto-length.
- **Cyclic Variables.** Five-level Accent, Legato, and Rhythm with six
  conductable positions, a reference-derived Classic view, and a Modern view
  exposing all three variables and twelve Voice grids at once. Legato implements
  M's Phrasing model, including overlap beyond 100%.
- **Conducting Window.** Start / Stop / Pause / Sync, six-by-six Baton grid,
  conducted Tempo range, Sync Ratio, bounded Robot Conductor, and pull-out
  per-Voice Continuous Conducting for Velocity Range and Legato.
- **Snapshots and Slideshows.** 26 partial A–Z locations with Hold/Do, editing,
  Blink Everything, recall/erase/restore, and nine timed Slideshows with Record
  Wait and Snapshot-quantized playback.
- **MIDI output.** Web MIDI with timestamped, explicitly ordered Note On / Note
  Off / Program Change events, lifecycle-owned releases, equal-timestamp batch
  submission, and clear-before-panic transport transitions.
- **Live MIDI input.** Sixteen assignable device/channel rows feeding per-Voice
  Source and Use modes, Echo-Thru / Echo Map, Keyboard Transpose, Pattern
  recording, `sa` Step Advance, Mouse Advance, and the Appendix B Input Control
  System. Controller X/Y assignments drive the Baton.
- **MIDI Assignment window.** Sixteen input/output device mappings, output
  latency, program-number base, conducting controllers, and channel messages.
- **Orchestration routing.** Each a–f Orchestration Position stores a
  4-Voice × 16-channel routing matrix; a Voice may layer or be silent.
- **Metronome and MIDI Clock.** 24-PPQN clock output with a single anchor.
- **Built-in Synth.** Four independent click-safe color-coded subtractive
  patches with dual oscillators, sub/noise mixer, routable LFO, resonant
  multimode filter, dual ADSR envelopes, glide, velocity, and master controls.
- **Midi View.** Four-stream diagnostic tracker of generated output.
- **Movies and export.** Performance capture with deterministic format-1
  Standard MIDI File export at 960 PPQN.
- **Project documents.** Versioned `.mclone` JSON (`ProjectDocumentV2`) with
  defensive decoding, v1 migration, and legacy `.json` / `.mclone.json` import.
- **Interface.** Movable window canvas with persisted positions and z-order,
  right-click window launcher, classic global menu, 640 × 480 logical desktop
  with 50–200% scaling, uniform rendered typography, complete four-channel
  theming, and light / dark themes.
- **Distribution.** GitHub Pages deployment on every push to `master`, and a
  self-contained single-file HTML build.

### Not included in this alpha

- Standard MIDI File import and imported Sequence playback (deliberate product
  exclusion for Classic Web).
- Sound Choice (deliberate product exclusion).
- The four role-specific Classic engines — drum sampler, monophonic bass, lead,
  and chord/pad — and the basic stereo mixer, reverb, and delay. The current
  four-patch subtractive Synth is an audition/routing monitor, not the approved
  Classic rack.
- Configurable 1–16 Voice counts; Classic exposes four.
- Native desktop, plug-in, and mobile targets.
- Published supported-browser and MIDI-device matrices. Hardware certification
  requires representative devices and is still in progress.

### Known limitations

- Web MIDI needs a Chromium-based browser, a secure context, and user
  permission. Firefox and Safari have no Web MIDI support; the built-in Synth
  still works there.
- Scheduling runs on the browser main thread with a bounded adaptive horizon.
  Background tabs, heavy pages, and system sleep can stall it; see
  [`docs/MIDI_RELIABILITY_SPEC.md`](docs/MIDI_RELIABILITY_SPEC.md) for the exact
  guarantees and recovery behavior.
- Events more than 20 ms late are dropped; releases and state events are always
  retained.
- Synth patches are application state and are not yet stored in the `.mclone`
  document.
- Long-session CPU/memory, asset-loading, and accessibility audits are release
  hardening work that has not been completed.

### Verification at this tag

- 758 tests across 62 files.
- 184 manual-conformance tests: 167 passed, 17 explicit skips, covering the
  180-capability M 2.7 inventory (163 implemented, 17 documented exceptions).
- 100% statement / branch / function / line coverage across the included engine
  and state modules.
- Clean `tsc --noEmit`, plus successful normal, Pages, and single-file builds.

[0.8.0-alpha]: https://github.com/rjvaleo/M-Clone/releases/tag/v0.8.0-alpha
