# DP/4+ Reference Manual — ingestion

Full ingestion of [`../DP4_manual.pdf`](../DP4_manual.pdf) — *Ensoniq DP/4+ Parallel Effects Processor Reference Manual v2.0*, 199 pages, by Tom Tracy, Bill Whipple, Jon Dattorro and John Senior.

## What is here

```
dp4/
  md/p001.md … p199.md          per-page text, one file per PDF page
  pages/p001.png … p199.png     150 dpi grayscale page renders (20.6 MB)
  manual.json                   per-page char counts and hashes
  algorithms_canonical.json     ← the authoritative algorithm list (glossary, p171)
  algorithms.json               parsed parameter blocks, keyed by body page
  algorithm_pages.json          algorithm name → PDF page
  presets.json                  all 400 factory presets with unit chains and routing
  routings.json                 the 32 ABCD routing combinations (p128)
```

**The PDF has a complete text layer** — 373,792 characters across all 199 pages. No OCR was needed and none was used; `md/` is the extracted text verbatim.

**The renders are supplementary.** The signal-flow diagrams, routing matrices and panel art are *vector* drawings (only 8 raster images exist in the file), so they carry no text. Use `pages/` for anything diagrammatic and `md/` for prose and parameter tables.

## Addressing

Everything is keyed to the **PDF page number** (1–199), matching `md/pNNN.md` and `pages/pNNN.png`.

**Do not navigate by the table of contents.** Its page numbers are 15–30 higher than the printed folio of the page actually holding that content, and the offset is not constant — the TOC appears to have been written against a different pagination. Navigate by the running section header instead, which is reliable:

| Section | PDF pages |
|---|---|
| Front matter / TOC | 1–16 |
| 1 — Controls & Basic Functions | 17–42 |
| 2 — Algorithms | 43–121 |
| 3 — Config Parameters | 122–135 |
| 5 — Storage | 136–147 |
| 6 — Presets | 148–167 |
| Glossary | 168–~180 |

## Key pages

| What | PDF page |
|---|---|
| **Glossary algorithm table** — all 54 algorithms with their 3-letter abbreviations | **171** |
| **Available ABCD Routings** — 18 diagrams covering 32 combinations | **128** |
| **Preset lists** begin — 1-Unit RAM | **151** |

## The algorithm list — 54, from the glossary

`algorithms_canonical.json`. The **glossary on p171 is authoritative**, not the TOC: it lists 47 entries, four of which are compound (`NonLin Reverb 1, 2, 3`; `Guitar Amp 1, 2, 3, 4`; `VCF-Distort 1, 2`; `Tunable Spkr 1, 2`), expanding to **54 distinct algorithms**. Each carries the three-letter abbreviation the device shows in Select mode, which also gives a ready-made family taxonomy:

| abbr | n | algorithms |
|---|---:|---|
| `rev` | 11 | Small/Large Room Rev, Hall Reverb, Small/Large Plate, Reverse Reverb 1–2, Gated Reverb, NonLin Reverb 1–3 |
| `amp` | 6 | DigitalTubeAmp, DynamicTubeAmp, Guitar Amp 1–4 |
| `ddl` | 5 | 3.3 sec Delay 2U, MultiTap Delay, Dual Delay, Tempo Delay, EQ-DDL-withLFO |
| `pit` | 4 | Pitch Shift 2U, Pitch Shifter, Pitch Shift-DDL, FastPitchShift |
| `spk` | 3 | Speaker Cabinet, Tunable Spkr 1–2 |
| `flt` | 3 | Rumble Filter, VandrPolFilter, Vocal Remover |
| `exp` | 2 | Expander, InversExpander |
| `cho` | 2 | EQ-Chorus-DDL, 8 Voice Chorus |
| `fla` | 2 | EQ-Flanger-DDL, Flanger |
| `dst` | 2 | VCF-Distort 1–2 |
| `dry` `cmp` `ess` `rot` `equ` `vib` `pan` `gen` `trm` `pha` `tun` `gat` `key` `voc` | 1 each | No Effect, EQ-Compressor, De-esser, Rotating Spkr, Parametric EQ, EQ-Vibrato-DDL, EQ-Panner-DDL, Sine/Noise Gen, EQ-Tremolo-DDL, Phaser-DDL, GuitarTuner2U, Ducker/Gate, Keyed Expander, Vocoder (4) |

**Against what we have implemented: 8 of 54**, and those eight are approximations built from a different machine's vocabulary.

## Presets — 400, complete

`presets.json`. Eight banks of exactly **50** each — 1-Unit / 2-Unit / 4-Unit / Config, in RAM and ROM — totalling 400, which matches the manual's own claim of 200 ROM + 200 RAM. The even 50-per-bank split is the completeness check.

Each preset records its unit chain and the **routing encoded in the separator characters** between algorithm names:

| separator | meaning | count |
|---|---|---:|
| `~` | serial | 380 |
| `+` | parallel | 106 |
| `⁄` | feedback | 28 |

## Routings — 32 combinations

`routings.json`, from p128. AB pair routing × CD pair routing × AB→CD, where each pair takes `serial / parallel / feedback1 / feedback2` and AB→CD takes `serial / parallel`. That is 4 × 4 × 2 = **32**, rendered as **18 diagrams** because Feedback 1 and Feedback 2 differ only in the dry path.

This matches what [`dp4.ts`](../../src/modular/audio/dp4.ts) already implements (`DP4_ROUTING_COUNT`).

## Extraction status

| | |
|---|---:|
| Pages ingested (text + render) | **199 / 199** |
| Algorithms identified (glossary) | **54 / 54** |
| Presets extracted | **400 / 400** |
| Routing combinations recorded | **32 / 32** |
| Algorithms with parameter blocks parsed | 40 / 54 |

## ⚠ This PDF is incomplete — 9 algorithms are missing

Not a parsing problem. **Nine algorithms have no pages in this file at all**, and they form a contiguous alphabetical run from the start of Section 2:

1. 3.3 sec Delay 2U
2. 8 Voice Chorus
3. De-esser
4. DigitalTubeAmp
5. Dual Delay
6. Ducker / Gate
7. DynamicTubeAmp
8. EQ-Chorus-DDL
9. EQ-Compressor

Three independent confirmations:

- **PDF page 42 is blank** — 72 characters, being only the running header, folio 26 and the manual title. This is where the algorithm section should open.
- **PDF page 43 begins mid-algorithm**, at `09 — Comp Noise Gate Off Below` — parameter 9 of EQ-Compressor. Its heading and parameters 01–08 are nowhere in the file.
- **The first algorithm heading in the body is `EQ - DDL - WITH LFO` on page 44.** Every heading from there to `VOCODER` on page 119 is present and extracts cleanly; nothing alphabetically earlier exists anywhere in the 199 pages.

Section 2 spans 79 pages for the 45 algorithms it does contain, ≈1.75 pages each, so roughly **16–18 pages are absent** — while the printed folios run continuously across the gap (25, 26, 27…), which is why the loss is not obvious from the page numbers.

**A complete scan is needed before the build spec can be written.** Everything else in the ingestion is sound.

### Naming differs between the three sources

Worth knowing when cross-referencing — the body, glossary and TOC do not agree:

| Glossary (p171) | Body heading | TOC |
|---|---|---|
| `Tunable Spkr 1, 2` | `TUNABLE SPKR 1` / `TUNABLE SPKR 2` | `TUNABLE SPEAKER` / `TUNABLE SPEAKER 2` |
| `Rotating Spkr` | `ROTATING SPEAKER` | `ROTATING SPEAKER` |
| `VandrPolFilter` | `VAN DER POL FILTER` | `VAN DER POL FILTER` |
| `Reverse Reverb` | `REVERSEREVERB1` | `REVERSE REVERB 1` |
| `No Effect (Bypass Preset)` | `NO EFFECT (BYPASS EFFECT)` | `NO EFFECT (BYPASS EFFECT)` |

`section2_headings.json` records every heading as it actually appears in the body, with its page.

## Extraction status, corrected

| | |
|---|---:|
| Algorithms in the canonical list | 54 |
| Algorithms present in this PDF | **45** |
| Algorithms **absent from this PDF** | **9** |
| Parameter blocks parsed | 40 / 45 present |
| Absent algorithms **reconstructed from the index** | **9 / 9** — 131 parameter labels |

## The gap is partly closed — see `algorithms_reconstructed.json`

The manual's back-of-book index survived intact and cites **TOC pagination**, so each missing algorithm's known two-page span can be read back out of it. Method validated against `EQ-DDL-withLFO` (pp.53–54, present in this PDF): the index returned its parameter list exactly. See [`../notes/missing-algorithms-reconstruction.md`](../notes/missing-algorithms-reconstruction.md).

**Recovered:** parameter names for all nine, ordering for `EQ-Compressor` (determined) and for `De-esser` / `Ducker/Gate` (inferred from family pattern).

**Not recovered:** value ranges, defaults, descriptions, all nine routing diagrams, and the waveshaper table contents that give both tube amps their character. Tracked in [`../notes/open-questions.md`](../notes/open-questions.md).

`algorithms_reconstructed.json` is kept **separate from `algorithms.json` on purpose** — the latter is a clean extraction from surviving pages, the former is inference. Join on name at read time; do not merge.

## Next

The 1:1 build spec can now be written against all 54 algorithms, with borrowed ranges flagged in code so a later scan corrects rather than entrenches them. What it still cannot specify faithfully: the two tube amps' waveshaper tables, and the nine routing diagrams.

Cheapest remaining shot at those — Dattorro's German edition of this manual, `dp4_Deutschland.pdf`, pulled by [`../fetch-papers.sh`](../fetch-papers.sh).

## Related

- [`../notes/README.md`](../notes/README.md) — notes on the scientific papers, including Dattorro's own
- [`../notes/missing-algorithms-reconstruction.md`](../notes/missing-algorithms-reconstruction.md) — how the nine were recovered
- [`../notes/open-questions.md`](../notes/open-questions.md) — what the reconstruction could not settle
- [`../notes/dattorro-effect-design-part1.md`](../notes/dattorro-effect-design-part1.md) — the plate topology behind `Small Plate` / `Large Plate`
- [`../notes/dattorro-effect-design-part2.md`](../notes/dattorro-effect-design-part2.md) — the chorus/flange/pitch family behind ~13 more
