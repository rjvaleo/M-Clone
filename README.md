# M-Clone

### Current stack and engineering practices

![TypeScript](https://img.shields.io/badge/TypeScript-5.9.3-3178C6?logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/React-18.3.1-61DAFB?logo=react&logoColor=111827)
![Vite](https://img.shields.io/badge/Vite-5.4.21-646CFF?logo=vite&logoColor=white)
![Zustand](https://img.shields.io/badge/Zustand-4.5.7-433E38)
![Vitest](https://img.shields.io/badge/Vitest-2.1.9-6E9F18?logo=vitest&logoColor=white)
![npm](https://img.shields.io/badge/npm-package_tooling-CB3837?logo=npm&logoColor=white)
![Web Audio API](https://img.shields.io/badge/Web_Audio_API-timestamped_synthesis-8A2BE2)
![Web MIDI API](https://img.shields.io/badge/Web_MIDI_API-timestamped_output-0A7EA4)
![HTML5](https://img.shields.io/badge/HTML5-semantic_UI-E34F26?logo=html5&logoColor=white)
![CSS3](https://img.shields.io/badge/CSS3-responsive_vector_UI-1572B6?logo=css&logoColor=white)

![TDD](https://img.shields.io/badge/practice-TDD-2E7D32)
![Engine coverage](https://img.shields.io/badge/engine%2Fstate_coverage-100%25_lines%20%7C%20branches%20%7C%20functions-brightgreen)
![Tests](https://img.shields.io/badge/tests-657_passing-brightgreen)
![Typecheck](https://img.shields.io/badge/TypeScript_typecheck-passing-brightgreen)
![Production build](https://img.shields.io/badge/production_build-passing-brightgreen)
![Architecture](https://img.shields.io/badge/architecture-pure_engine_%2B_platform_adapters-44546A)
![Timing](https://img.shields.io/badge/timing-960_PPQN_%2B_adaptive_lookahead-6A1B9A)
![Deterministic](https://img.shields.io/badge/generation-seeded_%26_deterministic-795548)
![Clean room](https://img.shields.io/badge/reimplementation-clean_room-37474F)
![Browser first](https://img.shields.io/badge/platform-browser_first-F57C00)
![Document format](https://img.shields.io/badge/document_format-JSON_v2-263238?logo=json&logoColor=white)

### Planned platform stack

![Tauri planned](https://img.shields.io/badge/Tauri-native_shell_planned-24C8DB?logo=tauri&logoColor=white)
![Rust planned](https://img.shields.io/badge/Rust-native_timing_planned-000000?logo=rust&logoColor=white)
![WAM planned](https://img.shields.io/badge/Web_Audio_Modules-instrument_host_planned-5C2D91)
![Platforms planned](https://img.shields.io/badge/targets-macOS_%7C_Windows_%7C_iOS_%7C_Android-607D8B)
![Editions](https://img.shields.io/badge/editions-Classic_%7C_Studio_%7C_Modular-7B1FA2)

Badges labeled **planned** describe the roadmap, not current shipped capability.
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
The authoritative MIDI timing, transport, lifecycle, verification, and known-
limits specification is
[`docs/MIDI_RELIABILITY_SPEC.md`](docs/MIDI_RELIABILITY_SPEC.md).
The technical-completion sequence for the next session is in
[`docs/NEXT_STEPS.md`](docs/NEXT_STEPS.md).

Current verified checkpoint: **657 passing tests across 34 files**, **100%**
statement/branch/function/line coverage for the included engine and state
modules, clean TypeScript checking, and successful normal and single-file
production builds. P3 is complete for the selected scope (Sound Choice remains
intentionally skipped). Movie capture/SMF export and the focused
Patterns/Transport/Conductor audit are complete; MIDI import and Sequence
playback are next.

## Documentation index

### Project direction and current state

- [`docs/STATUS.md`](docs/STATUS.md) — authoritative implemented-feature
  scorecard, verification checkpoint, and roadmap status.
- [`docs/TODO.md`](docs/TODO.md) — current open backlog and deferred decisions.
- [`docs/NEXT_STEPS.md`](docs/NEXT_STEPS.md) — ordered technical-completion plan
  with acceptance gates.
- [`docs/HANDOFF.md`](docs/HANDOFF.md) — implementation handoff, working rules,
  architectural decisions, and known development gotchas.
- [`docs/M-Clone_Build_Plan.md`](docs/M-Clone_Build_Plan.md) — product vision,
  architecture, technology choices, phased build plan, and native direction.
- [`docs/PRODUCT_RELEASE_ROADMAP.md`](docs/PRODUCT_RELEASE_ROADMAP.md) —
  authoritative Classic/Studio/Modular editions, browser/desktop/mobile stages,
  free/invite/paid progression, monetization principles, and release gates.

### Audio products and native integration

- [`docs/AUDIO_ENGINE_SPEC.md`](docs/AUDIO_ENGINE_SPEC.md) — four lightweight
  web engines; seven Studio instruments; RJ Vallejo source-library, mixer,
  granular glitch, Smooth Crusher, Spatial Enhancer, and delay specifications.
- [`docs/NATIVE_PLUGIN_SPEC.md`](docs/NATIVE_PLUGIN_SPEC.md) — standalone clock,
  VST3/Audio Unit host synchronization, eight/ten stereo buses, real-time safety,
  host certification, packaging, and native release gates.

### MIDI, timing, and conducting

- [`docs/MIDI_RELIABILITY_SPEC.md`](docs/MIDI_RELIABILITY_SPEC.md) — canonical
  MIDI timing, transport, event lifecycle, synchronization, limitations, and
  verification specification.
- [`docs/MIDI_VIEW.md`](docs/MIDI_VIEW.md) — four-Voice diagnostic tracker,
  capture semantics, display behavior, and tests.
- [`docs/MOVIES_AND_MIDI.md`](docs/MOVIES_AND_MIDI.md) — manual-derived Movie
  capture, timestamp model, deterministic SMF export, and remaining import work.
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
  Baton grid, conducted Tempo range, Sync Ratio, and bounded Robot Conductor.
- **Per-voice Midi:** channel, program, transpose, velocity range, density, legato.
- **Orchestration:** each of six a–f Positions stores a 4-Voice × 16-channel
  routing matrix; a Voice can layer across multiple MIDI channels or be silent.
- **Dual output:** built-in synth (zero setup) **and** Web MIDI to any device/DAW.
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
Time Distortion, Grid conducting, and the Robot Conductor are audible; external
Midi-Conduct remains a visual option until MIDI controller assignment lands.

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
ride the sliders. For MIDI, click **Enable MIDI** and pick an output (Chromium
browsers). To build a single self-contained HTML preview: `npm run build:single`
then open `dist-single/index.html`.

## Develop

```bash
npm test          # unit tests (Vitest)
npm run coverage  # tests + coverage (engine/state held at 100%)
npm run test:watch # interactive test watch mode
npm run typecheck # tsc --noEmit
npm run build     # typecheck + production build
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
    useDraggable.ts    draggable/persisted window positions + z-order
docs/              build plan, status, and UI to-dos
reference/         original M manual, screenshots, layout mockup
```

Included engine and state logic are held at **100% statement/line/branch/function
coverage** by Vitest's V8 provider. Browser runtime and Web MIDI behavior also
have fake-clock/fake-scheduler/fake-port tests, while their browser-only adapter
code is excluded from the Node coverage threshold. The browser scheduler wakes
on the main thread with a bounded adaptive horizon; see the reliability
specification for exact guarantees, verification steps, and native requirements.
