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

1. ✅ **Project save/load (`.mclone`, JSON payload).** `ProjectDocumentV2` and the File menu are
   done: New, Open, Save, Save As, defensive decoding, document name and
   unsaved-changes tracking, including the Conducting/transport title. Save As
   uses an app-owned filename dialog and encoded download so restricted
   browsers commit the visible document name before downloading. New saves use
   `.mclone`; legacy `.mclone.json` and `.json` files remain importable, and the
   transport caption omits the suffix.
   Picker-backed handle persistence is an optional browser enhancement; new
   live-MIDI state is included in the current defensive document codec.
2. ✅ **Slideshows and Snapshot editing.** Hold/Do, partial stores, Edit/copy,
   Blink Everything, Restore, and nine timed record/play/pause/loop/stop
   Slideshows are implemented and saved in document version 2.
3. ✅ **Phrasing / Legato Cyclic.** Manual review established that Phrasing is
   Legato Cyclic, not another Variable. Onset-relative sustain, manual defaults,
   cyclic conducting, Snapshots, Slideshows, and persistence are complete.
   Sound Choice remains intentionally deferred to instrument design.
4. ✅ **Recorder / Movie / MIDI export.** Movie arming/capture/finalization and
   deterministic type-1 Standard MIDI File export are complete. MIDI import,
   Pattern conversion, and imported Sequence playback/persistence were removed
   from active product scope; the manual audit records them as deliberate
   not-applicable product decisions.
5. ✅ **Manual conformance gap closure.** The executable 180-capability inventory
   records 163 passes, zero partials, zero failures, and 17 explicit exceptions.
   The existing and new work queues are empty. See
   [`MANUAL_CONFORMANCE.md`](./MANUAL_CONFORMANCE.md).
6. 🟡 **Instrument layer — next local implementation.** Four independent, stream-color-coded patches in a
   compact dual-oscillator, sub/noise mixer, routable-LFO, click-safe Web Audio
   monitor and themed Synth window are implemented. The approved four
   role-specific browser engines still precede seven full Studio instruments,
   signature effects, and multi-output native audio. Third-party WAM hosting is
   exploratory and does not block Classic.
7. ⬜ **Dynamic Voice architecture.** Remove framework-independent assumptions
   that the engine always has four Voices. Classic exposes four, Studio eight,
   and core structures should support a configured 1–16 without changing
   musical algorithms.
8. ⬜ **Classic release hardening.** Add long-session CPU/memory and asset-load
   tests, migration/failure-recovery fixtures, an accessibility/keyboard pass,
   and a final visible-placeholder audit.
9. ⬜ **Hardware/browser MIDI certification — external verification lane.** Test real input/output devices,
   reconnect and permission failure, background recovery, latency compensation,
   and MIDI Clock measurements across the supported browser matrix. This needs
   representative physical/virtual devices and cannot be completed by the
   local automated suite alone.

The execution order and acceptance gates for these items are in
[`NEXT_STEPS.md`](./NEXT_STEPS.md).

## UI and fidelity backlog — paused

- ✅ Shared rendered typography, global/context menu ownership, 640×480 sizing,
  application scaling, and current clipping/alignment defects are normalized.
- ✅ Compact Synth dial/select rows and the Note Density 100%/fourth-row edges
  have explicit containment clearance at the normal 150% scale.
- ⏸ Broad pixel-overlay work remains deferred to release hardening. Targeted
  defects that clip data, break controls, or contradict a supplied reference
  continue to be fixed as found.
- ✅ Midi ownership is resolved: the permanent strip is the compact six-position
  Orchestration performance view; the separate Midi Assignment window owns
  device/channel setup, controller assignments, latency, and channel messages.
- ❓ Decide the permanent home of global theme and channel-palette controls.
- ⬜ Build a whole-app Modern layout. Only the Cyclic Editor currently has a
  dedicated Classic/Modern view toggle; light/dark and six channel palettes are
  skins over the shared main layout.
- ✅ Cyclic-variable Conducting Arrows are manual-confirmed and implemented for
  Accent, Legato, and Rhythm Positions.
- ✅ Audited Patterns, Transport, and Conductor icons/control semantics. Phase,
  numeric Time Bases, Option-click modes, editable Tempo, semantic transport
  colors, clipped-safe lower controls, and Movie/Sequence/Robot glyphs are
  corrected; the former input dependencies are implemented.

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
- ✅ Live MIDI input and Appendix B control: sixteen input/output assignments,
  Source/Use/Echo routing, recording modes, Keyboard Transpose, Mouse Advance,
  `sa` Step Advance, sustain rests, controller conducting, metronome, and MIDI
  Clock output.
- ✅ Movable persistent window canvas, z-order, light/dark skins, six channel
  palettes plus custom colors.
- ✅ Collision-free auxiliary placement and drag-release snapping with 4px
  alignment gaps; flat module title bars and unified Patterns/Conducting/Midi
  View theme surfaces.
- ✅ Non-modal window manager: permanent six-window core, canvas right-click
  launcher, disabled already-open entries, closable simultaneous auxiliaries.
- ✅ 26-location Snapshot core with quantized recall and one-step restore.
- ✅ Versioned `ProjectDocumentV2` save/load (including Slideshows and v1
  migration) with defensive decoding, File menu
  commands, and document-name / unsaved-changes tracking.

## Deliberately paused experiment

The animated absolute-time Midi View (fixed playhead, tempo-derived 16th-note
ruler, and Pattern position/length) and the later independent-lane-speed idea
were removed in favor of the initial event-list design. Moving Length/Base
controls into the Pattern Editor was also rolled back; they remain in Patterns.
