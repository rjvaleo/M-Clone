# Conducting Window — Dependency Map and Implementation Plan

Transport timing, tempo-continuity segments, Pause/Resume/Sync cancellation,
MIDI event ordering, and the precise browser limitations are specified in
[`MIDI_RELIABILITY_SPEC.md`](./MIDI_RELIABILITY_SPEC.md). This document owns the
Conducting UI and musical controls; the reliability specification owns output
semantics and verification.

Cross-window scale, typography, theme, and menu findings are tracked in
`VISUAL_AUDIT_AND_THEMING.md`.

**Source of truth:** `reference/transport and conductor.png`, M 2.7 manual
Chapters 8 and 15, Chapter 22 for Options, and Appendix A for keyboard
equivalents.

**Implementation status:** Core conducting plus Movie capture/export are
implemented. Pure conductor, Movie, and store behavior are covered by the
current 657-test, 100%-coverage engine/state suite.
Production and single-file builds pass, and the localhost UI has been exercised
with the in-app browser.

## Reference inventory

The screenshot is a 922×432 2× capture of an approximately 461×216 original
window. The implementation uses that 1× footprint rather than treating the
reference pixels as CSS pixels. Its layout divides cleanly into two areas:

- Left: title, Start / Stop / Pause, Sync, Movie, Sequence Play Enable.
- Right: a six-by-six dotted Conducting Grid.
- Bottom: Tempo Conducting Arrow, Tempo Range Bar and Numerical, Sync Ratio,
  Robot Conductor, horizontal/vertical movement ranges, and Robot Time Base.

The manual defines these behaviors:

- **Start (Space):** start playback.
- **Stop (Return):** stop playback.
- **Pause (Tab):** stop scheduling, then continue from the same place.
- **Sync (Space while playing):** reset Voices and Cyclic Variables to step 1.
- **Conducting Grid:** map the Baton’s x/y position into each armed Conducting
  Arrow’s direction. Right and down use increasing grid coordinates; left and
  up reverse them.
- **Tempo Range:** sets the low/high range over which tempo is conducted;
  editing the range makes its midpoint the current tempo.
- **Robot Conductor:** move the Baton automatically, constrained by horizontal
  and vertical jump ranges and paced by a time-base control.
- **Sync Ratio:** stores the relationship between M’s quarter-note pulse and
  MIDI clock/metronome output, with a reversible direction.

Movie capture and Standard MIDI File export are implemented. Imported Sequence
playback, MIDI clock output, and an audible metronome still depend on unfinished
subsystems; Sequence remains disabled with an explicit tooltip.

## Implemented state

- `ConductorWindow.tsx` renders the dedicated compact transport and six-by-six
  Baton grid inside the `Untitled` window.
- `store.ts` owns normalized Baton coordinates, ranges, arrows, atomic
  conducting updates, Sync Ratio, and Robot controls.
- `runtime.ts` implements distinct start, stop, sync, pause, and resume cursor
  semantics.
- Tempo, Pattern Group, supported Variable Positions, and Orchestration respond
  to armed arrows. Robot movement conducts through the same store path.
- Movie arms before Start, captures planner output, highlights while armed or
  recording, and finalizes on Stop. Sequence remains disabled until import and
  playback exist.
- The Tempo Numerical is directly editable from 40–240, while Tempo Range and
  Baton conducting continue to update the same project tempo.
- Movie and Sequence glyphs follow the reference filmstrip and
  document/mechanism symbols. Full audit: `PATTERNS_TRANSPORT_AUDIT.md`.

## Target data flow

```text
pointer / robot position
        |
        v
normalize and clamp x/y to 0..1
        |
        +--> Tempo arrow --> interpolate tempoRange --> project.tempo
        |
        +--> Pattern Group arrow --> Position a..f
        |
        +--> Variable arrows --> activate Position a..f --> live Voice values
```

## Pure engine layer

Add `src/engine/conductor.ts`:

- clamp a Baton point into the unit square;
- select x or y according to an Arrow direction;
- reverse left/up directions;
- map a normalized axis to one of six Positions;
- interpolate a conducted tempo inside a normalized range;
- move a Robot point by a bounded signed jump.

All boundary behavior is tested first: exact edges, reversed directions,
clamping, midpoint selection, normalized tempo ranges, and robot bounds.

## Store layer

Add conductor state:

```ts
baton: { x: number; y: number }
tempoRange: { low: number; high: number }
isPaused: boolean
syncRatio: 1 | 2 | 4 | 8 | 16
syncRatioDirection: "out" | "in"
robotRange: { x: number; y: number }
robotTimeBase: 1 | 2 | 4 | 8 | 16
```

Add actions:

- `conductAt(x, y)` updates the Baton and every armed supported target in one
  atomic store transition.
- `setTempoRange(low, high)` normalizes the range and sets tempo to its
  midpoint, as the manual specifies.
- setters for pause, sync ratio/direction, Robot ranges/time base.
- `robotStep(dx, dy)` advances the Baton and conducts at the resulting point.

Supported in this implementation:

- Tempo
- Pattern Group
- Note Density
- Velocity Range
- Note Order
- Transposition
- Time Distortion
- Orchestration

Cyclic Variables now have six stored Positions, but cyclic conducting arrows
are not yet part of the conducting target model.

## Runtime layer

Add true `pause()` and `resume()`:

- Pause stops the scheduling timer and silences current notes without replacing
  Voice cursors.
- Resume shifts cursor time origins by the paused duration so playback
  continues from the same musical position without trying to catch up.
- Stop retains its current semantics; Start after Stop creates fresh cursors.
- Sync still resets all Voice and Cyclic cursors.

Runtime is browser wiring and remains deliberately thin; the cursor and mapping
logic stays in tested pure/store layers.

## Interface layer

Create `src/ui/ConductorWindow.tsx` and replace the generic `Untitled` body.

The reference image is a 2× capture. The window retains a 461 × 216 internal
coordinate system for exact control geometry and is rendered at 50%, producing
a 230.5 × 108 on-screen footprint.

- Use monochrome CSS-drawn icons and shapes; do not embed the screenshot.
- Match the 1× reference geometry: 461×216 outer window, 265×158 left control
  field, 194×158 Grid, and a 56px bottom strip.
- Use a six-by-six dotted grid with pointer capture and a visible Baton mark.
- Render the tempo range as a dual-handle range line with a current-tempo mark.
- Render Robot movement ranges and time base in the compact lower-right strip.
- Preserve fixed dimensions and the project’s draggable/z-order behavior.
- Keep options that do not belong visually in the window in its right-click
  module menu:
  - **Options:** Midi Conduct, Second-Order Transpose, Scale Snap, Diatonic,
    Chord Tones.
  - **Harmony:** Root, Scale, and deterministic Seed remain commands rather
    than occupying the reference transport face.

The shared context-menu implementation also serves the Pattern, Variables,
Midi, and Cyclic modules.

## TDD sequence

1. Write failing `conductor.test.ts` cases from the manual.
2. Implement the pure coordinate/range/robot functions.
3. Write failing store tests for armed arrows, reversed axes, atomic multi-
   Variable conducting, tempo range, and robot steps.
4. Implement conductor state and store actions.
5. Add runtime pause/resume.
6. Build `ConductorWindow` and its module right-click menu.
7. Run 100% coverage, typecheck, both builds, and live browser interaction/
   screenshot comparison.

## Acceptance criteria

- Dragging or clicking anywhere in the Grid leaves a visible Baton point.
- Armed Variables select the expected a–f Position for all four directions.
- Multiple armed targets change in one Baton move.
- Tempo follows its armed arrow continuously within the selected range.
- Editing the tempo range selects its midpoint.
- Pause and resume preserve musical cursor position.
- Robot movement remains inside the Grid and respects both jump ranges.
- Unsupported Sequence features remain visibly disabled and honest; Movie is
  enabled only for its implemented capture/export workflow.
- Options needed by this window use its module right-click menu.
- Engine/state coverage remains 100%.
