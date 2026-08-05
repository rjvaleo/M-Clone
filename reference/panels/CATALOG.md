# Panel reference — ingested 2026-08-04

Nineteen image files across eighteen catalogued entries: seven physical
hardware/Eurorack front panels, eleven software synth GUIs. Each entry below
is what was actually seen in the image, not a guess at the product's full
feature set — this is source material for building a themeable UI kit, not a
design history.

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
