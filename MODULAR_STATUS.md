# idMLab Development Checkpoint

**Checkpoint date:** 2026-08-03
**Branch:** `modular`
**Branch base:** `master` at `dda067b` (`0.8.0-alpha`)
**Foundation checkpoint:** `2e816fc` (`Build modular MIDI foundation`), published to `origin/modular`
**Last commit:** `61974e3` (`Rename Modular docs to idMLab`), published to
`origin/modular`. Everything described below is committed.

The application is named **idMLab**. Internal identifiers — module type ids such as
`m.pattern-editor`, the `.mmod` extension, `src/modular/`, CSS `mm-` prefixes — keep
their original spelling on purpose; renaming them would churn every file for a
cosmetic gain.

## Product decisions now in force

- Modular is a new application and native document model. It does not need runtime or native-file compatibility with Classic M.
- Standard M files will be supported through a one-way importer that constructs ordinary Modular nodes and connections.
- Every independently wired musical processor is a single-stream module. Classic screens that grouped four voices are unfolded into four independent module instances.
- Every multi-view module owns sixteen embedded presets, numbered 1-16. Classic A-F maps onto the first six; the rest start from module defaults.
- Preset strips live inside the processor. There are no separate preset nodes or shared editors.
- Every module draws its presets with one shared control, `PresetPad` — sixteen numbered keys, one row of sixteen where the face is wide enough and two rows of eight where it is not, never anything between. Only *which* parameters a slot captures differs between modules.
- Preset interaction is consistent: click recalls, Shift-click overwrites from live controls, and a tooltip carries both the slot's contents and the gestures. The pad has no heading.
- A module merged into a compound keeps its standalone form, and the compound always takes a different name. Note Editor and Pattern Editor are both real modules; so are Time Base, Phase, and the three Cyclics inside the latter.
- A compound is a **compile-time expansion**, never a second engine: it materializes into exactly the nodes it stands for, wired the way they were always wired.
- Single-stream Variable and Cyclic processors use one uniform compact face class. Large always-visible editors, such as Note Editor, use the standardized editor class; utility/I/O nodes use the utility class. Faces are sized by their content rather than to a fixed frame.
- All operational controls remain on node faces. Inspectors, secondary windows, collapsible editors, and instance selectors are not part of the musical workflow.
- The application uses a restrained full-color visual system rather than grayscale.
- Work is **test-first** from 2026-08-03. The previous practice — build the
  modules, then write every test in one pass at the end — is what let a player
  ship with no runtime processor at all and let two tests assert nothing.

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
- A fixed 16000 x 8000 canvas that is always pannable in every direction, whatever
  the zoom. The stage never shrinks below the scrollport, so there is no "island"
  of usable space; a new patch is centred on the canvas once, at creation, and the
  toolbar's **Center** command repeats that on demand rather than on every open.
- Wheel zoom eased toward a target rather than applied per notch, normalised across
  wheel/trackpad delta modes. The dot grid is painted inside the zoom transform, so
  it scales with the modules instead of sliding under them.
- Right-click menus are placed page-aware — flipped, then clamped — and scroll
  internally, so no group is ever cut off the bottom of the window.
- `.mmod` download/save, plus **Save + samples** writing a self-contained
  `.mmodpack`.
- Runtime bridge is wired: graph edits recompile to plans, node-face transport/runtime commands call `ModularRuntime`, and parameter edits are queued with each parameter's declared morph policy.
- Node-face runtime status polling is wired outside the scheduling path:
  transport position, step rate, delayed pulses, order/cyclic cursors, note
  activity, density decisions, legato overlap, and muted-note counts update live.
- Browser MIDI session ownership is wired: Enable MIDI requests permission,
  output ports populate a selector, each MIDI Output owns one adapter with its
  latency trim, state changes reconcile ports, and deleted nodes dispose their
  adapters. Permission, selection, connection, and device-loss state are shown
  on the node face.

### Current registered modules

1. **Transport Clock** — utility face with transport and clock controls.
2. **Time Base** — compact single-stream clock node turning the shared transport into one stream's step pulses, with sixteen embedded ratio presets. Denominator zero is Classic's `sa`.
3. **Phase** — compact single-stream start offset in ticks, with sixteen embedded presets. Holds a delayed pulse until the window it lands in.
4. **Step Notes** — utility converter from `step-event` to `note-event`, carrying the velocity, gate, and channel decisions that turn a chosen step into sounding notes. No preset strip: it is a utility, not a Classic Variable.
5. **Note Editor** — large editor face with all controls visible and sixteen independent pattern positions. Each instance owns its own piano roll; no shared editor selector exists.
6. **Note Density** — compact single-stream processor with one live probability slider, deterministic seed, and sixteen embedded numeric presets.
7. **Note Order** — compact single-stream processor with the original-style three-region/two-handle Original-Cyclic-Utterly control, shaded regions, and sixteen embedded mix presets.
8. **Cyclic Accent** — control sequencer emitting per-step accent values from an embedded 16-step sequence with sixteen presets.
9. **Cyclic Legato** — control sequencer emitting per-step legato values from an embedded 16-step sequence with sixteen presets.
10. **Cyclic Rhythm** — clock sequencer that warps outgoing step-clock duration from an embedded 16-step sequence with sixteen presets.
11. **Velocity Range** — compact single-stream note shaper consuming `accent-in` control values and mapping them onto a configurable low/high velocity range with sixteen presets.
12. **Legato Processor** — compact single-stream note shaper consuming `legato-in` control values and applying legato multipliers that can create intentional note overlap, with sixteen presets.
13. **Play Enable** — compact per-path note gate that mutes notes without stopping upstream clocks, with sixteen embedded presets.
14. **Transposition** — compact note shaper with semitone and scale-degree modes, optional scale-context input, and sixteen embedded presets.
15. **Stream** — utility compound surface (`m.stream`) that materializes into ordinary single-stream modules and can be expanded onto the canvas.
16. **Pattern Editor** — the compound described below: a clock in, fully formed notes out.
17. **MIDI Output** — utility face with destination/channel/latency/program controls.

Fourteen **audio modules** over one `input → dry/wet → output` shell — Audio
Output, Gain, Delay, Reverb, EQ, Compressor, Limiter, Bit Crusher, Blackhole,
DP/4 Reverb, DP/4 Non Lin, the DP/4+ machine, Stereo Widener and Mixer — with
the mix as an equal-power crossfade.

Four **instruments** — the Percussion, Looper and Granular sample players and
the Synth — driven by note events through the shared voice bank.

### Stereo

The rack is stereo throughout rather than mono arriving on two wires:

- **Every source has a position.** Percussion, Looper, Granular and the Synth
  each own a `pan`, ramped rather than structural. Percussion additionally pans
  per pad, as `AUDIO_ENGINE_SPEC.md` §4 asks; a centred pad builds no panner at
  all, so a mostly-centred kit costs nothing.
- **The reverb tanks decorrelate.** `createFeedbackNetwork` taps alternate delay
  lines to alternate sides of a two-channel merger, so each ear hears a
  different set of line lengths while the Householder bus still mixes all of
  them inside the loop. Blackhole and the DP/4 reverbs inherit it. Each side is
  normalised by the lines it carries, so the tail did not change level.
- **Stereo Widener** (`m.audio-widener`) — a mid/side matrix with the side path
  high-passed, so the band below its corner stays mono however wide the rest is
  set. It is deliberately *not* a null at width 1: monoing the bass is the
  feature, and a true bypass is `mix = 0` like everything else in the rack.
- **Mixer** (`m.audio-mixer`) — four independent inputs through the DP/4's
  per-port wiring, each with level, pan, mute and solo. Mute is a ramp on a
  channel that stays wired, for the same reason bypass is.

`EffectContext` gained `createStereoPanner`, `createChannelSplitter` and
`createChannelMerger`, and `AudioNodeLike.connect` gained the two optional
channel indices that addressing a side requires.

#### Cyclic faces

A Cyclic sequence draws as sixteen vertical bars of five segments rather than a
5 x 16 cell grid: the same information at a quarter of the height, which is what
makes three of them fit inside one compound. Press a segment to set the step,
drag vertically for a random range (drawn hatched, never solid), drag sideways to
paint. Clear / Flat / All random are a right-click menu. Clicking a step number
on the ruler sets the sequence length; steps past the end stay visible and dimmed
rather than disappearing.

#### The Pattern Editor compound

`m.pattern-editor` merges Time Base, Phase, the three Cyclics, Note Editor, Note
Order, Step→Notes, Velocity Range, and Legato Processor into one face: a clock
goes in, whole notes come out, with the accent already in their velocity and the
legato already in their length. Each embedded sequence carries its own length
(`accent-length`, `legato-length`, `rhythm-length`) and none of them carry their
own preset pad — the compound has one bank, and a slot in it stores the entire
idea: the pattern, all three sequences, their lengths, the step rate, and the
phase.

Its note editor is a **windowed roll**: every one of the 128 pitches and every
step is rendered inside a short scrolling viewport, with an overview strip above
that draws the whole pattern at once and a marker showing where the window sits.
Dragging the overview moves the window. It opens centred on the notes that exist
rather than at the top of the range. `src/modular/ui/noteRoll.ts` holds the
arithmetic; the component is in `ModularApp.tsx`.

Faces are sized by content (`width: fit-content` with per-layout bounds); the old
fixed 520 x 330 compact frame no longer applies.

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
and parameter edits route through `ModularRuntime`; live node telemetry and the
browser MIDI device session are connected to the node faces.

## Audio (ported from Modular AV Performance)

Stages C, D, E, and G of [MODULAR_AV_SALVAGE_PLAN.md](MODULAR_AV_SALVAGE_PLAN.md)
are implemented in `src/modular/audio/`.

- **The safety contract.** `compileAudioPlan` sorts every parameter into
  `structure` (rebuild) or `parameters` (ramp), so a knob turn can never touch
  topology. New nodes are built, crossfaded over 10-20 ms **on the audio clock**,
  and only then disconnected and disposed. Direct `AudioParam.value =` assignment
  is banned and a test enforces the ban by scanning the sources.
- **Effects.** One `EffectModule` shell — `input → dry/wet → outputGain(level)` —
  and eight builders. The mix is equal-power (`sin`/`cos` of the angle), and
  bypass belongs to the adapter, not the effect.
- **The sound pool.** Content-addressed asset ids (a 64-bit double FNV-1a over the
  bytes, hashed *before* the decoder detaches them), a library that tracks loaded
  versus missing assets, waveform peaks for thumbnails, drag-and-drop, audition
  through the master limiter, and a deterministic synthetic starter kit
  (`kit:kick` and friends) so a fresh install makes sound with no files at all.
- **`.mmodpack`.** A self-contained container: magic, `uint32` version, `uint32`
  manifest length, a JSON manifest, then the raw blobs, each verified against its
  own checksum on open. Chosen over inlining base64 in the `.mmod` JSON so a patch
  file stays diffable and a pack stays streamable.
- **Players.** Percussion, Looper, and Granular, over a shared `VoiceBank` with
  choke groups scheduled on the audio clock and a 0.2 s lookahead grain scheduler.
  `AudioClockBridge` maps runtime seconds onto `AudioContext.currentTime` with EMA
  smoothing and a hard snap across suspend/resume.

## Tuning (ported from the scale sequencer)

`src/modular/tuning/` — 81 scales in **true cents** across 7 categories, from
`rjvaleo/scale-sequencer`, with the pure maths that turns a degree into a
frequency: `centsToRatio`, `centsToHz`, `hzToCents`, `degreeCents`, `degreeHz`,
`nearestDegree`, `mapKeyboard`, `rootHzForMidi`.

The point of it is that a scale is a list of cent offsets rather than semitones:
a Pythagorean third is 408 cents and a maqam's neutral second is 150, and
neither survives being rounded to the nearest piano key. `mapKeyboard` lays a
scale across the keys so a twelve-note keyboard can play a 31-tone temperament —
each key keeps its position and sounds the degree nearest to it, at that
degree's true pitch.

Three changes on the way in:

- **Scales carry stable ids.** The source selected by array index, so inserting
  a scale silently retuned every saved preset. A document names `"dorian"`.
- **Raga Marwa was wrong** — a stray trailing `0` made its last degree sound the
  root again, and made it the one scale in the library that did not ascend. A
  guard test now checks all 81.
- **Degrees below the root worked.** `degree % length` keeps JavaScript's sign,
  so degree −1 read as −1 rather than as the seventh below.

Nothing consumes it yet. It is the intended pitch source for the synth
([MODULAR_SYNTH_PLAN.md](MODULAR_SYNTH_PLAN.md)) and for the `scale-context-in`
port Transposition has always declared with nothing to feed it.

## Coverage

`npm run coverage` measures Classic's engine and store **and all of
`src/modular`**, and fails the build below its thresholds. Until this session it
measured only `src/engine` and `src/state`, so the 100% it reported was 100% of
about a third of the code and none of idMLab.

- **100%** of statements, lines and functions.
- **99.3%** of branches, gated at 98.5. The shortfall is `catch` blocks for
  browser behaviour Node cannot provoke — a source that refuses to stop, a
  limiter that reports nothing — each marked and explained where it sits.
- The React faces (`*.tsx`) are the one deliberate exclusion: testing them needs
  a DOM, which this project does not install. Their logic is kept in plain
  modules beside them — `noteRoll.ts`, `viewport.ts`, `cyclicSequence.ts`,
  `nodePlacement.ts`, `portGeometry.ts` — and those are covered.

Writing those tests found four real defects: `build()` crashed on a plan naming
a node the document no longer had, voices started after dispose, and two tests
asserted nothing at all.

## Verification baseline

- `npm test -- --run`: **1,794 tests passed across 125 files**.
- `npm run typecheck`: passed.
- `npm run build`: passed.
- `npm run coverage`: **passes**, for the first time since `72085dc`. That
  commit left `dp4.ts` at 88.29% of statements and `blackhole.ts` at 99.41%,
  which held the gate red — the two machines built correctly and their control
  surfaces were never asked to move, so only one case of one `setParameter`
  switch was reached by any test. Both are now at 100%; every documented knob
  on both machines has a test asserting that the right node moved rather than
  merely that the call did not throw. **100%** of statements, lines and
  functions, **99.17%** of branches, ratcheted from 98.5 to 99.
- Browser verification on every UI change in this session, which is how most of
  the real defects were found — the unit tests passed throughout.

## Known limitations and deferred defects

1. **Players have not been confirmed audible end to end.** The voice counter
   increments and every layer tests clean, but nobody has yet reported hearing
   the drums. This is the first thing to check.
2. **The MIDI engine wants a rethink**, from a hodgepodge of constructors toward a
   UMP-shaped event layer with MIDI 1.0 as one output encoding. Agreed in
   principle, not started.
3. The React faces have no automated coverage: it needs a DOM (`jsdom` plus a React testing library), which the project does not install. Their logic is deliberately kept in plain modules beside them, and those are fully covered.
4. Web MIDI session wiring and automated lifecycle coverage are complete. A manual acceptance pass with a physical or virtual MIDI output is still required to validate the host browser's permission UI, hardware timing, hot-unplug, and reconnect behavior.
5. Stream materialization and expand command are implemented, but stream-level scoped snapshots and parity trace assertions between compact and expanded forms are still pending. The Pattern Editor has no expand command at all — it is materialized at compile time only.
6. Save and Open for `.mmod` and `.mmodpack` are implemented; import, autosave, and recovery UI remain pending.
7. Standard M import exists only as a documented mapping; no importer transaction or fixture conversion exists yet.
8. Port connection uses click-output/click-input. The planned drag-cable workflow, compatible-port highlighting, keyboard connection flow, and filtered module creation are still pending.
9. Two clicks on a Cyclic ruler within one tick clobber each other, because the second reads a stale node. Separated by a re-render they behave correctly.
10. Pan, zoom, hand mode, and theme persist in browser-local workspace preferences; broader scene-level view states are not implemented.
11. Snapshots, macros, conducting, slideshow, performance view, timeline, and visualizer remain planned work. **idMLab still cannot generate a pitch** — there is no oscillator in `src/modular`, only sample players. Stage F, the synth and its 8 x 12 modulation matrix, is planned in [MODULAR_SYNTH_PLAN.md](MODULAR_SYNTH_PLAN.md) with the PWM generator built.
12. The development server at `http://127.0.0.1:5173/` belongs to the current local task session and should not be treated as a deployment.

## Build record and remaining work

The authoritative forward sequence is [MODULAR_NEXT_STEPS.md](MODULAR_NEXT_STEPS.md).
The sections below retain the completed build record and detail for remaining
module, canvas, import, and product work; their historical numbering is not the
current priority order.

### 1. Stabilize the reusable embedded-preset contract

Status: completed. Every module draws `PresetPad`; capture, recall, storage shape,
tooltip, and active state live in one file (`src/modular/ui/PresetPad.tsx`), and a
guard test asserts that each descriptor's `captures` names parameters that exist —
which caught five modules capturing ids that had been renamed underneath them.

- Remaining: migration helpers for provisional six-position documents and Classic
  A-F data into the sixteen numbered slots.

### 2. Clock-to-note vertical slice and control-tick contract

Status: completed for the current module set.

- Completed: single-stream Time Base and Phase modules with tick-based phase.
- Completed: explicit Step Notes boundary between `step-event` and scheduled `note-event` paths.
- Completed: scheduling loop over compiled plans with parameter queue drain, pooled message/event processing, adapter submission, and bounded telemetry.
- Completed: executing chain with deterministic tests across multiple lookahead/window shapes.
- Completed: control-tick matcher and cross-window deterministic tests proving tick-based control/event matching.

### 2a. Audio adapter rules to establish with the first audio module

Status: established before the rack existed, which was the point.

- Completed: plan diffing that reconnects only changed subgraphs; a parameter change never touches topology.
- Completed: crossfade protocol — build new nodes, ramp over 10-20 ms on the audio clock, then disconnect and dispose.
- Completed: no direct `AudioParam.value` assignment anywhere. Every write is a scheduled ramp honoring the descriptor's `smoothing`, enforced by a source-scanning test.
- Completed: voice pooling rather than per-note node construction, and an always-on master limiter.
- Remaining: signal converter modules, so near-miss control types have a bridge instead of a bare rejection.

One defect worth remembering: `compileAudioPlan` originally carried only numbers
and booleans, so `slots` and `asset-id` were dropped silently and every player was
built with no samples. The fix is a guard test asserting that **every** audio
parameter survives compilation — the class of bug, not the instance.

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

Implement each with a content-sized face and the shared preset pad:

1. Time Distortion, using a larger standardized editor class only if the always-visible map cannot fit the compact face.
2. Orchestration.
3. Sound/Program Choice.
4. Scale Context and quantizer helpers.

Do not reintroduce the removed four-lane rack prototype.

### 5. Finish Phase 3 canvas behavior

- Completed: zoom redesign — eased toward a target, delta-mode normalised, grid inside the transform, and a fixed 16000 x 8000 always-pannable canvas.
- Completed: menu clamping and internal menu scrolling.
- Remaining: cable dragging, compatible target highlighting, escape cancellation, cable-to-module creation, keyboard patching, grouping, marquee selection, focus restoration, and narrow-layout tests.
- Completed: persist pan, zoom, and theme preferences.
- Remaining: persist broader workspace preferences and scene-level view states.

### 6. Documents, templates, and Classic import

- Completed: Open support for `.mmod` with schema decode/migration warnings.
- Completed: starter templates for one, four, eight, and sixteen streams in the canvas toolbar.
- Remaining: robust corrupted-document recovery UX.
- Implement the Standard M importer as one undoable transaction with topology/parameter/snapshot warnings.
- Map Classic A-F onto the first six numbered slots and initialize the rest from defaults.
- Save/reopen imported graphs without consulting the source file.

### 7. Scenes and later product layers

- Generic snapshots and morphing.
- Macros, conducting, Pattern Group, and slideshow sequencing using stable parameter IDs.
- MIDI input/monitor and the built-in synth (salvage plan Stage F). The audio graph, effects, and sample players are built.
- Performance capture, Timeline, Visualizer, and AV render path in the later planned phases.

## Resume rule

Before adding another module, confirm that it is one independently wired stream, uses the shared layout class, exposes every live control, owns sixteen embedded presets where applicable, supports click recall and Shift-click overwrite, and does not require another window or inspector.
