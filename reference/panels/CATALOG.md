# Panel reference — ingested 2026-08-04

Two passes, thirty-one image files across twenty-nine catalogued entries.

**First pass** (entries 1–18, below): nineteen files of synthesizer front
panels and softsynth GUIs — seven physical hardware/Eurorack panels, eleven
software synth GUIs.

**Second pass** (entries 19–29, at the end): twelve files of drum machines
and samplers, added because the first pass under-sampled two things the
first-pass sources barely showed — *readouts* (fields that display a value
rather than set one) and *layout grammar* (which controls sit next to which,
and why). See "Second pass" and "Layout grammar" below; the taxonomy grows
from fourteen items to twenty-nine there, and the kit's own control
vocabulary is settled at fourteen in the final section.

Each entry is what was actually seen in the image, not a guess at the
product's full feature set — this is source material for building a themeable
UI kit, not a design history.

One entry (KULT, #15) covers two files: a full-panel shot and a close-up
detail crop (`Screen+Shot+2022-12-21+at+4.39.48+PM.webp`) that adds
proportion/color detail rather than a new style, so it stays folded into the
same entry rather than getting its own number.

## Component taxonomy

Fourteen "kinds of things" recur across the set, in at least four visually
distinct renderings each. This is the vocabulary a themeable kit needs to
cover — the list every theme is measured against in the gap table at the end.

| # | Component | Sub-styles observed |
|---|---|---|
| 1 | **Rotary knob** | skeuomorphic metal/plastic (pointer line + radial ticks) · flat thin-ring (arc progress + tick) · line-art (open circle, ticks only, no body) · flat solid-color (yellow/red disc + pointer) |
| 2 | **Linear slider** | horizontal track + round cap · vertical fader + round cap · thin vertical line + small triangle handle |
| 3 | **Toggle switch** | mechanical rocker · diamond 2/3-position selector · pill/rounded-rect toggle · circular radio-button |
| 4 | **Push button** | round chunky · rounded-rectangle labelled · small square icon button · illuminated pad |
| 5 | **Jack / port** | hex-nut outline (B&W line art) · colored barrel with ring · plain black round · grouped panel on contrast plate |
| 6 | **LED / indicator** | round dot (power) · ring-style active indicator · colored status dot cluster |
| 7 | **Section label / legend** | bold uppercase header · bracket-underlined group header · boxed/outlined group |
| 8 | **Screw / corner mount** | decorative circular cutout at panel corners |
| 9 | **Waveform / envelope display** | line-art curve on dark field · glowing neon curve with depth trail · scrolling oscilloscope · 3D wavetable stack |
| 10 | **Keyboard strip** | flat black/white keys · backlit keys |
| 11 | **Step sequencer / pad grid** | numbered cells with note name + link icon · illuminated round pads |
| 12 | **Modulation matrix grid** | text-grid with colored numeric cells at intersections |
| 13 | **Preset / patch list** | scrollable text list, selection highlighted by color fill or outline |
| 14 | **Numeric stepper** | pill-shaped `− value +` |

A fifteenth pattern, **wood-grain end-cheek panels**, shows up on every
"warm/vintage" entry (Minimoog, Diva, Enterprise) as a framing device rather
than a control — noted separately, not counted as a "kind of thing" a person
operates.

---

## The eighteen sources

### 1. Minimoog (`minimoog-panel.jpg`)
Dark brushed-metal panel, warm wood end-cheeks. Chunky black knobs with
silver/chrome caps and a white pointer line (skeuomorphic). Orange mechanical
rocker switches. Bold white uppercase section labels (CONTROLLERS, OSCILLATOR
BANK, MIXER, MODIFIERS, OUTPUT) set directly on the panel, no boxes. One black
round headphone jack, one red round power LED.
**Present:** knob (skeuomorphic), toggle (rocker), jack (plain), LED, section
label, wood end-cheek.
**Absent:** slider, button, waveform display, keyboard, sequencer, mod matrix,
preset list, stepper.

### 2. Synthesis Technology MOTM-300 (`MOTM300width1-28in.jpg`)
Stark white panel, pure black line-art. Knobs are open circles with radial
tick marks and printed 0–10 scale — no filled knob body at all. Diamond-shaped
2-position selector switches (EXP/LIN, AC/DC, HARD/SOFT). Hex-nut jack
sockets drawn as line art (black hex outline, white dot center). Bold black
sans labels. No color anywhere; the whole panel is an engineering drawing.
**Present:** knob (line-art), toggle (diamond selector), jack (hex-nut),
section label (boxed).
**Absent:** slider, button, LED, waveform display, keyboard, sequencer, mod
matrix, preset list, stepper.

### 3. Behringer-style Eurorack module, "GRP-A4" (`GRP-A4-panel-231x300.png`)
Black panel. Knobs are black bodies with a brushed-silver metal insert and a
white pointer line, white tick marks and 0–10 numerals. Clean white sans
labels underneath each knob.
**Present:** knob (skeuomorphic, metal-insert variant), section label (plain).
**Absent:** everything else — this is a knob-only crop.

### 4. Behringer EDGE, overlay by Oversynth (`behringer-edge-overlay-white.webp`)
White panel, black hardware trim. Knobs are satin-black bodies with a white
pointer line and white tick marks printed directly on the white panel around
them (ticks live on the panel, not the knob). Dark charcoal contrast plate
for the MIDI/CV jack section (black round jacks on grey). Small 2-position
rocker/slide switches. Round amber/red status LED ("POWER... AMBER = NORMAL,
RED = POLYCHAIN"). Rounded-square illuminated transport buttons at the
bottom (one lit red/orange for "PLAY/STOP"). Bold black sans headers with a
darker rule dividing sections.
**Present:** knob (skeuomorphic, panel-tick variant), jack (grouped, plain
black-on-grey), toggle (small rocker), LED (round, color-coded meaning),
button (illuminated rounded-square), section label (rule-divided).
**Absent:** slider, waveform display, keyboard, sequencer/pad grid (the
per-step knob row exists but there is no illuminated step grid here), mod
matrix, preset list, stepper.

### 5. Cre8Audio West Pest, overlay by Oversynth (`cre8audio-west-pest-overlay.jpg`)
White panel, black hardware trim, yellow accent. Knobs are solid yellow discs
with a white pointer line, no ticks. Large round buttons in black or white,
with a two-tone label plate underneath (black label = base function, yellow
label = shifted/alt function) — several buttons show an active yellow
highlight ring. Black round jacks in two contrast-plate zones (dark grey
INPUT block, dark grey OUTPUT block). Small round LEDs beside some knobs
(green ring). Bold black rounded sans labels, boxed section groups with
rounded corners. Brand wordmark bottom right.
**Present:** knob (flat solid-color), button (round, two-tone label, active
state), jack (grouped, plain), LED (small ring), section label (rounded
box).
**Absent:** slider, waveform display, keyboard, sequencer/pad grid as a
distinct grid (the button row functions as one but isn't visually a grid),
mod matrix, preset list, stepper.

### 6. Rossum Electro-Music Panharmonium (`rossum_electro_music_..._front_panel_black_240296_1.webp`)
Near-black/navy panel. Large off-white flat-top knobs with a dot-ring skirt
(no pointer line — direction is read from a small notch, not a line).
Salmon-pink bracket-underlined section headers (ANALYZER, MODIFIERS,
OSCILLATOR BANK, SPECTRA, PRESETS). Small white round CV jacks in an
"INPUTS"/"OUTPUTS" pair with a decorative curved blue line connecting them,
drawn as a static graphic rather than a real patch cable. Blue small dot
grid as background texture inside each section. Decorative circular cutouts
at all four panel corners (screw mounts). Teal-blue title/subtitle at top.
**Present:** knob (flat, dot-skirt variant), jack (plain white round, with
decorative connector line), section label (bracket-underlined), screw/corner
mount, LED (small colored dots used as bank-select indicators).
**Absent:** slider, toggle switch, button, waveform display, keyboard,
sequencer, mod matrix, preset list, stepper.

### 7. Initial Audio Sektor (`Sektor-Synth-Plugin3.webp`)
Dark navy/slate gradient plugin GUI, green accent. Small dark circular knobs
with a thin green arc ring (flat thin-ring style) rather than a pointer
line. Waveform-icon toggle buttons (sine/tri/saw glyphs as clickable icons).
Two green oscillator waveform previews. Scrollable two-column preset browser
(category list left, patch list right) with a green-highlighted selected
row. Tab bar across the bottom (Keys / Xpression / ADSR / Mod Env / LFO /
Matrix). Full black/white piano keyboard along the bottom edge. Brand
wordmark top right.
**Present:** knob (thin-ring, green), toggle (icon-button), preset list
(two-column, highlighted row), keyboard, section label (tab bar), waveform
display (small preview pane).
**Absent:** slider, jack (plugin, none needed), LED as a distinct hardware
element, sequencer/pad grid, mod matrix (implied by a "Matrix" tab but not
shown open), stepper.

### 8. Audio Damage suite: Phosphor3 / Quanta2 / Continua (`SynthSuite1_...webp`)
Three plugin windows stacked, each a variant of the same flat dark-charcoal
language with a different accent color (Phosphor3 green, Quanta2 dark
red/amber, Continua cyan). All three share: thin-ring knobs (arc-only, no
knob body fill — the most minimal knob style in the set), a title bar with a
small brand glyph + "AUDIODAMAGE" wordmark, thin horizontal level meters
(Phosphor3's harmonic bars), a preset-name dropdown with prev/next arrows, a
waveform/envelope editor with draggable node points and connecting lines
(Continua's ADSR, Quanta2's waveform-with-grain-markers), small toggle icon
buttons (waveform-shape glyphs, in a horizontal row), thin horizontal level
sliders.
**Present:** knob (thin-ring, multi-accent), slider (thin horizontal),
toggle (icon-button row), waveform/envelope display (node-and-line editor),
preset list (single-line dropdown, not a full list), section label (plain
caps).
**Absent:** jack, LED, keyboard, sequencer/pad grid, mod matrix, stepper.

### 9. Audio Damage Axon3 (`main_axon_3_01_2048x2048.webp`)
Near-black to dark-maroon gradient plugin GUI, teal + pink dual accent.
Pill-shaped `− value +` numeric steppers (Tempo, Root Note, Offset,
Threshold, MIDI Note In/Out). A bespoke circular six-node network diagram
with connecting lines (not a generalizable "kind of thing," but the
node-and-edge visual language is worth noting). Thin-ring knobs in teal or
pink depending on section. Pill-shaped toggle buttons ("ON PLAY", "CHROMATIC",
"SYNTH ONLY"). Small circular radio-button toggles paired with a text label
(NETWORK / THRESHOLDS / ALL VOICES / etc.). Rounded-rectangle icon tabs along
the bottom of the routing panel. Transport as two small square icon buttons
(stop/play).
**Present:** knob (thin-ring, dual-accent), stepper (pill `− +`), toggle
(pill button, and separately circular radio-button), button (square icon,
rounded-rect icon tabs), section label (plain caps), waveform/scope display
(small circular scope, bottom center).
**Absent:** slider, jack, LED (round-dot style; the radio toggles double as
status indicators but aren't a distinct LED), keyboard, sequencer/pad grid,
mod matrix, preset list (a preset name field exists but no browsable list is
shown).

### 10. Sonic Academy ANA 2 (`ana_black_and_white.webp`)
Deep navy/charcoal plugin GUI, blue accent. Thin-ring knobs (dark body, cyan
arc). Vertical fader sliders with a blue round cap (filter/amp/mod envelope
lanes drawn as ADSR fader stacks rather than curve graphs). Cyan oscillator
waveform preview panes and a scrolling cyan-on-black envelope/LFO graph
display. Small pill toggle buttons. Mod-wheel and pitch-wheel drawn as tall
narrow vertical sliders on the left edge, separate from the fader stacks.
Full keyboard strip at the bottom. Brand wordmark top right.
**Present:** knob (thin-ring, blue), slider (vertical fader, round cap),
waveform/envelope display (both preview pane and scrolling graph variants),
keyboard, toggle (pill), section label (plain caps, boxed subsections).
**Absent:** jack, LED, button (transport-style), sequencer/pad grid, mod
matrix, preset list (a name field exists, no browsable list shown), stepper.

### 11. Surge XT, skinned by @baconpaul (`baconpaul-scaled.jpg`)
Dark slate-blue-grey plugin GUI, orange accent, illustrated pig background
texture (skin-specific decoration, not a reusable component). The most
slider-dense GUI in the set: nearly every parameter (pitch, waveform mix,
unison, envelope stages, LFO shape) is a horizontal fader with a round
orange or blue cap, arranged in dense stacked columns. A handful of small
blue thin-ring knobs (global volume, FX returns) contrast with the sliders.
Rounded-rectangle multi-option selectors (Scene A/B, Mode, FX Bypass) drawn
as a segmented button row. Small square mute/solo buttons per-oscillator.
LFO shape icon-button row. A scrolling MSEG envelope editor with draggable
nodes. Numeric stepper-like small boxed values next to several sliders.
Patch browser as a single-line searchable field with prev/next, not a full
list panel.
**Present:** slider (horizontal, the dominant control), knob (thin-ring,
sparse use), toggle (segmented button row, small square mute/solo), button
(labelled rounded-rect), waveform/envelope display (MSEG node editor),
section label (plain caps, ruled dividers), stepper-adjacent numeric field.
**Absent:** jack, LED, keyboard, sequencer/pad grid, mod matrix (a routing
list exists but as text rows, not a grid), preset list (single-line browser
only).

### 12. u-he Diva (`uhe-diva-screenshot-fullui-1150x642.jpg`)
Warm wine/maroon panel with wood-grain end-cheeks (same framing device as
Minimoog and Enterprise). Large realistic chrome/metal 3D-rendered knobs
with a white pointer line, set against a dark charcoal "well" background per
knob — the most skeuomorphic/detailed knob rendering in the whole set. Small
black rocker toggle switches (waveform range selectors, sync mode). Vertical
LED-strip-style bar indicators next to the envelope sections (velocity/key
sensitivity, drawn as a small stepped bar rather than a slider — a distinct
"strip indicator" component, not quite an LED and not quite a slider). Boxed
section groups with a small triangular disclosure arrow in the header
("▽ ENV 2", "▽ TRIPLE VCO"). Cursive script logo. Tab bar at the very bottom
(MAIN / MODIFICATIONS / TRIMMERS / SCOPE / PRESETS).
**Present:** knob (skeuomorphic, chrome/3D variant — the richest in the
set), toggle (rocker), section label (boxed, disclosure-arrow header), tab
bar, wood end-cheek, strip indicator (velocity/key bars — a new sub-kind
worth folding into "LED / indicator" as a striped variant).
**Absent:** slider (true fader), jack, button, waveform display (no curve
graphs shown, only knob-driven envelopes), keyboard, sequencer/pad grid, mod
matrix, preset list (tab exists, not shown open), stepper.

### 13. OSS Enterprise (`Enterprise_screenshotsmall.jpg`)
Dark charcoal panel, wood-grain end-cheeks, cyan/teal accent — a
sci-fi-tinted take on the vintage-wood family. Thin dark knobs with a cyan
pointer line (thinner and flatter than Diva's, closer to the thin-ring
family but with a solid dark body rather than an open ring). Small cyan
oscillator waveform preview panes. A circular "vector" XY-pad display
showing a small planet/nebula texture — bespoke, not a generalizable
component, but the circular-display-as-modulation-source idea is notable.
Small pill toggle switches (cyan). Full keyboard strip at the bottom with a
cyan backlight glow beneath the keys — the only backlit-keyboard example in
the set. Tab-style menu row (Menu / Pitch / Vector / Filter 1 / Filter 2 /
Mod type).
**Present:** knob (skeuomorphic-thin, cyan pointer), waveform display
(preview pane), toggle (pill, cyan), keyboard (backlit variant), section
label (tab row), wood end-cheek.
**Absent:** slider, jack, LED, button, sequencer/pad grid, mod matrix,
preset list (a name field exists, no list shown), stepper.

### 14. Unbranded wavetable synth, "VOSM/Vintage" (`Screen+Shot+2017-11-02+at+8.19.53+PM.webp`)
Flat modern grey/charcoal GUI, amber/orange accent — closest in the set to a
minimal "Ableton-Live-device" visual language. Large wavetable stack display
(dozens of overlaid horizontal waveform traces receding in depth, orange
highlight for the active frame) — a distinct "wavetable stack" display type,
separate from a single scrolling waveform. Thin vertical sliders with a
small triangular handle and a numeric readout beside them (gain/tone/pitch
per-oscillator). Amber ADSR curve graphs with draggable square node
handles, each stage labeled Time/Slope/Value as a small toggle group above
the graph. A dense **modulation matrix**: a real text-grid with source rows
against destination columns, colored numeric values (green/orange/blue) at
active intersections — the clearest example of this component in the whole
set. Small thin-ring knobs at the bottom (Res/Frequency/Drive) in cyan.
Bracket/glyph tabs across the very top (menu icons).
**Present:** slider (thin vertical, triangle handle), waveform display
(wavetable-stack variant, plus curve-graph variant), mod matrix (full
text-grid, the reference example), knob (thin-ring, sparse use), toggle
(small text-label group above each envelope), section label (plain, no
boxes).
**Absent:** jack, LED, button, keyboard (cropped out of this shot), toggle
switch (mechanical/pill kind), sequencer/pad grid, preset list, stepper.

### 15. Dawesome KULT (`Screen+Shot+2022-12-21+at+3.15.00+PM.webp`, detailed
by `...4.39.48+PM.webp`)
Near-black flat modern GUI, red accent. Thin-ring knobs — dark body, red arc
progress plus a white pointer tick, the same family as Sektor/ANA/Axon3 but
with the sharpest, thinnest ring in the set (confirmed at close range by the
detail crop). Red circular radio-button toggles paired with a text
label, used identically to Axon3's pattern (ON/OFF states for FM, AM, Vowel,
Unison per-oscillator). Two abstract 3D wireframe "ribbon" visualizers
(bespoke, non-reusable, but establish that this family likes an organic
line-art centerpiece rather than a waveform graph). A dense scrollable
preset list (single column, alphabetically grouped, green text for the
currently-selected patch, orange for the rest) — the fullest preset-browser
example in the set. A horizontal tab row across the top for patch categories
(BASS / BRASS / PAD / LEAD / …). Small circular "engaged" indicator dots
next to OSC1/OSC2/each module group (red-filled when active, outline when
not) — functions as both toggle and status LED simultaneously. A bottom
ruler/keyboard-range strip (tick marks with note-name label, no actual keys
drawn) plus a labelled "PANIC!" button and a small vertical output-level
meter (segmented bar).
**Present:** knob (thin-ring, red — best-documented example via the close-up
crop), toggle (circular radio-button, dual-purpose as LED), preset list
(full column, color-coded selection), section label (tab row), button
(labelled rounded-rect, "PANIC!"), LED (segmented level meter, a new
sub-kind).
**Absent:** slider, jack, waveform display (only bespoke wireframe art, not
a generic curve/scope), keyboard (ruler only, no drawn keys), sequencer/pad
grid, mod matrix, stepper.

### 16. Chaos-attractor LFO/preset grid, unbranded (`Screen+Shot+2022-12-21+at+4.40.18+PM.webp`)

Grid of preset cards on black, five columns. Each card is a small colorful
line-art curve (Lorenz, Chua, Van der Pol, Rayleigh and other attractor
shapes, plus basic Saw/Square/Triangle/Sine/White-noise references) rendered
in a distinct accent color per card, with the card name in grey caps above
and a green outline on the currently-selected card. This is a **preset card
with a generative-curve thumbnail** — a variant of "preset list" crossed
with "waveform display," worth keeping as its own pattern since the visual
payload (the curve) *is* the content being selected, unlike a text-only
preset row.
**Present:** preset list (card-grid variant, thumbnail-driven), waveform
display (icon-scale curve thumbnail, a new small-format sub-kind).
**Absent:** everything else — this is a single-purpose browser crop.

### 17. Vintage sampler "Sample Edit" screen, likely Akai/E-mu style
(`ScreenShotSampleEdit-4ecd05755ef78253dd742b4c4a49925d.jpeg`)
The one genuinely different *material* in the set: a monochrome-blue LCD
hardware screen rather than a modern GUI or a metal panel. Blue monospace
text on a pale blue-white background. Stereo waveform display (L/R lanes) in
solid blue fill. Small square icon buttons in a left rail (Edit, Loop
Fwd/Bwd, Lock, Loop toggle) and a bottom row (Adjust/ZeroX/Zoom ×2, each
with a small glyph). A lock icon and a loop icon rendered as tiny bitmap-style
glyphs rather than vector icons — deliberately low-resolution, matching the
LCD's real pixel density. This whole family (LCD screen surface + chunky
bitmap glyph buttons) is worth keeping as a distinct **"hardware LCD"** theme
candidate separate from every backlit/plugin GUI above.
**Present:** waveform display (LCD stereo variant), button (small square
bitmap-icon), section label (implicit, via the small caps field names).
**Absent:** knob, slider, toggle, jack, LED, keyboard, sequencer, mod
matrix, preset list, stepper.

### 18. WaveNode (`megathread-new-softsynths-software-and-apps-v0-9lyo9xfc3k2h1.webp`)
Very dark near-black GUI in a macOS app window (traffic-light chrome, visible
top-left). Glowing neon oscillator displays — layered depth-shadow traces in
orange (OSC1) and cyan (OSC2), the most dramatic waveform rendering in the
set. Thin vertical sliders with a round handle and a percentage readout,
used for octave/pitch/drift/pan/drive/volume rows. A card-grid of small
module-category tiles (Oscillators/Envelopes/Filters/Effects/Modulators)
each with its own icon-scale preview graphic. A **step sequencer grid**: 16
numbered cells, each showing a note name, a small link-chain glyph, and a
colored dot (blue = active, gold = current playhead step, outline-only =
empty) — the clearest sequencer/pad-grid example in the set. A full
black/white keyboard strip bottom-right with octave ± steppers. Small pill
buttons for transport/record/solo (STEP REC, glowing red when armed; STOP,
glowing green when running). BPM/Swing/Vol shown as compact labelled fields
in the title bar.
**Present:** waveform display (neon depth-trail variant), slider (thin
vertical, percentage-readout variant), sequencer/pad grid (numbered-cell,
the reference example), keyboard, button (pill, glow-state), section label
(icon-tile card grid — a new sub-kind, "module tile").
**Absent:** knob (this GUI does not use a single traditional knob anywhere —
notable, since every other software example does), toggle switch, jack, LED
(round-dot style; the glow-state buttons substitute for it), mod matrix,
preset list (tabs exist for sound slots, not a browsable list), stepper (a
small `OCT −`/`OCT +` pair exists but is drawn as plain text buttons, not
the pill-stepper style Axon3 uses).

---

## Gap table

Coverage of the fourteen-item taxonomy, one row per source. ✓ = present in
the image, · = absent. Reading a row shows how far a style is from a
complete kit; reading a column shows which component is best/worst attested
across the whole set — the input the eventual synthesis step needs.

| Source | Knob | Slider | Toggle | Button | Jack | LED | Label | Screw | Wave/Env | Keys | Seq/Pad | Mod grid | Presets | Stepper |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| 1 Minimoog | ✓ | · | ✓ | · | ✓ | ✓ | ✓ | · | · | · | · | · | · | · |
| 2 MOTM-300 | ✓ | · | ✓ | · | ✓ | · | ✓ | · | · | · | · | · | · | · |
| 3 GRP-A4 | ✓ | · | · | · | · | · | ✓ | · | · | · | · | · | · | · |
| 4 Behringer EDGE | ✓ | · | ✓ | ✓ | ✓ | ✓ | ✓ | · | · | · | · | · | · | · |
| 5 Cre8Audio | ✓ | · | · | ✓ | ✓ | ✓ | ✓ | · | · | · | · | · | · | · |
| 6 Rossum | ✓ | · | · | · | ✓ | ✓ | ✓ | ✓ | · | · | · | · | · | · |
| 7 Sektor | ✓ | · | ✓ | · | · | · | ✓ | · | ✓ | ✓ | · | · | ✓ | · |
| 8 Audio Damage suite | ✓ | ✓ | ✓ | · | · | · | ✓ | · | ✓ | · | · | · | ✓ | · |
| 9 Axon3 | ✓ | · | ✓ | ✓ | · | · | ✓ | · | ✓ | · | · | · | · | ✓ |
| 10 ANA 2 | ✓ | ✓ | ✓ | · | · | · | ✓ | · | ✓ | ✓ | · | · | · | · |
| 11 Surge XT | ✓ | ✓ | ✓ | ✓ | · | · | ✓ | · | ✓ | · | · | · | · | ✓ |
| 12 Diva | ✓ | · | ✓ | · | · | ✓ | ✓ | · | · | · | · | · | · | · |
| 13 Enterprise | ✓ | · | ✓ | · | · | · | ✓ | · | ✓ | ✓ | · | · | · | · |
| 14 VOSM wavetable | ✓ | ✓ | ✓ | · | · | · | ✓ | · | ✓ | · | · | ✓ | · | · |
| 15 KULT | ✓ | · | ✓ | ✓ | · | ✓ | ✓ | · | · | · | · | · | ✓ | · |
| 16 Attractor grid | · | · | · | · | · | · | · | · | ✓ | · | · | · | ✓ | · |
| 17 Sample Edit (LCD) | · | · | · | ✓ | · | · | ✓ | · | ✓ | · | · | · | · | · |
| 18 WaveNode | · | ✓ | · | ✓ | · | · | ✓ | · | ✓ | ✓ | ✓ | · | · | · |

No single source covers more than nine of the fourteen. Knob, section label
and waveform/envelope display are near-universal; jack, screw, sequencer/pad
grid, mod matrix and stepper each appear in three or fewer sources — these
five are where "synthesizing the missing ones" will do the most work.

---

## Next: turning this into a swappable kit system

This catalog is the ingestion step. Two decisions are needed before building
the actual asset library, both scoped in the accompanying proposal shared
with the project owner:

1. **How many kits.** Eighteen sources do not need to become eighteen kits —
   several share a family (Minimoog/Diva/Enterprise are all "warm vintage
   wood"; Sektor/Axon3/KULT/ANA share the "thin-ring knob, dark flat GUI"
   language). A smaller set of clearly distinct kits, each complete, serves
   the "interswapped as a theme" goal better than eighteen partial ones.
2. **Format.** The existing theme system (`src/modular/theme/`) swaps color
   tokens onto CSS custom properties; it has no concept yet of swapping
   component *shape*. Making a knob actually look different between themes —
   not just recolor — needs a new layer, most naturally SVG components keyed
   to the same token vocabulary so a kit's assets still respond to the
   existing palette system rather than hard-coding their own colors.

*Both were settled: six kits, SVG components under `src/modular/theme/kits/`.
Built and shipped — see `KitGallery.tsx`. The second pass below is what
grew that from seven controls to fourteen.*

---
---

# Second pass — drum machines and samplers

Twelve files, eleven entries (Serato #29 covers two screenshots of the same
product, following the KULT precedent). These were ingested for a different
reason than the first pass: not "what does a knob look like" but "what else
is on a panel besides knobs, and how is it arranged."

Two things dominate here that the first-pass sources barely showed. The
first is **readouts** — fields whose job is to *display* a value someone
selected elsewhere (`Midi C1`, `Choke None`, `ROOT G3`, `45.9Hz`, `BPM
120.5`, `LENGTH 16`). Nearly every image has several; the first pass logged
almost none. The second is **layout grammar** — the consistent, unspoken
rules about which control sits next to which, documented in its own section
after the entries.

### 19. ADSR Drum Machine (`Sound.png`) — dark modern software

Charcoal GUI, magenta-pink accent. Top: an 8×2 **pad grid**, each pad
carrying two labels (note name `C1` small and grey above, sound name `Kick`
below in a hue keyed to sound class — Kick pink, Snare blue, Hihat green,
Clap orange, Rim red); the selected pad is a solid accent fill with the
labels knocked out. Below, a sample path field with a magnifier icon,
flanked by `‹` `›` **prev/next steppers** and a dice **randomize** button;
to its right two **label/value readouts** (`Midi C1`, `Choke None`) with the
value in accent.

A row of knobs, each with its **numeric value large below the knob** and the
parameter name below that (`-0.0` / Gain, `0%` / Pan, `100%` / Velocity) —
value takes visual priority over name. Bipolar knobs carry a small centre
dot at 12 o'clock.

A **waveform display** with: triangular grip handles at the top corners for
trim, draggable diamond markers for split points, a playhead line, and
diagonal hatching over the out-of-range regions. Under it a **tab strip**
(Env / Split / Tune, each with a glyph, active one underlined in accent).

The effects rail below is the clearest **module-header** example in the whole
set: each of Cut / EQ / Compressor / Filter / Drive / Phaser gets a header
with a circular power toggle (accent when on), the name, and a collapse
chevron. Inside, an **EQ response curve** with draggable coloured band nodes
and axis labels (+12/−12, 100Hz/1k/10k), a **filter response curve** with one
draggable node, and a three-glyph **icon selector** for filter type. A
rotated vertical **tab rail** (Transient / Body) runs up the left edge.
Bottom: transport, a BPM field, and a horizontal stereo **bar meter** with an
`-INF` readout.
**Present:** pad grid, waveform (marker/region variant), value readout,
curve editor, meter, tab strip, module header with power toggle, icon
selector, stepper, toggle (pill), knob, button.
**Absent:** jack, screw, keyboard, mod matrix, fader.

### 20. Vermona drumDING (`Vermona_drumDING_N13-12628_01.webp`) — hardware, two-tone

Brushed metal upper panel (near-white) over a slate-violet lower panel, with
corner **screws**. Knobs in two finishes that mean two things: pale silver
for shaping parameters, **orange for level/output** — colour as function,
not decoration. Small physical **2-position toggles** with both states
printed above (`LO`/`HI`, `0`/`5TH`, `PINK`/`BLUE`).

The upper panel is the best **signal-flow** example in the set. Thin lines
are printed on the panel joining each knob to the black rounded **section
plates** below them (VCO, MODULATOR, VCF, ROUTING MIXER, VCA), and bracket
lines tie knob *pairs* into sub-groups (the two PITCH knobs, the two BEND
knobs). Separately, right of centre, a printed **routing diagram**: a stack
of labelled boxes (VCO → NOISE → CLICK → AUX IN → VCF → VCA → OUT/SAMPLE)
wired by lines, telling you the architecture without a manual.

Lower panel: a blank OLED strip, four chrome **encoders** (E F G H — no
pointer line, since an encoder has no absolute position) plus an orange
LEVEL knob. Then rows of small square **buttons each with one or two round
LEDs above it** in a recessed bezel — red/green pairs for TRACK 1–6, amber
for the 16 numbered **step buttons**.
**Present:** knob (two-tone functional), toggle (hardware, labelled both
states), section plate, signal-flow diagram, screw, LED, button+LED pair,
step grid, encoder, display (blank OLED).
**Absent:** slider/fader, jack (rear-panel), waveform, keyboard.

### 21. Teenage Engineering K.O. II (`one-bad2978…jpg`) — hardware, graphic LCD

Light grey ABS, orange accent, black keycaps. The display is a **seven-segment
numeric readout** (`19.3`) surrounded by a fixed **icon legend** — a printed
grid of glyphs that light or stay dark to show state (battery, bar, metronome,
stereo, record, play, loop, FX, swing). Also a four-quadrant **radial
pie indicator**.

The key idea here is the **dual-label key**: one physical key carries a black
primary label and a coloured secondary label for its shifted function
(`SOUND`/`EDIT`, `MAIN`/`COMMIT`, `TEMPO`/`LOOP`, `SAMPLE`/`CHOP`), with the
currently active half lit orange. Beneath several keys is a small round LED
next to a parameter name (`LEVEL`, `PITCH`, `TIME`, `LPF`, `HPF`, `ATK`,
`REL`, `PAN`, `TUNE`, `VEL`, `MOD`) — a **legend of what the encoders are
currently assigned to**, one lit at a time.

Two large **encoders with a raised cap** (labelled X and Y) sit under square-
bracket group labels (`GAIN`, `SWING`). At the left, a **vertical fader with
a wide flat finger pad** and a centre detent tick printed on the track — the
canonical "mixer fader" as distinct from a thin slider. A numeric keypad, big
`−`/`+` keys, and an illuminated `RECORD` key glowing orange.
**Present:** segment display, icon legend/state grid, radial indicator,
dual-label key, LED-as-assignment-legend, encoder, fader (finger pad, centre
detent), bracket group label, keypad, illuminated button, jack (top edge).
**Absent:** waveform, traditional pointer knob, mod matrix.

### 22. Roland TR-909 (`7ff81f66ca5…webp`) — grey/orange software recreation

Warm off-white panel, orange accent, near-black knobs with an orange pointer
line and printed radial ticks. This is the reference example for the
**section header bar**: a dark bar with the instrument name in accent caps
(TOTAL ACCENT · BASS DRUM · SNARE DRUM · LOW TOM · MID TOM · HI TOM · RIM ·
CLAP · HI HAT · CYMBAL) spanning exactly the column group it governs, with
thin vertical rules separating adjacent groups. Under each bar, knobs sit in
a small grid with **each knob's own label printed above it** (TUNE, LEVEL on
the first row; ATTACK, DECAY on the second) — and the group widths differ
because the groups have different parameter counts, so the header bars are
different widths too.

A dark-red **LCD-style preset field** (`1 Preset`, `Deep 909`) with
up/down **stepper arrows** at its right edge and a `WRITE` button beside it.
Eight small amber bank buttons (A–H). A large VOLUME knob with a fine tick
ring, noticeably bigger than the SHUFFLE knob next to it. Along the bottom, a
**bar/beat ruler** of bracketed note-value cells above 16 numbered **step
buttons** with rectangular LED indicators, and a label strip beneath naming
which instrument each step group belongs to.
**Present:** section header bar (the reference example), knob (+per-knob
label above), preset field with stepper, LCD text field, step grid, bar
ruler, button, size-as-priority.
**Absent:** slider/fader, jack, waveform, meter, keyboard.

### 23. drumcomputer (`62cc830b711…webp`) — dark, per-track colour

Charcoal, and the clearest **per-track colour identity** in the set: each of
eight tracks owns a hue (red, terracotta, sand, blue, green, olive, gold,
brown) carried consistently across *five* separate elements — the pitch ring,
both knobs, the numbered tab, the fader's level line, and the key badge at
the bottom. Colour here is an index, not styling.

Pitch is shown as a **number inside a thin open circle** — a readout ring,
not a knob (there is no pointer). Below each knob pair, an `RND ▾` **menu
button with a caret**, and an outline **glyph** naming the instrument type
(kick, snare, cymbal, clap, djembe, ride, machine, dice).

The mixer strip below has **vertical faders with wide rectangular finger-pad
handles**, each over a coloured track line whose length shows the level, plus
tiny stacked `M`/`S` mute/solo squares and small Pan/Room/Hall knobs. A
**track tab strip** (coloured 1–8, then KIT and SEQ) selects what the strip
edits. Master effects show a **bipolar segmented scale meter** — a tick ruler
with a lit segment run and the two extremes labelled at the ends
(`Attack`↔`Release`, `Gain Reduction / Make Up`). Choke groups read as a
paired assignment (`3 ⊠ 6`). Key range shows as a **two-line note badge**
(`C0` over `C♯1`).
**Present:** fader (finger-pad, the reference example), readout ring, menu
button with caret, icon glyph, M/S pair, tab strip, segmented bipolar meter,
per-track colour identity, paired-assignment readout, knob.
**Absent:** jack, screw, waveform, keyboard, stepper.

### 24. Nepheton 2 (`0211f7b914…webp`) — 808-derived, warm cream on black

Black panel, cream/red/orange/amber knob rows, cream keycaps. Each instrument
is a **column**: name header, an `M ● S` mute/solo row with an LED, then a
vertical stack of knobs each labelled above (LEVEL, TONE, DECAY, SWEEP) —
same parameter always at the same height across columns, so the row you are
scanning is the parameter and the column is the voice.

Introduces several readout kinds: a **vertical dot column** of six or seven
LEDs used as a compact meter (`RED.` for gain reduction); **LCD numeric
fields** in recessed boxes (`1/16 FULL`, `16`, `57`, velocity `54`/`97`/`97`)
in a segmented typeface; and an **inline value chip** for crossover
frequencies (`45.9Hz`, `842Hz`) boxed between the bands it divides.

Effects are **slot tab strips** — five named slots per bus, each with a
status LED and a dotted **drag handle** for reordering. Mode selection is a
**vertical radio group with LEDs** (`COMP.`/`VCA`, one lit). Also a
**segmented button group** (`NORMAL` | `FLAM` | `SUB S.`) and **icon toggle
groups** (two speaker glyphs for step type, five note glyphs for
articulation, active one orange).

The sequencer is a grid: instrument names down the left, 16 step columns
across, filled cells dark red — and **accent shown as a lighter tint of the
same red**, not a different colour, so velocity reads as intensity. Bottom
right, **illuminated numbered pads** (1–12, A–D) each with an LED bar across
the top.
**Present:** LED dot-column meter, LCD numeric field, inline value chip, slot
tab strip, drag handle, LED radio group, segmented button group, icon toggle
group, sequencer grid with tinted accent, illuminated pad, M/S pair, knob,
column layout.
**Absent:** fader, jack, screw, waveform, keyboard.

### 25. Nithonat 2 (`82db8a7431…webp`) — sibling of #24, mastering-focused

Same house style as Nepheton 2, cream panel instead of black, and worth its
own entry for one thing: **size as priority**. The multiband compressor's
`THRESHOLD` knob is drawn roughly two and a half times the diameter of the
`ATTACK`/`RELEASE` knobs flanking it, and the `OUTPUT VOLUME` knob is the
largest object in the master section. Nothing labels these as more
important; the size does.

Also here: **orange rectangular rocker switches** with an LED above
(`ENABLE`, one per band), a **stereo block meter** (two columns of stacked
segments), a `1ms` **look-ahead value chip**, a printed **signal-flow glyph**
(`⊘→` for master output), toolbar **icon buttons** (copy / paste / trash,
`‹ › « »`), and colour-coded action keys (COPY yellow, PASTE orange, CLEAR
red) where the cap colour carries the severity.
**Present:** size-as-priority (the reference example), rocker switch + LED,
stereo block meter, value chip, signal-flow glyph, icon button row,
severity-coloured buttons, sequencer grid, LCD field, illuminated pad.
**Absent:** fader, jack, waveform, keyboard.

### 26. Bitwig Sampler (`sampler-full-screen-v0…webp`) — compact dark device panel

Very dense dark strip. **AHDSR drawn as a row of five knobs** labelled with
single letters (`A H D S R`), each ringed in accent — the compact envelope
layout. A stereo **waveform** (L and R stacked) with yellow square marker
flags for start/end. Below it two rows, `PLAY` and `LOOP`, each a mode-icon
group followed by **value+unit readouts** (`0.00 ms`, `222 s`, `0.00 %`),
and a header line of inline label/value pairs (`ROOT C3`, `0 cents`,
`GAIN 0.0 dB`, `100 %`).

A **filter slope selector as a row of eight tiny curve glyphs**. Dropdowns
with a caret (`Repitch ▾`, `AHDSR ▾`). Small **toggle chips** stacked
(`PLAY` / `LOOP` / `LEN`, the active one filled green). Two small **XY
breakpoint editors** — a curve in a box with a draggable dot — for
modulation shaping. Tab buttons (Note / Release / FX) where the active tab
is outlined in its own colour.
**Present:** envelope as knob row (AHDSR), waveform (stereo, flag markers),
value+unit readout, inline label/value pair, icon-glyph selector, dropdown,
toggle chip, XY breakpoint editor, tab.
**Absent:** jack, screw, fader, keyboard, meter.

### 27. Mimic Creative Sampler (`ReasonTech_1121_01…jpg`) — dark teal/orange

Dark slate with teal and amber accents, panels drawn as raised rounded
plates with a title in the top-left corner — a **framed section**, as
opposed to TR-909's header *bar*.

The mode selector is a **segmented row where each option carries a glyph
above its label** (Pitch / Slice / Multi Slot / Multi Pitch, active one
filled red), and slot selection is a **numbered segmented row** (1–8) with a
small waveform thumbnail under the selected slot. A **waveform overview
strip** sits above the main waveform, which carries slice markers as small
triangles along its top edge, a red playhead, and a blue start marker.

A **mini keyboard strip** shows the mapped key range with octave labels
(C1…C7) and the assigned zone highlighted. Envelopes appear here in their
third form: **ADSR as four short vertical sliders** labelled A D S R with
coloured caps — Filter Envelope and Amp Envelope each drawn that way,
side by side, so the two envelopes are visually comparable at a glance.

Also: **LED radio lists** (`GLOBAL POSITION`/`SNAP TO SLICES`;
`POLY`/`MONO RETRIG`/`MONO LEGATO`), amber-bordered **dropdown fields**
(`Off`), a two-digit **LED numeric display** (`00`), narrow **vertical
sliders with small rectangular caps** (PITCH, MOD) — visibly a different
control from the mixer fader in #23 — and a **modulation source row** where
FREQ · KBD · VEL · ENV · MOD are joined by a printed horizontal line into
one chain.
**Present:** framed section, segmented selector with glyphs, waveform
(overview + detail, slice markers), keyboard strip with zone, envelope as
mini-slider bank, LED radio list, dropdown, LED numeric display, thin slider
(small cap), modulation chain row.
**Absent:** jack, screw, meter, pad grid.

### 28. CR8 (`fe2e141e4ce…webp`) — light/white plugin

The only predominantly **light** panel in either pass, and useful for that
alone: white body, black knobs, pastel section tints (blue for filter, grey
for envelope), saturated pills for modulation sources.

A compact **top readout row** — label above, value below (`TUNE 0`,
`FINE 0`, `BEND 4`, `VOICES 8`, `OUT 0.0`) — and **value chips** beside
labels elsewhere (`TUNE [12]`, `VOL [-28.6]`, `VEL [20]`), plus a bordered
**readout block** stacking `GAIN 0.0` / `ROOT G3` / `BPM 120.5`.

Knobs carry a **modulation arc**: a coloured partial ring outside the knob
body showing mod depth, with a small dot at the mod target and the source's
name printed beneath in the source's own colour (`VL` teal, `M1 M2` purple,
`A4` magenta). Those colours come from the **modulation source pill bar**
along the bottom (KY · AT · PW · MW · VL · M1–M4 · A1–A4), where the
selected source is inverted — so a knob's arc colour tells you *which*
modulator is moving it.

Filter type is a **2×2 grid of curve glyphs** plus a stacked `12`/`24`
dB-per-octave toggle. ADSR appears in its fourth form here: **four large
black knobs** labelled ATTACK / DECAY / SUSTAIN / RELEASE with an `ADSR
[A1 ▾]` assignment chip to their left. The waveform has **triangular
fade-in/fade-out ramp handles** draggable from the corners, region shading,
and a **bar ruler** (1 2 3 4) across the top. At the bottom, a **bipolar
step editor**: bars above and below a centre line, scale marked +24 / 0 /
−24, a playhead, pencil/eraser/folder tool buttons, a `STEPS 16` readout,
and a play-mode icon row (`→ ↻ ⇄ ‖`).
**Present:** light panel, readout row, value chip, readout block, modulation
arc on knob, mod-source pill bar, glyph grid selector, envelope as large
knob row, waveform (fade ramps, bar ruler), bipolar step editor, tool
buttons, tab strip.
**Absent:** jack, screw, fader, meter, keyboard.

### 29. Serato Sample (`a913a07d3a5…webp` + `2a423231ac…webp`) — two views

Two screenshots of one product: a grid/cue-edit view and a knob view. Dark
grey chrome, yellow accent, and an unusually **saturated pad bank** — 8×4
pads in a full spectrum of hues, some carrying a key-letter badge (H, N, J,
M, Z, S, X…) and a star **favourite marker**. The pads are wide rounded
rectangles, not squares.

Compound numeric controls recur: a value with **up/down arrows plus `×2` and
`½` multiplier buttons** beside it (BPM `70.35`, Time Stretch `-50%`, Key
Shift `+2`) — a stepper with coarse jumps attached. `MONO`/`POLY` appears as
a **two-line stacked selector**, one half highlighted. An **icon toggle row**
(mic / keys / guitar / drums) filters by instrument category. Track info sits
in a **grouped readout** (title, then Key / BPM / duration in small type
beneath).

Waveform is shown twice: a full-length **overview strip** at the top and a
detail view below, with a green region selection, coloured cue **flag
markers** (triangles that hang from the top edge), a white playhead, and
`+`/`−` zoom buttons overlaid at the left. The knob view's knobs are
**arc-progress with a small dot above** the knob at 12 o'clock (Level,
Filter, Attack, Release). Beside them, **icon buttons with the caption
underneath** (Reverse ◀, Favorite ★, Options ⚙) — the caption is part of the
control, not a separate label.
**Present:** pad bank (wide, saturated, badged), stepper with multipliers,
stacked two-line selector, icon toggle row, grouped readout, waveform
(overview + detail, flag markers, region, zoom), arc knob with dot,
icon+caption button.
**Absent:** jack, screw, fader, keyboard, mod matrix.

---

## Expanded taxonomy

The first pass named fourteen kinds of thing. The second pass adds fifteen
more, numbered 15–29 below. Several are readouts — controls that display
rather than set — which is the category the first pass almost entirely
missed.

| # | Component | Sub-styles observed |
|---|---|---|
| 15 | **Value readout / data field** | label-above-value-below (CR8 top row) · value-below-knob, larger than its name (#19) · inline `LABEL value` pair (#26) · recessed LCD box in a segmented face (#24) · bordered readout block stacking several (#28) · value inside an open ring (#23) |
| 16 | **Value chip** | small rounded badge beside a label (`[12]`, `[-28.6]`) · boxed inline constant between groups (`45.9Hz`, `1ms`) |
| 17 | **Segmented selector** | horizontal segmented row, active filled (#24 `NORMAL\|FLAM\|SUB S.`) · glyph-above-label segments (#27 mode) · numbered slot row (#27 1–8) · two-line stacked pair (#29 `MONO`/`POLY`) |
| 18 | **LED radio group** | vertical list, one round LED per option, one lit (#24 `COMP.`/`VCA`, #27 `POLY`/`MONO RETRIG`/`MONO LEGATO`) |
| 19 | **Icon glyph selector** | filter-slope curve glyphs in a row of 8 (#26) or a 2×2 grid (#28) · articulation note glyphs (#24) · instrument category icons (#29) · filter-type curves (#19) |
| 20 | **Level meter** | horizontal stereo bar with dB readout (#19) · vertical LED dot column (#24) · stereo stacked block segments (#25) · bipolar tick-scale with labelled extremes (#23) |
| 21 | **Trigger pad** | square, two labels, class-coloured (#19) · illuminated numbered with LED bar (#24) · wide saturated rounded rect with key badge and star (#29) · button+LED-pair in a bezel (#20) |
| 22 | **Mixer fader** | wide flat finger pad on a track, over a coloured level line (#23) · hardware fader with a printed centre detent (#21) — distinct from the thin small-cap slider (#27), which is its own thing |
| 23 | **Envelope display/editor** | drawn curve with draggable breakpoints (#19 Env tab) · row of knobs, one per stage (#26 AHDSR, #28 ADSR) · bank of short vertical sliders, one per stage (#27) |
| 24 | **Waveform display** | trim grips + split diamonds + hatched out-of-range (#19) · stereo L/R with flag markers (#26) · overview strip above detail view (#27, #29) · fade-in/out ramp handles (#28) · region selection + cue flags + zoom (#29) |
| 25 | **Curve / response editor** | EQ response with draggable band nodes (#19) · filter response with one node (#19) · XY breakpoint box (#26) |
| 26 | **Step / pattern grid** | rows = voice, columns = step, accent as a lighter tint of the same fill (#24, #25) · bipolar bar editor around a centre line with a scale (#28) |
| 27 | **Module / section header** | dark bar with accent caps spanning its group (#22, the reference) · header with power toggle + collapse chevron (#19) · framed plate with corner title (#27) · name plate *below* its group, joined by printed lines (#20) |
| 28 | **Tab strip** | icon+label tabs with accent underline (#19) · slot tabs with status LED and drag handle (#24) · coloured per-track tabs (#23) · rotated vertical tab rail (#19) |
| 29 | **Signal-flow diagram** | printed box-and-line routing map on the panel (#20) · inline flow glyph (#25) · modulation chain joined by a printed rule (#27) |

---

## Layout grammar

The user's actual question about these images — how are controls arranged so
they make sense — has consistent answers across all thirty-one sources. These
are the rules the panels follow without stating them.

**A. The group is the unit, not the control.** No panel presents a flat field
of knobs. Every one partitions into named groups, and the naming device is
one of four: a header bar above (TR-909), a framed plate with a corner title
(Mimic), a name plate below joined by printed lines (drumDING), or a header
row carrying a power toggle and collapse chevron (ADSR Drum Machine). Group
width follows content — TR-909's header bars are visibly different widths
because RIM has one knob and BASS DRUM has four.

**B. Parameter order is fixed by signal order, never alphabetised.** ADSR is
always A→D→S→R left to right, and AHDSR always inserts H second (#26); it is
never reordered or sorted. Filter is always cutoff/FREQ first, then
resonance, then drive (#19, #27, #28). Oscillator is TUNE before LEVEL
(#22, #24). A kit that lets a caller reorder these is wrong, which is why
the semantic groups in `layout.tsx` fix the order rather than accepting an
arbitrary array.

**C. Size encodes priority.** Nithonat 2's THRESHOLD is ~2.5× the ATTACK and
RELEASE knobs beside it; TR-909's VOLUME is larger than SHUFFLE; K.O. II's
master VOLUME is the largest knob on the unit; drumcomputer's Decay and
Modify dominate the small Pan/Room/Hall knobs. The one you reach for most is
drawn biggest — nothing else marks it.

**D. Related parameters share an axis, and the axis means something.** In
column layouts (Nepheton, Nithonat) the *column* is the voice and the *row*
is the parameter — LEVEL is at the same height in all fifteen columns, so
scanning across a row compares one parameter over every voice. In step grids
the *row* is the voice and the *column* is time. The axis assignment is never
mixed within one panel.

**E. Colour is an index, not decoration.** drumcomputer gives each track a hue
and repeats it on five separate elements. ADSR Drum Machine colours the pad
label by sound class. CR8 colours a knob's modulation arc by which modulator
drives it, matching the source's pill. drumDING uses orange only for
level/output knobs. Where colour varies within a panel, it is carrying data.

**F. A readout sits adjacent to what it reads.** Value under the knob (#19),
value inside the ring (#23), value chipped beside the label (#28), value in a
recessed box within the group it belongs to (#24). No panel puts a value in a
status bar far from its control.

**G. Mute/solo is always a tiny pair at the head of its channel.** `M` over
`S`, or `M ● S` — never separated, never large, always at the top of the
column (#23, #24, #25).

**H. Enable/bypass is a switch plus an LED at the group's edge.** Nithonat's
per-band ENABLE rocker with an LED above it; the ADSR Drum Machine's
circular power toggle in each effect header. It is always at the boundary of
what it controls, never buried inside.

**I. Accent within a grid is a tint, not a second colour.** Nepheton and
Nithonat show accented steps as a lighter shade of the same red as normal
steps. Intensity reads as magnitude; a different hue would read as a
different *kind* of thing.

---

## Gap table II

Coverage across the second pass, against the seven components that became
new kit controls. ✓ = present, · = absent.

| Source | Fader | Pad | Selector | Meter | Display | Envelope | Waveform |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| 19 ADSR Drum Machine | · | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| 20 Vermona drumDING | · | ✓ | ✓ | · | ✓ | · | · |
| 21 K.O. II | ✓ | ✓ | ✓ | · | ✓ | · | · |
| 22 TR-909 | · | ✓ | ✓ | · | ✓ | · | · |
| 23 drumcomputer | ✓ | ✓ | ✓ | ✓ | ✓ | · | · |
| 24 Nepheton 2 | · | ✓ | ✓ | ✓ | ✓ | · | · |
| 25 Nithonat 2 | · | ✓ | ✓ | ✓ | ✓ | · | · |
| 26 Bitwig Sampler | · | · | ✓ | · | ✓ | ✓ | ✓ |
| 27 Mimic | · | · | ✓ | · | ✓ | ✓ | ✓ |
| 28 CR8 | · | · | ✓ | · | ✓ | ✓ | ✓ |
| 29 Serato Sample | · | ✓ | ✓ | · | ✓ | · | ✓ |

**Selector and display are universal** — every single source has both, which
is exactly why the first pass's omission of them mattered. **Fader is the
worst-attested at 2 of 11**, and both instances differ (a software mixer
fader with a coloured level line; a hardware fader with a printed centre
detent), so the six kit renderings of it are the most synthesised of any
control. Envelope and waveform cluster in the samplers and are absent from
every drum machine except #19; meter clusters in the drum machines and is
absent from every sampler.

---

## The kit's control vocabulary — fourteen

Twenty-nine taxonomy items is a description of the source material, not a
buildable set. Most of items 15–29 are either *layouts* built from smaller
pieces (module header, tab strip, step grid, signal-flow diagram) or
*variants* of one widget (value chip is a display; LED radio group and icon
glyph selector are both selectors). Collapsing those leaves fourteen genuinely
distinct, genuinely swappable widgets — what `KitFace` requires every kit to
implement:

| Control | Why it is its own control, not a variant |
|---|---|
| `knob` | rotary, absolute position, drag to set |
| `slider` | linear, thin track, small cap — the compact one (#27) |
| `fader` | linear, wide finger pad, scale and detent — a mixer channel (#21, #23); different proportions, different affordance |
| `toggle` | two states, both meaningful, no ordering |
| `button` | momentary, fires an action |
| `pad` | momentary *and* lit *and* labelled twice *and* tiles into a grid (#19, #24, #29) |
| `selector` | n options, one active, cycles — subsumes segmented row, LED radio list, glyph grid, stacked pair |
| `stepper` | discrete ±, holds a number |
| `jack` | a connection point, not a value |
| `led` | pure indicator, no interaction |
| `meter` | continuous readout of a *live* signal, segmented |
| `display` | readout of a *set* value, with label and unit — subsumes value chip and readout block |
| `envelope` | a multi-stage shape; its three source forms (curve, knob row, slider bank) are per-kit rendering choices of one control |
| `waveform` | sampled data with markers and a region |

The four remaining first-pass items that are *not* kit controls —
section label, screw, keyboard, mod matrix, preset list — are either layout
(handled by `layout.tsx`), decoration (screw is drawn by the kits that want
it, inside their own faces), or composite views better built from the
fourteen than themed as a unit.
