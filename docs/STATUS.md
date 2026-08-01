# M-Clone — Project Status

## 2026-08-01: configurable click-safe built-in Synth

Each of the four sequencer streams now owns an independent, color-coded patch
in the compact themed Synth module. Every patch has two tuned
oscillators, sub oscillator, noise mixer, routable LFO, power, master, glide,
multimode keyboard-tracked resonant filter, filter ADSR, amplifier ADSR, and
velocity sensitivity. Its 366×81px hardware-panel layout is designed around
the application's normal 150% working scale.
The Web Audio path uses held scheduled values and nonzero attack/release ramps,
eliminating the hard envelope discontinuities exposed by repeated sixteenth
notes. See [`BUILT_IN_SYNTH.md`](./BUILT_IN_SYNTH.md).

The final compact-control pass keeps the 366×81 faceplate while preventing
caption/select/section collisions at 150%. Knob hit areas cover their complete
dial-and-caption cells, select widths derive from their abbreviated values with
one-character border padding, and every Output control remains contained.
The Note Density editor is now 145×90 logical pixels with a fixed 270px
pre-scaled drawing body and equal rendered right/bottom safety gutters, so its
100% label and fourth lane clear the frame.
Global menu titles now toggle closed on a second click instead of being reopened
by the outside-dismiss handler. Save As uses an app-owned filename dialog and
commits that explicit name before activating the declarative encoded-download
anchor. This avoids suppressed page prompts and late embedded-browser picker
results changing or losing the document title.

TDD verification is **672 tests across 41 files** with 100% included
engine/state coverage. Browser verification covered dark-theme layout,
close/reopen through Windows, live control exposure, a generated sixteenth-note
run, compact select/knob containment, and Note Density geometry at 150%.

## 2026-08-01: Patterns/Transport/Conductor parity correction

The manual/reference audit is complete. Phase is now a persisted, Snapshot-aware
per-Voice initial delay that affects planner and Movie timing; all numeric M
Time Base denominators are available; Pattern Record Mode icons require the
manual's Option-click gesture; and Tempo is directly editable. Movie and
Sequence glyphs have been redrawn toward the printed filmstrip and document
symbols. Dependency-bound gaps are catalogued without claiming they work in
[`PATTERNS_TRANSPORT_AUDIT.md`](./PATTERNS_TRANSPORT_AUDIT.md).

TDD verification is **657 tests across 34 files** with 100% included
engine/state coverage. The next P5 slice is MIDI import and Sequence playback;
live input later owns Source/Use/Echo-Thru, Mouse Advance, and `sa` Step Advance.

## 2026-08-01: Movie capture and deterministic MIDI export

The Conducting Movie button now arms before Start, records the same submitted
planner notes consumed by the outputs and Midi View, and automatically finishes
on Stop. A 960-PPQN performance model retains Voice, channel, pitch, velocity,
duration, and tempo-map changes without introducing Pause wall-clock gaps.
File ▸ Save Movie As Midi File is enabled for a completed take and writes a
deterministic format-1 SMF with a conductor tempo track and one track per used
Voice. See [`MOVIES_AND_MIDI.md`](./MOVIES_AND_MIDI.md).

TDD verification is **653 tests across 34 files** with 100% included
engine/state statement, branch, function, and line coverage. MIDI import,
Pattern/Sequence conversion, editable track UI, and Movie persistence remain
open. The immediate next checkpoint is a manual/reference parity audit of the
Parent Pattern, Transport, and Conductor modules.

## 2026-08-01: unified module themes and collision-free placement

Patterns and the inner Conducting/transport drawing now honor the dark palette;
Midi View uses the same light/dark panel surfaces as the rest of the app while
retaining its monospaced tracker data. Individual window/module title bars are
flat in both themes—the old stripe fill is removed.

New and reopened auxiliary windows begin in the leftmost free column to the
right of the permanent modules, then stack vertically with 4px padding. Drag
release snaps nearby edges into alignment and resolves overlaps to the nearest
free padded edge. TDD verification is **641 tests across 33 files** with 100%
included engine/state coverage; browser verification covered initial placement,
close/reopen placement, computed theme colors, and flat chrome.

## 2026-08-01: Midi View lane containment

Compact Midi View messages now render in two rows of three fields, so Note On
duration, velocity, and channel remain inside their Voice lane. Header, row,
and background dividers share one 60px time-column measurement. Live browser
checks confirm zero horizontal overflow for cells and messages in both themes.

## 2026-08-01: Phrasing completed through Legato Cyclic

Manual review corrected the roadmap model: M has no separate Phrasing
Variable. Its “Working with Phrasing” behavior is the Legato Cyclic Variable.
Legato now uses the manual defaults (6/25/50/75/100%) and sustains each note as
a percentage of the actual interval to its next Rhythm/Time-Distortion-adjusted
onset. Values above 100% overlap subsequent notes as documented.

Accent, Legato, and Rhythm Positions now have Conducting Arrows and participate
in Hold/Do, partial Snapshots, Restore, Blink Everything, Slideshows, and saved
documents by active Position only. A Cyclic Editor selection race found during
browser verification is also fixed. See [`PHRASING.md`](./PHRASING.md).

TDD verification: **635 tests across 33 files**, 100% included engine/state
coverage, clean typecheck, both production builds, and fresh-server browser
verification of cyclic selection, arrow exposure, and correct Legato editor
opening.

## 2026-08-01: Snapshot editing and Slideshows

The remaining Snapshot Window controls are wired from the M 2.7 manual.
Hold/Do defers selected Variable Positions, Play Enable, Time Base, Output
Length, Conducting Arrows, and Pattern Group changes until Do; a held set can
instead be stored as a partial Snapshot. Edit Snapshot toggles membership and
can copy the edited set to another A–Z location. Blink Everything selects every
currently supported storable control.

Nine Slideshows now record executed Snapshot and Variable Position actions with
the manual's Record Wait option, play after Snapshot quantization, pause/resume
without losing position, stop, and add/remove or record a loop point. Stopping
music pauses slideshow playback until Start. Definitions persist in the new
version-2 project document; version-1 projects load with nine empty Slideshows.
The transient transport and Hold/Edit drafts are deliberately not saved.

TDD verification: **625 tests across 32 files**, 100% included engine/state
coverage, clean typecheck, both production builds, and a fresh-server browser
pass covering Hold → Do, Blink Everything → Snapshot A, and Option-recorded
Slideshow 1.

## 2026-08-01: product, audio, and native roadmap approved

The product family is now explicitly defined: free four-Voice **M Classic Web**,
paid eight-Voice **M Studio** for native desktop/plug-in production, and later
premium **M Modular**. Studio is planned with seven original instruments,
*September*-derived source material, signature granular glitch, Smooth Crusher,
Spatial Enhancer, Tempo Delay, and multi-output audio. These are roadmap items,
not current shipped features. Authoritative specifications:

- [`PRODUCT_RELEASE_ROADMAP.md`](./PRODUCT_RELEASE_ROADMAP.md)
- [`AUDIO_ENGINE_SPEC.md`](./AUDIO_ENGINE_SPEC.md)
- [`NATIVE_PLUGIN_SPEC.md`](./NATIVE_PLUGIN_SPEC.md)

## 2026-08-01: MIDI reliability phases 1–3

The MIDI path now has timing-continuity segments, atomic queue cancellation,
one clock correlation per batch, explicit ordered Note On/Off/Program Change
events, 960-PPQN musical positions, lifecycle-owned future Note Offs, deterministic
retrigger handling, destination separation, and independent per-Voice RNG.
Output is submitted before Midi View/Zustand telemetry. The exact guarantees,
known browser limits, test matrix, and manual measurement protocol are maintained
in [`MIDI_RELIABILITY_SPEC.md`](./MIDI_RELIABILITY_SPEC.md).

Phase 3 adds injected monotonic clock/scheduler drivers, a shared transport and
audition scheduler, bounded adaptive lookahead, lateness/lead/queue diagnostics,
20 ms late-attack dropping, 400 ms stall recovery without catch-up bursts,
suspension recovery, retained MIDIAccess with multi-port selection and reconnect,
controller-aware panic, and a versioned native event-batch boundary.

Current verification checkpoint: **592 tests across 31 files**, 100% included
engine/state coverage, clean typecheck, and successful normal and single-file
production builds. Physical timing certification and native adapters remain
future platform work, not browser Phase 3 work.

## 2026-08-01: project save/load

At that checkpoint the save/load work was committed. `ProjectDocumentV1` is the portable save format:
Project and Pattern material (Original and Scrambled), Variable and Cyclic
Positions, Snapshots, Conducting Arrows and configuration. Workspace geometry,
zoom, skin and palette stay local preferences. Decoding rejects damaged or
future documents and repairs what it safely can, reporting warnings. File ▸
New / Open / Save / Save As are wired, with document name and unsaved-changes
tracking in the header. The later MIDI reliability work brings the current
checkpoint to 592 tests with 100% included engine/state coverage.

## 2026-07-31: end-of-session checkpoint

Layout is accepted as good enough for now. The global menu bar is restored,
the footer is removed, all fifteen panels share effective 10px/16px title
chrome and 8px primary typography, Cyclic controls are enlarged without larger
fonts, Pattern notes retain exact grid cadence at 150%, Time Distortion is
content-fit, and Cyclic loop markers align exactly with their columns.
Technical completion now takes priority; see `NEXT_STEPS.md`.

## 2026-07-31: documentation alignment audit

Every Markdown file in the repository was checked against the current source,
tests, UI labels, reference-directory inventory, and known disabled controls.
Stale pre-implementation descriptions were converted to historical/implemented
state, the backlog was rebuilt from current gaps, and local documentation links
were verified. `STATUS.md` is authoritative for shipped scope; `TODO.md` is the
open backlog; implementation-plan documents retain design rationale.

## 2026-07-31: visual audit and channel themes

Every reference has been compared with the implementation; deferred deltas are
in `VISUAL_AUDIT_AND_THEMING.md`. Six extensible four-Voice presets and a
custom palette chooser are implemented. Global and module context-menu
ownership follows the current interaction model. Further fidelity work is
intentionally deferred until technical completion.

## 2026-07-31: dedicated Cyclic Editor

The editor now has a right-click Classic/Modern view toggle. Modern view keeps
Rhythm, Legato, and Accent open together in three columns, including all six
Positions, five level values, and four Voice grids for each variable.

Six Positions per variable, four themed 5x16 Voice grids, independent cycle
lengths, global Legato/Rhythm value tables, and planner integration are now
implemented. Vertical drag ranges make seeded random level choices and legacy
numeric steps migrate without changing their RNG sequence. See
`CYCLIC_EDITOR.md`.

The editor was subsequently rebuilt against `reference/cyclic editor.png` with
the original left-grid/right-control composition and reference Rhythm/Legato
defaults. Its current Classic window is 275×222 logical pixels; controls are
25% larger than the earlier normalization without larger rendered fonts.

## 2026-07-31: Midi View

A movable four-lane tracker now records actual planned Note On/Off output with
Voice, channel, note name/number, velocity, timestamp, and duration. It follows
the global channel palette and maintains a bounded chronological history. See
`MIDI_VIEW.md`.

The UI is the initial delivered compact event tracker: simultaneous events
align across the four fixed Voice columns, Follow pins the scrollable history
to new rows, and Clear resets it. The later animated playhead and Pattern
position/length experiment has been removed.

**As of:** 2026-08-01 · **Working tree:** local Synth, density-layout, and
documentation refinements intentionally uncommitted
**Measured against:** [`M-Clone_Build_Plan.md`](./M-Clone_Build_Plan.md)

Legend: ✅ done · 🟡 partial · ⬜ not started

## Snapshot

**The generative engine is now feature-complete** and fully tested: the
transform chain, the "alive" randomness (memory + 1/f Brownian), and the whole
harmonic engine (per-voice + diatonic + second-order transposition, key/scale
snap, chord-tone targeting). The movable classic interface is wired for the
implemented engine, and conducting core is complete. Remaining work is the
unfinished classic subsystems, persistence/I/O, and instruments. Layout work
is paused by decision.

| Metric | State |
| --- | --- |
| Unit tests | **672 passing** (41 files) |
| Coverage (engine + state) | **100%** lines / branches / functions |
| Typecheck (`tsc --noEmit`) | Clean |
| Production build | Succeeds (`vite build`, `build:single`) |
| Views | Unified movable-window canvas · light/dark skins · Classic/Modern Cyclic Editor |
| Audio out | Configurable click-safe WebAudio subtractive synth ✅ · Web MIDI ✅ |

## Roadmap phases

| Phase | Scope | Status |
| --- | --- | --- |
| **P0 Foundations** | Scaffold, engine skeleton, Web Audio lookahead scheduler, dual sinks, store | ✅ (theme architecture 🟡) |
| **P1 Sound & Patterns** | Pattern model, editor, transport, tempo, time base, first sound | ✅ |
| **P2 Variables core** | Note Order, Transposition, Density, manual-faithful Velocity Range + positions + editors + harmonic engine | ✅ |
| **P3 Cyclic + Midi + rest** | Cyclic editor, Midi window, Orchestration, Time Distortion, Phrasing, Pattern Group, Sound Choice | ✅ for selected scope (Phrasing is Legato Cyclic ✅; Sound Choice intentionally skipped) |
| **P4 Conducting + Snapshots** | Conducting grid, arrows, Robot, snapshots, slideshows | ✅ |
| **P5 Classic technical I/O** | Record-to-tracks, MIDI import/export, save/load, Input Control, Mouse Advance, four lightweight playback engines | 🟡 (save/load ✅; Movie capture + SMF export ✅) |
| **P6 Modern theme + instruments** | Modern layouts, deeper instruments, pattern-manipulation upgrades | 🟡 (Modern Cyclic Editor + color themes ✅; broader Modern layout ⬜) |
| **M Classic Web** | faithful four-Voice browser MIDI product + four lightweight engines | 🟡 |
| **M Studio Desktop** | paid eight-Voice standalone + plug-in, seven instruments, signature FX, multi-output | ⬜ |
| **M Modular** | premium node-based generative MIDI/audio environment | ⬜ |
| **Later — Mobile** | paid iOS/iPadOS and Android family after desktop | ⬜ |

## The generative engine (the soul) — ✅ complete

| Element | Status | Notes |
| --- | --- | --- |
| Per-step transform chain | ✅ | `planner.ts`, pure + tested |
| Four-by-six model (4 voices × 6 positions) | ✅ | voices in engine; 6 positions in `variables.ts` |
| Note Order probability mix | ✅ | Original / stored Cyclic Random / live Utterly Random; two continuously positioned, edge-contained boundaries; animation-frame-batched dragging; per Voice and a–f Position |
| Velocity Range / Accent mapping | ✅ | draggable low/high range per Voice and a–f Position; endpoint numericals; Accent 0 silent, levels 1–4 interpolate low→high |
| Cyclic Random | ✅ | Pattern-owned stored copy; ReScramble, Original → Scrambled, and Swap Scrambled and Original work over Patterns or Regions |
| Utterly Random memory | ✅ | chooses anew during playback and avoids immediate repeats via `rng.pickIndexAvoiding` |
| 1/f Brownian primitive | ✅ | `BrownianWalk` remains available for future generative contours; it is not one of M's three Note Order regions |
| Per-voice Transposition (multi-voice harmony) | ✅ | the "notes you never played" mechanism |
| Second-Order Transpose | ✅ | cumulative voice stacking in `planner.ts` |
| Key / scale context + snap-to-key | ✅ | `music.snapToScale`, `scaleSnap` |
| Diatonic (scale-aware) transposition | ✅ | `music.diatonicTranspose` (steps fold into the key) |
| Chord-tone targeting | ✅ | `music.snapToChord` (tonic-triad snap; progression-aware later) |
| Deterministic seed / reproducible performance | ✅ | `project.seed`, seeded `Rng` |

> Note on interpretation: **Second-Order Transpose** stacks each voice's
> transposition cumulatively onto the voices above it (a harmonizer feeding a
> harmonizer). **Chord-tone targeting** currently snaps to the key's tonic triad;
> progression-aware chords are a future upgrade.

## Architecture (three layers)

| Layer | Status | Notes |
| --- | --- | --- |
| A — Generator (classic M) | ✅ | engine + store |
| B — Recorder (record-to-tracks / Movie) | ⬜ | |
| C — Instrument rack | 🟡 | configurable subtractive monitor synth complete; four role-specific Classic engines then seven first-party Studio engines remain planned |
| Engine (framework-agnostic TS) | ✅ | `src/engine/*` |
| Control catalog + bindings (shared) | 🟡 | store is shared; formal abstract control catalog ⬜ |
| Theme layer (per-view layout + renderers) | 🟡 | light + dark themes via a scoped `.theme-dark` skin over one layout; a formal per-theme layout provider is still 🟡 |
| Web Audio lookahead scheduler | ✅ | injected monotonic clock + scheduler; 25 ms browser wake; bounded 80–250 ms adaptive horizon; stall/drop policy and diagnostics |
| Explicit MIDI event/lifecycle layer | ✅ | ordered events, 960 PPQN, retrigger cleanup, per-Voice RNG |
| Output sinks (MIDI + instruments) | 🟡 | explicit-event Web MIDI + configurable four-stream monitor synth ✅; Classic/Studio and native adapters ⬜ |
| Document format (JSON) + save/load | ✅ | `ProjectDocumentV2`; Slideshows included, v1-compatible defensive decode, File menu wired |
| Standard MIDI File import/export | ⬜ | |
| Old `.M` import | ⬜ | awaiting sample files |
| VST/AU hosting | ⬜ | native phase |

## Screen inventory

| Window | Status | Wired today |
| --- | --- | --- |
| **Patterns** | ✅ | play-enable, voice select, output length, time base (num/den), 16-step toggles; Pattern Group a–f selection, conducting, snapshots, and persistence ✅ |
| **Conducting / "Untitled"** | 🟡 | Start/Stop/Pause/Sync, six-by-six Grid, Position + Tempo conducting, editable Tempo, Tempo Range, Sync Ratio, bounded Robot + Time Base, corrected Movie/Sequence glyphs, and Movie capture; Sequence remains disabled pending import/playback |
| **Variables** | ✅ for selected scope | 6-position activation/editors for Note Order, Transposition, Density, Velocity Range, Orchestration, and Time Distortion; Pattern Group activation/conducting; Sound Choice skipped |
| **Cyclic Variables** | ✅ | five-level Accent/Legato/Rhythm cycles, six Positions, per-Voice lengths, conducting, Snapshot/Slideshow integration, and Classic/Modern editor; Legato supplies Phrasing |
| **Midi** | ✅ | per-voice channel, program, transpose, velocity-range readout, density, legato; six-position 4×16 Orchestration routing ✅; Sound Choice skipped |
| **Snapshot** | ✅ | 26 partial A–Z stores, Hold/Do, Edit/copy, Blink Everything, restore, keyboard control, and nine record/play/pause/loop/stop Slideshows |
| **File menu** | ✅ | New / Open / Save / Save As over a versioned document, with document name and unsaved-changes tracking in both the application header and Conducting/transport title; an app-owned filename dialog and encoded download keep embedded-browser saves deterministic |
| **Pattern Editor** | ✅ | dual keyboards, dotted grid, Region tools, View/Chord/Insert/Drum/Size modes, MIDI range/counter, audition, resize, and 22 working Edit/Pattern commands including Cyclic Random operations |
| **Midi View** | ✅ | initial compact four-lane event tracker with timestamp, Note On/Off details, Follow, Clear, and bounded history |
| **Synth** | ✅ monitor scope | four independent stream-colored subtractive patches; compact themed dual-oscillator/LFO/filter/dual-ADSR control surface; click-safe Web Audio scheduling |
| **Module context menus** | ✅ | Pattern Editor owns Edit/Pattern; Variables owns editors/colors; Conducting owns Options/Harmony/Output; commands are accessed by right-click and popups are viewport-correct |
| **Global menu bar** | ✅ | Classic File/Edit/Variables/Pattern/Windows/Options strip restored; window and editor entries use the shared window registry |
| **Typography standard** | ✅ | 11px global menu; uniform 10px/16px panel chrome; 8px primary body controls; 7px compact dense readouts, verified as effective rendered sizes across all fifteen panels |

## Interface / window canvas — ✅

| Element | Status | Notes |
| --- | --- | --- |
| Movable windows | ✅ | every window drags by its title bar; positions persist (localStorage) |
| Stacking / focus | ✅ | last-clicked window comes to front (shared z-counter); focused window shadowed |
| Chrome | ✅ | hairline 1px borders, opaque backgrounds, drop shadow |
| Fixed-size modules | ✅ | modules keep a constant size; the Pattern Editor's size box is the one intentional exception |
| Window open/close model | ✅ | six `color-app.gif` main windows are permanent; canvas right-click opens auxiliaries; open items are disabled; editors are movable, closable, simultaneous, and non-modal |
| Unified window navigation | ✅ | every main and auxiliary window uses compact reference `.uwin__title` chrome with shared name/note/close layout, drag handle, border, and theme treatment; module menus are context-only |
| 640×480 workspace + zoom | ✅ | 640×480 logical baseline; persisted 50–200% application scaling in 10% increments; −/+ /100%/Fit controls; scale-aware dragging and context menus |
| Complete channel coloring | ✅ | four-voice artwork across main windows and editors inherits the six-preset/custom global palette |
| Reference Patterns Window | 🟡 | 228×120 Chapter 13 layout; Play Enable, Option-click Record Modes, Output Length, full numeric Time Base, functional Phase, selection and double-click editing work. Src/Use/Echo/Mouse Advance and independent a–f banks await input/group architecture |
| Reference-native editors | ✅ | Density 145×90 with right/bottom gutter; Velocity 165×81; Note Order 199×149; Transposition 143×95; Cyclic controls enlarged 25% to 275×222 without changing font size; Time Distortion content-fit 185×155; Orchestration 155×80 |
| Velocity Range editor | ✅ | exact M layout (boxed low/high, dithered range block on the axis line); click-drag to draw the range |

## Modern upgrades (beyond classic M)

| Upgrade | Status |
| --- | --- |
| Variable Positions with editor | ✅ |
| Snapshots (whole-screen recall) | ✅ |
| Key/scale harmonic guardrail | ✅ |
| Movable-window canvas (drag, persist, z-order) | ✅ |
| Pattern drag-painting + auto-extending length | ✅ |
| Pattern copy/paste/extend/variation commands | ✅ |
| Non-destructive pattern operation stacks / undo | ⬜ |
| All-in-one record-to-tracks | ⬜ |
| Classic four-engine rack | ⬜ | browser milestone; scope in `AUDIO_ENGINE_SPEC.md` |
| Studio seven-engine rack + signature effects | ⬜ | paid native milestone |
| Third-party WAM hosting | ⬜ | exploratory; not a Classic release requirement |
| VST/AU hosting (native) | ⬜ |
| Import old `.M` files | ⬜ |
| Automation lanes / history-undo | ⬜ |

## Testing & tooling

- **TDD throughout the engine:** every pure module (`music`, `rng`, `transform`,
  `planner`, `variables`, `project`) and the `store` has co-located tests.
- **Coverage gate:** Vitest + V8 at a 100% threshold over included `src/engine`
  and `src/state` modules. React UI, `outputs/synth`, and type-only files are
  excluded; directly tested runtime/Web MIDI adapter modules also appear in the
  measured report and currently remain at 100%.
- Scripts: `dev`, `build`, `build:single`, `test`, `coverage`, `typecheck`.

## Suggested next steps

See [`NEXT_STEPS.md`](./NEXT_STEPS.md). Project save/load and MIDI Reliability
Phase 3 (with Sound Choice intentionally skipped), Phrasing/Legato, and
Snapshot/Slideshow behavior are complete. The active order is performance
recording/MIDI I/O, then controller and instrument work. Visual
polish is not on the technical critical path.

## Known constraints

- Web MIDI needs a secure origin (`https`/`localhost`); the `file://` standalone
  preview is synth-only.
- The built-in synth is a complete shared subtractive monitor, not one of the
  four later role-specific Classic instruments.
