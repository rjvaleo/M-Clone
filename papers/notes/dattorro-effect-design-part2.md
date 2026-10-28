# Effect Design, Part 2: Delay-Line Modulation and Chorus

**Jon Dattorro**, CCRMA Stanford. *J. Audio Eng. Soc.* **45**(10), 1997 October, pp. 764–788.

- **Source PDF:** [`../EffectDesignPart2.pdf`](../EffectDesignPart2.pdf) · **extracted text:** [`../text/EffectDesignPart2.txt`](../text/EffectDesignPart2.txt)
- Page cites below are the **PDF page** (`p6`), which the extracted text marks as `=== [p6] ===`. The journal's own folio numbers run 764–788.

**Why this paper carries more weight than the others here:** Dattorro is one of the four credited authors of the DP/4+ reference manual. This is the same engineer documenting the algorithm family the machine implements. Where this paper and a guess disagree, this paper wins.

**What it covers:** every effect built on a *moving delay tap* — vibrato, chorus, flange, doubling, echo, detune — plus the interpolation that makes them not sound broken, plus the pitch-change/pitch-shift distinction. It does **not** cover reverberation; that is Part 1, which is **not in this folder** (see [`README.md`](README.md)).

---

## 1. The moving tap (p1–p2, §4.1–4.2)

Everything in this paper is one delay line with a tap that moves:

```
i.frac = NOMINAL_DELAY + CHORUS_WIDTH · y[n]      y[n] = LFO, bipolar, |y| ≤ 1
i      = floor(i.frac)                             integer sample index
frac   = i.frac − i                                fractional part, always ≥ 0
```

`NOMINAL_DELAY` is the tap centre in whole samples; `CHORUS_WIDTH` is the peak excursion either side of it. The tap must be *interpolated*, because a tap that snaps to integer samples produces a discontinuity every time it crosses one.

Dattorro's reference implementation uses a 2048-sample line named `VoiceL`. `x[n]` is always `VoiceL[0]`; positive `i` indexes older samples.

**Naming, which the paper is strict about and most sources are not:**

| Term | Meaning |
|---|---|
| **Vibrato** | delay modulation alone, no dry mix, sinusoidal LFO |
| **Chorus** | vibrato *mixed with dry*, slow and microtonal |
| **Flange** | same circuit, much shorter minimum delay, feedback inverted |
| **Doubling** | same circuit, ~20 ms tap centre, modulation randomised |
| **Detune** | *fixed* microtonal pitch **shift** mixed with dry — not the same as chorus |
| **Pitch change** | playback-rate change; run time changes |
| **Pitch shift** | pitch altered, run time preserved; needs a splicer |

The chorus/detune distinction matters for the DP/4 build: chorus pitch necessarily *undulates* because of how it is made, detune does not. They are sonically distinct and the paper says detune is the harder one.

---

## 2. Linear interpolation (p1–p6, §4)

```
v[n] = frac · VoiceL[i+1] + (1 − frac) · VoiceL[i]
```

Cheap, and the cost/performance is "difficult to beat" (p6). But it is a **time-varying low-pass filter**, and the paper is unusually direct about the consequences (p6, §5):

1. **Amplitude distortion** — the polyphase filter has a dynamic zero at Nyquist. Audible as a "veil" over the source, and as unaccounted damping anywhere the interpolator sits in a signal path.
2. **Amplitude modulation** — that moving zero produces audible **flutter**, worst near unity pitch-change ratio on bright material.
3. **Phase distortion** — delay response is non-constant; the only frequency with zero delay error is DC, and error worsens with frequency.
4. **Aliasing** — worst for large upward pitch change (decimation).

Measured THD+N (p11): **−78 to −88 dB**.

> **Implementation consequence.** A multi-voice chorus built on linear interpolation low-passes the signal audibly, *per voice*. Guitarists leave chorus on permanently and want it transparent (p13, §6.1), so this is the wrong default for that module.

---

## 3. All-pass interpolation (p6–p11, §5)

```
v[n] = VoiceL[i+1] + (1 − frac) · VoiceL[i] − (1 − frac) · v[n−1]
```

One recursive element with a time-varying coefficient. Magnitude response ≈ all-pass, which removes distortions 1 and 2 above. Costs one extra multiply-accumulate and one state variable per voice.

**Where it wins:** microtonal pitch change, less than about ±1 semitone. Outside that region linear interpolation beats it on THD+N. Measured warped all-pass THD+N (p11): **−77 to −85 dB** — slightly worse than linear on paper, but the paper's claim is that it "makes the interpolation sound analog" (p7), i.e. the *character* of the error is better even where the number is not.

### Coefficient warping (p8, §5.2.1)

Plain all-pass interpolation tracks `frac` unevenly — badly at DC. The exact fix warps the coefficient for a chosen frequency ω:

```
1 − frac  →  sin[(ω/2)(1 − τ)] / sin[(ω/2)(1 + τ)]
```

For audio dominated by low frequencies, ω → 0 collapses this to the cheap form (eq. 40, p8), with **τ = frac**:

```
1 − frac  →  (1 − τ) / (1 + τ)
```

This evens out delay distribution at low frequency and reduces phase distortion there, at the cost of worse *average* delay across frequency. The paper judges it desirable up to a few kHz.

> **For the build:** the warped form is two adds and a divide on a value that changes once per sample. Use it. `(1−τ)/(1+τ)` is also numerically well behaved for τ ∈ [0,1).

---

## 4. The white chorus circuit (p12–p13, §6) — the centrepiece

One circuit does vibrato, flange, chorus, doubling and echo. Three coefficients:

```
        ┌─────────────── blend ──────────────────┐
        │                                        ▼
x[n] ──►(+)──► delay line ──┬─► modulating tap ─►(×ff)──►(+)──► out
         ▲                  │
         │                  └─► fixed tap (same centre) ─┐
         └────────────────── (×fb) ◄────────────────────┘
```

```
H_chorus(z) = (blend + feedforward · z^−i) / (1 + feedback · z^−same_tap_centre)
```

The **feedback tap is fixed**, at the exact centre of the feedforward tap's modulation. That is the whole idea: feeding back a *modulating* signal feeds back pitch change, which compounds and "becomes objectionable quickly" (p12). Feeding back from a static tap at the same centre makes the circuit approximate an all-pass, cancelling the comb troughs the feedforward sum introduces.

`|H(e^jω)| = 1` exactly when `i = same_tap_centre`, `feedforward = 1.0`, and `blend = feedback`.

### Table 6 — knob settings (p12)

| Effect | Blend | Feedforward | Feedback |
|---|---:|---:|---:|
| Vibrato | 0.0 | 1.0 | 0.0 |
| Flanger | 0.7071 | 0.7071 | −0.7071 |
| Industry-standard chorus | 1.0 | 0.7071 | 0.0 |
| **White chorus** | **0.7071** | **1.0** | **0.7071** |
| Doubling | 0.7071 | 0.7071 | 0.0 |
| Echo | 1.0 | ≤ 1.0 | < 1.0 |

`0.7071` is 1/√2 throughout — equal-power. Max `|feedback|` is **0.9999999** (q23) for stability of every effect in the table.

Echo sets either feedforward *or* feedback to zero, adds a first-order low-pass in that path to simulate air absorption (cutoff becomes a knob), and turns delay modulation off.

### Table 7 — delay ranges in ms (p13)

| Effect | Onset | Nominal | Range end |
|---|---:|---:|---:|
| Vibrato | 0 | minimal | 5 |
| Flange | 0 | 1 | 10 |
| Chorus | 1 | 5 | 30 |
| Doubling | 10 | 20 | 100 |
| Echo | — | 50 | 80 |

The **strong flange zone is the first ~1 ms** of the delay line. Range end sizes the delay-line allocation.

### Worked white-chorus values (p13)

At Fs = 44.1 kHz: tap centre **400 samples**, peak excursion **350 samples**, LFO rate **~0.15 Hz**.

### Definition (p13, §6.1)

> A chorus is **white** when *both* negative feedback *and* all-pass interpolation are used.

Either alone leaves spectral aberration. This is the term of art the DP/4's 8 VOICE CHORUS almost certainly implements.

### Stereo (p13, §6.1)

Two circuits, one per channel, driven by a **quadrature LFO** — 90° relative phase. Creates a moving stereo image from a mono source via the Haas effect. The paper flags Haas as "a persistent source of irritation for recording engineers" and recommends:

- a stereo-field or panning control at the output of any chorus, and
- a user switch to disable quadrature modulation (in-phase; antiphase also useful).

**Flanging is the opposite**: modulate both channels *in phase*, or acoustic mixing in air at the speakers cancels the comb filtering. Flangers also benefit from a mild memoryless nonlinearity placed *before* the whole effect, so the troughs have richer material to cut into. For maximum trough depth in flange, `blend` must equal `feedforward`.

---

## 5. Pitch change vs pitch shift (p22–p23, §6.2.12)

Genuinely different machines, routinely conflated:

- **Pitch change** (Fig. 51b) — read the delay line at a rate ≠ 1. Pitch and run time both move. This is what a sampler does per key. Cheap: it is just `i.frac` advancing linearly. `i.frac = NOMINAL_DELAY + (1 − ratio)·n`, which is why it eventually runs off the end of the line and *cannot be used indefinitely* (p4).
- **Pitch shift** (Fig. 52b) — pitch moves, run time preserved. Requires a **splicer**: jump the read pointer periodically, with jump targets chosen by a high-speed autocorrelator seeking periodicity in the delay-line contents, crossfading across the jump with **two quadrants of a raised cosine** (footnote 104, p22).
- **Time compansion** (Fig. 52a) — the converse: run time moves, pitch preserved.

**Delay budget** (p23): polyphonic material needs as much as **60 ms** of nominal transport delay through the line for pitch shift or compansion to work well — "easily perceptible, and a compromise is nearly always necessary". Vibrato needs only about **1 ms**.

> **For the build:** the DP/4's four pitch algorithms (FAST PITCH SHIFT, PITCH SHIFT 2U, PITCHSHIFT-DDL, PITCH SHIFTER) almost certainly split along this line — "FAST" suggesting the cheap pitch-change path, the others the splicer. Confirm against the manual before implementing. The splicer's autocorrelator is the piece Web Audio cannot express natively and that forces an AudioWorklet.

---

## 6. What this gives the rebuild

Directly implementable, in rough order of value:

1. **One `DelayModulator` primitive** — delay line, LFO, interpolation mode (linear / all-pass / warped all-pass), tap centre, width. Everything in Table 6 is this primitive plus three gains.
2. **Table 6 as literal preset data** — five effects fall out of one circuit with no new DSP.
3. **All-pass interpolation with the warped coefficient** as the default for chorus and flange, since transparency is the requirement for both.
4. **Quadrature LFO** for stereo, with an in-phase/antiphase switch, and a panner after the chorus.
5. **The pitch-shift splicer** as a separate, later, AudioWorklet-only piece.

### Caveats the paper is explicit about

- Never feed back a modulated tap. Feed back from a fixed tap at the same centre.
- Linear interpolation in a multi-voice chorus is audibly a low-pass filter, per voice.
- A triangular LFO gives piecewise-constant instantaneous frequency, which the paper calls "unnatural" (p4). Use sinusoidal.
- Doubling wants **randomised** modulation, not sinusoidal (footnote 84, p12).

---

## Related notes

- [`README.md`](README.md) — index, and the note about Part 1 being absent
- [`dattorro-hifi-recursive-filters.md`](dattorro-hifi-recursive-filters.md) — same author on the filter implementation these circuits sit inside
