# M-Clone — Current Backlog

Audited against the working tree on 2026-08-01. `STATUS.md` is the current
feature scorecard; `VISUAL_AUDIT_AND_THEMING.md` owns reference-image deltas.

Legend: ⬜ open · 🟡 partial · ✅ done · ❓ decision needed

## Open work inventory

The commercial/product sequence is authoritative in
[`PRODUCT_RELEASE_ROADMAP.md`](./PRODUCT_RELEASE_ROADMAP.md). Audio and native
work must follow [`AUDIO_ENGINE_SPEC.md`](./AUDIO_ENGINE_SPEC.md) and
[`NATIVE_PLUGIN_SPEC.md`](./NATIVE_PLUGIN_SPEC.md); none of that planned Studio
scope should be counted as current implementation.

1. 🟡 **Project save/load (JSON).** `ProjectDocumentV1` and the File menu are
   done: New, Open, Save, Save As, defensive decoding, document name and
   unsaved-changes tracking. Still open — a real file-system picker instead of
   download/upload, and promoting the format when new subsystems land.
2. ⬜ **Slideshows and Snapshot editing.** The Snapshot window has 26 working
   A–Z locations, quantized recall, erase, keyboard recall, and Restore. Hold/Do,
   Edit Snapshot, Blink Everything, and Slideshow record/play/loop remain honest
   placeholders.
3. ⬜ **Phrasing.** The remaining planned classic Variable is not modeled.
   Sound Choice is intentionally deferred to the instrument design work.
4. ⬜ **Recorder / Movie / Sequence.** No performance-to-track recorder, Movie
   capture, imported Sequence playback, or MIDI file import/export exists yet.
5. ⬜ **Instrument layer.** The approved split is four lightweight browser
   engines followed by seven full Studio instruments, signature effects, and
   multi-output native audio. Third-party WAM hosting is exploratory and does
   not block Classic.
6. ⬜ **Dynamic Voice architecture.** Remove framework-independent assumptions
   that the engine always has four Voices. Classic exposes four, Studio eight,
   and core structures should support a configured 1–16 without changing
   musical algorithms.

The execution order and acceptance gates for these items are in
[`NEXT_STEPS.md`](./NEXT_STEPS.md).

## UI and fidelity backlog — paused

- ✅ Shared rendered typography, global/context menu ownership, 640×480 sizing,
  application scaling, and current clipping/alignment defects are normalized.
- ⏸ Further notch, icon, pixel-overlay, and exact reference-detail work is
  deliberately paused until technical completion. The current layout is good
  enough for implementation work.
- ❓ Decide whether the current per-Voice Midi controls are a live summary of
  Variable Positions or a separate control surface; remove conceptual
  duplication once decided.
- ❓ Decide the permanent home of global theme and channel-palette controls.
- ⬜ Build a whole-app Modern layout. Only the Cyclic Editor currently has a
  dedicated Classic/Modern view toggle; light/dark and six channel palettes are
  skins over the shared main layout.
- ⬜ Add cyclic-variable conducting arrows if manual review confirms their
  intended behavior. Six Cyclic Positions already exist; they are not currently
  targets of the Baton.

## Completed foundations

- ✅ Pure generative engine, harmonic options, seeded randomness, four Voices.
- ✅ Pattern Editor with Region tools, audition, resizing, fixed-cell painting,
  auto-extension, and 22 working Edit/Pattern commands.
- ✅ Pattern-owned Cyclic Random material and its three Pattern commands.
- ✅ Six-position Variables: Note Order, Transposition, Density, Velocity
  Range, Time Distortion, Pattern Group, and Orchestration.
- ✅ Cyclic Variables with six Positions, random ranges, per-Voice lengths, and
  Classic/Modern dedicated editor.
- ✅ Conducting transport, Baton grid, Tempo/Variable conducting, Robot,
  Pause/Resume, Sync Ratio, and module context menus.
- ✅ Four-lane Midi View initial design with timestamped Note On/Off rows,
  Follow, Clear, bounded history, and channel colors.
- ✅ MIDI reliability phases 1–2: timing segments, clear-before-panic transport,
  batch clock anchors, explicit events, lifecycle releases, Program Change,
  960-PPQN positions, destination separation, and independent Voice RNG.
- ✅ MIDI reliability Phase 3: injected clock/scheduler seams, bounded adaptive
  lookahead and diagnostics, late-attack/stall/suspension recovery, retained
  multi-port lifecycle, controller-aware panic, native batch codec, and stress
  traces.
- ✅ Movable persistent window canvas, z-order, light/dark skins, six channel
  palettes plus custom colors.
- ✅ Non-modal window manager: permanent six-window core, canvas right-click
  launcher, disabled already-open entries, closable simultaneous auxiliaries.
- ✅ 26-location Snapshot core with quantized recall and one-step restore.
- ✅ Versioned `ProjectDocumentV1` save/load with defensive decoding, File menu
  commands, and document-name / unsaved-changes tracking.

## Deliberately paused experiment

The animated absolute-time Midi View (fixed playhead, tempo-derived 16th-note
ruler, and Pattern position/length) and the later independent-lane-speed idea
were removed in favor of the initial event-list design. Moving Length/Base
controls into the Pattern Editor was also rolled back; they remain in Patterns.
