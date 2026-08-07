# Open questions — what the reconstruction could not settle

Companion to [`missing-algorithms-reconstruction.md`](missing-algorithms-reconstruction.md) and [`../dp4/algorithms_reconstructed.json`](../dp4/algorithms_reconstructed.json).

131 parameter labels were recovered for the nine missing algorithms. What follows is everything the index could **not** give, ranked by whether it actually blocks work.

## Blocking — cannot build faithfully without these

### 1. Waveshaper table contents — DigitalTubeAmp, DynamicTubeAmp
`Waveshaper First Table`, `Last Table`, `Onset Level`, `Table Slope` tell us there is a *bank* of tables traversed by a level detector. They do not tell us **how many tables, what curve each holds, or how the traverse interpolates**. That is the entire character of both algorithms — 2 of 54, and the reference point for Guitar Amp 1–4.

*Unblocks:* a complete scan of pp.41–42 and 47–48. Nothing else will do it. Failing that, the shape has to be chosen by ear against hardware.

### 2. Which of the two tube amps is which
The index shows an identical parameter set for both. `DynamicTubeAmp` implies level-responsive behaviour, but with the same controls, the difference must live in the table bank or the detector coupling. Undetermined.

### 3. All nine signal-routing diagrams
Every surviving algorithm page carries one, and they resolve ordering ambiguities that parameter lists cannot — where regen taps, whether EQ sits pre or post, how the sidechain is fed. Absent for all nine.

*Partial mitigation:* `EQ-DDL-withLFO` describes itself as "similar to Dual Delay", so its diagram (PDF p.44) is the closest surviving reference for that one.

## Non-blocking — build now, correct later

### 4. Value ranges and defaults — all nine
Not recoverable from the index. But the machine reuses ranges with high consistency, so these can be borrowed from the nearest surviving twin and flagged:

| Parameter family | Borrow from | Range |
|---|---|---|
| Noise Gate Off Below / On Above | EQ-Compressor p.43 | −96 to +00 dB |
| Gate Release Time | EQ-Compressor p.43 | 1 ms to 10.0 s |
| Bass Fc | EQ-Compressor p.43 | 0 to 1000 Hz |
| Bass / Treble EQ Gain | EQ-Compressor p.43 | −48 to +24 dB |
| Treble Fc | EQ-Compressor p.43 | 1 kHz to 16 kHz |
| EQ Input Level Trim | EQ-Compressor p.43 | −24 to +00 dB |
| Delay Time | EQ-DDL-withLFO p.44 | 0 to 845 ms |
| LFO Rate / Width | EQ-DDL-withLFO p.44 | 00 to 99 |
| Ratio, Threshold, Attack, Release, Gain Change | Expander / Inverse Expander | see `algorithms.json` |

Mark every borrowed range in code so a later scan can correct it rather than silently entrench it.

### 5. Parameter ordering — 6 of the 9
`EQ-Compressor` is determined. `De-esser` and `Ducker/Gate` are inferred with good confidence from the family pattern. The remaining six have **names but no positions**. Ordering matters for the Mod1/Mod2 destination indices and for preset compatibility, not for whether the DSP sounds right — so it does not block implementation, only round-tripping real DP/4 presets.

### 6. EQ-Compressor parameter 08
Reconstructed as `Compressor Gain`. The index supports it and both sibling dynamics algorithms carry an output gain in that slot, but it is the one genuine inference in an otherwise determined list. If a scan turns up something else, only that slot moves.

### 7. `3.3 sec Delay 2U` vs `3.6 sec DDL 2U`
The index records both names. The algorithm's own title says 3.3; the index entry says 3.6. One is a typo and the maximum delay time depends on which. Low stakes, easy to fix, worth not guessing.

## Resolved — no longer open

- **Parameter names for all nine** — recovered, 131 labels.
- **The dynamics core** — De-esser, Ducker/Gate and EQ-Compressor share one six-parameter compressor (Ratio, Threshold, Gain Change, Attack, Release, Output Gain) differing only in sidechain EQ and output routing. One implementation, three algorithms, plus the two expanders.
- **Tube amp topology** — level detector traversing a waveshaping-table bank, not circuit simulation. Settles the reading list: antiderivative antialiasing is load-bearing, wave digital filters are not.
- **De-esser sidechain** — a full parametric sidechain (HighPass Fc, Input Trim, two mid bands, low and high shelves), not a fixed de-ess band.

## The one cheap shot left

Dattorro hosts a German edition of the manual, `dp4_Deutschland.pdf`, fetched by [`../fetch-papers.sh`](../fetch-papers.sh) into `dsp-papers/00-manual-gap/`. Same plates, separate typesetting run. If the omission is a defect in the English export rather than the source, items 1–5 above all close at once. Worth checking before committing to any borrowed range.
