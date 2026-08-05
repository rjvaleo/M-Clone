# The Rust audio port — state, and what to do next

**Written 2026-08-05; updated the same day after §2 and §4a–4d landed.
Branch `modular`.**

This is the authoritative handoff for the audio migration. `MODULAR_MODULE_MAP.md`
is stale (it claims sixteen of forty modules registered; it is sixty-one, and
the Rust story it predates entirely). Trust this file over that one.

---

## 1. Where the port actually is

**All sixteen audio modules run in Rust.** `ModuleKind` in
`rust/dsp-core/src/modules.rs`:

| # | Kind | Notes |
|---|---|---|
| 0 | HostInput | audio in from the worklet |
| 1 | Gain | |
| 2 | AudioOutput | |
| 3 | Synth | 3-osc, filter, 2 ADSR, 2 LFO, mod matrix |
| 4 | Blackhole | **has real inverse mode** — Web Audio could not do this |
| 5 | Dp4Reverb | 5 algorithms via structural variant |
| 6 | Dp4NonLin | 3 variants; **no feedback anywhere**, by design |
| 7 | Delay | |
| 8 | Reverb | FDN, *not* a convolver — see §5 |
| 9 | Eq | |
| 10 | Compressor | soft knee, 0–40 dB |
| 11 | Limiter | hard knee deliberately; mix is a real control |
| 12 | Bitcrusher | |
| 13 | Percussion | note→sample table |
| 14 | Looper | |
| 15 | Granular | grain cloud |

Run it: `open "http://localhost:5173/?engine=rust"`. Opt-in, unpersisted; the
status bar names the live backend. Anything that fails falls back to Web Audio
silently and says so.

Build artifacts: `npm run build:engine` → `public/idmlab-engine.wasm` +
`public/idmlab-rack.js`. Both gitignored.

**Test counts at last green run:** 2068 TS, 291 Rust, coverage gate at 100 %,
`npm run verify:wasm` passing, `npm run build` clean.

---

## 2. The sample loop — done, and proven live

The sample-transfer loop is committed and **verified in a real browser**, which
is what §2 used to be waiting for. On `?engine=rust`, with Audio on, adding a
Percussion node puts the starter kit in WASM memory; the status bar reads
`2 in engine · 3 samples`. That number comes from `sample_count()` over the
telemetry channel, not from an inference about whether sound came out.

A document names audio by content hash; the engine addresses it by `u32`.
`SampleSlots` is the translation, per-rack rather than global because `init`
rebuilds the engine and its bank together. Audio goes before the plan and it
has a test — a plan naming a sample the engine does not hold assigns a slot to
nothing.

## 3. Architecture notes worth not rediscovering

- **`ProcessContext` lends `&SampleBank` to every module.** The `Engine` owns
  the bank. This exists because samplers need bank access during `process`.
- **`Module::note_on` has no bank access**, so `PercussionModule` and
  `LooperModule` queue the note (`PendingNotes`) and start the voice on the next
  sample. ~20 µs. Documented in `modules.rs`.
- **Notes reach samples via `set_sample_slot(module, slot, sample)`**, not a
  parameter. Slot = MIDI note for a kit, 0 for single-source modules.
- **Structural variants** ride in on `add_module_variant(kind, variant)`.
  Topology is fixed at construction and allocates, so it cannot be a parameter.
  `variantOf()` in `engineBridge.ts` maps names to numbers.
- **Every effect shares a `Shell`** — mix, level, mute, always the last three
  consecutive parameters. Four tests assert that contract across all eight
  effects at once.
- **Notes carry `detuneCents` and a `nodeId`, and both are required.** The
  first because the scale quantisers split a pitch into a note plus a
  remainder and dropping it made all 81 microtonal scales sound like 12-TET;
  the second because dropping it made every instrument play every note. Both
  were easy to omit when they were optional, which is why they are not.
- **`process_range(start, len)` renders part of a quantum**, which is what
  makes note timing sample-accurate. `process_quantum` is that call over the
  whole buffer — do not add a second copy of the hot loop.
- **The port runs both ways now.** `RackReport` comes back every 16 quanta.
  `takeReport` is a pull so the "is one due" decision sits in `engineBridge.ts`
  where it can be tested, rather than as a counter in the untestable worklet.
- **Growing WASM memory detaches JS views.** This bit twice. `WasmRack.input`/
  `.output` are getters that re-derive; `sampleTransfer.ts` takes its view
  *after* `sample_alloc`. Do not "optimise" either back into a field.

---

## 4. What to do next, in order

**4a–4d as originally written are all done.** Detune reaches the oscillator,
notes fire at the frame the score asked for, and the worklet reports back.
What is left is the one that was always last:

### 4a. Do NOT delete the Web Audio path yet

This was the plan, and the assessment done while attempting it says no. Two
reasons, both concrete:

**The Rust path is still opt-in.** Deleting the Web Audio renderer without
first making Rust the default leaves the default path with no renderer at all.
Making Rust the default is a separate change and needs its own verification.

**Parity is not established, and the search for it found a real bug.** Notes
were being broadcast to every instrument rather than routed to the one they
were addressed to — a four-part kit played all four parts on each hit. That is
fixed, but it was found by looking, not by a test failing, which is the
argument for keeping a working fallback until more of the surface has been
exercised.

The order that would actually work:

1. Build a patch with several instruments and several effects, and listen to
   it on both backends. Nothing below the level of "does this sound the same"
   will catch the next gap.
2. Make Rust the default (`preferredEngine` in `rackNode.ts`), keeping
   `?engine=web-audio` as the escape hatch.
3. Run on that for a while.
4. Then delete `graphAdapter`, `effects`, `players`, `synthPlayer`,
   `synthVoice`, `voices`, `nodes`, `voicePool`, `grains`, `reverbTank`,
   `blackhole`, `dp4`, `transitions`, `params` and their tests — about 4,000
   lines of source and as much again of test.

Note what is **not** deleted, because it is not the Web Audio *path*: the
`AudioContext` itself, `masterChain` (the rack connects into its input),
`audition`, `decode`, `waveform`, `kit`, `assets`. Those stay whatever the
renderer is.

### 4b. Meters, now that there is something to draw them from

`RackReport.peak` is measured and delivered and nothing draws it. The status
bar shows module and sample counts only. Per-node voice counts need one more
ABI call — the engine knows `active_count` per bank but does not export it.

### 4c. The event side

See §7. 28 modules render, appear in the menu, can be patched, and do nothing.
That is now a bigger gap than anything left in the audio layer.

## 5. Decisions already made — do not silently revisit

- **`m.audio-reverb` is an FDN, not a convolver.** Convolution was raised and
  explicitly withdrawn ("NM on the convolution reverb rt now"). `impulse-seed`
  now reaches nothing.
- **Limiter knee stays hard.** A brick wall with a soft corner starts limiting
  below its ceiling. Its *mix* is adjustable (user asked); its knee is not.
- **Decay Definition on the DP/4** is applied to the tank's feed, not inside the
  loop, because `Fdn` has no hook there. Close at moderate settings, thinner at
  extremes. Moving it inside means adding an allpass stage to `Fdn`.
- **Compressor knee is real** (quadratic, continuous in value and gradient) but
  `GainComputer` is otherwise the DP/4's single signed slope.
- **Fonts are not shipped.** `fonts/CATALOG.md` has per-file licence findings
  read from the binaries: BitMap is All Rights Reserved, Digital-7 is
  personal-use, DS-Digital is $45 commercial, six carry no licence. Only the
  font *stacks* are wired (`faces/fonts.ts`); DSEG and Silkscreen are named as
  OFL replacements if this should ever ship.

---

## 6. Other open threads (not audio)

- **Task #53** — DOM test harness. More valuable now: `.tsx` carries real
  behaviour (6 kit faces, `ParameterControl` dispatch, `NodeFace`).
- **A11y gap** — kit sliders render `aria-label` null; the visible label is an
  unassociated sibling `<span>`. Fix needs a `labelHidden` prop on the kit
  controls so a face can name without double-drawing. ~6 face edits.
- **Task #72** — the 20 scale-sequencer presets from
  `/Users/rjvaleo/Documents/GitHub/scale-sequencer/presets.json`.
- **28 modules render but do not run** — see §7.
- **`reference/details/`** — Sugar Bytes / O3 panel images, never ingested.
- **Untracked and deliberately not committed:** `fonts/` (licensing),
  `reference/machines/` + `reference/theory/` (70 MB of PDFs),
  `Audio - Archival LIBRARY/` and `Audio - dec 2004 sound design/`, and
  `reference/emulate/` (all new, all unexamined).

---

## 7. The other half of the app

Audio is done. **The event side is not.** 28 of 61 modules have faces, appear in
the menu, can be patched — and have no runtime processor, so they do nothing:

MIDI input side (entirely absent): `midi-input`, `midi-monitor`,
`midi-note-decoder`, `midi-clock-encoder`, `channel-mapper`,
`source-channel-filter`, `cc-mapper`, `program-message`.

Also: `scale-context`/`scale-quantizer`/`chord-quantizer` **now run** (done this
session), plus still-inert `time-distortion`, `orchestration`, `sound-choice`,
`cumulative-transpose`, `step-advance`, `step-gate`, `sync-divider`,
`tap-tempo`, `tempo-conductor`, `reset-trigger`, `event-merger`,
`event-splitter`, `pattern-recorder`, `pattern-commands`, `conducting-xy`,
`position-conductor`, `continuous-mapper`.

There is a test in `engineBridge.test.ts` using `m.stream` as its "not ported
yet" stand-in. It has moved three times (reverb → percussion → stream); each
move was the test correctly noticing the world changed. Keep that pattern.

---

## 8. House rules

- **Tests first.** Standing rule for this project.
- **Coverage gate is 100% on `.ts`.** `.tsx` is the documented exclusion (no DOM
  harness yet). Browser-only shims carry `/* v8 ignore */` with a stated reason.
- **Verify in the browser, not just the suite.** Two real bugs this session were
  invisible to a green suite: the detached ArrayBuffer, and the gallery not
  scrolling.
- Commit messages explain *why*, and state divergences honestly rather than
  quietly.
