# 640 × 480 workspace and application scaling

The classic interface now uses the original application's 640 × 480 desktop as
its logical 100% coordinate system. `color-app.gif` is a 540 × 353 crop from
that desktop; its measured window geometry supplies the permanent-window sizes.

## Scaling model

- `src/engine/workspace.ts` owns the 640 × 480 constants, 50–200% bounds,
  10% normalization, Fit calculation, physical wrapper size, and drag-delta
  conversion.
- `App.tsx` owns the persisted application zoom and the −, percentage, +,
  100%, and Fit controls.
- The logical workspace keeps 640 × 480 as its floor and grows to fill larger
  viewports. Its parent reserves the scaled physical dimensions so browser
  scrolling and hit testing remain correct.
- `WorkspaceScaleProvider` gives dragging and context menus the same scale.
- Window positions are stored as logical coordinates under versioned `v2`
  keys. Legacy physical-pixel positions are intentionally not reused.
- New/reopened auxiliary windows ignore stale saved positions and use the
  leftmost free column beyond the permanent modules. They stack downward with
  4px gaps. Drag release aligns nearby edges and moves overlaps to the nearest
  free padded edge; user-chosen non-overlapping order remains unconstrained.

At 110%, for example, the desktop and its complete module suite render at
704 × 528 while every saved window coordinate remains unchanged.

## Reference-sized permanent windows

| Window | Logical size at 100% |
|---|---:|
| Patterns | 228 × 120 |
| Conducting | 229 × 113 |
| Snapshot | 62 × 315 |
| Variables | 220 × 156 |
| Cyclic Variables | 229 × 156 |
| Midi, collapsed | 454 × 45 |

Midi's modern detailed controls remain available through its right-click Setup
button; collapsing Setup restores the reference-sized strip.

## Shared design and color

All windows use the same navigation, border, menu, close, focus, movement, and
theme rules. Per-window dimensions describe content geometry rather than
introducing alternate chrome systems.

Four-voice artwork inherits `--channel-1` through `--channel-4`, including the
Patterns rows, Pattern Editor notes, Variables thumbnails and editors, Cyclic
summaries and editor, Midi orchestration, Midi View, Transposition, and Time
Distortion maps. The Classic, Blue, Red, Green, RGB, B&W, and custom palettes
therefore propagate without component-specific color tables.

Reference-native auxiliary sizes are fixed in logical pixels after normalizing
the secondary captures' additional 2× raster scale: Note Density 137×86,
Velocity Range 165×81, Note Order 199×149, Transposition 143×95, Cyclic Editor
275×222, Time Distortion 185×155, and Orchestration 155×80.
Orchestration follows the manual's four Voice rows by sixteen M Output Channels.

## Verification

The workspace math was written test-first. Browser verification confirmed:

- 100% produces a 640 × 480 logical and physical desktop.
- 110% produces 704 × 528 and scales a 220 × 111 Pattern window to 242 × 122.1.
- Fit chooses a supported 10% increment.
- At 120%, a 36 physical-pixel drag moves a window 30 logical pixels.
- Auxiliary initial/reopen placement is non-overlapping, left-aligned, and
  padded; pure collision tests cover free, overlapping, edge-snap, and stacked
  cases.
