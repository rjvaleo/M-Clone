# Reference material

Audited against the directory contents on 2026-07-31. These files are the
visual and behavioral source material for the clean-room rebuild. The M 2.7
manual is the behavior authority; screenshots are used for layout and styling.

## Current files

| File | What it shows |
| --- | --- |
| `M27.pdf` | M 2.7 manual, 194 pages |
| `color-app.gif` | Full color application layout and four Voice colors |
| `b&w-open-window.jpg` | Monochrome application/window treatment |
| `all-windows-open-overlapping.png` | Overlapping window layout and stacking |
| `patterns module.png` | Compact Patterns module |
| `transport and conductor.png` | Transport and Conducting Window |
| `variables.png` | Variables Window and six Position miniatures |
| `cyclic editor.png` | Classic Cyclic Editor |
| `note density.png` | Note Density editor |
| `velocity range.png` | Velocity Range editor |
| `note order.png` | Multi-Voice Note Order editor |
| `note-order.png` | Note Order single-state detail |
| `transposition.png` | Transposition editor |
| `time-distortion.png` | Time Distortion editor |
| `pattern-editor.png` | Pattern Editor |
| `snapshot window.png` | Snapshot Window |
| `M-Unified-mockup.html` | Early rebuild mockup; not original M material |

The previously indexed `screen 1.gif`, packaging PNG, and product-thumbnail JPG
are not currently present. Do not cite them as available references.

## Values transcribed into presets

- Note Density Position `a`: 57, 100, 100, 100 percent.
- Velocity Range Position `a`: 48–110, 84–107, 84–104, 85–108.
- Note Order Position `e`, as Original/Cyclic/Utterly:

| Voice | Original | Cyclic | Utterly |
| --- | --- | --- | --- |
| 1 | 50 | 4 | 46 |
| 2 | 38 | 47 | 15 |
| 3 | 3 | 10 | 87 |
| 4 | 10 | 15 | 75 |

The Variables image places Note Density and Note Order on Position `e`; Pattern
Group, Velocity Range, Transposition, and Time Distortion are on `a`. Other
preset numbers are shaped from the visible miniatures where exact values cannot
be recovered. `src/engine/variables.ts` records that distinction.

## Implementation notes

Every current image is covered by the delta table in
[`docs/VISUAL_AUDIT_AND_THEMING.md`](../docs/VISUAL_AUDIT_AND_THEMING.md).
Time Distortion is implemented as an audible piecewise-linear map with pinned
corners; its original rubber-band draw-from-scratch gesture remains unbuilt.
The Conducting Window and Classic Cyclic Editor are implemented, though their
remaining pixel-level differences are still tracked in the visual audit.
