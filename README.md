# M-Clone

The current visual-consistency analysis, reference-by-reference delta, menu
ownership audit, and channel-theme architecture are in
[`docs/VISUAL_AUDIT_AND_THEMING.md`](docs/VISUAL_AUDIT_AND_THEMING.md).
The dedicated editor is documented in
[`docs/CYCLIC_EDITOR.md`](docs/CYCLIC_EDITOR.md).
The four-stream diagnostic tracker is documented in
[`docs/MIDI_VIEW.md`](docs/MIDI_VIEW.md).
The technical-completion sequence for the next session is in
[`docs/NEXT_STEPS.md`](docs/NEXT_STEPS.md).

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
  Transposition, Note Density, Velocity Range, and Orchestration — click a cell to activate, click a
  name to edit per-voice values.
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
- **Snapshots:** 26 A–Z locations, quantized recall, erase, and one-step restore.
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
- **Light / Dark themes:** the header toggle re-skins the whole interface between
  a light and a dark theme — identical layout and functionality, persisted.

The five-level Accent, Legato, and Rhythm Cyclic Variables drive playback.
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
npm run typecheck # tsc --noEmit
npm run build     # typecheck + production build
```

## Layout

```
src/
  engine/          framework-agnostic musical core (developed test-first)
    music.ts       scales / key-snapping
    rng.ts         seeded + Brownian randomness
    transform.ts   per-step transform primitives
    planner.ts     the pure scheduler heart
    variables.ts   Variable Positions (a–f) model
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

Engine and state logic are held at **100% line/branch/function coverage**. All
browser-only wiring (AudioContext / Web MIDI / React) is kept deliberately thin.
