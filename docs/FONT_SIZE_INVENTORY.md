# Rendered Font-Size Inventory

Measured from the running application at **100% application zoom** on
2026-07-31. The original inventory below records the pre-normalization state.

## Measurement method

Every panel was opened and measured in the same browser session. For every
visible title, button, input, select, output, table label, and text label, the
inventory takes the browser's computed CSS `font-size` and multiplies it by all
ancestor CSS `transform` and `zoom` scales. The resulting number is the
**effective rendered font size**, not merely the declared stylesheet value.

Panel width, height, and title-bar height are browser bounding-box measurements
after the same transforms. Counts in parentheses show how many sampled elements
render at that size.

## Global chrome

| Area | Effective font | Height |
| --- | ---: | ---: |
| Global File/Edit/Variables/Pattern/Windows/Options menu | 11px | 22px |
| Standard core-window title | 10px | 16px |
| Standard core-window title annotation | 8px | within 16px bar |

## Historical pre-normalization panel inventory

The dimensions and sizes in this table are deliberately retained as the audit
baseline. They are not the current values; see **Implemented normalization**
below and `WORKSPACE_SCALING.md` for current geometry.

| Panel | Rendered size | Title font | Title bar | Effective body fonts |
| --- | ---: | ---: | ---: | --- |
| Patterns | 228×120 | **11px** | **20px** | 8px (9), 9px (24), 10px (8), 11px (16) |
| Conducting / Untitled | 229×113 | 10px | 16px | 4.98px (2), 5.48px (9), 5.97px (1), 7.47px (1), 8.46px (2), 8.96px (1), 10.45px (3) |
| Snapshot | 62×315 | 10px | 16px | **11px (44)** |
| Variables | 220×156 | 10px; annotation 8px | 16px | 9px (6), **11px (36)** |
| Cyclic Variables | 229×156 | 10px; annotation 8px | 16px | **8px (36)** |
| Midi | 454×45 | 10px; annotation 8px | 16px | **11px (7)** |
| Midi Assignment | 560px wide | 10px; annotation 8px | 16px | 8px dense setup controls |
| Midi View | 454×257 | 10px; annotation 8px | 16px | 9px (5), 10px (2) |
| Pattern Editor | 319×163 | **7.2px**; annotation 5.76px | **11.5px** | **7.92px (571)** |
| Cyclic Editor (Classic) | 220×183 | 10px; annotation 8px | 16px | 4px (64), 5px (1), **5.5px (345)**, 6px (10), 7px (14), 10px (2) |
| Note Density Editor | 145×90 | **6.5px** | 16px | **5.5px (12)** |
| Velocity Range Editor | 165×81 | **6.5px** | 16px | **5.5px (12)** |
| Note Order Editor | 199×149 | **6.5px** | 16px | 5px (12), 5.5px (4), 6.5px (8) |
| Transposition Editor | 143×95 | **6.5px** | 16px | 4.5px (2), **5.5px (8)** |
| Time Distortion Editor | 140×147 | **6.5px** | 16px | **5.5px (7)** |
| Orchestration Editor | 107×61 | **6.5px** | 16px | 4px (1), **5.5px (68)** |

The Note Density shell is intentionally wider/taller than its fixed scaled
drawing body. Those pixels are containment gutters and do not change its type,
ruler, or Voice-lane cadence.

## Material deltas

1. **Title bars use three distinct systems.** Core windows use 10px text in a
   16px bar. Patterns uses 11px in a 20px bar. Pattern Editor renders at 7.2px
   in an 11.5px bar. All six variable editors use 6.5px text in a 16px bar.

2. **Secondary editor bodies are substantially smaller than core bodies.** The
   six variable editors are dominated by 5.5px text. Core Variables, Snapshot,
   and Midi are dominated by 11px text: exactly a 2:1 difference.

3. **Cyclic Editor contains the widest internal range.** Most sampled controls
   are 5.5px, but the same panel also contains 4px, 5px, 6px, 7px, and 10px
   text. This comes from scaling a layout whose internal declarations were not
   first normalized to shared typography tokens.

4. **Conducting is similarly mixed.** It contains seven effective sizes from
   about 5px to 10.45px because its internal controls are scaled independently
   from the common 10px/16px title chrome.

5. **Pattern Editor is internally consistent but globally undersized.** Nearly
   all body elements render at 7.92px, while its title is 7.2px. Its complete
   window zoom also shrinks the nominal 16px title bar to 11.5px.

6. **Core panels are not uniform either.** Snapshot and Midi primarily use
   11px body text, Cyclic Variables uses 8px, Midi View uses 9–10px, and
   Patterns spans 8–11px.

## Recommended later normalization target

When visual normalization resumes, use explicit shared tokens rather than
whole-panel scaling:

- Global menu: 11px / 22px bar.
- Window title: 10px / 16px bar for every panel.
- Title annotation: 8px.
- Primary body labels and controls: 8px.
- Compact numericals and secondary annotations: 7px only where the reference
  requires it.

Panel geometry can then be adjusted independently without silently shrinking
or enlarging its typography.

## Implemented normalization

The recommendation was enacted after this inventory. A repeat measurement with
all fifteen panels open now reports:

- Global menu: 11px in a 22px bar.
- Every panel title: 10px in a 16px bar (Pattern Editor measures 15.99px due to
  browser subpixel rounding).
- Every primary body control: 8px effective.
- Dense Cyclic, Note Order, Time Distortion, Transposition, and Orchestration
  readouts: the shared 7px compact tier.
- Conducting retains the standard 10px/16px chrome in its current 229×107
  logical shell; the older 229×113 measurement above remains audit history.
- No title name wraps or clips.

Scaled panels use compensated declared sizes at their scale boundary, so the
effective rendered result remains the same when control geometry changes. The
Cyclic Editor now uses this mechanism to enlarge its controls by 25% while
retaining the same 8px/7px effective typography.
