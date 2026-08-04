# Stage F — Synth and Modulation Matrix

**Date:** 2026-08-03
**Branch:** `modular`
**Status:** planned; one piece built (the PWM generator), four to go.

The last stage of [MODULAR_AV_SALVAGE_PLAN.md](MODULAR_AV_SALVAGE_PLAN.md), and
the largest. idMLab can shape notes in a dozen ways and play samples three ways,
but it cannot *generate* a pitch: there is no oscillator anywhere in
`src/modular`. This is the module that makes it an instrument rather than a
sequencer with a sampler attached.

Two sources feed it. The AV prototype contributes the **8 × 12 modulation
matrix** — plan §9.1 item 9, "full three-oscillator Synth Player and modulation
matrix". The scale sequencer
(`rjvaleo/scale-sequencer`) contributes the **voice**: five wave types with
true variable-width PWM, an amplitude ADSR, a filter with its own ADSR and key
follow, and two LFOs. Both are worked designs that have made sound; neither can
be imported as it stands, for reasons set out under *What does not come across*.

---

## 1. What it is

One module, `m.synth`, in the `instrument` family — so the note adapter drives
it exactly as it drives Percussion, Looper and Granular, and the graph adapter
wires, bypasses, ramps and disposes it exactly as it does an effect. Nothing
about the runtime needs to learn what a synth is.

```text
                    ┌─ osc 1 ─ gain ─┐
note ──► voice ─────┼─ osc 2 ─ gain ─┼──► filter ──► amp env ──► module output
                    └─ osc 3 ─ gain ─┘   (per voice, with its own ADSR)
                                  ▲            ▲
                                  └─ modulation matrix ─┘
```

**One filter per voice**, which is the single most important departure from both
sources. The scale sequencer has one `BiquadFilter` for the whole instrument and
schedules every note's filter envelope onto that one `frequency` param — so
notes fight over it, and touching the cutoff knob mid-phrase cancels the ramps
already queued for notes that have not sounded yet. That is exactly the filter
knob bug. A filter inside the voice cannot have the problem: each note owns its
own sweep, and the knob sets a base value that new voices read.

---

## 2. The modulation matrix

Eight sources by twelve destinations, from the prototype's design:

| Sources | Destinations |
| --- | --- |
| LFO 1, LFO 2 | Oscillator 1/2/3 pitch |
| Amp envelope, Filter envelope | Oscillator 1/2/3 level |
| Velocity, Note | Filter cutoff, Filter resonance |
| Mod wheel, Random | LFO 1 rate, LFO 2 rate |
| | Pan, Volume |

A routing is a `(source, destination, amount)` triple with amount in −1…+1. The
matrix is **a pure model built and tested before any audio exists**: which
sources reach which destinations, how an amount maps onto each destination's own
units — cents for pitch, a multiplier for cutoff, a linear offset for pan — and
what a set of routings evaluates to given a set of source values.

Sources divide by how fast they move, and the division decides the wiring:

- **Per-note scalars** — Velocity, Note, Random, and the two envelope amounts —
  are known when the note starts. They are folded into the ramps the voice
  schedules, so they cost nothing at all while the note sounds.
- **Continuous** — LFO 1 and LFO 2, and the mod wheel — are real nodes: an
  oscillator through a gain into the destination `AudioParam`. Audio-rate, and
  the gain *is* the amount, so changing an amount is a ramp rather than a
  rebuild.

That split is what keeps the matrix affordable. A naive implementation
recomputes ninety-six values per block; this one schedules a dozen ramps per
note and leaves two oscillators running.

---

## 3. Work, in order

Each step is test-first, and each leaves the suite green.

### F1 · Oscillator and periodic wave in the node abstraction

`nodes.ts` describes exactly the slice of Web Audio idMLab uses, and it has no
oscillator. Add `OscillatorNodeLike`, `PeriodicWaveLike`, and a `SynthContext`
extending `SampleContext` with `createOscillator` and `createPeriodicWave`. Add
`FakeOscillator` and the two factory methods to `testing/fakeContext.ts`.

**Done when:** a test can build an oscillator, set its frequency through
`rampParam`, start and stop it, and read back what it was told — under Node,
with no browser.

### F2 · The PWM generator — **built**

`pulseWaveCoefficients(width, harmonics)` in `dsp.ts`: the Fourier series for a
rectangular wave of any duty cycle, `2/(nπ)·sin(nπw)`, with the mean `2w − 1` as
the DC term. Sits beside `renderPlateImpulse` and `crushCurve` as a third pure
generator. Seven tests, including the two properties that catch a mis-indexed
series: a 50% pulse has no even harmonics, and the mirror of a 30% pulse is a
70% pulse with its odd harmonics unchanged and its even ones inverted.

### F3 · The matrix model

`modMatrix.ts`: the eight sources, twelve destinations, the routing table, the
per-destination unit mapping, and evaluation. Pure — no audio, no DOM. Includes
the rules that keep a patch sane: amounts clamp to −1…+1, a destination sums its
routings and then clamps to its own legal range, and a routing naming a source
or destination that does not exist is dropped rather than throwing.

### F4 · The voice and the player

`SynthPlayer`, implementing `ManagedAudioNode` and `NotePlayer`. Per note: three
oscillators at their detunes, per-oscillator gains, the summed signal into a
voice filter with its ADSR and key follow, then the amplitude envelope. Voices
bounded and stolen oldest-first, as `VoiceBank` already does for samples.

Every write a scheduled ramp — the source assigns `AudioParam.value` in 74
places and the ban here is enforced by a source-scanning test.

### F5 · The module, its face, and the browser

The `m.synth` descriptor with every control on the face and the shared preset
pad, in the audio accent. Then the thing that actually settles it: drop a Synth
on the canvas, wire Pattern Editor → Synth → Audio Output, press play, and hear
it. The players taught this lesson — every layer tested clean while nothing
converted note messages into scheduled events, because no unit test can see a
missing wire.

---

## 4. What does not come across

**The scheduler.** The sequencer runs `setInterval` at 25 ms with a 100 ms
lookahead and its own transport. idMLab already has a tick-based scheduler with
a tempo map, stall recovery and window-independent output; the synth is a sound
source inside it, not a second clock.

**The global state.** Seventy-odd module-scope `let`s and direct writes to
`AudioParam.value`. Both are exactly what the audio safety contract exists to
prevent, and both are enforced rather than encouraged.

**The one-filter-for-everything design.** See §1.

**The delay and reverb.** Already here — eight effects over one shell — and a
synth that carried its own would be a second, unpatchable copy.

---

## 5. What has already come across

The **tuning library** (`src/modular/tuning/`) landed ahead of this stage:
81 scales in true cents, with stable ids, and the pure functions that turn a
degree into a frequency. It is the natural pitch source for these oscillators,
and for the `scale-context-in` port that Transposition has declared since the
beginning with nothing to feed it.

Two corrections were made on the way in, both recorded in
[MODULAR_STATUS.md](MODULAR_STATUS.md): Raga Marwa's stray trailing degree, and
degrees below the root.
