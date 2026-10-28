# Effect Design, Part 1: Reverberator and Other Filters

**Jon Dattorro**, CCRMA Stanford. *J. Audio Eng. Soc.* **45**(9), 1997 September, pp. 660–684.

- **Source PDF:** [`../EffectDesignPart1.pdf`](../EffectDesignPart1.pdf) · **extracted text:** [`../text/EffectDesignPart1.txt`](../text/EffectDesignPart1.txt)
- Page cites are **PDF pages**, marked `=== [pN] ===`. Journal folios run 660–684. **Fig. 1 is on PDF p3.**

**This is the paper.** The plate reverberator below is the most-implemented reverb topology of the last thirty years, and it is by one of the four authors of the DP/4+ reference manual. The DP/4's `SMALL PLATE` and `LARGE PLATE` algorithms are this design. Everything here is specified precisely enough to build from without a single design decision left open.

---

## 1. The topology (p3, Fig. 1)

```
xL ─┐
    ├─►(Σ)─►(×½)─► predelay ─►(×bandwidth)─►(Σ)─► [input diffusers] ─► tank
xR ─┘                                        ▲ └─(×(1−bandwidth))◄─ z⁻¹ ─┘
```

Stereo in is summed to **mono** at the input (`×½`) — the stereo image at the output is synthetic, produced entirely by the output tap structure. Predelay is `z⁰ → z⁻∞`, i.e. freely variable from zero.

Then a one-pole low-pass (**bandwidth**), four **input diffusers** in cascade, and the **tank**: a global figure-eight of two mirrored halves that feed each other.

### Delay-line lengths, in samples @ **Fs = 29761 Hz**

**Input diffusers** — all-pass lattices, in cascade order:

| Stage | Delay | Coefficient |
|---|---:|---|
| 1 | **142** | input diffusion 1 |
| 2 | **107** | input diffusion 1 |
| 3 | **379** | input diffusion 2 |
| 4 | **277** | input diffusion 2 |

**Tank — left half:**

| Element | Delay | Note |
|---|---:|---|
| decay diffusion 1 | **672 + EXCURSION** | **modulating** (node 24), *negative* coefficient |
| delay | **4453** | node 24→30, then `×(1−damping)` → damping one-pole → `×decay` |
| decay diffusion 2 | **1800** | nodes 31→33 |
| delay | **3720** | nodes 33→39, then `×decay`, crosses to the right half |

**Tank — right half:**

| Element | Delay | Note |
|---|---:|---|
| decay diffusion 1 | **908 + EXCURSION** | **modulating** (node 48), *negative* coefficient |
| delay | **4217** | node 48→54, then `×(1−damping)` → damping one-pole → `×decay` |
| decay diffusion 2 | **2656** | nodes 55→59 |
| delay | **3163** | nodes 59→63, then `×decay`, crosses to the left half |

The two halves are cross-coupled: left's output (node 39) feeds the right half's input, right's output (node 63) feeds the left's. That is the "global figure eight" (p4).

> **Note the sign.** Fig. 1 marks *"note sign"* on both `decay diffusion 1` lattices — those coefficients are **negative**. Making a lattice's coefficients negative changes the impulse response character (multiplies it by `(−1)^(n−1)`) without destroying the all-pass transfer, and the paper says this is *deliberately exploited* to sharpen the distinction between the two pairs of tank diffusers (p5, §1.3.3).

---

## 2. Table 1 — default parameters (p4)

| Parameter | Default | Meaning |
|---|---:|---|
| Sample rate | **29761 Hz** | the rate all the delay lengths above assume |
| `EXCURSION` | **16** | max peak sample excursion of delay modulation |
| `decay` | **0.50** | rate of decay |
| `decay diffusion 1` | **0.70** | controls density of tail |
| `decay diffusion 2` | **0.50** | decorrelates tank signals |
| `input diffusion 1` | **0.750** | decorrelates incoming signal |
| `input diffusion 2` | **0.625** | " |
| `bandwidth` | **0.9995** | HF attenuation on input; full bandwidth = 0.9999999 |
| `damping` | **0.0005** | HF damping in tank; no damping = 0.0 |

**Coupling rule, from Table 1's own footnote:**

```
decay diffusion 2 = decay + 0.15,  floored at 0.25, ceilinged at 0.50
```

So `decay diffusion 2` is *not* independent — it tracks decay. This is the kind of detail that separates a working plate from one that sounds almost right.

Coefficient range for all lattices and both one-poles: **0.0 to 0.9999999**. Exceeding 1.0 is unstable.

---

## 3. Table 2 — output taps (p6)

Both outputs are **all wet**, every tap scaled by **0.6**, with a specific and non-obvious sign pattern. `nodeA_B[i]` means "tap `i` samples into the delay line running from node A to node B".

**Left:**
```
yL  =  0.6·node48_54[266]  + 0.6·node48_54[2974]
     − 0.6·node55_59[1913] + 0.6·node59_63[1996]
     − 0.6·node24_30[1990] − 0.6·node31_33[187]
     − 0.6·node33_39[1066]
```

**Right:**
```
yR  =  0.6·node24_30[353]  + 0.6·node24_30[3627]
     − 0.6·node31_33[1228] + 0.6·node33_39[2673]
     − 0.6·node48_54[2111] − 0.6·node55_59[335]
     − 0.6·node59_63[121]
```

Seven taps each, mirrored across the two tank halves — left reads mostly from the right half and vice versa. **This tap structure is what makes it a plate** (p6, §1.3.6) and what creates the stereo image from a mono tank.

> The first left tap prints as `node48_54[1266]` in the extracted text; the leading `1` is an OCR-ish artefact of the PDF's text layer. Cross-check against the PDF before implementing — the value is within bounds either way (4217 > 2974 > 1266 > 266).

---

## 4. Why each piece is there

**Input diffusers** (p4, §1.3.1) — decorrelate the incoming signal before it reaches the tank, so tank recirculation does not become audible as "strong cyclic events". Especially important for percussive material. Think of it as phase randomisation to reduce peakedness. Zero coefficients = no diffusion; near-unity = **buzzing local to that all-pass**. Optimum is nearer 0.5 than either extreme. The Table 1 values were found **by trial and error** — the paper says so plainly.

**Tank** (p4, §1.3.2) — traps sound in the figure-eight. With decay near 1.0 and damping off, sound is held indefinitely (a usable effect in itself), but the looping pattern becomes audible unless the tank diffusers metamorphose it. The paper is candid that the tank diffusers are signal-dependent and "everything must be set by ear".

**All-pass lattice topology** (p5, §1.3.3) — each diffuser is a **two-multiplier lattice**. Both coefficients within a lattice must stay identical or the all-pass transfer breaks. Chosen for efficiency. Warning: this topology **clips prematurely at internal nodes**, so a full-scale signal must not be presented to a lattice input at all frequencies.

**Delay modulation** (p6, §1.3.7) — only the two `decay diffusion 1` lines modulate, at **~1 Hz** and a peak excursion of about **8 samples** at 29.8 kHz (footnote 14 — note this is half the `EXCURSION = 16` of Table 1, which is the *maximum*). Its job is to raise the effective number of resonances; without it "the imaginary space… [is] enclosed by a picket fence". A godsend on drums; on piano the resulting vibrato "may be objectionable".

Ideally *all* tank delay lines would modulate at different rates and depths. When compute is constrained, modulate the earliest stereo pair — which is what Fig. 1 does — using the same rate and depth for both but a **quadrature oscillator** to decorrelate them.

Use **all-pass interpolation**, not linear: linear interpolation is a time-varying low-pass and would add unaccounted damping to the tank. The required pitch change is microtonal, which is exactly all-pass interpolation's sweet spot. See [`dattorro-effect-design-part2.md`](dattorro-effect-design-part2.md) §3.

**Damping filters** (p5, §1.3.5) — three single-pole low-passes (one bandwidth, two tank damping), implemented **direct form I** so they never clip prematurely at any node. The paper cites its own earlier work for this — see [`dattorro-hifi-recursive-filters.md`](dattorro-hifi-recursive-filters.md). Note the *inverse* sense of the two coefficients: bandwidth tracks cutoff frequency, whereas **damping is high when the damping filter's cutoff is low**.

Because they are low-pass, any zero-input limit cycles land at DC rather than as tones. Were they high-pass, limit cycles would appear at Nyquist — audible.

**Magnitude truncation** (p5, §1.3.4) — fixed-point only, but the reasoning is worth knowing. Lattices produce **zero-input limit cycles**: low-level tones persisting after the input is removed, a multiplicity of which is heard as "a whooshing ocean noise floor". Truncating toward zero on writes to delay memory suppresses them and can drop the network noise floor by **12–24 dB**, at a cost of 0–6 dB worse THD+N. Only recursive circuits need it. In float64 this is not a live concern.

---

## 5. What this gives the rebuild

This is a **drop-in specification**. Nothing needs designing:

1. **Build `m.audio-plate` directly from Fig. 1** — four input all-pass lattices (142, 107, 379, 277), a two-half tank with the delays tabulated above, three one-pole filters, and Table 2's fourteen output taps.
2. **Scale the delays for the sample rate.** Every length assumes 29761 Hz. At 48 kHz multiply by 48000/29761 ≈ 1.613; at 44.1 kHz by ≈ 1.482. The paper's structure survives rescaling — the *ratios* are what matter.
3. **Table 1 is the preset**, including the `decay diffusion 2 = clamp(decay + 0.15, 0.25, 0.50)` coupling.
4. **Get the signs right** — negative coefficients on both `decay diffusion 1` lattices, and Table 2's mixed-sign taps. Both are easy to miss and both matter.
5. **All-pass interpolation on the two modulating taps**, ~1 Hz, ~8 samples, quadrature between the pair.

### How this compares to what we have

Our [`reverbTank.ts`](../../src/modular/audio/reverbTank.ts) is a **Householder FDN** — a different and more general family. This plate is a *cascade of all-pass lattices in a figure-eight*, which is cheaper, has a very different character (instantaneous high density, randomisation only in the phase trail — p4 §1.2), and is what the DP/4's plate algorithms actually are.

**These should be separate modules, not one parameterised module.** Our current `m.audio-dp4-reverb` treats `small-plate` and `large-plate` as two of five FDN presets. Per this paper that is the wrong lineage: the plate class is a distinct topology, and the paper is explicit that engineers choose plates precisely *because* the reflection density does not take time to build.

---

## Related notes

- [`README.md`](README.md) — index
- [`dattorro-effect-design-part2.md`](dattorro-effect-design-part2.md) — Part 2, the all-pass interpolation this reverb's modulation depends on
- [`dattorro-effect-design-part3.md`](dattorro-effect-design-part3.md) — Part 3, the quadrature LFO that drives it
- [`dattorro-hifi-recursive-filters.md`](dattorro-hifi-recursive-filters.md) — why the one-poles are direct form I
- [`moorer-1979-reverberation.md`](moorer-1979-reverberation.md) — the earlier comb/all-pass lineage this departs from
