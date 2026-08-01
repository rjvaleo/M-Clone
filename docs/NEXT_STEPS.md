# Tomorrow Morning — Technical Completion Plan

Date prepared: 2026-07-31

The current layout is accepted as good enough. Do not begin another broad
reference-fidelity or resizing pass while this plan is active. Fix only visual
defects that block operation, hide data, or break hit targets.

## Current green checkpoint

- Branch: `master`.
- Working tree: substantial uncommitted multi-session implementation.
- Tests: **459 passing across 22 files**.
- Coverage: **100% statements, branches, functions, and lines** across
  `src/engine` and `src/state`.
- Typecheck, normal production build, and single-file build: passing.
- Native workspace: 640×480 with persisted 50–200% scaling.
- Layout decision: frozen until technical completion.

## First 15 minutes

1. Start the app with the supplied launcher:

   ```bash
   ./mclone.sh start
   ```

2. Confirm the checkpoint:

   ```bash
   npm run typecheck
   npm run coverage
   npm run build
   npm run build:single
   ```

3. Review `git status` and checkpoint the existing work before adding another
   subsystem. Do not discard or rewrite the current working tree.

## Technical completion sequence

### 1. Versioned project document and File commands

This is the first implementation task. Everything musical is currently lost
on reload.

Build test-first:

- Add a pure `ProjectDocumentV1` codec with an explicit schema version.
- Serialize the Project, Patterns and Scrambled material, Variable Positions,
  Cyclic Positions and lengths, active positions, conducting arrows, Pattern
  Group, Snapshots, and required playback configuration.
- Keep workspace positions, application zoom, light/dark skin, and palette as
  user preferences unless a deliberate decision makes them document state.
- Decode defensively: reject malformed required data, clamp bounded values,
  and supply defaults for fields absent from older documents.
- Add atomic store export/import actions. Stop playback before replacing live
  state and rebuild runtime-derived state after import.
- Wire global File menu commands: New, Open JSON, Save, and Save As.
- Track document name and dirty state; do not silently overwrite a file.

Acceptance gate:

- Round-trip equality for every musical subsystem.
- Tests for malformed JSON, unknown future versions, missing legacy fields,
  invalid bounds, and detached array/object copies.
- Save → reload page → Open restores an audible equivalent project.
- No regression below 100% engine/state coverage.

### 2. Finish Snapshot and Slideshow behavior

Implement the remaining honest placeholders from the manual:

- Hold/Do semantics.
- Edit Snapshot.
- Blink Everything feedback state.
- Slideshow record, play, pause, loop, quantization, and stop.
- Decide and test how slideshow timing interacts with Pause, Stop, and Robot
  conducting.
- Include all new state in `ProjectDocumentV1` or a versioned successor.

Acceptance gate:

- Deterministic pure slideshow state transitions.
- Quantized recall does not lose or double-trigger locations.
- Stop/Resume semantics are covered explicitly.
- Browser verification with an audible A→B→C slideshow.

### 3. Implement the remaining Phrasing Variable

- Read the complete Phrasing sections of the M 2.7 manual before modeling it.
- Document the inferred data model and any ambiguity.
- Add four Voices × six Positions, presets, conducting behavior, thumbnails,
  editor state, planner integration, snapshot integration, and persistence.
- Follow red → implementation → coverage for engine and store work.

Acceptance gate:

- Phrasing changes audible timing/articulation as specified without duplicating
  existing Legato or Time Distortion responsibilities.
- Active Position, conducting, snapshots, and save/load all agree.

### 4. Performance recording and standard MIDI files

- Define one timestamped performance-event model fed by the existing planner
  output rather than scraping Midi View.
- Implement Movie/Sequence recording, stop, clear, and playback.
- Implement Standard MIDI File export first, then import with documented chord,
  timing, rest, quantization, and source-channel choices.
- Keep Web MIDI, built-in synth, Midi View, and recorder as consumers of the
  same planned events.

Acceptance gate:

- Deterministic event-to-SMF tests using known fixtures.
- Exported file re-imports with equivalent notes, channels, velocities, and
  timing within the chosen quantization.
- Recording remains correct across Pause/Resume and tempo changes.

### 5. Complete live input and controller assignments

- Implement MIDI Assignment for supported controls.
- Finish the Input Control System and verify Mouse Advance end-to-end.
- Persist assignments as preferences, with optional document overrides only if
  explicitly chosen.
- Cover disconnect/reconnect and missing-device behavior without crashing or
  changing the musical document.

### 6. Close the instrument and Sound Choice decision

Hold the queued instrument-design conversation before coding this phase.

Decide:

- Whether Sound Choice is an M-style Variable, an instrument-rack concern, or
  a bridge between them.
- Initial WAM host scope.
- Built-in sampler format and asset ownership.
- Drum auto-routing rules.
- What belongs in the browser milestone versus later native/Tauri work.

Only then implement the WAM rack, sampler, Sound Choice, and drum routing.

## Definition of technical completion

The browser milestone is technically complete when:

- Project save/load is versioned and reliable.
- Every visible non-deferred control either works or is removed.
- Snapshot/Slideshow and Phrasing are complete.
- Performance recording and Standard MIDI File import/export work.
- Input control and MIDI assignments work with graceful device loss.
- The instrument/Sound Choice scope is implemented or explicitly moved to the
  named next milestone.
- All engine/state work remains test-first at 100% coverage.
- Typecheck and both builds pass.
- `STATUS.md`, `TODO.md`, `HANDOFF.md`, and feature documents are updated in the
  same change as each subsystem.

The following do **not** block this browser milestone: pixel-perfect fidelity,
whole-app Modern layout, native VST/AU hosting, Tauri packaging, or old `.M`
import without representative source files.

## Working rules

- Manual behavior outranks screenshots; screenshots define presentation.
- Write the failing test before implementation.
- Keep engine logic pure and UI wiring thin.
- Reuse the planner event stream; do not create parallel musical truth.
- No fake controls or silent no-ops.
- Do not broaden a technical task into another layout refactor.
