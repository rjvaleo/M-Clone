# Patterns, Transport, and Conductor Parity Audit

**Audited:** 2026-08-01 against `reference/patterns module.png`,
`reference/transport and conductor.png`, and M 2.7 manual Chapters 13 and 15.

This audit separates reference parity from controls that merely occupy the
right rectangle. A visible button is not counted as implemented unless it has
the behavior described by the manual.

## Corrected in this pass

| Area | Confirmed mismatch | Correction |
| --- | --- | --- |
| Patterns / Phase | The numerical was component-local and had no musical effect. | Phase now belongs to each Voice, persists in project JSON, is captured/restored with its Pattern-window Snapshot settings, and delays Start/Sync by 1/96-quarter-note M ticks. The Movie timestamp reflects the delayed onset. |
| Patterns / Time Base | Only 1, 2, 4, 8, and 16 were offered. | The denominator offers every numeric Chapter 13 value: 1–9, 11, 12, 13, 15, 16, and 24. `sa` remains deferred with Step Advance/Input Control rather than being presented as functional. |
| Patterns / Record Modes | Clicking a Chord, Insertion, or Drum icon immediately changed it. | Ordinary clicks now select the Pattern; Option-click changes the chosen mode, matching the Pattern Select box instructions. Double-click still opens the Pattern Editor. Tooltips expose the modifier. |
| Conductor / Tempo | The displayed Tempo Numerical could not set tempo. | It is now an editable, bounded 40–240 numerical and continues to follow the range midpoint/conducting path. |
| Conductor / Movie icon | The glyph resembled a clapper board. | It is redrawn as the manual/reference filmstrip button. |
| Conductor / Sequence icon | The internal mark was an arbitrary star. | It is redrawn as the reference document-and-mechanism symbol; it remains disabled until a Sequence exists. |

## Confirmed correct behavior

- Start begins from step one; Start while paused resumes.
- Stop cancels output, clears Pause, and finalizes an armed/recording Movie.
- Pause resumes from the same cursor through either Pause or Start.
- Space starts while stopped and performs Sync while playing; Return stops and
  Tab toggles Pause.
- Sync resets Voice, Note Order, and Cyclic traversal through fresh cursors.
- The Conducting Grid maps all armed arrows through the same clamped Baton.
- Tempo Range edits normalize endpoints and set the current tempo to midpoint.
- Movie is armed before Start, highlights during capture, and disarms on Stop.
- Play Enable, Pattern selection/double-click editing, Output Length, Time Base,
  Chord Mode, Insertion Mode, and Drum Machine state reach engine/store state.

## Still incomplete by dependency

These controls are retained visually but are not being described as complete:

- **Use Picture Matrix:** Disable and Record are represented; Keyboard
  Transpose, Input Control, and Echo Map require live MIDI input.
- **Source Channel and Echo-Thru-Orchestration:** the UI state exists, but there
  is no MIDI-input routing/recording path yet.
- **Mouse Advance:** the toggle exists, but mouse-gesture clocking and its
  modifier-key gate await the Input Control milestone.
- **Pattern Groups:** the a–f selector is snapshot/conducting-aware, but six
  independent banks of Pattern-window settings and material are not yet
  modeled.
- **`sa` Time Base:** this is specifically Step Advance mode and remains absent
  until Step Advance is real.
- **Sequence Play Enable:** remains disabled until MIDI import creates an
  independent Sequence.
- **Sync Ratio output, MIDI clock, and metronome:** the UI state is present but
  no clock/metronome output consumer exists yet.

The next P5 slice is MIDI import and Sequence playback. Live-input work then
owns Source, Use, Echo-Thru, Mouse Advance, `sa`, and full input recording.
