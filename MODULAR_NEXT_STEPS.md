# M Modular — Agreed Next Steps

**Date:** 2026-08-03
**Branch:** `modular`
**Status:** active roadmap

This roadmap records the implementation sequence agreed after reviewing the
current modular branch. The order favors recoverability, an end-to-end musical
workflow, and deterministic equivalence before expanding the module catalog.

## Current verified checkpoint

- Sixteen module types are registered, including the full clock-to-note path,
  cyclic control modules, the Stream compound, and MIDI Output.
- The starter graph contains the canonical chain from Transport through MIDI
  Output, with Cyclic Accent and Cyclic Legato connected to their consumers.
- Stream templates support 1, 4, 8, and 16 streams. Stream materialization and
  visible expansion are implemented.
- Modular document schema v2 is implemented with v1 migration.
- On 2026-08-03, 1,017 tests across 82 files passed. TypeScript, the production
  build, and `git diff --check` also passed.
- Wheel zoom remains a known interaction defect and is intentionally deferred
  until the graph interaction step below.

## Implementation order

### 1. Protect the current checkpoint

- Commit the complete passing modular foundation on the `modular` branch.
- Publish the branch to the remote so the checkpoint does not exist only in one
  working tree.
- Keep subsequent architecture, interaction, and feature work in focused
  commits with verification at each boundary.

**Done when:** the working foundation is committed, the branch exists remotely,
and the checkpoint can be recovered independently of the local workspace.

### 2. Reconcile the modular documentation

- Bring `MODULAR_STATUS.md`, `MODULAR_MODULE_MAP.md`,
  `MODULAR_STREAM_PLAN.md`, and `MODULAR_IMPLEMENTATION_PLAN.md` into agreement
  with the code.
- Correct the module inventory, executing status, starter topology, Stream
  stages, document schema version, verification totals, and ordered work.

**Done when:** the four documents describe one consistent checkpoint and a new
developer can determine what is implemented without inspecting source code.

### 3. Finish the UI-to-runtime vertical slice

- Replace generic node status text with live transport, cursor, density,
  note-shaping, MIDI connection, and error telemetry.
- Wire browser MIDI permission, destination discovery and selection, session
  lifecycle, adapter attachment, and panic behavior into the application.
- Exercise the canonical starter graph as a visible, audible end-to-end path.

**Done when:** the canvas can play through a selected MIDI destination and its
nodes visibly report meaningful runtime activity and failures.

### 4. Prove Stream equivalence and add Stream snapshots

- Add deterministic trace tests comparing a compact Stream with its expanded
  ordinary modules under identical transport, seed, parameters, and presets.
- Resolve any state or routing differences revealed by those tests.
- Add Stream-scoped snapshot capture and recall without introducing hidden
  behavior that cannot be represented by the expanded graph.

**Done when:** compact and expanded forms produce identical scheduled output,
and Stream snapshots round-trip deterministically.

### 5. Stabilize the reusable embedded-preset contract

- Extract shared A-H preset normalization, recall, Shift-click store, tooltip
  summaries, active state, and atomic command behavior.
- Apply it consistently to Classic-style multi-value modules.
- Migrate provisional six-position and Classic A-F data into eight-position
  storage without changing the source file.

**Done when:** preset behavior is shared rather than duplicated and browser
tests cover recall, overwrite, tooltips, active state, and migration.

### 6. Complete graph interaction

- Redesign wheel and trackpad zoom so it zooms without scrolling, anchors to the
  pointer, respects limits, and has real-browser regression coverage.
- Add drag-to-patch cables, compatible-port highlighting, cancellation,
  keyboard patching, and filtered module creation from a pending connection.
- Derive cable endpoints from measured port geometry.

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
7. Audio modules and upgraded instruments

Each Classic-derived module remains single-stream, exposes its complete working
face, and embeds eight presets where the original workflow used preset views.

### 9. Establish audio safety before expanding the audio rack

- Define and test graph diffing so parameter changes do not rebuild topology.
- Require scheduled parameter smoothing and click-free graph crossfades.
- Establish voice pooling, deterministic disposal, explicit converters, bounded
  feedback, and an always-on master limiter.

**Done when:** the first audio module demonstrates the lifecycle and safety
contract, including leak, bypass, smoothing, and transition tests.

## Verification required at every milestone

- `npm test -- --run`
- `npm run typecheck`
- `npm run build`
- `git diff --check`
- Focused browser checks for any changed canvas or node-face behavior
- Migration or deterministic trace fixtures whenever serialized or scheduled
  behavior changes
