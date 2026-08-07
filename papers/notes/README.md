# Reference papers — implementation notes

Working notes on the papers in [`../`](../), written for **building effects**, not for studying them. Each note pulls out the topologies, equations, coefficient tables and tuning rules needed to implement something, cites the PDF page it came from, and links back to the source.

**Use these as a working index, not a substitute for the papers.** Where a note says something matters, the page cite is there so you can check it.

## How the material is laid out

```
papers/
  *.pdf              the sources, as committed
  text/*.txt         extracted plain text, page-marked `=== [pN] ===`, for grep
  text/index.json    page counts, char counts, SHA-256 prefixes
  notes/*.md         these notes
```

Page cites in the notes are **PDF page numbers**, which match the `=== [pN] ===` markers in the extracted text. Where a journal's own folio numbers differ, the note says so.

## Status

### Core — the Dattorro *Effect Design* trilogy

All three parts are now present. Together they are a complete effects toolbox by one of the DP/4+ manual's own authors.

| Paper | Topic | Note | Status |
|---|---|---|---|
| `EffectDesignPart1.pdf` | **Plate reverberator**, musical filtering, cut filters, resonators | [dattorro-effect-design-part1.md](dattorro-effect-design-part1.md) | ✅ done |
| `EffectDesignPart2.pdf` | Delay-line modulation, chorus, flange, vibrato, doubling, pitch shift | [dattorro-effect-design-part2.md](dattorro-effect-design-part2.md) | ✅ done |
| `EffectDesignPart3.pdf` | Oscillators: sinusoidal LFOs and pseudonoise generators | `dattorro-effect-design-part3.md` | ⬜ pending |

### Reverberation

| Paper | Topic | Note | Status |
|---|---|---|---|
| `About_This_Reverberation_Business.pdf` | Comb/all-pass reverb, in-loop damping, tuned parameter tables | [moorer-1979-reverberation.md](moorer-1979-reverberation.md) | ✅ done |
| `stanm39.pdf` | Digital waveguides, waveguide reverberation, limit cycles | `smith-waveguides.md` | ⬜ pending — **scanned**, needs vision reading |
| `Design_of_a_Reverb_Plugin_and_Evaluation.pdf` | Convolution reverb, plugin design, listening evaluation | `shenhuy-convolution-reverb.md` | ⬜ pending |
| `Digital_Implementation_of_Artificial_Reverberation.pdf` | Schroeder/Moorer structures re-implemented on FPGA | `dornean-artificial-reverberation.md` | ⬜ pending |

### Filter implementation

| Paper | Topic | Note | Status |
|---|---|---|---|
| `HiFi.pdf` | Recursive filter topology, unity-gain design, truncation noise | [dattorro-hifi-recursive-filters.md](dattorro-hifi-recursive-filters.md) | ✅ done |
| `DigitalTimesI.pdf` | Condensed version of the above, **plus** extra truncation-error-cancellation material and a 64:1 sigma-delta FIR decimator | — | ⬜ pending — see note below |
| `Wavelet.pdf` | Filterbank implementation of Meyer's wavelet | `dattorro-meyer-wavelet.md` | ⬜ pending |
| `IIRAdapt.pdf` | LMS adaptation with a recursive second-order circuit | `dattorro-lms-adaptation.md` | ⬜ pending |

### Devices

| Source | Topic | Status |
|---|---|---|
| `DP4_manual.pdf` | Ensoniq DP/4+ reference manual, 199p, ~54 algorithms | separate audit + build spec, pending |
| `LexVortex/`, `Vortex_Basic_Op_original.pdf` | Lexicon Vortex — 2p operation sheet, plus archived HTML specs pages | ⬜ unexamined |

### Off-topic — same author, different field

| Paper | What it actually is |
|---|---|
| `DattorroLAA.pdf` | *Equality relating Euclidean distance cone to positive semidefinite cone*, Lin. Alg. Appl. 428 (2008). Convex optimisation. |
| `TissueSaturationPulse.pdf` | *Minimum Peak Impulse FIR Filter Design* (Law & Dattorro). MRI saturation pulses — genuinely FIR design, but the objective is peak-RF minimisation, not audio. |
| `proj392c.pdf` | *Error Spectrum Shaping and Vector Quantization* (Dattorro & Law, EE392c). Image coding. The error-shaping half overlaps `HiFi.pdf` §2. |

## Notes on the collection itself

**Duplicates.** `Digital_Implementation_of_Artificial_Rev.pdf` and `Digital_Implementation_of_Artificial_Reverberation.pdf` have **byte-identical extracted text** (4 pages, 10,630 chars each) — Dornean, Ţopa & Kirei. Different SHA-256, so two exports of one paper. One note will cover both; one file can be deleted. Likewise `Vortex_Basic_Op_original.pdf` exists both at the top level and inside `LexVortex/`.

**`HiFi.pdf` vs `DigitalTimesI.pdf`.** Not duplicates, though the abstracts nearly match. `HiFi.pdf` is the full journal version (JAES 36(11), 1988 November). `DigitalTimesI.pdf` says of itself: *"An expanded version of Part I of this paper… was previously published in the Journal this past November"* — so it is the **condensed** conference version, but it adds new material on Truncation Error Cancellation and a **Part II covering a one-stage multirate 64:1 FIR decimator for one-bit sigma-delta A/D**, which `HiFi.pdf` does not contain. Read `HiFi` for the IIR material; read `DigitalTimesI` for the decimator and the extra cancellation work.

**Three papers are by Dattorro but not about audio** — see the table above. They were presumably collected on the strength of the author's name. `proj392c.pdf` is the least irrelevant of the three: error spectrum shaping is the same mathematics as the noise shaping in `HiFi.pdf` §2, applied to images instead of audio, and it bears on a noise-shaped bitcrusher.

**Sample rates differ between papers and none is ours.** Dattorro's plate assumes **29761 Hz**; Moorer tabulates for **25 kHz and 50 kHz**; we run at whatever the browser's `AudioContext` gives us, typically 44.1 or 48 kHz. Every delay length taken from these papers must be rescaled, and the notes flag this where it matters.

## What each paper is actually good for

- **Effect Design Part 1** — **the most directly implementable document in the folder.** A complete plate reverberator: every delay length, every coefficient, the output tap structure, and the parameter defaults. Nothing is left to design. This is what the DP/4's `SMALL PLATE` and `LARGE PLATE` are.
- **Effect Design Part 2** — the highest-value paper for the DP/4's *modulation* algorithms. Gives the chorus/flange/vibrato/doubling/echo circuit as *one* topology with a knob table, the interpolation methods that make it transparent, and the pitch-change vs pitch-shift distinction that determines how the DP/4's four pitch algorithms must be built.
- **Effect Design Part 3** — the oscillators the other two parts depend on. Part 1's tank modulation needs a quadrature LFO; Part 2's stereo chorus needs the same. Both forward-reference this part for the design.
- **HiFi** — filter doctrine from ENSONIQ itself. Direct form I for audio, unity-gain design, cascade biquads. Half the paper is fixed-point material that does not transfer to a float pipeline; the note marks which half.
- **Moorer 1979** — the only paper here that hands over a *tuned, working reverb* as a table of numbers. Use it as a reference implementation and a sanity check.
- **Smith STAN-M-39** — waveguide theory, which is the lineage our FDN actually belongs to, plus a section on limit-cycle elimination in recursive structures.
- **Shenhuy** — convolution reverb, i.e. the other family entirely. Relevant to our convolver-based `m.audio-reverb` and to impulse-response generation.
- **Dornean et al.** — a short modern re-implementation of the Schroeder/Moorer structures; useful as a cross-check on Moorer rather than as a source in its own right.
- **IIRAdapt / Wavelet** — Dattorro's student work. Adaptive filtering and filterbanks, not effect design. Lower priority, but the filterbank material bears on any multiband processing (the Smooth Crusher's mid/side and frequency-dependent width both want it).

## Related

- [`../../MODULAR_AV_SALVAGE_PLAN.md`](../../MODULAR_AV_SALVAGE_PLAN.md) — how the audio rack was built and what remains
- [`../../docs/AUDIO_ENGINE_SPEC.md`](../../docs/AUDIO_ENGINE_SPEC.md) — the product-level audio spec these papers serve
- `DP4_manual.pdf` — 199 pages, ~54 algorithms, its own audit and build spec still pending
