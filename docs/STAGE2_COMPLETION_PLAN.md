# Stage 2 completion — making the Rust synth playable in a browser

**Status:** ready to implement
**Repo:** `/Users/rjvaleo/Documents/GitHub/M Clone`, branch `modular`
**Background:** [`AV_ENGINE_REFACTOR.md`](AV_ENGINE_REFACTOR.md) — read §1 and §4 first
**Scope:** two steps. Everything below them is built, tested and verified.

This document is written to be executed cold. It assumes no memory of the
session that produced it.

---

## 1. Where things stand

The Rust audio engine works and is proven end to end at the WASM boundary.
`rust/wasm/verify.mjs` already sends a note across the ABI, gets sound back,
sets an LFO→Volume modulation routing, and measures the resulting tremolo.

**187 Rust tests, 1,795 TypeScript tests, coverage gate at 100% lines /
statements / functions, clippy clean.** Do not regress any of that.

What exists:

| Layer | File | State |
|---|---|---|
| Oscillator, LFO, ADSR, matrix, voice, polyphony | `rust/dsp-core/src/{osc,lfo,envelope,modmatrix,voice,bank}.rs` | done |
| `Synth` engine module + note verbs | `rust/dsp-core/src/modules.rs`, `engine.rs` | done |
| WASM ABI | `rust/wasm/src/lib.rs` | done |
| Plan → engine commands | `src/modular/audio/wasm/engineBridge.ts` | done |
| Worklet processor | `src/modular/audio/wasm/rackWorklet.ts` | **modified, uncommitted** |
| Main-thread handle | `src/modular/audio/wasm/rackNode.ts` | **needs step 1** |
| Bench page | `public/engine-test.html` | **needs step 2** — currently only exercises Gain |

### The uncommitted change

`src/modular/audio/wasm/rackWorklet.ts` has already been extended. `RackMessage`
now carries six variants and the port handler dispatches all of them:

```ts
export type RackMessage =
  | { type: "plan"; plan: AudioPlan }
  | { type: "reset" }
  | { type: "note-on"; note: number; velocity: number }
  | { type: "note-off"; note: number }
  | { type: "all-notes-off" }
  | { type: "modulation"; nodeId: string; source: number; dest: number; amount: number };
```

It typechecks and every test passes. It is half a feature: the worklet can
*receive* notes and nothing on the main thread *sends* them. Step 1 closes that.
Commit it together with step 1.

---

## 2. Reference — the wire protocol

These numbers are shared between Rust and TypeScript. **Appending is safe;
reordering silently rewrites every saved patch.** Take them from here rather
than re-deriving them.

### `ModuleKind` — `rust/dsp-core/src/modules.rs`

| Value | Kind | Document type |
|---|---|---|
| 0 | HostInput | *(none — no document mentions it)* |
| 1 | Gain | `m.audio-gain` |
| 2 | AudioOutput | `m.audio-output` |
| 3 | Synth | `m.synth` |

### Synth parameter indices

Already mapped in `PARAM_INDICES["m.synth"]` in `engineBridge.ts`. Use those
names; this table is for writing the bench UI.

| Index | Name | Range / units |
|---|---|---|
| 0 | `level` | 0–1, the fade handle. **Built at 0 — must be raised or the synth is silent.** |
| 1–5 | `osc1-{wave,semitones,cents,level,width}` | wave enum, ±48 semis, ±100 cents, 0–1, 0.05–0.95 |
| 6–10 | `osc2-…` | as above |
| 11–15 | `osc3-…` | as above |
| 16 | `filter-cutoff` | 20–20000 Hz |
| 17 | `filter-resonance` | 0–1 |
| 18 | `filter-env-octaves` | ±8 |
| 19 | `key-follow` | 0–1 |
| 20–23 | `amp-{attack,decay,sustain,release}` | seconds, sustain 0–1 |
| 24–27 | `filter-{attack,decay,sustain,release}` | seconds, sustain 0–1 |
| 28–32 | `lfo1-{shape,trigger,rate,depth,phase}` | enums, 0.01–50 Hz, 0–1, 0–360° |
| 33–37 | `lfo2-…` | as above |
| 38 | `pan` | −1 to 1 |
| 39 | `volume` | 0–1 |
| 40 | `mod-wheel` | 0–1 |

### Enums

- **Wave:** Sine 0, Triangle 1, Sawtooth 2, Square 3, Pulse 4
- **LfoShape:** Sine 0, Triangle 1, Sawtooth 2, Ramp 3, Square 4, SampleHold 5, SmoothRandom 6
- **LfoTrigger:** Free 0, Note 1, OneShot 2
- **ModSource:** Lfo1 0, Lfo2 1, AmpEnv 2, FilterEnv 3, Velocity 4, Note 5, ModWheel 6, Random 7
- **ModDest:** Osc1Pitch 0, Osc2Pitch 1, Osc3Pitch 2, Osc1Level 3, Osc2Level 4, Osc3Level 5, FilterCutoff 6, FilterResonance 7, Lfo1Rate 8, Lfo2Rate 9, Pan 10, Volume 11

---

## 3. Step 1 — post notes from the main thread

**File:** `src/modular/audio/wasm/rackNode.ts` (and its existing test file).

`WasmRackNode` currently has `update(plan)`, `reset()`, `dispose()`. Add four
methods that post the corresponding `RackMessage`:

```ts
noteOn(note: number, velocity: number): void
noteOff(note: number): void
allNotesOff(): void
setModulation(nodeId: string, source: number, dest: number, amount: number): void
```

### Rules each one must follow

1. **Respect the `disposed` guard.** Every existing method returns early when
   disposed; these must too. There is already a test asserting a disposed node
   goes quiet — extend it to cover the new methods.
2. **Do not deduplicate.** `update()` filters by `plan.generation` because it is
   called from an effect that cannot know whether anything moved. Notes are the
   opposite: two identical `noteOn(60, 1)` calls are two notes, and swallowing
   the second would break a repeated note. Write a test that says so.
3. **Clamp nothing here.** The Rust ABI already refuses non-finite velocities and
   notes above 127. Duplicating that check would create two places to fix it.

### Tests to add to `rackNode.test.ts`

The file already has a `FakeNode` with a `FakePort` recording `sent` messages.
Follow its existing style — assert on the posted message objects.

- each method posts the right message shape
- a repeated `noteOn` posts twice
- a disposed node posts nothing for any of the four
- `setModulation` passes the `nodeId` through unchanged

**Done when:** `npx vitest run src/modular/audio/wasm/` is green and the
coverage gate still reports 100% lines/statements/functions.

---

## 4. Step 2 — the bench page

**File:** `public/engine-test.html`.

The page already loads the real `.wasm` into an AudioWorklet and runs a Gain
chain. Read it before editing — it has a working `render(state)` pattern where
**one function sets the text of every control**, and a `check()` helper that logs
pass/fail lines. Keep both; do not have individual handlers patch their own
labels.

### What to add

A synth section that sends this plan, then plays it:

```js
{
  generation: <increment on every send>,
  nodes: {
    s:   { nodeId: "s",   moduleType: "m.synth",        structure: {}, parameters: { …by name… }, bypass: false, wet: 1 },
    out: { nodeId: "out", moduleType: "m.audio-output", structure: {}, parameters: {},            bypass: false, wet: 1 },
  },
  connections: [{ from: { nodeId: "s", portId: "audio-out" }, to: { nodeId: "out", portId: "audio-in" } }],
}
```

Controls, all posting through the worklet port:

- **A keyboard.** Two octaves of buttons, or map the computer keyboard. Mouse
  down / key down → `{ type: "note-on", note, velocity: 0.8 }`; up → `note-off`.
  Send `all-notes-off` on blur, or a stuck note outlives the page focus.
- **Oscillator 1:** wave select, level, pulse width (only meaningful on Pulse).
- **Filter:** cutoff, resonance.
- **Amp envelope:** the four ADSR sliders.
- **LFO 1:** shape, rate, depth.
- **One live matrix routing:** a source select, a destination select, and an
  amount slider, posting `{ type: "modulation", nodeId: "s", source, dest, amount }`.
  Default it to **LFO1 → FilterCutoff at 0.6 with the LFO at ~2 Hz**, because
  that is the combination that makes the point of the whole stage audible.

Set `parameters.level` to 1 in the plan, or nothing will be heard.

### Automated checks on the page

The page's `check()` log is how this gets verified without clicking. Add checks
that run on start:

- the synth module was built and connected
- silent before any note
- a note produces measurable output (use an `AnalyserNode` on the worklet node,
  as the existing Gain section does)
- with the LFO routed to cutoff, the output's brightness changes over time

---

## 5. Verification

All of these must pass. Run them; do not assume.

```bash
cargo test --manifest-path rust/dsp-core/Cargo.toml
cargo clippy --workspace --manifest-path rust/Cargo.toml --all-targets   # must be warning-free
npm run build:engine        # rebuilds public/idmlab-engine.wasm and idmlab-rack.js
node rust/wasm/verify.mjs
npm run typecheck
npx vitest run --coverage   # gate: 100% lines/statements/functions
npm run build
```

`cargo` needs `. "$HOME/.cargo/env"` first if it is not on PATH.

### Verifying in a browser

Start the dev server with the `m-clone` launch config and open
`http://localhost:5173/engine-test.html`.

**Synthesized clicks on this page are unreliable** — they have missed their
targets repeatedly. Do not conclude anything from a click that appears to do
nothing. Instead drive verification with `javascript_tool` and an
`OfflineAudioContext`, which needs no user gesture and renders deterministically.
The pattern that works:

```js
const ctx = new OfflineAudioContext(2, 48000, 48000);
const mod = await WebAssembly.compile(await (await fetch('./idmlab-engine.wasm')).arrayBuffer());
await ctx.audioWorklet.addModule('./idmlab-rack.js?v=' + Date.now());  // cache-bust
const node = new AudioWorkletNode(ctx, 'idmlab-rack', {
  numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2],
  processorOptions: { module: mod },
});
node.port.postMessage({ type: 'plan', plan: … });
await new Promise(r => setTimeout(r, 60));      // let the plan land before rendering
node.port.postMessage({ type: 'note-on', note: 60, velocity: 1 });
node.connect(ctx.destination);
const buf = await ctx.startRendering();
```

Then measure the rendered buffer. **Report measured numbers, not adjectives.**

---

## 6. Rules that have already cost time

Each of these caused a real defect in this codebase. They are not style notes.

**Write the test first.** It is the standing instruction and it has repeatedly
caught defects that looked like working code — including a gain of 1 that read as
silence because parameters were seeded to zero.

**A green suite over a silent app has happened three times here.** Every layer
had passing tests while nothing exercised the wire *between* layers. Verify by
rendering audio, not by asserting that a function was called.

**Brightness must be measured normalised** — RMS of the first difference over RMS
of the signal. Raw total variation conflates timbre with loudness, so closing a
filter (which lowers the level too) reads as the filter barely working. There is
a correct implementation in `rust/dsp-core/src/lib.rs` under `testutil`.

**Measure before changing an assertion.** When a test fails, find the real number
first. Two failures in this stage were bad metrics, not bad code, and tuning the
threshold would have hidden working DSP.

**WASM has no unsigned integers.** A `u32` return arrives in JavaScript as a
signed `i32`, so the `NO_MODULE` sentinel (`u32::MAX`) reads as `-1`. Always pass
module ids back through `>>> 0`.

**Never let an enum crossing the ABI fail closed.** A wave index from a newer
document must fall back to a default, not silence the instrument.

---

## 7. Known limitation — do not fix here

`AudioOutput` is mono (1 in, 1 out), so only the synth's **left** channel reaches
the speakers. Pan works and is tested at the synth module's own ports.

Making the graph stereo end to end is a real piece of work — `HostInput`, `Gain`
and `AudioOutput` all widen, and the bridge has to wire two cables per
connection. It deserves its own step. **Do not special-case it into this one.**

---

## 8. Committing

Focused commits, message explaining *why* rather than what — match the existing
history, which is unusually detailed and is the project's main record of
reasoning. Do not push.

Suggested split:

1. Worklet protocol + `WasmRackNode` note methods (includes the uncommitted change)
2. The bench page

Then update [`AV_ENGINE_REFACTOR.md`](AV_ENGINE_REFACTOR.md) with Stage 2's
status, in the same shape as the Stage 1 entry: what landed, what proves it, and
anything found on the way.
