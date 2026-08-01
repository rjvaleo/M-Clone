# M‑Clone — Build Plan & Design Document

> The deferred visual-fidelity sequence and per-reference delta are maintained
> in `VISUAL_AUDIT_AND_THEMING.md`.

**A clean‑room reconstruction of the classic interactive composing instrument *M*, rebuilt screen by screen from the manual.**

*A modern, browser‑first recreation of **M**, David Zicarelli / Joel Chadabe's interactive composing instrument (Intelligent Music → Cycling '74, v2.7), extended into an all‑in‑one generative studio.*

Status: **Living design and roadmap.** P0-P2 and substantial P3/P4 work are
implemented; this document includes future intent as well as shipped design.
Use [`STATUS.md`](./STATUS.md) for the authoritative current scorecard.
Source material: `M27.pdf` (194‑page v2.7 manual) — all pages rendered and analyzed; the manual's screen images are the drawing reference for the UI.

---

## 1. Vision

M was an *instrument*, not a sequencer. You gave it raw material (Patterns) and it continuously transformed that material through Variables while you conducted in real time. It felt alive — it seemed to "know" what you wanted, and it would play complementary notes you never programmed, in key, like a jazz player. That living quality is the thing we are actually recreating; the windows and sliders are just the surface.

The goal is **not** a pixel‑for‑pixel museum piece. It is a faithful recreation of M's **functionality, interactivity, usability, and musical output**, drawn with clean vector graphics, plus a large set of modern upgrades — and, ultimately, an **all‑in‑one system** that replaces the old workflow end to end.

### The old workflow we are collapsing into one app
1. Create patterns in M.
2. Store snapshots / presets.
3. Hit record; play back the patterns and ride the sliders to shape the arrangement.
4. Export a MIDI file.
5. Import into Digital Performer as 4 MIDI tracks.
6. Separate drum hits onto their own channels by hand.
7. Play everything back through HALion (software sampler).

M‑Clone folds steps 4–7 into the app: generate, record to editable tracks, auto‑route drums, and play through hosted software instruments — no export/import round‑trip, no external DAW, no external sampler.

### Two decoupled views
- **Classic view** — M's exact window/control layout and behavior, redrawn in vector (not bitmap). This is where we prove the functionality is correct.
- **Modern view** — a reflowable, contemporary skin.

Look‑and‑feel is **decoupled from layout and from function**, so a theme can be swapped in to completely change the appearance without touching behavior.

---

## 2. Design Principles

1. **The engine is the heart.** The generative/musical engine is plain, framework‑agnostic TypeScript with no dependency on React or any theme. Everything else binds to it.
2. **Decoupled layers.** Function (engine) → control catalog + bindings (shared) → theme (per‑view layout + renderers). Same bindings, different skin *and* arrangement.
3. **Faithful feel over faithful pixels.** Match behavior, interaction, and output. Redraw the UI in vector from the manual images.
4. **Ears are the oracle.** We reverse‑engineer the generative "feel" from the manual + music theory, and tune it by listening. Since the original app no longer runs, there is no automated ground truth — RJ's ear is the acceptance test.
5. **Modernize deliberately.** M was rudimentary. Where it was painful (manual copy/paste, hand drum‑splitting, external DAW/sampler), we upgrade — without breaking the classic core.

---

## 3. The Generative Engine (the soul)

> **Implementation status (2026-07-28): this section is now complete and fully
> tested** — transform chain, memory + 1/f Brownian randomness, and the full
> harmonic engine (per-voice / diatonic / second-order transposition, key-snap,
> chord-tone targeting). See [`STATUS.md`](./STATUS.md) for the live scorecard.

### 3.1 The "four by six" model
M's whole design rests on two numbers: **4 Voices** and **6 Variable Positions**. Every Variable holds six snapshot‑able Positions; each Position stores a setting for each of the four Voices. Selecting a Position (by click or by conducting) instantly swaps that group of settings.

### 3.2 The per‑step transformation chain
Each step, for each Voice, the engine pulls material from the Voice's Pattern and runs it through an ordered chain:

```
Pattern
  → Pattern Group select        (which pattern set is active)
  → Note Order                  (Original / Cyclic Random / Utterly Random mix)
  → Transposition               (per-voice; incl. Second-Order Transpose)
  → Note Density                (probability the note actually sounds)
  → Velocity Range + Accents    (dynamics)
  → Time Base / Rhythm / Time Distortion   (when it plays)
  → Legato / Staccato           (how long it plays)
  → Orchestration               (which MIDI channel / instrument)
  → Sound Choice                (program / patch)
  → output  (Web MIDI + internal synth + WAM instruments)
```

Overlaid on the chain:
- **Conducting** moves the Active Position of any conducting‑enabled Variable as the baton is dragged (continuous for Velocity Range and Legato).
- **Cyclic Variables** independently step through their own 16‑step cycles for Rhythm, Legato, and Accent.

### 3.3 Note Order behavior and editor

Note Order is not an exclusive mode selector. Each Voice stores a three-part
probability mix whose values always total 100:

- **Original Order** (solid black) reads the Pattern in its recorded order.
- **Cyclic Random** (gray) reads a stored permutation of the Pattern. That
  permutation repeats, so the result is scrambled but cyclic.
- **Utterly Random** (polka dot) chooses a Pattern step anew during playback
  and avoids immediately repeating the previous step when possible.

The editor shows one segmented bar per Voice. Two numbered handles are placed
directly on each bar:

1. The **Original/Cyclic boundary** controls the end of the solid region.
2. The **Cyclic/Utterly boundary** controls the start of the polka-dot region.

Dragging either handle continuously changes the shaded regions, percentages,
and live playback. The gray Cyclic Random share is the space between the two
boundaries. When the boundaries meet, the handles remain side by side and
grab-able; dragging one through the other pushes the opposite edge so the
percentages remain valid. Each handle permanently occupies one side of its
boundary, uses the same positioning rule across the full range, and is clamped
inside the bar at both extremes. Pointer movement is batched to animation frames
so dragging does not trigger excessive store/render updates. Each of the six
a–f Note Order Positions stores a separate mix for all four Voices.

The stored Scrambled list is owned by the Pattern and remains deterministic
from the project seed plus a Pattern generation counter. **Pattern →
ReScramble**, **Original → Scrambled**, and **Swap Scrambled and Original** all
operate on whole Patterns or selected Regions.

### 3.4 The "quantum," alive randomness
Flat `Math.random()` will not reproduce M's feel. The randomness is modeled as a **tunable RNG layer**:
- **M-style Note Order mix** — each Voice probabilistically chooses among the
  recorded Original Order, a stored/repeating Cyclic Random permutation, and a
  live Utterly Random pick. Utterly Random avoids immediate repeats.
- **1/f (pink) / Brownian distributions** — Chadabe's Intelligent Music lineage leaned on fractional noise, which wanders smoothly yet still surprises. This is the "musical randomness" texture.
- **Real‑time steering** — you are driving a probabilistic system through the conducting layer, so responsiveness/latency is part of the feel, not just the math.

All of this is exposed as parameters we can dial toward what the ear remembers.

### 3.5 The harmonic engine — "notes I never played, in key"
The single most important behavior to reproduce: M generated complementary pitches the user never entered, in the right key or a complementary one — auto‑accompaniment in the Band‑in‑a‑Box era, done M's gestural way.

Best‑fit mechanism (to validate by ear):
- The **pitch pool is seeded by the user's input**, but **per‑voice Transposition** reads that one line at different intervals across the four Voices (e.g., melody / third / fifth / octave), producing harmony you never explicitly voiced.
- **Second‑Order Transpose** (a real Options‑menu toggle in M) transposes the transpositions — a harmonizer feeding a harmonizer — turning played notes into implied chords.
- Note Order mixing + Density gating then let each voice wander independently through that harmonized space: four players reading one chart.

Whether M snapped transpositions to a scale (so a "third" bends major/minor to stay in key) can't be confirmed from the manual. We implement it as a **first‑class harmonic engine** regardless:
- A **key / scale context**.
- **Diatonic (scale‑aware) transposition** — intervals fold into the active scale.
- **Per‑voice interval harmonization** and **second‑order transpose**.
- **Optional chord‑tone targeting** (an upgrade M never had) so voices can lean into real chord changes like an accompanist.
- **Optional key/scale quantization** guardrail so even generated/transposed notes snap to key.

Faithful default behavior, with modern guardrails available.

---

## 4. Architecture

### 4.1 Three stacked layers (the all‑in‑one)
- **A — Generator:** classic M. Patterns, Variables, Cyclic Variables, Conducting, Snapshots.
- **B — Recorder:** the "hit record and ride the sliders" step becomes built‑in multitrack capture (M called it a *Movie*), except the four voices are kept as **live, editable tracks** rather than bounced to a flat MIDI file.
- **C — Instrument rack:** **WAM (Web Audio Modules)**‑hosted instruments per voice, including a **sampler** to replace HALion. **Drum voices auto‑route** each note to its own pad/lane/output — automating the old hand drum‑splitting step.

### 4.2 Cross‑cutting technical layers
- **Engine** — framework‑agnostic TS: clock, scheduler, transform chain, RNG, harmonic engine, document model.
- **Control catalog + bindings (shared)** — abstract control types (Numerical, Toggle / Picture‑Matrix, Grid editor, Variable‑miniature strip, Conducting arrow, Drag area) each bound to engine state. Never changes between views.
- **Theme layer (per view)** — supplies a *layout map* (where controls sit) and a *renderer* per control type. Classic = M's 640×480 arrangement in vector; Modern = reflowable.
- **Workspace scale layer** — the Classic layout remains in 640×480 logical
  coordinates and the entire control suite scales from 50–200% in 10% steps.
  Dragging, menus, persistence, fonts, icons, and channel colors share that one
  coordinate and theme system; individual modules do not apply local zoom.

### 4.3 Stack
- **Vite + React + TypeScript** for UI.
- **Lightweight store** (Zustand‑style) that both the engine and React can touch.
- **Timing:** the **Web Audio clock with a lookahead scheduler** (not `setInterval`) — even for MIDI out — to avoid jitter.
- **Output sinks:** **Web MIDI** (`navigator.requestMIDIAccess`) and the internal
  WebAudio synth are implemented. **WAM instruments** remain planned.
- **Native later:** **Tauri** (Rust shell) for cross‑platform desktop, native MIDI/audio, and **VST/AU hosting** (see §7).

### 4.4 Data & file formats
- **Document format:** a fresh JSON project format (patterns, variables, snapshots, tempo, routing, instrument rack).
- **Standard MIDI File** import/export.
- **Old `.M` file import:** planned, **deferred until sample files are available.** A `.M` file stores saved *state* (patterns, snapshot values, variable positions, tempo), not M's code — so it feeds the importer, not the algorithm. Not needed to start.

### 4.5 VST / plugin reality
A browser **cannot** load VST/VST3/AU binaries. Path:
1. **Now:** internal synth + SoundFonts, plus Web MIDI out to drive existing VSTs in an external host.
2. **Browser‑native plugins:** support the **WAM** standard (closest thing to "VST for the web").
3. **Real VST hosting:** in the **Tauri native build**, where the Rust shell bridges to VST/AU so existing plugins load inside M‑Clone.

---

## 5. Screen Inventory

> **Implementation note:** the Unified view now renders these as a **movable-window
> 640×480 canvas** (drag by the title bar, positions persist, last-clicked comes
> to front) with **50–200% application zoom**, light/dark themes, and a shared
> six-preset/custom channel palette. See [`STATUS.md`](./STATUS.md) for what's wired and
> [`TODO.md`](./TODO.md) for the open UI/UX items.

### Main screen — six always‑live windows
1. **Patterns** (4 rows). *Input controls:* Src/Use, input channel, monitor, record enable, Record Mode (Replace / Overdub / Drum‑Machine), Insertion Mode. *Output controls:* Play‑Enable (speaker), Mouse Advance, Pattern thumbnail / Select, Output Length, Time Base (numerator/denominator), Phase, articulation, Pattern Group.
2. **Conducting.** Start / Stop / Pause / Sync buttons, Tempo, Sync‑Metronome ratio, the Conducting Grid (baton), Robot (Automatic) Conductor.
3. **Variables.** Matrix of Variables × 6 Positions × 4 Voices; each Variable has a conducting arrow (direction/enable), miniature representations of all six Positions, and an Active Position. Variables: Note Order, Transposition, Note Density, Velocity Range / Accents, Pattern Group, Orchestration, Sound Choice, Time Distortion, Phrasing.
4. **Cyclic Variables.** Rhythm / Legato / Accent, six Positions arranged vertically, cyclic conducting arrows.
5. **Midi.** Per‑voice output channel + program (patch) change.
6. **Snapshot.** Drag area, snapshot store/recall controls, Slideshow record/play controls.

### Edit windows (open by double‑click)
- **Pattern Editor** — editing grid (chromatic low→high, steps left→right), View selector (1–4), step tools (Eraser / Plunger / Scissors), MIDI Edit Range bar, Record/Insertion/Drum‑Machine mode selectors, Editor Sound enable, size box.
- **Transposition Editor** — Note + Octave per voice; "Middle C = C3 = no transposition."
- **Cyclic Editor** — Rhythm / Legato / Accent; 16‑step × 5‑level grids per voice.
- **Per‑Variable editors** — Density, Velocity Range, Note Order, etc.

### Dialogs
- MIDI Assignment / MIDI Setup → **Web MIDI device pickers**.
- Open / Save (JSON project).
- Open MIDI File (import); Save Movie As MIDI File (export).
- Movie import dialog (Chord Method / Timing / Rests / Quant / Source Channels / Import as Sequence).
- Registration/serial → repurpose as About.

### Menus
File, Edit, Variables, Pattern, Windows, Options (all the toggles: Metronome, clock sources, Second‑Order Transpose, Midi Conduct, No Cyclic Blinking, etc.).

### Performance systems
Conducting Grid (mouse baton), Input Control System (MIDI‑keyboard one‑step / two‑step controls), Mouse Advance, transpose‑from‑MIDI‑keyboard, play‑along.

---

## 6. Functionality List (by area)

**Patterns / Pattern Editor** — record via MIDI (Replace/Overdub/Drum‑Machine), step edit with mouse and tools, per‑pattern Output Length, Time Base, Phase; four independent patterns; Pattern Groups.

**Voices & playback** — 4 voices, Play‑Enable, per‑voice time base/phase, Sync (reset all voices to start), Start/Stop/Pause.

**Variables** — six snapshot‑able positions per transform, conducting‑enabled with direction; Note Order, Transposition, Density, Velocity/Accents, Time Distortion, Phrasing, Pattern Group, Orchestration, Sound Choice.

**Cyclic Variables** — 16‑step cycles for Rhythm, Legato, Accent, five levels each, per voice.

**Conducting** — drag the baton to move Active Positions of enabled Variables; continuous conducting for Velocity/Legato; Robot Conductor for autonomous movement; tempo and sync/metronome ratios.

**Snapshots & Slideshows** — store/recall whole‑screen configurations; chain snapshots into slideshows.

**Midi** — per‑voice channel and program change; device assignment.

**I/O** — MIDI file import/export, Movie record; (later) `.M` import.

---

## 7. Modern Upgrades (beyond classic M)

- **Pattern manipulation system** — replace M's manual copy/paste with reusable transforms: multi‑pattern operations, variation generators, "extend / develop this pattern," non‑destructive operation stacks, and history/undo.
- **Harmonic / scale engine** — key context, diatonic transposition, chord‑tone targeting, optional key‑quantization guardrail (§3.4).
- **All‑in‑one record‑to‑tracks** — capture the performance as editable multitrack instead of a flat MIDI bounce.
- **WAM instrument rack** — per‑voice hosted instruments; built‑in sampler replacing HALion; **automatic drum routing** (each drum note → its own pad/lane/output).
- **VST/AU hosting** in the native build.
- **Import old `.M` files** once samples are available.
- Quality‑of‑life: automation lanes for slider moves, richer conducting, project save/load, and cross‑platform native.

---

## 8. Phased Roadmap

**Current checkpoint (2026-07-31):** P0–P2 are complete; the implemented parts
of P3/P4 are stable; layout is accepted and frozen. Technical completion now
follows `NEXT_STEPS.md`: persistence, remaining Snapshot/Phrasing behavior,
recording/MIDI I/O, controller bindings, and the instrument decision.

- **P0 — Foundations.** Repo scaffold (Vite/React/TS), engine skeleton, Web Audio clock + lookahead scheduler, dual output sinks (MIDI + synth), theme architecture (control catalog + theme provider), state store.
- **P1 — Sound & Patterns.** Pattern model, Pattern Editor, transport (Start/Stop/Pause/Sync), Tempo, Time Base / Output Length / Play‑Enable. **First sound.**
- **P2 — Variables core.** Note Order, Transposition (+ harmonic engine start), Density, Velocity/Accents; Positions, miniatures, Active Position, edit windows.
- **P3 — Cyclic + Midi + remaining Variables.** Cyclic Editor, Midi window, Orchestration, Time Distortion, Phrasing, Pattern Group, Sound Choice.
- **P4 — Conducting + Snapshots.** Conducting Grid, arrows, Robot Conductor; snapshots + slideshows. *(Classic M feature‑complete.)*
- **P5 — All‑in‑one I/O.** Record‑to‑tracks, WAM instrument rack + sampler + drum auto‑routing, MIDI import/export, Options toggles, project save/load, Input Control System, Mouse Advance.
- **P6 — Modern theme + instruments.** Second theme; deeper instrument work; pattern‑manipulation upgrades.
- **Later — Native.** Tauri build; VST/AU hosting; `.M` import.

---

## 9. Open Items & Decisions Log

- **Generative fidelity:** reverse‑engineer to best ability; tune by ear (decided).
- **Look:** vector redraw from manual images; faithful function/feel, not pixels (decided).
- **Views:** classic + modern remains the direction. The Modern Cyclic Editor
  is implemented; a fully decoupled whole-app layout system is not yet built.
- **Audio:** internal synth + Web MIDI are implemented; WAM remains planned.
- **VST:** browser can't host VST; real VST hosting arrives with the native/Tauri build (decided).
- **`.M` import:** wanted; deferred until sample files are provided.
- **Instruments:** RJ has specific instruments in mind — **dedicated design conversation still queued.**
- **To confirm later:** scale/key snapping behavior of transposition (validate by ear); native wrapper specifics.

---

## 10. Glossary (M terms)

- **Voice** — one of four independent playback "paths" through the program.
- **Pattern** — a collection of notes/chords/rests; the raw material.
- **Variable** — a category of transformation applied to Voices.
- **Variable Position** — one of six snapshot‑able setting groups per Variable.
- **Active Position** — the currently selected Position.
- **Cyclic Variable** — Rhythm / Legato / Accent, stepping through 16‑step cycles.
- **Conducting** — steering Active Positions in real time via the baton in the Conducting Grid.
- **Snapshot** — a stored configuration of screen controls; **Slideshow** — a sequence of snapshots.
- **Movie** — M's performance recording (here upgraded to editable multitrack).
