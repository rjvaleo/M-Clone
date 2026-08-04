# M-Clone

[![Version](https://img.shields.io/badge/version-0.8.0--alpha-E65100)](CHANGELOG.md)
[![Release](https://img.shields.io/badge/release-alpha_prerelease-FF6F00?logo=github)](https://github.com/rjvaleo/M-Clone/releases/latest)
[![GitHub Pages deployment](https://github.com/rjvaleo/M-Clone/actions/workflows/pages.yml/badge.svg)](https://github.com/rjvaleo/M-Clone/actions/workflows/pages.yml)
[![Build Release](https://github.com/rjvaleo/M-Clone/actions/workflows/release.yml/badge.svg)](https://github.com/rjvaleo/M-Clone/actions/workflows/release.yml)
[![Launch M-Clone](https://img.shields.io/badge/Launch_M--Clone-GitHub_Pages-222222?logo=github)](https://rjvaleo.github.io/M-Clone/)

> **Alpha — 0.8.0.** M Classic Web is feature-complete against the M 2.7 manual
> audit apart from documented exclusions, and every gate below is green. It is
> not a 1.0: the role-specific Classic audio rack, release hardening, and
> hardware/browser MIDI certification are still open. The interface and the
> `.mclone` document format may change before 1.0. See
> [`CHANGELOG.md`](CHANGELOG.md) for what this build includes, what it excludes,
> and its known limitations.

**Live web app:** [Launch M-Clone on GitHub Pages](https://rjvaleo.github.io/M-Clone/).
Every push to `master` is tested, compiled, and deployed automatically by
GitHub Actions.

**Downloads:** [the latest release](https://github.com/rjvaleo/M-Clone/releases/latest)
ships a self-contained `m-clone-<version>-standalone.html` (open it directly in a
browser — no server, no install) and `m-clone-<version>-web.zip` (the static
build for your own hosting), with `SHA256SUMS.txt`.

### Current stack and engineering practices

![TypeScript](https://img.shields.io/badge/TypeScript-5.9.3-3178C6?logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/React-18.3.1-61DAFB?logo=react&logoColor=111827)
![Vite](https://img.shields.io/badge/Vite-5.4.21-646CFF?logo=vite&logoColor=white)
![Zustand](https://img.shields.io/badge/Zustand-4.5.7-433E38)
![Vitest](https://img.shields.io/badge/Vitest-2.1.9-6E9F18?logo=vitest&logoColor=white)
![Node](https://img.shields.io/badge/local_verification-Node_24.18.0-339933?logo=node.js&logoColor=white)
![npm](https://img.shields.io/badge/npm-package_tooling-CB3837?logo=npm&logoColor=white)
![Web Audio API](https://img.shields.io/badge/Web_Audio_API-timestamped_synthesis-8A2BE2)
![Web MIDI API](https://img.shields.io/badge/Web_MIDI_API-live_input_%2B_timestamped_output-0A7EA4)
![HTML5](https://img.shields.io/badge/HTML5-semantic_UI-E34F26?logo=html5&logoColor=white)
![CSS3](https://img.shields.io/badge/CSS3-responsive_vector_UI-1572B6?logo=css&logoColor=white)

![TDD](https://img.shields.io/badge/practice-TDD-2E7D32)
![Engine coverage](https://img.shields.io/badge/engine%2Fstate_coverage-100%25_lines%20%7C%20branches%20%7C%20functions-brightgreen)
![Tests](https://img.shields.io/badge/tests-758_passing-brightgreen)
![Typecheck](https://img.shields.io/badge/TypeScript_typecheck-passing-brightgreen)
![Production build](https://img.shields.io/badge/production_build-passing-brightgreen)
![Architecture](https://img.shields.io/badge/architecture-pure_engine_%2B_platform_adapters-44546A)
![Timing](https://img.shields.io/badge/timing-960_PPQN_%2B_adaptive_lookahead-6A1B9A)
![Deterministic](https://img.shields.io/badge/generation-seeded_%26_deterministic-795548)
![Clean room](https://img.shields.io/badge/reimplementation-clean_room-37474F)
![Browser first](https://img.shields.io/badge/platform-browser_first-F57C00)
![Document format](https://img.shields.io/badge/document_format-.mclone_v2-263238?logo=json&logoColor=white)

### Roadmap candidates and targets

![Tauri candidate](https://img.shields.io/badge/Tauri-native_shell_candidate-24C8DB?logo=tauri&logoColor=white)
![Rust candidate](https://img.shields.io/badge/Rust-native_adapter_candidate-000000?logo=rust&logoColor=white)
![WAM exploratory](https://img.shields.io/badge/Web_Audio_Modules-hosting_exploratory-5C2D91)
![Platforms planned](https://img.shields.io/badge/targets-macOS_%7C_Windows_%7C_iOS_%7C_Android-607D8B)
![Editions](https://img.shields.io/badge/editions-Classic_%7C_Studio_%7C_idMLab-7B1FA2)

These badges describe product targets and implementation candidates, not the
current shipped stack. The exact resolved versions, architecture boundaries,
build tools, and current/candidate distinction are in
[`docs/TECH_STACK.md`](docs/TECH_STACK.md).
The exact MIDI guarantees and remaining native work are defined in
[`docs/MIDI_RELIABILITY_SPEC.md`](docs/MIDI_RELIABILITY_SPEC.md).

The current visual-consistency analysis, reference-by-reference delta, menu
ownership audit, and channel-theme architecture are in
[`docs/VISUAL_AUDIT_AND_THEMING.md`](docs/VISUAL_AUDIT_AND_THEMING.md).
The dedicated editor is documented in
[`docs/CYCLIC_EDITOR.md`](docs/CYCLIC_EDITOR.md).
The manual-derived Phrasing/Legato behavior is documented in
[`docs/PHRASING.md`](docs/PHRASING.md).
The four-stream diagnostic tracker is documented in
[`docs/MIDI_VIEW.md`](docs/MIDI_VIEW.md).
Movie capture and deterministic Standard MIDI File export are documented in
[`docs/MOVIES_AND_MIDI.md`](docs/MOVIES_AND_MIDI.md).
The manual/reference parity audit for Patterns, Transport, and Conductor is in
[`docs/PATTERNS_TRANSPORT_AUDIT.md`](docs/PATTERNS_TRANSPORT_AUDIT.md).
The executable 180-capability M 2.7 audit—163 implemented behaviors, 17 explicit
exceptions, and no remaining red work queues—is in
[`docs/MANUAL_CONFORMANCE.md`](docs/MANUAL_CONFORMANCE.md).
The configurable click-safe Web Audio monitor is documented in
[`docs/BUILT_IN_SYNTH.md`](docs/BUILT_IN_SYNTH.md).
The authoritative MIDI timing, transport, lifecycle, verification, and known-
limits specification is
[`docs/MIDI_RELIABILITY_SPEC.md`](docs/MIDI_RELIABILITY_SPEC.md).
The technical-completion sequence for the next session is in
[`docs/NEXT_STEPS.md`](docs/NEXT_STEPS.md).

Current verified checkpoint (**0.8.0-alpha**): **758 passing tests across 62
files**, **100%**
statement/branch/function/line coverage for the included engine and state
modules, clean TypeScript checking, and successful normal and single-file
production builds. The retained M 2.7 manual gap queues are closed. Live MIDI
input, recording, routing, Input Control, Mouse/Step Advance, metronome, clock,
and the sixteen-channel assignment matrix are implemented. Sound Choice and
MIDI import/imported Sequence playback remain intentional exclusions. The next
local frontier is the role-specific Classic audio rack. Hardware/browser MIDI
certification proceeds in parallel when representative devices are available.

Projects save as `.mclone` files. Their payload is readable, versioned JSON,
but it represents the complete musical project—not merely a graph. Legacy
`.mclone.json` and `.json` project files remain importable.

## Documentation index

### Project direction and current state

- [`CHANGELOG.md`](CHANGELOG.md) — released versions, per-release scope,
  exclusions, known limitations, and the verification recorded at each tag.
- [`docs/STATUS.md`](docs/STATUS.md) — authoritative implemented-feature
  scorecard, verification checkpoint, and roadmap status.
- [`docs/TODO.md`](docs/TODO.md) — current open backlog and deferred decisions.
- [`docs/NEXT_STEPS.md`](docs/NEXT_STEPS.md) — ordered technical-completion plan
  with acceptance gates.
- [`docs/MANUAL_CONFORMANCE.md`](docs/MANUAL_CONFORMANCE.md) — exhaustive
  manual capability inventory, behavioral evidence, and explicit exceptions.
- [`docs/HANDOFF.md`](docs/HANDOFF.md) — implementation handoff, working rules,
  architectural decisions, and known development gotchas.
- [`docs/TECH_STACK.md`](docs/TECH_STACK.md) — canonical current dependencies,
  resolved tool versions, architecture boundaries, and roadmap candidates.
- [`docs/M-Clone_Build_Plan.md`](docs/M-Clone_Build_Plan.md) — product vision,
  architecture, technology choices, phased build plan, and native direction.
- [`docs/PRODUCT_RELEASE_ROADMAP.md`](docs/PRODUCT_RELEASE_ROADMAP.md) —
  authoritative Classic/Studio/idMLab editions, browser/desktop/mobile stages,
  free/invite/paid progression, monetization principles, and release gates.

### Audio products and native integration

- [`docs/AUDIO_ENGINE_SPEC.md`](docs/AUDIO_ENGINE_SPEC.md) — four lightweight
  web engines; seven Studio instruments; RJ Vallejo source-library, mixer,
  granular glitch, Smooth Crusher, Spatial Enhancer, and delay specifications.
- [`docs/NATIVE_PLUGIN_SPEC.md`](docs/NATIVE_PLUGIN_SPEC.md) — standalone clock,
  VST3/Audio Unit host synchronization, eight/ten stereo buses, real-time safety,
  host certification, packaging, and native release gates.
- [`docs/BUILT_IN_SYNTH.md`](docs/BUILT_IN_SYNTH.md) — implemented four-stream
  Web Audio monitor, control surface, click correction, and state boundary.

### MIDI, timing, and conducting

- [`docs/MIDI_RELIABILITY_SPEC.md`](docs/MIDI_RELIABILITY_SPEC.md) — canonical
  MIDI timing, transport, event lifecycle, synchronization, limitations, and
  verification specification.
- [`docs/MIDI_VIEW.md`](docs/MIDI_VIEW.md) — four-Voice diagnostic tracker,
  capture semantics, display behavior, and tests.
- [`docs/MOVIES_AND_MIDI.md`](docs/MOVIES_AND_MIDI.md) — manual-derived Movie
  capture, timestamp model, deterministic SMF export, and the import-scope
  decision.
- [`docs/PATTERNS_TRANSPORT_AUDIT.md`](docs/PATTERNS_TRANSPORT_AUDIT.md) —
  corrected Pattern/transport/conductor parity and dependency-bound gaps.
- [`docs/CONDUCTING_WINDOW.md`](docs/CONDUCTING_WINDOW.md) — Conducting Window
  dependency map, transport controls, Baton, tempo, Robot, and implementation
  history.

### Musical editors and commands

- [`docs/CYCLIC_EDITOR.md`](docs/CYCLIC_EDITOR.md) — Classic and Modern Cyclic
  Editor models, positions, values, lengths, interactions, and layout.
- [`docs/CYCLIC_RANDOM_COMMANDS.md`](docs/CYCLIC_RANDOM_COMMANDS.md) —
  Pattern-owned Cyclic Random material, command semantics, invariants, and test
  requirements.

### Interface, layout, and visual system

- [`docs/VISUAL_AUDIT_AND_THEMING.md`](docs/VISUAL_AUDIT_AND_THEMING.md) —
  reference-by-reference visual audit, theme architecture, menu ownership, and
  deferred fidelity work.
- [`docs/WORKSPACE_SCALING.md`](docs/WORKSPACE_SCALING.md) — 640×480 logical
  workspace, application scaling, coordinates, dragging, and persistence.
- [`docs/FONT_SIZE_INVENTORY.md`](docs/FONT_SIZE_INVENTORY.md) — rendered
  typography inventory, normalization rules, and verification notes.

### Source references

- [`reference/README.md`](reference/README.md) — inventory and provenance of the
  manual, screenshots, mockups, and other reference assets.

**A clean-room reconstruction of the classic interactive composing instrument
*M*, rebuilt screen by screen from the manual.**

A modern, browser-first recreation of **M** (David Zicarelli / Joel Chadabe,
Intelligent Music → Cycling '74), extended into an all-in-one generative studio.
Nothing is taken from M's original code — the engine is reverse-engineered from
the manual and by ear, and each window is redrawn as vector UI from the manual's
figures and screenshots. See [`docs/M-Clone_Build_Plan.md`](./docs/M-Clone_Build_Plan.md)
for the full design and roadmap.

## Status

**Unified classic interface — it plays.** A pure, fully-tested generative engine
drives both a built-in WebAudio synth and Web MIDI output, behind a movable
recreation of M's main windows plus dedicated Pattern, Cyclic, and Midi View tools.

![M-Clone at 150% in the Red channel palette, light theme: Patterns, transport,
Snapshot, Pattern Editor, Cyclic Variables, Variables, the Cyclic Editor in
Classic view, the Midi output strip and Midi View, with Transposition,
Orchestration, Velocity Range, Note Density, Note Order, and Time Distortion
open down the right side.](docs/screenshots/m-clone-red-theme.png)

*The full window suite at 150%, Red channel palette, light theme.*

![The same interface at 100% in the Classic four-color palette, showing the
project "Suffix Check.mclone" with the built-in Synth module open alongside
Midi View, the Pattern Editor, the Cyclic Editor, Note Order, Velocity Range,
Note Density, and Transposition.](docs/screenshots/m-clone-classic-theme.png)

*The Classic four-color palette at 100%, with the built-in Synth open. Each
Voice keeps its color across every module.*

Working today:

- Four independent **Voices**, four **Patterns**, a per-step **piano-roll editor**.
- **Variable Positions (a–f):** six snapshot-able positions for Note Order,
  Transposition, Note Density, Velocity Range, Time Distortion, and
  Orchestration — click a cell to activate, click a name to edit per-voice
  values. Pattern Group also has six active/conductable positions.
- **M-style Note Order mixing:** each Voice blends Original Order, a
  stored/repeating Cyclic Random scramble, and continually changing Utterly
  Random playback. Two handles sit directly on the segmented bar: the first
  sets the Original/Cyclic boundary and the second sets the Cyclic/Utterly
  boundary. The solid, gray, and polka-dot regions—and their percentages—update
  continuously while either handle is dragged. The handles stay on fixed sides
  of their boundaries, remain inside the bar at 0% and 100%, and update at most
  once per animation frame for responsive movement. Every a–f Variable Position
  stores an independent mix for all four Voices.
- **Pattern-owned Cyclic Random lists:** ReScramble, Original → Scrambled, and
  Swap Scrambled and Original work on a whole Pattern or selected Region.
  Ordinary Pattern edits automatically maintain the stored repeating copy.
- **Pattern Editor (M-style window):** vertical piano keyboard, dotted step
  grid, region/eraser/plunger/scissors tools, View 1–4 + Size panel, octave
  shift, and a bottom-right size box. **Drag to paint notes on/off**; the grid
  grows by adding **fixed-size** cells (never stretched) both horizontally and
  vertically — the area past the pattern's length is a greyed but fully paintable
  grid, and painting into it **auto-extends the length** to the furthest note
  (grow-only; erasing never shrinks it).
- **Movable window canvas:** every window drags by its title bar to anywhere and
  remembers its position; hairline borders, opaque backgrounds, and the
  last-clicked window comes to the front. Modules keep a fixed size.
- **Window manager:** right-click blank canvas to open any available window.
  The six reference main windows stay open; auxiliary editors and Midi View can
  close and reopen, and all editor windows can coexist without modal overlays.
  Right-clicking occupied module space retains that module's commands and adds
  the same available-window launcher beneath them, so free canvas space is not
  required to open another module.
  New/reopened auxiliaries occupy the leftmost free column beyond the permanent
  modules and stack with 4px padding. Dragged windows snap to nearby aligned
  edges and resolve overlaps on release.
- **Unified window navigation:** every main and auxiliary window uses the same
  compact reference title bar, with window-specific commands available by right-click.
- **Classic global menu:** File, Edit, Variables, Pattern, Windows, and Options
  are restored at the top; the footer is removed so the canvas uses the full
  remaining viewport.
- **Uniform rendered typography:** all panel titles render at 10px in 16px
  chrome, primary controls at 8px, and dense readouts at the 7px compact tier.
- **640 × 480 logical desktop:** the reference composition is the native 100%
  layout. The whole module suite scales from 50–200% in 10% increments, with
  100% and Fit controls and scale-aware dragging, menus, and persistence.
- **Complete channel theming:** four-voice artwork in Patterns, Variables,
  Cyclic, Midi, Pattern Editor, and auxiliary editors follows the global preset
  or custom palette rather than falling back to black and white.
- **Snapshots and Slideshows:** 26 partial A–Z locations with Hold/Do,
  Edit/copy, Blink Everything, recall/erase/restore, plus nine timed
  record/play/pause/loop/stop Slideshows, Record Wait, Snapshot-quantized
  playback, keyboard control, and version-2 persistence with v1 migration.
- **Manual-faithful Velocity Range:** per-Voice shaded low/high range bar drawn
  directly on the axis line — **click-drag on the line to draw the range** —
  plus editable endpoint numericals. Accent 0 is silent; levels 1–4 span the
  selected low→high range.
- **Transport:** Start / Stop / Pause / Sync, Tempo; **Key + Scale** with snap-to-key.
- **Conducting Window:** manual-faithful Start / Stop / Pause / Sync, six-by-six
  Baton grid, conducted Tempo range, Sync Ratio, bounded Robot Conductor,
  reference-colored controls, clipped-safe lower numericals, and pull-out
  per-Voice Continuous Conducting for Velocity Range and Legato.
- **Midi performance strip:** each of six a–f Orchestration Positions stores a 4-Voice × 16-channel
  routing matrix; a Voice can layer across multiple MIDI channels or be silent.
- **Separate Midi Assignment window:** sixteen input/output device mappings,
  latency, program-number base, conducting controllers, and channel messages
  stay in their File-menu setup window instead of expanding the quick strip.
- **Dual output:** built-in synth (zero setup) **and** Web MIDI to any device/DAW.
- **Live MIDI input:** sixteen assignable device/channel rows feed per-Voice
  Source and Use modes, Echo-Thru/Echo Map, Keyboard Transpose, Pattern
  recording, `sa` Step Advance, Mouse Advance, and the Appendix B Input Control
  System. Controller X/Y assignments drive the Baton.
- **Four independent monitor patches:** each stream has its own color-coded,
  click-safe subtractive Synth patch with dual oscillators, sub/noise mixer,
  routable LFO, resonant multimode filter, dual ADSR envelopes, glide, velocity,
  and master controls.
- **MIDI reliability foundation:** shared 960-PPQN positions, per-Voice RNG,
  explicit ordered Note On/Off/Program Change events, lifecycle-owned releases,
  equal-timestamp batch submission, and clear-before-panic transport transitions.
- **Light / Dark themes:** the header toggle re-skins the whole interface between
  coherent light and dark palettes, including Patterns, Conducting, and Midi
  View. Individual module title bars use flat surfaces rather than stripes.

The five-level Accent, Legato, and Rhythm Cyclic Variables drive playback.
Legato is M's Phrasing system: its 6/25/50/75/100% levels scale the actual time
to the next onset and may exceed 100% for overlapping articulation. All three
Cyclic Variables have six conductable, Snapshot/Slideshow-aware Positions.
Their dedicated editor has a reference-derived Classic view and a right-click
Modern view that exposes all three variables and all twelve Voice grids at once.
Time Distortion, Grid conducting, Robot Conducting, and assigned external MIDI
Conducting are active performance paths.

## Run it

One-command control script (starts the dev server and opens the app in your
browser):

```bash
./mclone.sh start     # start + open the app (installs deps on first run)
./mclone.sh stop      # stop the server
./mclone.sh restart   # stop then start
./mclone.sh status    # is it running?
```

Override the port with `MCLONE_PORT=5200 ./mclone.sh start`. Or run it manually:

```bash
npm install
npm run dev
```

Open the local URL Vite prints, press **Start**, edit the grid, activate positions,
and ride the sliders. For MIDI, choose **File ▸ Midi Assignment**, click
**Enable / Refresh MIDI**, and map input/output ports (Chromium browsers). To
build a single self-contained HTML preview: `npm run build:single`
then open `dist-single/index.html`.

## Deploy to GitHub Pages

The live application runs at
[rjvaleo.github.io/M-Clone](https://rjvaleo.github.io/M-Clone/). The tested
`.github/workflows/pages.yml` pipeline rebuilds and deploys it automatically on
every push to `master`; generated files are not committed to the repository.

```bash
npm run build:pages
```

The output is written to `dist-pages/` with `/M-Clone/` asset URLs. The workflow
runs the 100%-coverage product gate and manual-conformance suite before it
uploads that directory. GitHub Pages supplies the HTTPS secure context required
by Web MIDI; device access still depends on browser support and user permission.

## Releases

Releases are cut from annotated tags. Pushing a `v*` tag runs
[`.github/workflows/release.yml`](.github/workflows/release.yml), which checks
the tag against `package.json`, runs the 100%-coverage product gate and the
manual-conformance suite, builds the normal and single-file bundles, and
publishes a GitHub Release with:

| Artifact | What it is |
| --- | --- |
| `m-clone-<version>-standalone.html` | The whole application inlined into one HTML file. Open it in a browser; no server or install. |
| `m-clone-<version>-web.zip` | The static `dist/` build, for hosting on your own domain. |
| `m-clone-<version>-SHA256SUMS.txt` | Checksums for both artifacts. |

Any tag containing `-alpha`, `-beta`, or `-rc` is published as a GitHub
prerelease. Release notes come from the matching section of
[`CHANGELOG.md`](CHANGELOG.md).

To cut one:

```bash
git tag -a v0.8.0-alpha -m "M-Clone 0.8.0-alpha" && git push origin v0.8.0-alpha
```

For MIDI hardware, prefer the hosted
[GitHub Pages app](https://rjvaleo.github.io/M-Clone/) or your own HTTPS host:
Web MIDI requires a secure context and explicit permission, and browsers may
restrict device access for a local file. The built-in Synth works everywhere.

## Develop

```bash
npm test          # unit tests (Vitest)
npm run coverage  # tests + coverage (engine/state held at 100%)
npm run test:watch # interactive test watch mode
npm run typecheck # tsc --noEmit
npm run build     # typecheck + production build
npm run build:pages # typechecked GitHub Pages build in dist-pages/
npm run build:single # self-contained dist-single/index.html
npm run preview   # preview the normal production build
```

## Layout

```
src/
  engine/          framework-agnostic musical core (developed test-first)
    music.ts       scales / key-snapping
    rng.ts         seeded + Brownian randomness
    transform.ts   per-step transform primitives
    planner.ts     the pure scheduler heart
    transport.ts   timing-change continuity segments
    scheduler.ts   adaptive lookahead policy + diagnostics
    events.ts      explicit event protocol + note lifecycle
    eventbatch.ts  versioned adapter-neutral MIDI event batches
    midiinput.ts   normalized live MIDI input and routing helpers
    inputcontrol.ts Appendix B Input Control command mapping
    clockoutput.ts 24-PPQN MIDI Clock scheduling
    movie.ts       performance capture + deterministic SMF encoding
    variables.ts   Variable Positions (a–f) model
    snapshot.ts    partial Snapshot capture/apply + quantization
    slideshow.ts   deterministic recording/playback state machine
    document.ts    defensive JSON v2 codec + v1 migration
    project.ts     defaults
    runtime.ts     Web Audio lookahead scheduler (browser-only wiring)
    outputs/       synth + Web MIDI sinks
  state/store.ts   zustand store (live project document)
  ui/              React — the Unified movable-window canvas, light + dark themes
    Unified.tsx    the canvas and movable application windows
    PatternEditor.tsx  M-style editor (paint, resize, auto-length)
    CyclicEditor.tsx   Classic/Modern five-level cyclic editor
    MidiView.tsx       four-Voice generated-output tracker
    ConductorWindow.tsx transport, Baton, tempo, Robot, and Movie controls
    SynthWindow.tsx    four-patch subtractive monitor control surface
    windowlauncher.tsx canvas-wide auxiliary-window launcher
    useDraggable.ts    draggable/persisted window positions + z-order
  manual/          executable manual capability inventory
docs/              stack, plans, specifications, audits, status, and backlog
reference/         original M manual, screenshots, layout mockup
```

Included engine and state logic are held at **100% statement/line/branch/function
coverage** by Vitest's V8 provider. Browser runtime and Web MIDI behavior also
have fake-clock/fake-scheduler/fake-port tests, while their browser-only adapter
code is excluded from the Node coverage threshold. The browser scheduler wakes
on the main thread with a bounded adaptive horizon; see the reliability
specification for exact guarantees, verification steps, and native requirements.
