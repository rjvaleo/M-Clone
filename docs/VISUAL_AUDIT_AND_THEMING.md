# Visual Audit, Window Consistency, and Theming

Date: 2026-07-31

## Scope and decision

This began as the requested analysis of window/font consistency and the delta
between every image in `reference/` and the implementation. Shared typography,
logical sizing, global/context menus, and current clipping/alignment defects
were subsequently normalized. Further fidelity work is paused until technical
behavior is complete.

Implemented outcomes include the extensible four-Voice color-theme system, six
initial presets, custom palette chooser, menu ownership, shared rendered
typography, and logical panel sizing.

## Reference scale caveat

The reference files do not share one pixel scale. Several isolated windows are
approximately 2x captures. For example, `transport and conductor.png` is
922 x 432 but represents roughly a 461 x 216 internal window and is currently
rendered at 50% (230.5 x 108 CSS pixels) at the user's direction. Raw bitmap
dimensions must therefore never be copied directly. Future matching should use
control ratios, text cap height, line weight, and comparison with the full-app
captures to infer display scale.

## System-wide consistency findings

### Typography

Typography tokens are enacted and verified from rendered output: 11px global
menu text, 10px titles in 16px bars, 8px primary body text, and a 7px compact
tier. Scaled editors compensate declarations at their scale boundary.
Browser-native select and number-input rendering remains a platform delta.

### Window chrome

The three competing title systems have now been consolidated on the majority
generic `.uwin` chrome. Main windows, Pattern Editor, Cyclic Editor, variable
editors, Midi View, and Conducting all use the same compact flat title bar, title/note
layout, inline controls, drag handle, border, and theme treatment. Conducting's
body alone remains scaled to preserve its compact control geometry. Title height,
diagonal notch angle, border weight, menu placement, shadow, and drag hit area
are inconsistent. The original uses flat white panels, black hairlines,
diagonal title notches, and essentially no decorative shadow. A future shared
window primitive may later parameterize notch/title width while retaining the
shared metrics; that is reference-fidelity work, not a remaining consistency bug.

The application now renders inside a 640 × 480 logical desktop. The permanent
window composition has been resized to the measured `color-app.gif` footprint,
and global 10% scaling changes the complete suite without changing logical
window coordinates. Four-channel artwork across previously monochrome modules
now inherits the global palette.

### Sizing and density

The desktop uses absolute positions with unrelated internal scales. Patterns
and Variables are 560px wide, Cyclic is 344px, Snapshot sizes to content, and
Conducting is transform-scaled. The result is not proportional even when an
individual control resembles its reference. Do not solve this with global
zoom; establish each reference's intended scale first.

### Icons and controls

Pattern Editor has the strongest purpose-built icon set. Other panels mix
Unicode, CSS shapes, native controls, and SVG. The original uses crisp one-bit
icons, picture matrices, square numericals, and custom scroll/slider controls.
Native range/select controls are the largest platform-dependent delta.

### Navigation and menus

The black-and-white full-screen capture's global menu bar is restored with
File, Edit, Variables, Pattern, Windows, and Options. Context-specific menus
remain associated with their owning panels through right-click menus. Manual-backed ownership is:

- Pattern Editor: Edit and Pattern.
- Variables: variable editors and Voice 1-4 Color.
- Conducting: supported performance Options, Harmony, and Output.
- MIDI: routing controls, not unrelated global options.

Unsupported historical File, Windows, MIDI Assignment, slideshow, external
clock, and OS lifecycle commands remain documented gaps. Reference controls
that are visible before their subsystem exists are disabled or carry explicit
"not yet wired" tooltips.

The browser replacement for M's Windows menu is a right-click menu on blank
canvas. It lists every window, disables those already open, and can reopen any
auxiliary. The six windows visible in `color-app.gif` are permanent; edit
windows and Midi View are non-modal, independently movable, and closable.

## Screen-by-screen delta

| Reference | Current counterpart | Main deltas for later implementation |
| --- | --- | --- |
| `color-app.gif` | Unified desktop | Global menu restored and footer removed; logical scaling, shared typography, Voice colors, and compact proportions are in place. Exact header branding, notches, gaps, and pixel placement remain deferred. |
| `b&w-open-window.jpg` | Unified desktop / B&W preset | B&W supplies distinct grays, but monochrome chrome, menu geometry, overlap order, and compact desktop dimensions are not matched. |
| `all-windows-open-overlapping.png` | Movable windows | Movement/z-order exists. Auxiliary windows now open/reopen in a collision-free padded column and snap away from overlaps after dragging; user order remains free. |
| `patterns module.png` | Patterns window | 🟡 Rebuilt at the reference's effective 228×120 size with corrected Option-click modes, full numeric Time Bases, and functional Phase. Input-dependent Src/Use/Echo/Mouse Advance and six independent Pattern Group banks remain incomplete. |
| `transport and conductor.png` | Conducting window | Inventory and geometry are close. Exact bitmap font, diagonal/border pixels, native controls, title-menu fit, and lower icons remain deltas. |
| `variables.png` | Variables / `VarThumb` | Six positions and miniature concepts exist. Width, labels/arrows, four-color miniature rows, and exact cell/title metrics differ. |
| `cyclic editor.png` | Dedicated Cyclic Editor | Classic controls are enlarged 25% to 275×222 logical pixels without enlarging typography. Four stacked 5×16 grids, aligned loop numerals, dual axes, controls, Positions, defaults, and random ranges work; Modern exposes all three variables. |
| `note density.png` | Note Density popup | ✅ Reference raster normalized to 137×86 logical geometry, with compact four-Voice percentage/slider rows and global channel colors. |
| `velocity range.png` | Velocity popup | Four bands exist. Selector, dither, number boxes, endpoints, pointer treatment, and dimensions differ. |
| `note order.png` | Note Order popup | ✅ Reference raster normalized to 199×149 logical geometry; three-region behavior, textures, boundaries, values and selector retained. |
| `note-order.png` | Note Order popup | The 100/0/0 state is supported; the same geometry/texture/title deltas apply. |
| `transposition.png` | Transposition popup | ✅ Reference raster normalized to 143×95 logical geometry with four colored Voice rows, Note/Octave controls, C3 reference and selector. |
| `time-distortion.png` | Time Distortion popup | ✅ Content-fit 185×155 logical geometry; Length controls and the complete square graph remain inside bounds at 150% scaling. |
| `pattern-editor.png` | Pattern Editor | Closest reconstruction. Font, title, exact icons, key widths, grid cadence, line weights, scrollbar, and overall scale remain. |
| `snapshot window.png` | Snapshot | Major groups exist. Ratio, tiny icons, row cadence, slideshow symbols, footer artwork, globe, and typography differ. |

## Theme implementation

`src/engine/theme.ts` is the preset library and extension point. Adding a preset
requires one registry entry; the picker is generated from the registry.

- Classic: green, red, blue, yellow from `color-app.gif`.
- Blue: four distinct blue shades.
- Red: four distinct red shades.
- Green: four distinct green shades.
- RGB: red, green, blue, yellow.
- B&W: four distinct grayscale values.

The header exposes a preset selector and four color wells. Editing a well
creates a Custom palette. State persists locally. Colors are exposed as
`--channel-1` through `--channel-4` and currently reach Patterns, Variables
miniatures/editors, both Cyclic Editor views, Cyclic Variables, and MIDI/Midi
View Voice rows. Further reference work can reuse the same API.

## Deferred fidelity work — frozen until technical completion

Completed: reference scale inference, shared typography, common window chrome,
Patterns reconstruction, auxiliary sizing, global/context menu ownership, and
removal of the footer. The remaining fidelity queue is deliberately paused:

1. Optional reference-accurate title notches without separate chrome systems.
2. Remaining one-bit icon normalization.
3. Snapshot, Conducting, and Classic Cyclic pixel-detail passes.
4. Fixed-viewport overlay comparisons for every reference.
5. Decide the permanent home or final styling of the non-reference app header
   and theme controls.

For each panel verify outer size, title cap height, notch, border continuity,
menu ownership, icons, control order, numericals, row cadence, Voice colors,
focus/disabled states, and hit targets at inferred native scale.
