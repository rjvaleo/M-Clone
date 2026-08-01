# Tomorrow Morning — Technical Completion Plan

Date prepared: 2026-07-31

Product sequencing is now fixed by
[`PRODUCT_RELEASE_ROADMAP.md`](./PRODUCT_RELEASE_ROADMAP.md): finish free
four-Voice M Classic Web, then invite-only native desktop work, then paid
eight-Voice M Studio standalone/plug-in, then mobile stores, with M Modular as a
later premium platform. Instrument/effect and native requirements live in
[`AUDIO_ENGINE_SPEC.md`](./AUDIO_ENGINE_SPEC.md) and
[`NATIVE_PLUGIN_SPEC.md`](./NATIVE_PLUGIN_SPEC.md).

The current layout is accepted as good enough. Do not begin another broad
reference-fidelity or resizing pass while this plan is active. Fix only visual
defects that block operation, hide data, or break hit targets.

## Current green checkpoint

Updated 2026-08-01.

- Branch at the earlier checkpoint: `master`; inspect the current working tree
  before making additional changes.
- Tests: **592 passing across 31 files**.
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

3. Review `git status`; preserve unrelated work and commit each subsystem
   intentionally when requested.

## Technical completion sequence

### 0. MIDI reliability Phase 3 — ✅ DONE (2026-08-01)

Phases 1–2 are implemented: timing continuity segments, cancellation-before-
panic transitions, synchronized batch clock anchors, explicit ordered events,
960-PPQN positions, note lifecycle/retrigger cleanup, Program Change, destination
separation, and per-Voice RNG. The authoritative requirements and verification
matrix are in [`MIDI_RELIABILITY_SPEC.md`](./MIDI_RELIABILITY_SPEC.md).

Implemented:

- injected monotonic clock and scheduler drivers;
- one scheduler for transport and audition;
- late-wake/event diagnostics and bounded adaptive lookahead;
- explicit drop/recovery behavior after serious stalls;
- retained `MIDIAccess`, port `statechange`, reconnect, and multiple port IDs;
- background/suspension/sleep recovery;
- stronger controller-aware panic;
- versioned native event-batch serialization;
- forced-stall, device-loss, and long-duration conformance traces.

Acceptance gate:

- no uncontrolled catch-up burst after a simulated 500 ms stall;
- no hanging lifecycle owners after Stop, suspension, or device removal;
- measured diagnostics identify minimum lead, maximum lateness, and queue depth;
- multi-port loss does not interrupt unaffected destinations;
- browser and simulated native adapters pass the same event-order traces;
- the canonical reliability specification is updated with measured results.

Executed plan (TDD, in this order):

1. Add a pure bounded-lookahead policy that measures wake lateness, minimum
   submission lead, maximum event lateness, queue depth, dropped windows, and
   recovery count. A serious stall rebases unscheduled Voice timelines instead
   of emitting an uncontrolled catch-up burst.
2. Inject monotonic clock and scheduler drivers into the browser runtime and use
   the same scheduler for transport and audition release wakes.
3. Replace the single disposable Web MIDI output lookup with retained access,
   multi-port selection, statechange reconciliation, unaffected-port isolation,
   reconnect restoration, and controller-aware panic.
4. Add a versioned adapter-neutral event-batch codec and conformance traces that
   drive browser and simulated-native consumers from identical ordered events.
5. Forced 500 ms stalls, device-loss/reconnect, 100,000-wake boundedness,
   coverage, typecheck, and both production builds pass. The measured result is
   592 tests across 31 files at 100% included engine/state coverage.

### 1. Versioned project document and File commands — ✅ DONE (2026-08-01)

Shipped in `231c372` and `ccde4dd`. `src/engine/document.ts` holds the codec,
`src/ui/fileCommands.ts` the browser I/O, and the store gained
`exportDocument` / `importDocument` / `newDocument` / `markSaved` plus
document-name and dirty tracking.

Acceptance gate met: round-trip equality for every musical subsystem, tests for
malformed JSON, future versions, missing legacy fields, invalid bounds and
detached copies, browser-verified save → wander → open, and no coverage
regression.

Still open, carried forward: Save uses a browser download rather than a real
file-system picker, so it cannot overwrite in place.

Original scope, for reference:

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
- Whether third-party WAM hosting belongs in a later milestone at all.
- Built-in sampler format and asset ownership.
- Drum auto-routing rules.
- What belongs in the browser milestone versus later native/Tauri work.

The product decision is now partially closed:

- Classic Web receives four lightweight engines and basic stereo reverb/delay.
- Studio receives seven full instruments, signature effects, and multi-output.
- The instrument rack remains downstream of the explicit MIDI/event engine.
- Third-party WAM hosting is not part of the approved Classic promise and needs
  a separate scope decision.

Implement only the lightweight Classic engines during the browser milestone.
Follow `AUDIO_ENGINE_SPEC.md`; do not pull Studio DSP into Classic by accident.

### 7. Native invite beta and M Studio — after Classic Web

- Native macOS/Windows standalone adapters and real-time audio foundation.
- External MIDI clock in standalone mode.
- Host tempo/position/loop context in plug-in mode; do not depend on MIDI clock
  from the host.
- Eight Voices, seven instruments, signature effects, and multi-output buses.
- Invite-only standalone beta before hosted plug-in beta.
- Paid release only after the native and host certification gates in
  `NATIVE_PLUGIN_SPEC.md` pass.

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
