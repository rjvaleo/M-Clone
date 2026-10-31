# Open issues

Faults found and not yet fixed. Each says what is wrong, where, and what done
looks like. Remove an entry when its fix merges.

## The knob kit changes only the jacks on canvas modules

**What is wrong.** Choosing a kit in the canvas header (Vintage Wood, Eurorack
White, Thin Ring, Flat Modern, Line Art, Hardware LCD) restyles only the patch
jacks down a module's edges. Every module's knobs, sliders, buttons, steppers
and selectors look the same in all six kits, so the kits look nothing like
`kit-gallery.html`, where each kit restyles every control.

**Why.** The canvas faces take one control from the kit system, the jack
(`src/modular/theme/kits/controls/Jack.tsx`, used in
`src/modular/ui/ModularApp.tsx`). Everything else on a face is an N4 control
from `src/modular/ui/n4/kit` (`N4Knob`, `N4Button`, `N4Stepper`,
`N4Spinner`), which never reads `KitContext`. The kit system's own controls
(`Knob`, `Fader`, `Slider`, `Toggle`, `Button`, `Selector`, `Stepper`,
`Display`, `Meter`, `Led` in `src/modular/theme/kits/controls/`) are drawn
only by the gallery.

**Done means.** With each kit selected, the standard module faces (the
sequencing modules in the default patch, the LFO, ADSR and envelope follower,
and every other N4 face) draw their controls in that kit, as the gallery does,
while every handler, value, modulation ring and test keeps working. Either the
N4 controls read `useKit()` and take the kit's look, or the faces move onto the
kit controls. A test should fail while any N4 control ignores the kit.

**Out of scope.** The effect panels (`src/modular/ui/panels/`) keep the looks
of the hardware they are drawn after (Night console, Engineering strip, Graph
first, Cabinet, SoundHack, Lexicon, Hyperprism), whatever the kit. The M node
draws M's own windows and does not follow the kit either.

**How it was seen.** 31 October 2026: the default patch plus the LFO, ADSR and
envelope follower, captured in the app on master `1ed9919` with each kit in
turn. Only the jacks differed.
