# Handoff — read this first

## Latest work

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

**Last audited:** 2026-07-31 · **Branch:** `master` · **Nothing committed yet —
the whole session is uncommitted working-tree changes.**

This file is the pick-up-where-we-left-off note. [`TODO.md`](./TODO.md) is the
backlog, [`STATUS.md`](./STATUS.md) is the feature-by-feature state.

---

## Where things stand in one paragraph

The generative engine was already done. This session was a **fidelity pass over
the UI**, rebuilding windows against the real M screenshots in
[`../reference/`](../reference/) and the M 2.7 manual (`reference/M27.pdf`)
rather than from an impression of them. The current suite is **459 tests across
22 files**, with 100% coverage held on `src/engine` and `src/state` throughout.

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
| **Note Density** | The bar-and-square line editor with its scale header |
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
- **Pause is not Stop.** Runtime Pause keeps Voice/Cyclic cursors and shifts
  their time origins on Resume. Stop followed by Start still starts fresh.

## Known gotchas

- **`reference/README.md` lists image filenames that may not match** what's now
  in the folder. The images were added after that index was written. Reconcile
  it when convenient.
- **Screenshot coordinates are 0.625× the CSS viewport** when driving the
  browser tools at 1280×900. Multiply by 1.6 to go from screenshot pixels to
  CSS pixels.
- **Don't zoom a window with a CSS `transform` and then change the theme** — the
  screenshot comes back as a stale composited layer and looks wrong when the
  DOM is actually fine. Clear the transform before screenshotting.
- **Window positions persist in `localStorage`** (`mclone.v2.panel.*`). A stray
  drag while testing will move a window for good; clear the key to reset.

## Start here tomorrow

The tree is green and builds. Layout is frozen. Follow
[`NEXT_STEPS.md`](./NEXT_STEPS.md), beginning with a checkpoint commit and then
portable project save/load. Do not start another broad fidelity pass before the
technical-completion checklist is closed.

```bash
npm run dev
```

```bash
npm run coverage
```
