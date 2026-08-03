# M Modular Development Checkpoint

**Checkpoint date:** 2026-08-03
**Branch:** `modular`
**Branch base:** `master` at `dda067b` (`0.8.0-alpha`)
**Foundation checkpoint:** `2e816fc` (`Build modular MIDI foundation`), published to `origin/modular`

## Product decisions now in force

- Modular is a new application and native document model. It does not need runtime or native-file compatibility with Classic M.
- Standard M files will be supported through a one-way importer that constructs ordinary Modular nodes and connections.
- Every independently wired musical processor is a single-stream module. Classic screens that grouped four voices are unfolded into four independent module instances.
- Every multi-view module owns eight embedded presets, A-H. Classic A-F data maps directly; G-H start from module defaults.
- Preset strips live inside the processor. There are no separate preset nodes or shared editors.
- Preset interaction is consistent: click recalls, Shift-click overwrites from live controls, the stored value/summary appears below the letter, and a tooltip explains the stored state and gestures.
- Single-stream Variable and Cyclic processors use one uniform compact face class. Large always-visible editors, such as Note Editor, use the standardized editor class; utility/I/O nodes use the utility class.
- All operational controls remain on node faces. Inspectors, secondary windows, collapsible editors, and instance selectors are not part of the musical workflow.
- The application uses a restrained full-color visual system rather than grayscale.

## Implemented foundation

### Graph and documents

- Typed nodes, ports, signals, parameters, edges, and graph documents.
- Immutable add/remove/move/connect/disconnect and single/multi-parameter commands with inverse commands for undo/redo.
- Signal compatibility, direction, endpoint, duplicate-edge, and input-cardinality validation.
- Native `.mmod` v2 encoder/decoder with defensive validation, plus decode-time migration from v1 for renamed ports/parameters.
- Registry validation that fails when a parameter or command is hidden from its node face, or when a module claims to break feedback without advancing time.
- Registry validation for Stage 1 port rules: every many-input declares a merge policy, telemetry ids must end in `-telemetry`, and non-telemetry ids may not use that suffix.
- Safe unknown-module rendering for document recovery and registry changes.
- Graph compilation with deterministic evaluation order, named cycle rejection, required-input checks, stable per-node seeds, a per-node event budget, a plan generation counter, and last-known-good publication.
- Graph validation rejects telemetry routing into non-telemetry musical inputs.

### Timing and runtime foundation

Built before the first executing module, because each of these is far harder to
retrofit than to establish (`src/modular/runtime/`):

- **`time.ts`** — integer ticks canonical at 960 PPQN; a `TempoMap` of
  `(tick, seconds, bpm)` anchors from which seconds are derived by one multiply
  rather than accumulated. Pause, resume, and stall recovery shift one map, so
  every stream stays exactly in phase. Step lengths clamp to at least one tick,
  so a user-wired time base cannot hang a window planner.
- **`rng.ts`** — counter-based randomness hashed from
  `(seed, node, stream, tick, draw)`. Window boundaries, stalls, pauses, and
  re-plans cannot change the performance.
- **`clock.ts`** — the scheduling wake comes from an AudioWorklet counting
  render quanta, falling back to a Web Worker timer and only then to a
  main-thread timer. Background-tab throttling and canvas jank no longer reach
  the scheduler.
- **`skew.ts`** — one presentation clock for the whole runtime. Least-squares
  tracking of the AudioContext-to-`performance.now()` relationship instead of
  per-batch re-anchoring, and a fallback that adds `outputLatency` explicitly so
  browsers without `getOutputTimestamp` stop firing MIDI early against the synth.
- **`eventqueue.ts`** — a binary-heap scheduling queue and an event pool, so the
  steady-state path allocates nothing, plus a sounding-note shadow that makes
  panic and device-loss recovery exact instead of relying on CC 123.
- **`parameters.ts`** — a bounded coalescing queue of live edits, each landing at
  a tick chosen by the parameter's own declared morph policy.
- **`scheduling.ts`** — adaptive lookahead with stall detection and a per-window
  event budget, plus a bounded telemetry ring drained by the UI.

### Executing runtime

- **`messages.ts`** — the per-window message bus. Processors read their own
  inboxes and write their own outputs; the bus routes, pools, and enforces the
  per-node emission budget so no module author can forget to bound their output.
- **`processors.ts`** now includes a tick-matched control contract: control values are matched to musical events by tick (never arrival order), including values that arrive in an earlier scheduling window.
- **`processors.ts`** — Transport, Time Base, Phase, Note Order, Cyclic Accent,
  Cyclic Legato, Cyclic Rhythm, Step Notes, Note Density, Transposition,
  Velocity Range, Legato Processor, Play Enable, and MIDI Output as independent
  single-stream processors.
- **`engine.ts`** — the scheduling loop: measure the wake, recover from a stall,
  derive the window's tick span, apply due parameter edits, run each processor
  once in compiled order, convert to seconds, submit, then report telemetry
  last. It never reads the document and compares one integer per wake.
- **`midiadapter.ts`** — Web MIDI output through the presentation clock, with
  panic and device-loss recovery driven by the sounding-note shadow.

The starter chain now executes end to end:

```text
Transport -> Time Base -> Phase -> Cyclic Rhythm -> Note Order -> Step Notes
-> Note Density -> Transposition -> Velocity Range -> Legato Processor
-> Play Enable -> MIDI Output
```

The Note Editor supplies pattern material by reference. Cyclic Accent and
Cyclic Legato run beside the note path and feed their tick-matched controls into
Velocity Range and Legato Processor.

### Canvas and shell

- Full-color light/dark shell and graph canvas.
- Right-click module creation.
- Node dragging, node/cable selection, duplication, deletion, undo, and redo.
- A close button on every node header, removing that node without selecting it first. Pressing it does not start a drag, and the removal is undoable.
- Click-to-patch typed ports with actionable incompatibility messages.
- Hand mode for empty-canvas panning.
- Wheel zoom and toolbar zoom control.
- `.mmod` download/save action.
- Runtime bridge is wired: graph edits recompile to plans, node-face transport/runtime commands call `ModularRuntime`, and parameter edits are queued with each parameter's declared morph policy.

### Current registered modules

1. **Transport Clock** — utility face with transport and clock controls.
2. **Time Base** — compact single-stream clock node turning the shared transport into one stream's step pulses, with eight embedded ratio presets. Denominator zero is Classic's `sa`.
3. **Phase** — compact single-stream start offset in ticks, with eight embedded presets. Holds a delayed pulse until the window it lands in.
4. **Step Notes** — utility converter from `step-event` to `note-event`, carrying the velocity, gate, and channel decisions that turn a chosen step into sounding notes. No preset strip: it is a utility, not a Classic Variable.
5. **Note Editor** — large editor face with all controls visible and eight independent A-H pattern positions. Each instance owns its own piano roll; no shared editor selector exists.
6. **Note Density** — compact single-stream processor with one live probability slider, deterministic seed, and eight embedded numeric presets.
7. **Note Order** — compact single-stream processor with the original-style three-region/two-handle Original-Cyclic-Utterly control, shaded regions, and eight embedded mix presets.
8. **Cyclic Accent** — editor-layout control sequencer emitting per-step accent values from an embedded 16-step grid with eight presets.
9. **Cyclic Legato** — editor-layout control sequencer emitting per-step legato values from an embedded 16-step grid with eight presets.
10. **Cyclic Rhythm** — editor-layout clock sequencer that warps outgoing step-clock duration from an embedded 16-step grid with eight presets.
11. **Velocity Range** — compact single-stream note shaper consuming `accent-in` control values and mapping them onto a configurable low/high velocity range with eight presets.
12. **Legato Processor** — compact single-stream note shaper consuming `legato-in` control values and applying legato multipliers that can create intentional note overlap, with eight presets.
13. **Play Enable** — compact per-path note gate that mutes notes without stopping upstream clocks, with eight embedded presets.
14. **Transposition** — compact note shaper with semitone and scale-degree modes, optional scale-context input, and eight embedded presets.
15. **Stream** — utility compound surface (`m.stream`) that materializes into ordinary single-stream modules and can be expanded onto the canvas.
16. **MIDI Output** — utility face with destination/channel/latency/program controls.

Note Density and Note Order use the same 520 x 330 CSS-pixel compact frame, 28px controls, section spacing, and 50px preset cells. Their clean live measurement showed identical dimensions and no internal overflow.

## Starter graph currently shown

```text
Transport -> Time Base -> Phase -> Cyclic Rhythm -> Note Order -> Step Notes
-> Note Density -> Transposition -> Velocity Range -> Legato Processor
-> Play Enable -> MIDI Output

Note Editor -> Note Order
Cyclic Accent -> Velocity Range
Cyclic Legato -> Legato Processor
```

The canvas starter is now the canonical full runtime topology. Canvas commands
and parameter edits route through `ModularRuntime`. Live node telemetry and the
browser MIDI device session remain the next UI-to-runtime work.

## Verification baseline

- `npm test -- --run`: **1,017 tests passed across 82 files**.
- `npm run typecheck`: passed.
- `npm run build`: passed.
- `git diff --check`: passed.
- Clean browser reload: equal compact module dimensions, eight Density presets, eight Note Order presets, two Note Order boundary handles, and no new browser errors.

## Known limitations and deferred defects

1. **Zoom remains a known Phase 3 defect.** Wheel zoom is usable enough to continue, but wheel/trackpad behavior, scroll suppression, pointer anchoring, and zoom-limit behavior need a focused redesign and real-browser regression coverage.
2. The runtime bridge is implemented with a timer-based scheduler in the canvas, but Web MIDI device-session wiring and richer playback telemetry presentation in node UI remain pending.
3. Stream materialization and expand command are implemented, but stream-level scoped snapshots and parity trace assertions between compact and expanded forms are still pending.
4. Save and Open for `.mmod` are implemented; import, autosave, and recovery UI remain pending.
5. Standard M import exists only as a documented mapping; no importer transaction or fixture conversion exists yet.
6. Port connection uses click-output/click-input. The planned drag-cable workflow, compatible-port highlighting, keyboard connection flow, and filtered module creation are still pending.
7. Cable endpoint placement is approximate and should be derived from actual port geometry.
8. Pan, zoom, hand mode, and theme persist in browser-local workspace preferences; broader scene-level view states are not implemented.
9. Snapshots, macros, conducting, slideshow, performance view, audio modules, timeline, and visualizer remain planned work.
10. The development server at `http://127.0.0.1:5173/` belongs to the current local task session and should not be treated as a deployment.

## Build record and remaining work

The authoritative forward sequence is [MODULAR_NEXT_STEPS.md](MODULAR_NEXT_STEPS.md).
The sections below retain the completed build record and detail for remaining
module, canvas, import, and product work; their historical numbering is not the
current priority order.

### 1. Stabilize the reusable embedded-preset contract

- Extract shared preset normalization, recall, Shift-store, tooltip-summary, active-state, and atomic-command helpers from the first two implementations.
- Add browser regression tests for click recall and Shift-click overwrite.
- Add migration helpers for provisional six-position documents and Classic A-F data into A-H storage.

### 2. Clock-to-note vertical slice and control-tick contract

Status: completed for the current module set.

- Completed: single-stream Time Base and Phase modules with tick-based phase.
- Completed: explicit Step Notes boundary between `step-event` and scheduled `note-event` paths.
- Completed: scheduling loop over compiled plans with parameter queue drain, pooled message/event processing, adapter submission, and bounded telemetry.
- Completed: executing chain with deterministic tests across multiple lookahead/window shapes.
- Completed: control-tick matcher and cross-window deterministic tests proving tick-based control/event matching.

### 2a. Audio adapter rules to establish with the first audio module

Not yet implemented, and cheapest to get right before there is a rack to retrofit:

- Plan diffing that reconnects only changed subgraphs; a parameter change must never touch topology.
- Crossfade protocol: build new nodes, ramp over 10-20 ms on the audio clock, then disconnect and dispose. Node-leak disposal test.
- No direct `AudioParam.value` assignment anywhere. Every write is a scheduled ramp honoring the descriptor's `smoothing`, enforced like the existing complete-face rule.
- Voice pooling rather than per-note node construction, and an always-on master limiter.
- Signal converter modules, so near-miss control types have a bridge instead of a bare rejection.

### 2b. The Stream build

The module audit, port standard, and the decision to assemble a complete note as
a **Stream** compound (`m.stream`) are recorded in
[MODULAR_MODULE_MAP.md](MODULAR_MODULE_MAP.md) and
[MODULAR_STREAM_PLAN.md](MODULAR_STREAM_PLAN.md). The port standard, migration,
control-tick contract, cyclic and shaping processors, Stream materialization,
canvas expansion, and runtime bridge are implemented. Compact-versus-expanded
trace equivalence and Stream-scoped snapshots remain open.

Do not reintroduce the word "Voice" for this concept; the compound is a Stream.

### 3. Integrate cyclic outputs into note shaping

The cyclic core now exists; the next priority is to make those control streams
musically audible through dedicated consumers.

- Completed: Velocity Range and Legato Processor as single-stream modules.
- Completed: `accent-out` and `legato-out` control streams consumed through the tick-matcher contract.
- Completed: overlapping-legato and per-step velocity shaping tests.

### 4. Continue the single-stream compact module family

Implement each with the same 520 x 330 frame and embedded A-H presets:

1. Time Distortion, using a larger standardized editor class only if the always-visible map cannot fit the compact face.
2. Orchestration.
3. Sound/Program Choice.
4. Scale Context and quantizer helpers.

Do not reintroduce the removed four-lane rack prototype.

### 5. Finish Phase 3 canvas behavior

- Redesign and fix zoom before the Phase 3 gate.
- Add cable dragging, compatible target highlighting, escape cancellation, cable-to-module creation, keyboard patching, grouping, marquee selection, menu clamping, focus restoration, and narrow-layout tests.
- Completed: persist pan, zoom, and theme preferences.
- Remaining: persist broader workspace preferences and scene-level view states.

### 6. Documents, templates, and Classic import

- Completed: Open support for `.mmod` with schema decode/migration warnings.
- Completed: starter templates for one, four, eight, and sixteen streams in the canvas toolbar.
- Remaining: robust corrupted-document recovery UX.
- Implement the Standard M importer as one undoable transaction with topology/parameter/snapshot warnings.
- Map Classic A-F to Modular A-F and initialize G-H from defaults.
- Save/reopen imported graphs without consulting the source file.

### 7. Scenes and later product layers

- Generic snapshots and morphing.
- Macros, conducting, Pattern Group, and slideshow sequencing using stable parameter IDs.
- MIDI input/monitor, internal synths, audio graph, instruments/effects/mixer.
- Performance capture, Timeline, Visualizer, and AV render path in the later planned phases.

## Resume rule

Before adding another module, confirm that it is one independently wired stream, uses the shared layout class, exposes every live control, owns eight embedded presets where applicable, supports click recall and Shift-click overwrite, and does not require another window or inspector.
