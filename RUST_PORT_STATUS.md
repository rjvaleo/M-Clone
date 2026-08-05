# The Rust audio port — state, and what to do next

**Written 2026-08-05, at the end of a long session. Branch `modular`.**

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

**Test counts at last green run:** 2029 TS, 284 Rust, coverage gate passing,
`npm run verify:wasm` passing, `npm run build` clean.

---

## 2. UNCOMMITTED WORK — read this first

The working tree holds the **sample-transfer loop**, finished and fully green
but not committed. Verified before stopping: typecheck, 2029 TS tests, 284 Rust
tests, coverage gate, `verify:wasm`, `build` — all passing.

Modified:
- `src/modular/audio/audioEngine.ts` (+test) — `sendSamples()` pushes decoded
  assets to the rack before each plan
- `src/modular/audio/wasm/engineBridge.ts` (+test) — `loadSample`,
  `setSampleMap`, `assignSamples()` from the plan
- `src/modular/audio/wasm/rackNode.ts` (+test) — `loadSample`, `setSampleMap`
- `src/modular/audio/wasm/rackProtocol.ts` — two new messages: `sample`,
  `sample-map`
- `src/modular/audio/wasm/rackWorklet.ts` — handles both

New (untracked):
- `src/modular/audio/wasm/sampleSync.ts` (+test) — `planSampleRefs`,
  `SampleSlots`

**What it does:** a document names audio by content hash; the engine addresses
it by `u32`. `SampleSlots` maps between them. On each `update`, `AudioEngine`
finds every sample the plan wants, transfers any it has not sent (channel
buffers are *transferred*, not copied — 40 MB per stereo file), then posts the
plan. Order matters and is tested: audio before plan, or the sampler points at
nothing.

**The one thing not proven:** I never confirmed in a live browser session that a
sample actually lands in WASM memory. Everything is unit-tested and the path is
wired end to end; Percussion and Granular both add cleanly on `?engine=rust`
with no console errors, and Percussion renders its 8 slot rows. But
"audio reaches the bank at runtime" is verified only by fakes.

**First action on resume:** either commit this, or verify it in the browser and
then commit. See §4 for how.

---

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
- **Growing WASM memory detaches JS views.** This bit twice. `WasmRack.input`/
  `.output` are getters that re-derive; `sampleTransfer.ts` takes its view
  *after* `sample_alloc`. Do not "optimise" either back into a field.

---

## 4. What to do next, in order

### 4a. Commit the sample loop (or verify first)

To verify in the browser before committing:

```bash
npm run build:engine && npm run dev
```

Then open `http://localhost:5173/?engine=rust`, click **Audio**, add a
**Percussion** node from the right-click menu. Its default slots reference the
synthetic starter kit, so audio should transfer with no file dropped. Confirm
via `sample_count()` on the engine, or add temporary telemetry from the worklet
— there is currently **no telemetry channel from worklet to main thread**,
which is why this was not straightforward.

### 4b. Note detune through Rust (task #71) — a correctness gap in shipped code

The scale quantisers split a pitch into MIDI note + `detuneCents`, and the Web
Audio synth applies it. **The Rust path drops it entirely**, so all 81
microtonal scales currently sound like 12-TET on the engine everything is
moving to.

Thread cents through: `rackProtocol.ts` note-on → `rackNode.ts` → `engineBridge`
→ `rust/wasm/src/lib.rs` `note_on` → `Module::note_on` in `engine.rs` → `Synth`
in `modules.rs` → `VoiceBank` in `bank.rs` → `Voice` in `voice.rs` where the
oscillator frequency is set. Every Rust test call site needs the extra argument.

### 4c. Scheduled note timing

`RackMessage` carries no timestamp, so a Rust note sounds when its message is
handled rather than at `atSec`. The Web Audio path *is* sample-accurate here.
Needs a scheduled-note message and a queue on the Rust side. Documented in
`rackNotePlayer.ts`.

### 4d. Telemetry channel worklet → main thread

Needed for voice counts on node faces, meters, and to make 4a verifiable.
Nothing exists yet.

### 4e. Only then: delete the Web Audio path

Do **not** do this before 4b–4c. Removing the fallback earlier replaces working
audio with silence.

---

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
  `Audio - Archival LIBRARY/` and `Audio - dec 2004 sound design/` (new, unexamined).

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
