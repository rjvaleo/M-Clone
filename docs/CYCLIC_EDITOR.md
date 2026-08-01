# Cyclic Editor Implementation

Implemented 2026-07-31 from the M 2.7 manual Chapter 17 and
`reference/cyclic editor.png`.

Re-audited against the bitmap's enlarged capture scale. The Classic source
layout remains 439×328 internally, rendered through a 0.625 content scale in a
275×222 logical window. This makes the controls 25% larger than the earlier
normalization while inverse font compensation preserves the shared 8px/7px
typography. It retains four stacked Voice grids at left and permanently visible
Rhythm, Legato, and Accent controls at right. A NOTE descriptor identifies
their units. The home-screen Cyclic Variables module uses the same names.

## Classic and Modern views

Right-click anywhere in the Cyclic Editor to choose **Classic View** or
**Modern View**. Classic preserves the reference-derived compact editor.
Modern opens Rhythm, Legato, and Accent as three simultaneous vertical
modules. Each module contains its title, six Position presets in one row, five
level values in one row, and all four channel grids.

Rhythm and Legato level values remain editable. Accent levels are displayed
as the read-only 0%, 25%, 50%, 75%, and 100% mapping because playback maps
those five levels through each Voice's independently editable Velocity Range;
there is intentionally no separate global Accent value table. Pattern
painting, vertical random ranges, per-Voice cycle length, and Position editing
use the same store actions in both views.

## Implemented behavior

- Accent, Legato, and Rhythm selection.
- Six independent Positions for every cyclic variable.
- Four Voice cycles per Position, each with sixteen steps and five levels.
- Click and horizontal fixed-level painting.
- Vertical drag ranges with inclusive, seeded random level selection.
- Independent 1-16 step lengths for every Voice and Position.
- Global five-value Legato percentage and Rhythm multiplier tables.
- Live playback of the active Position, length, and value tables.
- Double-click from a Cyclic Variable Position into the dedicated editor.
- Shared four-channel theme colors.
- Voice number, both level axes, plotted point/range marks, and selected cycle
  length all resolve through the global `--channel-1` to `--channel-4` palette.
- Level axes on both sides of every grid and clickable 1-16 length numerals.
- Loop-length numerals use sixteen fixed equal-width columns aligned exactly
  with the grid above; selecting 8 highlights 8 and disables playback steps
  beginning at 9.
- Vertical six-cell Position selectors beneath each variable name.
- Manual-derived value defaults: Rhythm 1/1/1.5/2/5 and Legato
  6/25/50/75/100. Legato is a percentage of the actual time to the next onset;
  editable values may exceed 100% to overlap following notes.
- Conducting Arrows for all three Cyclic Variables, with active Positions stored
  by index in Hold/Do, Snapshots, Slideshows, and project documents.

The live `project.cyclic` arrays remain the active cycles consumed by the
planner. Six-position banks and lengths live in the store. Activating a
Position copies its cycles and lengths into the live project; editing the active
Position updates playback immediately.

The manual's “Working with Phrasing” section describes this Legato system; it
does not define a separate Phrasing Variable. See [`PHRASING.md`](./PHRASING.md).

Each step is now either a legacy numeric level or a `{ min, max }` range.
Numeric values normalize to point ranges without consuming RNG, preserving old
seed sequences. True ranges choose uniformly and inclusively through the
planner's seeded RNG, so performances remain reproducible. Existing documents
therefore migrate lazily without a destructive conversion pass.

The title notch, close triangle, dotted grid cadence, sidebar hierarchy, and
Accent reminder have reference-specific rendering. Final font rasterization can
still vary because the original bitmap font is not bundled with the project.
