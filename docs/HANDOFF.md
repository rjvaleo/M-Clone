# Handoff — read this first

## MIDI reliability handoff

Do not infer MIDI guarantees from the UI or older roadmap prose. The canonical
implemented behavior, invariants, known limits, automated suites, and manual
verification procedure are in
[`MIDI_RELIABILITY_SPEC.md`](./MIDI_RELIABILITY_SPEC.md). Phases 1–2 are present
in the working tree; Phase 3 now includes injected clock/scheduler drivers and a
defined late-event policy. Any change to planner timing, transport, event
ordering, routing, audition, or an output adapter must update that specification
and its verification matrix in the same change.

## Product and audio handoff

The approved commercial direction is free four-Voice M Classic Web →
invite-only macOS/Windows beta → paid eight-Voice M Studio standalone/plug-in →
paid mobile family → later M Modular. Do not infer edition scope from older WAM
or “all-in-one” brainstorming. Use:

- [`PRODUCT_RELEASE_ROADMAP.md`](./PRODUCT_RELEASE_ROADMAP.md) for editions,
  access stages, platforms, and monetization;
- [`AUDIO_ENGINE_SPEC.md`](./AUDIO_ENGINE_SPEC.md) for four web engines, seven
  Studio instruments, source assets, effects, mixer, and DSP order;
- [`NATIVE_PLUGIN_SPEC.md`](./NATIVE_PLUGIN_SPEC.md) for standalone clock,
  plug-in host timing, multi-output buses, and real-time safety.

The web product remains MIDI-first. The RJ Vallejo/*September* audio identity,
eight Voices, signature effects, and multi-output audio define the paid Studio
step. Mobile follows desktop. New core code must accept configurable Voice
counts even while the current Classic UI remains four-Voice.

## Latest work — 2026-08-01

The last committed baseline includes `82b8b94` (multi-session window rebuild),
`231c372` (project document codec), and `ccde4dd` (File menu). MIDI reliability
phases 1–2 and their documentation may be present as working-tree changes;
inspect `git status` rather than assuming a clean tree.

**Project save/load is done** — step 1 of `NEXT_STEPS.md`. `ProjectDocumentV2`
(`src/engine/document.ts`) carries the Project and Pattern material (Original
and Scrambled), Variable and Cyclic Positions, Snapshots, Conducting Arrows and
configuration. Workspace geometry, zoom, skin and palette stay local
preferences. Decoding refuses malformed input, a missing schema version, a
document from a newer build, and damaged Pattern material; everything else is
defaulted or clamped and returned as warnings. File ▸ New / Open / Save /
Save As are wired in `src/ui/fileCommands.ts`, with document name and
unsaved-changes tracking shown in the header.

**Current suite: 672 tests across 41 files**, 100% coverage on `src/engine` and
`src/state`, typecheck and both builds clean.

Snapshot editing and Slideshows are complete. Manual review also established
that Phrasing is Legato Cyclic rather than another Variable. Legato now uses
onset-relative sustain and the manual defaults; cyclic Positions support
conducting, Hold/Do, Snapshots, Slideshows, and persistence. See
[`PHRASING.md`](./PHRASING.md).

## Earlier work

`VISUAL_AUDIT_AND_THEMING.md` contains the full reference audit. The app now
has six channel-color presets, editable Voice colors, persisted palette state,
a restored global menu bar, module right-click menus, shared rendered
typography, and a 640×480 logical workspace. Layout is now considered good
enough and is frozen while the remaining technical systems are completed.

The dedicated Cyclic Editor is complete with six Positions, per-Voice lengths,
global Legato/Rhythm values, horizontal painting, vertical random level ranges,
backward-compatible migration, and deterministic live playback. See
`CYCLIC_EDITOR.md`.

Its right-click menu switches between the reference-derived Classic view and a
three-column Modern view where Rhythm, Legato, and Accent are all visible at
once. Rhythm/Legato values and all twelve grids are editable; Accent's five
percentage levels are read-only because they map through each Voice's Velocity Range.

Midi View is restored to its initial compact four-lane event tracker. It shows
planned Note On/Off data in timestamped rows, with Follow, Clear, channel
colors, and bounded history; it no longer has the animated playhead or Pattern
position/length fields. See `MIDI_VIEW.md`.

**Last audited:** 2026-08-01 · **Branch:** `master` · **Phase 3 changes are
local and intentionally uncommitted.**

This file is the pick-up-where-we-left-off note. [`TODO.md`](./TODO.md) is the
backlog, [`STATUS.md`](./STATUS.md) is the feature-by-feature state.

---

## Where things stand in one paragraph

The generative engine and selected P3 scope are complete. Save/load,
Snapshot/Slideshow, and Phrasing-through-Legato are done; Sound Choice remains
intentionally skipped. The UI was rebuilt against the real M screenshots in
[`../reference/`](../reference/) and the M 2.7 manual (`reference/M27.pdf`)
rather than from an impression of them. The suite is **672 tests across 41
files**, with 100% coverage held on `src/engine` and `src/state`. Movie capture,
deterministic SMF export, and the Patterns/Transport/Conductor parity correction
are complete. Each sequencer stream now owns an independent color-coded patch
in the compact dual-oscillator, sub/noise-mixer, LFO-modulated, click-safe
subtractive synth. The panel is designed for the normal 150% workspace scale.
Its compact rows now use contained knob hit areas, measured caption clearance,
and value-sized selects with one-character side padding. The Note Density
editor is 145×90 with fixed drawing geometry and visible right/bottom gutters.
MIDI import and Sequence playback follow.

## How we've been working — keep doing this

1. **The manual is the spec.** `reference/M27.pdf`, 194 pages. Chapter 5 and 14
   are the Pattern Editor, 16 the Variables Window, 17 the edit windows, 18 the
   Snapshot Window, 20/21 the Edit and Pattern menus, Appendix A the power-user
   keyboard and mouse actions.
   Extract text with: `pypdf` → the scratch text file, then grep it.
2. **TDD, genuinely.** Write the test file first, run it **red**, then
   implement. Every test block quotes the manual sentence it pins down, so a
   failure points at the manual rather than at an opinion.
3. **100% coverage is a gate, not a target.** `npm run coverage` fails the build
   below 100% on engine + state. It has caught real bugs — an unreachable branch
   hiding a divide-by-zero, a missing stale-snapshot case. When it flags dead
   code, delete the code rather than adding a token test.
4. **Verify in the browser, don't ask the user to check.** Start with
   `./mclone.sh start`; the default URL is `http://localhost:5173/`.
5. **Be explicit about what isn't wired.** Controls that exist but don't do
   anything yet say so in their tooltip. No fake features.

## What was built this session

| Area | Outcome |
| --- | --- |
| **Pattern Editor** | Rebuilt to chapter 14: 1-bit icon set, dual Reference Keyboards, Legend crosshair, View/Chd/Ins/Dr/Size Mode Selector, MIDI Edit Range + Counter, All/Ctr, Editor Sound + Velocity, Size Box |
| **Pattern Editor audit** | Seven gaps closed — Size ceiling to 999, Region limited to existing steps, draggable Edit Range, hold-to-repeat arrows, Counter drag auto-scrolls, multi-Pattern audition, `~` and `,` keys |
| **Edit + Pattern menus** | 22 commands in the global menu system and the Pattern Editor right-click menu; context popups are portaled so transformed windows do not offset them |
| **Cyclic Editor views** | Right-click Classic/Modern toggle; Modern shows three columns, 18 Position buttons, 15 level cells, and 12 Voice grids without overflow |
| **Midi View** | Initial delivered four-lane timestamped event list with Follow, Clear, and bounded Note On/Off history |
| **Cyclic Random commands** | Pattern-owned stored Scrambled list; ReScramble, Original → Scrambled, and Swap Scrambled and Original work over whole Patterns or Regions and affect live playback |
| **Conducting Window** | Rebuilt from the screenshot/manual: Start/Stop/Pause/Sync, six-by-six Baton Grid, conducted Tempo range, Sync Ratio, bounded Robot Conductor, Time Base, and right-click Options/Harmony/Output commands |
| **Variables Window** | Six rows in the manual's order with real miniature representations that draw each Position's actual contents |
| **Time Distortion** | New: breakpoint-curve model, edit window, and planner integration — it is audible |
| **Transposition** | Note/Octave numericals against C3, with the octave carry |
| **Snapshot Window** | Rebuilt as the tall strip: 26 A–Z locations, Quantization, Slideshow controls |
| **Note Density** | The bar-and-square line editor with its scale header; 145×90 shell preserves the fixed ruler while padding the 100% label and fourth lane |
| **Built-in Synth** | Four independent stream-colored patches; compact dual-oscillator/LFO/filter/dual-ADSR faceplate, click-safe envelopes, and collision-free controls at 150% |
| **Presets** | Six distinct Variable Positions read off the screenshots, replacing six identical copies |
| **Layout** | Restored the global menu bar, removed the footer, standardized effective typography, and gave the remaining viewport to the window canvas |
| **Window manager** | Right-click blank canvas to open windows; the six reference main windows are permanent, while all auxiliary editors are movable, closable, and can remain open together |
| **Window navigation** | The classic global File/Edit/Variables/Pattern/Windows/Options menu bar is restored. All windows use the same compact `.uwin__title` bar; module-specific commands are right-click only. |
| **Workspace scaling** | The interface has a 640×480 logical 100% desktop and 50–200% zoom in 10% steps. Window coordinates are logical and stored under `mclone.v2.panel.*`; Fit and scale-aware dragging/context menus are working. |
| **Reference sizing** | Permanent and auxiliary windows use the 640×480 logical baseline. Cyclic controls are 25% larger without larger fonts; Time Distortion is content-fit; Pattern note cells and Cyclic loop markers align at 150% zoom. |

## Decisions made — don't re-litigate these

- **Snapshots store the Position, not its contents.** The manual is explicit.
  Editing what lives at Position c changes every Snapshot pointing there. The
  old code cloned the whole project, which made Snapshots a save format.
- **Orchestration lives in the Midi window,** not Variables. Chapter 16 lists
  the Variables Window's six rows and Orchestration isn't among them.
- **Time Distortion is a curve, not a scalar.** Corners pinned at (0,0) and
  (1,1) so a cycle always takes exactly as long as it would have.
- **Transposition stays stored as semitones.** Note/Octave is a presentation
  layer over it, so the planner never changed.
- **Clear deletes steps; Change to Rests doesn't.** Inferred from the manual
  describing only the latter as "without deleting steps". Flip it if you read
  that differently.
- **The global menu bar is restored** — it provides application-wide navigation; module-specific commands are available by right-click rather than title-bar pull-downs.
- **Do not add component-local transforms for resizing.** New modules are
  authored in logical pixels and inherit the one workspace transform.
- **Cyclic Random is Pattern-owned musical material.** It is stored as a
  detached parallel step list, not a Voice cursor permutation. Ordinary Pattern
  edits regenerate it; explicit scramble/copy/swap commands modify it directly.
- **ReScramble remains deterministic.** Its seed derives from the project seed,
  Pattern index, and a persisted generation counter, so repeated commands
  change the order without sacrificing reproducibility.
- **The Baton is normalized state.** Grid coordinates live in the store as
  `0..1`; every armed arrow derives its axis/direction from that one point, so
  multiple Variables and Tempo change atomically.
- **Pause is not Stop.** Runtime Pause keeps Voice/Cyclic/tick cursors, cancels
  queued output, panics, and shifts time origins on Resume. Stop followed by
  Start starts fresh. Sync cancels and resets all Voices to one boundary.

## Known gotchas

- **A dynamic `import()` of the store in the browser console gives you a
  *second* store instance,** separate from the one React renders. State changes
  made that way will not update the UI. Drive real controls when verifying, or
  you will chase a phantom bug.
- **Screenshot coordinates are 0.625× the CSS viewport** when driving the
  browser tools at 1280×900. Multiply by 1.6 to go from screenshot pixels to
  CSS pixels.
- **Don't zoom a window with a CSS `transform` and then change the theme** — the
  screenshot comes back as a stale composited layer and looks wrong when the
  DOM is actually fine. Clear the transform before screenshotting.
- **Window positions persist in `localStorage`** (`mclone.v2.panel.*`). A stray
  drag while testing will move a window for good; clear the key to reset.

## Start here next

The tree is green and builds; the current milestones are intentionally local
and uncommitted. Follow
[`NEXT_STEPS.md`](./NEXT_STEPS.md): save/load, Snapshot/Slideshow, and
Phrasing-through-Legato are done. The active head of the list is now **step 4,
performance recording and standard MIDI files**. Movie capture/export and the
Patterns/Transport/Conductor parity audit are green; continue with MIDI import.

Two smaller carry-overs from save/load:

- Save As uses an app-owned filename dialog before activating the encoded
  download anchor. The explicit name is committed before download, so
  suppressed prompts or late picker results cannot leave the document as
  `Untitled`. New saves use `.mclone` (a versioned JSON project document),
  while legacy `.mclone.json` and `.json` files remain openable. The application
  header shows the stored filename and the transport title shows its stem.
- Any new subsystem must be added to `ProjectDocumentV2` (or a versioned
  successor) in the same change.

Do not start another broad fidelity pass before the technical-completion
checklist is closed.

```bash
npm run dev
```

```bash
npm run coverage
```
