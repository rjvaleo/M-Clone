# idMLab — Agreed Next Steps

**Date:** 2026-08-03
**Branch:** `modular`
**Status:** active roadmap; Steps 1-3 completed. Steps 4 and 5 were overtaken by
the audio port ([MODULAR_AV_SALVAGE_PLAN.md](MODULAR_AV_SALVAGE_PLAN.md) Stages
A-E and G) and the UI work that followed it.

The live items are:

1. **Stage F — the synth**, planned in
   [MODULAR_SYNTH_PLAN.md](MODULAR_SYNTH_PLAN.md). idMLab still cannot generate
   a pitch; this is the next build.
2. The MIDI engine rethink.
3. Confirming the sample players are audible end to end.
4. A DOM test harness, so the React faces can be covered too.

This roadmap records the implementation sequence agreed after reviewing the
current modular branch. The order favors recoverability, an end-to-end musical
workflow, and deterministic equivalence before expanding the module catalog.

## Current verified checkpoint

- Seventeen event module types are registered, including the full clock-to-note
  path, cyclic control modules, the Stream and Pattern Editor compounds, and MIDI
  Output — plus eight audio effects and three sample players.
- The starter graph contains the canonical chain from Transport through MIDI
  Output, with Cyclic Accent and Cyclic Legato connected to their consumers.
- Stream templates support 1, 4, 8, and 16 streams. Stream materialization and
  visible expansion are implemented; the Pattern Editor materializes at compile
  time and has no expand command.
- Modular document schema v2 is implemented with v1 migration, alongside the
  `.mmodpack` self-contained container.
- On 2026-08-03, **1,624 tests across 118 files** passed, with TypeScript, the
  production build and the coverage gate clean.
- Coverage now measures all of `src/modular` as well as Classic's engine and
  store: 100% statements, lines and functions, branches gated at 98.5. The React
  faces are the one deliberate exclusion — see `vitest.config.ts`.
- The tuning library (`src/modular/tuning/`) is in: 81 scales in true cents with
  the pure degree-to-frequency maths. Nothing consumes it yet.
- Wheel zoom is fixed: eased toward a target, delta-mode normalised, on a fixed
  16000 x 8000 canvas that is pannable in every direction at any zoom.

## Implementation order

### 1. Protect the current checkpoint

**Status:** completed 2026-08-03.

- Checkpoint commit: `2e816fc` (`Build modular MIDI foundation`).
- Local branch `modular` tracks `origin/modular` at the same commit.

- Commit the complete passing modular foundation on the `modular` branch.
- Publish the branch to the remote so the checkpoint does not exist only in one
  working tree.
- Keep subsequent architecture, interaction, and feature work in focused
  commits with verification at each boundary.

**Done when:** the working foundation is committed, the branch exists remotely,
and the checkpoint can be recovered independently of the local workspace.

### 2. Reconcile the modular documentation

**Status:** completed 2026-08-03.

- Reconciled the module inventory with 16 registered types and 14 direct
  runtime processor factories.
- Recorded the canonical starter topology, Stream parity and UI/runtime gates,
  document schema v2 with v1 migration, and the 1,017-test baseline.

- Bring `MODULAR_STATUS.md`, `MODULAR_MODULE_MAP.md`,
  `MODULAR_STREAM_PLAN.md`, and `MODULAR_IMPLEMENTATION_PLAN.md` into agreement
  with the code.
- Correct the module inventory, executing status, starter topology, Stream
  stages, document schema version, verification totals, and ordered work.

**Done when:** the four documents describe one consistent checkpoint and a new
developer can determine what is implemented without inspecting source code.

### 3. Finish the UI-to-runtime vertical slice

**Status:** implementation completed 2026-08-03. Real-device MIDI timing and
device-loss behavior still require a manual hardware acceptance pass.

- Node faces now read lossy status snapshots from processor state without
  putting UI work on the scheduling path.
- Transport position, Time Base rate, Phase pending pulses, Note Order and
  Cyclic cursors, Step Notes activity, Density acceptance/rejection, Legato
  overlap, and Play Enable mute counts are live.
- The Enable MIDI command requests browser permission; connected outputs appear
  in a node-local selector, and each MIDI Output owns its selected adapter and
  latency trim.
- Port state changes reconcile adapters, removed nodes dispose them, device
  loss releases sounding notes, and permission/selection/error state appears
  on the MIDI Output face.

- Completed: generic runtime status text has been replaced for the executing
  musical modules, including MIDI connection and error state.
- Wire browser MIDI permission, destination discovery and selection, session
  lifecycle, adapter attachment, and panic behavior into the application.
- Exercise the canonical starter graph as a visible, audible end-to-end path.

**Done when:** the implementation and automated lifecycle coverage are complete.
A manual acceptance pass with a physical/virtual MIDI destination remains on
the verification checklist for release readiness.

### 4. Prove Stream equivalence and add Stream snapshots

- Add deterministic trace tests comparing a compact Stream with its expanded
  ordinary modules under identical transport, seed, parameters, and presets.
- Resolve any state or routing differences revealed by those tests.
- Add Stream-scoped snapshot capture and recall without introducing hidden
  behavior that cannot be represented by the expanded graph.

**Done when:** compact and expanded forms produce identical scheduled output,
and Stream snapshots round-trip deterministically.

### 5. Stabilize the reusable embedded-preset contract

**Status:** completed. `ui/PresetPad.tsx` is the one pad every module draws, and a
guard test asserts each descriptor's `captures` names parameters that exist.

- Remaining: migrate provisional six-position and Classic A-F data into the
  sixteen numbered slots without changing the source file.

### 6. Complete graph interaction

- Completed: wheel and trackpad zoom, eased toward a target and normalised across
  delta modes, on an always-pannable fixed canvas.
- Completed: cable endpoints derived from measured port geometry.
- Remaining: drag-to-patch cables, compatible-port highlighting, cancellation,
  keyboard patching, and filtered module creation from a pending connection.

**Done when:** pan, zoom, patch, cancel, select, and keyboard flows are reliable
in a real browser and cables terminate at their visible ports.

### 7. Complete persistence boundaries

- Add autosave and crash/reload recovery.
- Restore workspace preferences such as pan, zoom, hand mode, and theme without
  confusing them with portable musical project state.
- Preserve unknown modules and actionable migration information.

**Done when:** interrupted work can be recovered and portable `.mmod` documents
remain independent of per-machine display preferences.

### 8. Continue the Classic musical module family

Implement and verify in this order:

1. Time Distortion
2. Orchestration
3. Sound / Program
4. Scale Context and quantization
5. Conducting, macros, and project snapshots
6. Standard M importer with an explicit conversion report

Audio effects and sample players are already built; the synth is the remaining
instrument work, planned in [MODULAR_SYNTH_PLAN.md](MODULAR_SYNTH_PLAN.md).

Each Classic-derived module remains single-stream, exposes its complete working
face, and embeds sixteen presets where the original workflow used preset views.

### 9. Establish audio safety before expanding the audio rack

**Status:** completed, and it did its job — the contract was written before the
rack existed, so nothing had to be retrofitted.

- Completed: graph diffing so parameter changes never rebuild topology.
- Completed: scheduled parameter smoothing and click-free crossfades.
- Completed: voice pooling, deterministic disposal, and an always-on limiter.
- Remaining: explicit signal converters and bounded feedback paths.

### 10. Rethink the MIDI engine

Agreed in principle, not started. Move from the current hodgepodge of
constructors to a UMP-shaped event layer, with MIDI 1.0 as one output encoding
rather than the native representation.

## Verification required at every milestone

- `npm test -- --run`
- `npm run typecheck`
- `npm run build`
- `git diff --check`
- Browser verification of anything the user can see. Most defects found in this
  work were invisible to the unit tests and obvious in the browser.
- Focused browser checks for any changed canvas or node-face behavior
- Migration or deterministic trace fixtures whenever serialized or scheduled
  behavior changes
