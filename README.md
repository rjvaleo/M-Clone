# M-Clone

A modern, browser-first recreation of **M**, the interactive composing instrument
(David Zicarelli / Joel Chadabe, Intelligent Music → Cycling '74), extended into
an all-in-one generative studio. See [`docs/M-Clone_Build_Plan.md`](./docs/M-Clone_Build_Plan.md)
for the full design and roadmap.

## Status

**Unified classic interface — it plays.** A pure, fully-tested generative engine
drives both a built-in WebAudio synth and Web MIDI output, behind a single-screen
recreation of M's six-window layout.

Working today:

- Four independent **Voices**, four **Patterns**, a per-step **piano-roll editor**.
- **Variable Positions (a–f):** six snapshot-able positions for Note Order,
  Transposition, Note Density, and Velocity — click a cell to activate, click a
  name to edit per-voice values.
- **Snapshots:** store / recall the whole screen (6 slots).
- **Transport:** Start / Stop / Sync, Tempo; **Key + Scale** with snap-to-key.
- **Per-voice Midi:** channel, program, transpose, velocity, density, legato.
- **Dual output:** built-in synth (zero setup) **and** Web MIDI to any device/DAW.
- A **Studio (v1)** view is also included (toggle in the header) — same engine.

Visual previews not yet driving audio: Cyclic Variables grid, Time Distortion,
Robot / Midi-Conduct. These are next on the roadmap.

## Run it

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
  ui/              React views — Unified (classic skin) + Studio (v1)
docs/              build plan & design
reference/         original M manual, screenshots, layout mockup
```

Engine and state logic are held at **100% line/branch/function coverage**. All
browser-only wiring (AudioContext / Web MIDI / React) is kept deliberately thin.
