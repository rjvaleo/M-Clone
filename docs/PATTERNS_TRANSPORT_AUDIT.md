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
| Patterns / Time Base | Only 1, 2, 4, 8, and 16 were offered. | The denominator offers every numeric Chapter 13 value plus `sa`; clocked planning skips `sa` Voices and Step/Mouse Advance drives them. |
| Patterns / Record Modes | Clicking a Chord, Insertion, or Drum icon immediately changed it. | Ordinary clicks now select the Pattern; Option-click changes the chosen mode, matching the Pattern Select box instructions. Double-click still opens the Pattern Editor. Tooltips expose the modifier. |
| Conductor / Tempo | The displayed Tempo Numerical could not set tempo. | It is now an editable, bounded 40–240 numerical and continues to follow the range midpoint/conducting path. |
| Conductor / Movie icon | The glyph resembled a clapper board. | It is redrawn as the manual/reference filmstrip button. |
| Conductor / Sequence icon | The internal mark was an arbitrary star. | It is redrawn as the reference document-and-mechanism symbol; it remains disabled until a Sequence exists. |
| Conductor / module geometry | Generic chrome pushed the Grid below a full-width title, separator strokes crossed glyphs, lower numericals clipped, and transport controls were monochrome. | The title/notch now ends over the transport column while the Grid begins at the top; separators render behind crisp one-bit glyphs; semantic reference colors are fixed independently of the Voice palette; lower columns reserve measured widths; and H/V ranges use vertical tracks. |

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

## Dependency closure

The former dependency-bound controls are now wired end-to-end: all Use modes,
Source filtering, Echo-Thru/Echo Map, MIDI recording modes and edit counter,
Keyboard Transpose, Mouse Advance, `sa` Step Advance, Pattern Group banks,
controller assignment, audible metronome, and Web MIDI Clock at Sync Ratio.

Sequence Play Enable remains intentionally absent because Standard MIDI import
and imported Sequence playback are excluded from the product. Its disabled
state is not a retained implementation gap.
