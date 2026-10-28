# Reference material

Audited against the directory contents on 2026-08-04. Most of these files are
the visual and behavioral source material for the clean-room rebuild: the M 2.7
manual is the behavior authority, and screenshots are used for layout and
styling. A second, smaller group is hardware documentation for the audio ports —
marked as such in the table, because it describes devices M never had.

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
| `eventide-h90-manual-v1.12.5.pdf` | **Not M material.** Eventide H90 manual — the behaviour authority for the Blackhole and DP/4 ports in `src/modular/audio/`, and the source of the shelf-resonance and inverse-Gravity descriptions quoted in `rust/README.md` |

The previously indexed `screen 1.gif`, packaging PNG, and product-thumbnail JPG
are not currently present. Do not cite them as available references.

**A note on size.** The H90 manual is 10 MB — four times the next largest object
in the repository, and about a third of `.git`. It was committed to the root on
2026-08-04 and moved here rather than removed, because rewriting history to
reclaim the space would invalidate every existing clone of a branch more than
one session is pushing to. Weigh that before adding anything else this large.

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
[`IDMLAB_MASTER_PLAN.md`](../IDMLAB_MASTER_PLAN.md).
Time Distortion is implemented as an audible piecewise-linear map with pinned
corners; its original rubber-band draw-from-scratch gesture remains unbuilt.
The Conducting Window and Classic Cyclic Editor are implemented, though their
remaining pixel-level differences are still tracked in the visual audit.
