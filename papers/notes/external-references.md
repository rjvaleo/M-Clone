# External references — what the folder does not cover

Companion to [`README.md`](README.md). That file describes the papers **in** `papers/`; this one describes the literature the collection is **missing**, mapped onto the 54 algorithms in [`../dp4/README.md`](../dp4/README.md), with a free source for each where one exists.

Reconciled against the folder as of 2026-08-07. Run [`../fetch-papers.sh`](../fetch-papers.sh) to pull everything marked ⬜-free in one pass; it skips what you already hold.

## The headline

**Four of the nine algorithms missing from `DP4_manual.pdf` are dynamics, and two more are tube amps.** The manual gap and the literature gap are the same gap:

| Missing from the manual | Family | Closed by |
|---|---|---|
| EQ-Compressor | `cmp` | Giannoulis 2012 |
| De-esser | `ess` | Giannoulis 2012 |
| Ducker / Gate | `gat` | Giannoulis 2012 |
| DigitalTubeAmp | `amp` | Yeh thesis |
| DynamicTubeAmp | `amp` | Yeh thesis |
| 8 Voice Chorus | `cho` | Effect Design Pt.2 ✅ held |
| EQ-Chorus-DDL | `cho` | Effect Design Pt.2 ✅ held |
| 3.3 sec Delay 2U | `ddl` | Effect Design Pt.2 ✅ held |
| Dual Delay | `ddl` | Effect Design Pt.2 ✅ held |

So the nine split cleanly: **five need outside papers, four are already covered by Dattorro's own trilogy.** The build spec is blocked on the missing scan, but the *theory* for five of the nine can be settled now.

**On the missing scan.** Dattorro hosts the manual himself, including a **German edition** — `dp4_Deutschland.pdf`. Same plates, different typesetting run; if the omission is a defect in the English export rather than in the source, the German file will have the pages. Cheapest possible fix and the script tries it first.

## Coverage by family

`✅ held` = in `papers/`. `⬜ free` = fetchable. `🔒` = paywalled.

| abbr | n | status | sources |
|---|---:|---|---|
| `rev` | 11 | ✅ strong | Effect Design Pt.1 (plate, complete), Moorer 1979 (tuned tables), Dornean, Shenhuy, `stanm39` |
| | | 🔒 gap | **Jot & Chaigne** — the FDN paper `reverbTank.ts` is built on inference from. Griesinger [4], Gardner ch.3 |
| | | ⬜ free | Gardner MS thesis, as partial substitute for ch.3 |
| `ddl` | 5 | ✅ held | Effect Design Pt.2 — one topology, knob table |
| | | ⬜ free | Laakso, *Splitting the Unit Delay* — the interpolation underneath it |
| `cho` | 2 | ✅ held | Effect Design Pt.2 |
| `fla` | 2 | ⚠ partial | Effect Design Pt.2 + **Smith STAN-M-21** — you have this as saved HTML only; the PDF is free at CCRMA |
| `pha` | 1 | ⬜ free | Smith STAN-M-21, same paper |
| `vib` `pan` `trm` | 3 | ✅ held | Effect Design Pt.2 |
| `gen` | 1 | ✅ held | Effect Design Pt.3 — LFOs and pseudonoise |
| `pit` | 4 | ⚠ partial | Effect Design Pt.2 gives pitch-change vs pitch-shift and stops at the splicer |
| | | 🔒 gap | **Rossum [36]** — the paper Pt.2 defers to. $33, no free copy anywhere |
| `amp` | 6 | ❌ none | ⬜ Yeh thesis (ch.1–2 = the paywalled Pakarinen & Yeh review), WDF tutorial, ADAA |
| `dst` | 2 | ⚠ partial | **Rossum ICMC 1992** — saved HTML only; free PDF via Michigan's ICMC archive |
| | | ⬜ free | Yeh thesis, ADAA — naive waveshaping aliases badly |
| `cmp` `ess` `gat` `key` `exp`×2 | 6 | ❌ none | ⬜ **Giannoulis, Massberg & Reiss** — all six in one paper |
| `spk` | 3 | ❌ none | ⬜ Yeh/Bank/Karjalainen cabinet, García partitioned convolution, Gardner 1995 |
| `rot` | 1 | ❌ none | ⬜ Smith/Serafin/Abel/Berners, Pekonen §3 (horn/rotor crossover) |
| `voc` | 1 | ❌ none | ⬜ Dudley 1940, Dolson 1986, Gold 1990 |
| `tun` | 1 | ❌ none | ⬜ McLeod & Wyvill (MPM — written for a tuner), YIN |
| `flt` | 3 | ⚠ partial | Rumble Filter ← `HiFi.pdf` ✅. Vocal Remover is mid/side, needs nothing |
| | | ⬜ free | **VandrPolFilter** ← Weingartner, DAFx-25 2025 — Van der Pol treated as audio, with the antialiasing |
| `equ` | 1 | 🔒 gap | Regalia & Mitra [13]. OpenAlex confirms no OA copy exists. `HiFi.pdf` covers the biquad side |
| `dry` | 1 | — | No Effect |

## Notes on the collection

**Two papers you hold as HTML, not PDF.** `An Allpass Approach to Digital Phasing and Flanging.html` and `Making Digital Filters Sound _Analog_.html` are both saved web pages. Both have proper free PDFs — CCRMA's tech-report scan and Michigan's ICMC archive respectively. The script pulls them.

**`ESP2.pdf` is US Patent 5,517,436** — Andreas, Dattorro & Mauchly, Ensoniq, filed 1994-06-07, issued 1996-05-14. Public domain, and you already have it, so the script no longer fetches it. Its sibling `US5027306` (Dattorro's sigma-delta decimation filter) and `DigitalTimesII` — the sequel to your `DigitalTimesI`, on the 64:1 multirate FIR decimator — are on the same CCRMA page and are not in the folder. The script pulls those.

**`Unconfirmed 177511.crdownload`, 4.0 MB.** An interrupted Chrome download sitting in the folder root. Whatever it was, it never finished; worth re-downloading or deleting so it doesn't get mistaken for a source.

**Redundant files**, consistent with what `README.md` already flags: `DP4_manual_TEXT.pdf` is byte-for-byte the same size as `DP4_manual.pdf`, `Vortex_Basic_Op_original.pdf` exists twice, and `Digital_Implementation_of_Artificial_Rev.pdf` duplicates its longer-named twin.

**The three off-topic Dattorro papers stay off-topic**, and nothing found here changes that — but `proj392c.pdf`'s error-spectrum shaping remains the closest of the three to anything audio, as `README.md` says.

## What is genuinely unobtainable

Five items, no legitimate free copy, verified rather than assumed:

| Paper | Cost | Closes |
|---|---|---|
| Rossum, *An Analysis of Pitch-Shifting Algorithms*, AES 87th | $33 | `pit` ×4 |
| Jot & Chaigne, *Digital Delay Networks…*, AES 90th | $33 | the FDN |
| Griesinger, *Practical Processors and Programs…*, AES 7th | $33 | plate lineage |
| Regalia & Mitra, *Tunable Digital Frequency Response Equalization Filters*, IEEE | IEEE | `equ` |
| van der Pol, *On relaxation-oscillations*, Phil. Mag. 1926 | T&F | superseded by DAFx-25 |

The first three are AES E-Library preprints at $33 each. **An AES membership costs less than buying three**, and the E-Library is the only route to any of them.

Pakarinen & Yeh and Gardner ch.3 are also paywalled but have free substitutes by the same authors covering substantially the same material — noted in the table above. Full copies of both circulate on file-dump sites; those are unauthorized and are not linked here.

## Sequencing

1. **German manual** — one download, might close the 9-algorithm gap and unblock the build spec.
2. **Giannoulis** — six algorithms, one paper, and four of them are in the manual gap.
3. **Yeh thesis** — eight algorithms, and it replaces a paywalled review.
4. **Smith STAN-M-21 and Rossum ICMC** — you have both as HTML; upgrading to PDF is free and closes `pha`, `fla`, `dst`.
5. **Then decide on the AES three.** Jot & Chaigne is the one with a live consequence: `reverbTank.ts` currently ships an FDN built on inference.
