# The 9 missing algorithms, reconstructed from the index

`DP4_manual.pdf` is missing roughly 16 pages covering nine algorithms ([`../dp4/README.md`](../dp4/README.md)). **Their parameter names are recoverable from the manual's own back-of-book index**, which survived intact.

## Method

The index (`dp4/md/p182`–`p199`) cites the **TOC pagination** — the complete manual's numbering — not the PDF's re-flowed folios. The TOC gives each missing algorithm a known two-page span. So every index entry citing those pages names something printed on them.

| Algorithm | TOC pages |
|---|---|
| 3.3 sec Delay 2U | 35–36 |
| 8 Voice Chorus | 37–38 |
| De-esser | 39–40 |
| DigitalTubeAmp | 41–42 |
| Dual Delay | 43–44 |
| Ducker / Gate | 45–46 |
| DynamicTubeAmp | 47–48 |
| EQ-Chorus-DDL | 49–50 |
| EQ-Compressor | 51–52 |

**Validated before use.** Run against pp.53–54 (EQ-DDL-withLFO, which we *do* have), the index returned that algorithm's parameter list exactly — Left/Right Delay Time, LFO Rate, LFO Width, Delay Regen, Cross Regen, Regen Damping, Right Delay Input, Right Output Level, Bass Fc/Gain, Treble Fc/Gain, EQ Input Level Trim. Nothing spurious, nothing missed.

Second confirmation: for EQ-Compressor the method returns p52 → Noise Gate Off Below, Noise Gate On Above, Release Time, Bass Fc, Bass EQ Gain, Treble Fc, Treble EQ Gain, EQ Input Level Trim. That is **exactly** parameters 09–16 as they appear on the surviving PDF page 43.

**What this does not recover:** value ranges, defaults, descriptions, and the signal-routing diagrams. Names and ordering only. The complete scan is still worth having — but the build spec is no longer fully blocked.

---

## EQ-Compressor — the partial one

Page 52 survives as PDF p043 (parameters 09–24). Page 51 is gone, and it held parameters **01–08**. The index cites these parameter-shaped labels on p51:

> Comp Attack · Comp Release · Compressor Ratio · Compressor Threshold · Compressor Gain · Gain Change · Gain Reduction meter

and these, which recur across every dynamics algorithm as prose rather than parameters: *Attenuating, Infinity, Limiter, Stereo compressor, Sustain*.

Three structural twins in the surviving manual fix the ordering. Every dynamics block on this machine runs **Ratio → Threshold → Gain Change → Attack → Release**:

| | Expander | Inverse Expander | Guitar Amp 3 |
|---|---|---|---|
| Ratio | 03 | 03 | 09 |
| Threshold | 04 | 04 | 10 |
| Gain Change | 05 | 05 | 11 |
| Attack | 06 | 06 | — |
| Release | 07 | 07 | — |

And `01 Mix` / `02 Volume` are universal — every one of the 40 parsed algorithms starts with them.

### Reconstruction

| # | Parameter | Confidence |
|---|---|---|
| 01 | Mix | **certain** — universal, all 40 parsed algorithms |
| 02 | Volume | **certain** — universal |
| 03 | Comp Ratio | **high** — index p51; position fixed by three twins |
| 04 | Comp Threshold | **high** — index p51; position fixed by three twins |
| 05 | Gain Change | **high** — index p51; position fixed by three twins |
| 06 | Comp Attack | **high** — index p51, entered as `Comp / Attack 39, 46, 51` |
| 07 | Comp Release | **high** — index p51, entered as `Comp / Release 39, 46, 51` |
| 08 | Compressor Gain *(makeup)* | **likely** — see below |

**On slot 08.** The block needs six parameters (03–08) but the Inverse Expander twin has only five, so EQ-Compressor carries one extra. The index's only remaining parameter-shaped entry on p51 is `Compressor / Gain 51`, indexed as a sibling of `Compressor / Ratio 51` and `Compressor / Threshold 51`. Both other missing dynamics algorithms — De-esser (p39) and Ducker/Gate (p45) — carry an explicit `Output Gain`, giving that same six-slot shape: Ratio, Threshold, Gain Change, Attack, Release, Output Gain. EQ-Compressor's is labelled `Compressor Gain` rather than `Output Gain`, which is why it indexes separately.

Ruled out by the index, not by guesswork: `Gate Hold Time` cites 64 and 82 only (Expander, Keyed Expander) — EQ-Compressor has none. `Output Gain` cites 39, 45, 116 — not 51. `Sustain` and `Infinity` recur on 63, 71, 80, 82 where no such parameters exist, so both are prose.

---

## The other eight

`⚙` marks labels matching parameter vocabulary used elsewhere in the manual.

### 3.3 sec Delay 2U (35–36)
⚙ Delay · ⚙ Time · ⚙ Pan · ⚙ Regen · ⚙ Regen Damping · Mode · DelaySet · Loop · Loop/Muted · Loop/Record · Loop/Replay · Continuous
*p36 is the Instant Replay feature, not parameters. Note the index also records the name* `3.6 sec DDL 2U` *— a different figure from the algorithm's own title.*

### 8 Voice Chorus (37–38)
⚙ LFO Rate · ⚙ LFO Width · ⚙ Regen · ⚙ Stereo Spread · ⚙ Delay Regen · ⚙ Left · ⚙ Right

### De-esser (39–40)
⚙ Ratio · ⚙ Threshold · ⚙ Change *(Gain Change)* · ⚙ Attack · ⚙ Release · ⚙ Output Gain · ⚙ Noise Gate Off Below · ⚙ Noise Gate On Above · ⚙ Sidechain EQ HighPass Fc · Sidechain EQ Input Trim · ⚙ Bass Gain (loShv) · ⚙ Mid1 Fc/Gain/Q · ⚙ Mid2 Fc/Gain/Q · ⚙ Treble Gain (HiShv)
*A full parametric sidechain, not a fixed de-ess band.*

### DigitalTubeAmp (41–42)
⚙ Pre-EQ HighPass Cutoff · Pre-EQ1 Fc/Gain/Q · Pre-EQ2 Fc/Gain/Q · Pre-EQ3 Fc/Gain/Q · ⚙ Preamp Gain · Drive Gain · ⚙ Tube Bias · ⚙ Output Level · ⚙ Level Detect Attack · ⚙ Level Detect Release · **Waveshaper First Table · Waveshaper Last Table · Waveshaper Onset Level · Waveshaper Table Slope**

### Dual Delay (43–44)
⚙ Left Input Delay Time · ⚙ Left Input Delay Time (fine) · Left Input Delay Pan · Left Input Delay Regen · ⚙ Right Input Delay Time · ⚙ Right Input Delay Time (fine) · Right Input Delay Pan · Right Input Delay Regen · ⚙ Cross Regen · ⚙ Regen Damping · ⚙ Fine tune

### Ducker / Gate (45–46)
⚙ Ratio · ⚙ Threshold · ⚙ Change *(Gain Change)* · ⚙ Attack · ⚙ Release · ⚙ Output Gain · Ducker Output Mix · ⚙ Noise Gate Off Below · ⚙ Noise Gate On Above · Side Chain EQ Input Trim · ⚙ Bandwidth · ⚙ Bass Gain (loShv) · ⚙ Mid1 Fc/Gain/Q · ⚙ Mid2 Fc/Gain/Q · ⚙ Treble Gain (HiShv)

### DynamicTubeAmp (47–48)
Same parameter set as DigitalTubeAmp — ⚙ Pre-EQ HighPass Cutoff · Pre-EQ1–3 Fc/Gain/Q · ⚙ Preamp Gain · Drive Gain · ⚙ Tube Bias · ⚙ Output Level · ⚙ Level Detect Attack · ⚙ Level Detect Release · Waveshaper First/Last Table, Onset Level, Table Slope.
*The two differ in behaviour, not in parameter list, as far as the index shows.*

### EQ-Chorus-DDL (49–50)
⚙ LFO Rate · ⚙ LFO Width · ⚙ Center · ⚙ Left Delay Time · ⚙ Right Delay Time · ⚙ Delay Regen · ⚙ Echo · ⚙ Echo Level · ⚙ Left Echo Time · ⚙ Right Echo Time · ⚙ Bass EQ Gain · ⚙ Treble EQ Gain · ⚙ EQ Input Level Trim

---

## The finding worth acting on

**Both tube amps are waveshaping-table machines, and the index names the mechanism.** `Waveshaper First Table`, `Waveshaper Last Table`, `Waveshaper Onset Level`, `Waveshaper Table Slope` — that is a bank of waveshaping tables with a run between a first and last index, an onset threshold, and a slope governing the traverse. Combined with `Tube Bias`, `Drive Gain` and an RMS `Level Detect Attack`/`Release` pair, the topology is legible without the missing pages: **level detector drives table selection across a bank, biased and driven into a static waveshaper.**

That is directly buildable, and it changes what to read. A table-interpolating waveshaper aliases hard, which makes **Parker/Zavalishin/Le Bivic on antiderivative antialiasing** (in `dsp-papers/02-tube-nonlinear/`) the load-bearing paper for `amp`×6 and `dst`×2 — not background reading. Yeh's thesis covers the circuit-simulation approach the DP/4 explicitly did *not* take; useful for judging the target, but the DP/4's own answer was tables.

The dynamics picture is equally legible: De-esser and Ducker/Gate are the **same six-parameter compressor core** as EQ-Compressor, differing only in sidechain EQ and output routing. One implementation covers all three, plus the two expanders — which is what Giannoulis predicts.

## What still needs the scan

Ranges, defaults, descriptions, and all nine signal-routing diagrams. For the tube amps that means the waveshaper table contents and count remain unknown, and those are the character of the algorithm. Dattorro's German edition (`dp4_Deutschland.pdf`, fetched by [`../fetch-papers.sh`](../fetch-papers.sh)) is still the cheapest shot at the real pages.
