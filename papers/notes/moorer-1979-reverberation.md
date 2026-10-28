# About This Reverberation Business

**James A. Moorer**. *Computer Music Journal* **3**(2), 1979 June, pp. 13–28.

- **Source PDF:** [`../About_This_Reverberation_Business.pdf`](../About_This_Reverberation_Business.pdf) · **extracted text:** [`../text/About_This_Reverberation_Business.txt`](../text/About_This_Reverberation_Business.txt)
- Page cites are **PDF pages**, marked `=== [pN] ===` in the extracted text.

The foundational artificial-reverberation paper. Everything in the FDN and plate literature that came later is a reaction to what is set out here. Its lasting value for us is that it gives **concrete, measured parameter values** rather than only topology — the numbers below can be typed straight into a module.

---

## 1. The two unit reverberators (p2, Fig. 1)

Schroeder's primitives, which every recirculating reverb is built from:

- **One-multiply all-pass** (Fig. 1a) — `|g| < 1` for stability
- **Comb filter** (Fig. 1b)

Moorer is careful about a point that is widely misread:

> The all-pass nature "is more of a mathematical property than a perceptual one" (p2). A flat magnitude response does **not** make the filter perceptually transparent; its phase response can be quite complex. All-pass only means that *in the long run*, with sufficient averaging, the energy is uniform.

Both primitives, used alone, sound bad. The design problem is how to combine them.

### Schroeder's two combinations (p3, Fig. 2)

- **Fig. 2a** — series all-passes plus a proportion of the direct signal. Note the all-pass also feeds the input through scaled by `g`, so the total direct signal is more than it appears.
- **Fig. 2b** — **four combs in parallel, followed by two all-passes in series.** This is the classic, and the one Moorer builds on.

All delay lengths should be **mutually prime** (p3) — the same reasoning our FDN already uses.

---

## 2. Moorer's contribution: a low-pass inside the comb loop (p7, Fig. 5)

The single change that made this design sound like a room rather than a machine. A one-multiply low-pass filter goes **inside each comb's feedback loop**, simulating the frequency-dependent absorption of air.

**The stability trick** (p7): set the loop's two gains as

```
g₂ = g · (1 − g₁)
```

with `g` in 0…1. This makes the filter **unconditionally stable** and gives a parameter in the familiar 0–1 range. `g` alone then sets the overall reverberation time; `g₁` sets the air-absorption roll-off.

Benefits Moorer reports beyond realism (p7):
- **loss of sensitivity to the exact delay length** — a robustness win worth having
- better behaviour on short impulsive sounds: each echo is smeared by the simulated air transmission rather than staying a discrete impulse, so the sparse early period is masked

**Bass ratio** (p7): Beranek's criterion for "good" concert-hall bass is that reverberation time at 125 Hz over mid-frequency reverberation time (mean of 500 and 1000 Hz) exceeds unity. The LP-in-loop comb gives ≈ **1.02** for any positive `g₁`, which Beranek calls customary for a good hall. Free, from the topology.

---

## 3. Table 2 — the numbers (p7–p8)

Six combs, each with a low-pass in the loop, followed by **one** all-pass. All-pass: **6 ms delay, gain ≈ 0.7**.

| | Delay (ms) | `g₁` @ 25 kHz | `g₁` @ 50 kHz |
|---|---:|---:|---:|
| Comb 1 | 50 | 0.24 | 0.46 |
| Comb 2 | 56 | 0.26 | 0.48 |
| Comb 3 | 61 | 0.28 | 0.50 |
| Comb 4 | 68 | 0.29 | 0.52 |
| Comb 5 | 72 | 0.30 | 0.53 |
| Comb 6 | 78 | 0.32 | 0.55 |

Each comb's loop gain is `g₂ = g·(1 − g₁)`, where **`g` is the same for every comb** and `g₁` differs per comb. **`g ≈ 0.83` gives about 2.0 s reverberation time** with these delays.

Delays are distributed **linearly over a ratio of 1 : 1.5**.

### Tuning rules Moorer gives explicitly (p8)

- If one comb's pitch dominates the decay, **reduce that comb's `g`**.
- With **fewer than six combs** you can never find gains that fully mask individual comb pitch. With **more than six combs, or more than one all-pass, the improvement is unnoticeable.** Six and one is the knee of the curve.
- **The all-pass delay is tightly constrained to ~6 ms.** Too short and background noise gets an annoying "puff-puff"; any click acquires its own impulse response "sounding not unlike a very quiet cymbal crash". Longer than 6 ms and you hear an audible repetition period.
- Comb delays as short as **10–15 ms** still work — density and naturalness hold up, though "one might well imagine that one were inside a garbage can rather than the Symphony Hall".
- More complicated in-loop filters "do not seem to add anything" beyond simulating specific wall or audience absorption.

### Air absorption (p6–p7, Table 1)

Table 1 (from Kuttruff 1973) gives absorption coefficients against **humidity**. `g₁` values were fitted by Marquardt optimisation against measured data, at 10/25/50 kHz and four humidities. Moorer's own caveat: a first-order low-pass cannot really match air absorption, so these are **guideline values only**.

To derive `g₁` for an arbitrary delay: convert the delay to metres using the speed of sound, **344.8 m/s at 22 °C and 751 mmHg**, then read `g₁` off Fig. 6 for your sample rate and humidity, interpolating between rates.

---

## 4. Early reflections (p3, Fig. 3)

Moorer records Schroeder's 1970 approach: derive the room's impulse response, then convolve. That is convolution reverb, covered in [`shenhuy-convolution-reverb.md`](shenhuy-convolution-reverb.md). The paper also discusses image-source "phantoms" up to the fifth bounce (p~13) for computing early reflection patterns geometrically.

---

## 5. What this gives the rebuild

Immediately usable:

1. **A complete, tuned Moorer reverb** — Table 2 above is a working module with no design work left. Six combs with in-loop damping, one 6 ms / 0.7 all-pass, `g ≈ 0.83` for 2 s.
2. **`g₂ = g(1 − g₁)`** as the stability-by-construction pattern for any damped feedback loop. Worth adopting in our FDN, where decay and damping are currently set independently and could in principle be pushed into instability together.
3. **The six-comb / one-all-pass knee** — a concrete answer to "how many lines is enough", which our FDN currently answers with 8 by assertion.
4. **The 6 ms all-pass constraint**, with both failure modes named. Our diffuser stages are shorter than this; the "puff on transients" symptom is the thing to listen for.
5. **The bass-ratio check (≈1.02)** as an objective test for a reverb module — measurable from an impulse response, so it could be an actual test rather than a listening note.

### How this relates to what we have

Our [`reverbTank.ts`](../../src/modular/audio/reverbTank.ts) is an FDN with a Householder mixing matrix — a *later* design than Moorer's parallel combs, and better in that all lines mix into all lines rather than staying independent. But Moorer's in-loop damping, his stability parameterisation, and his measured air-absorption coefficients all transfer directly, and his tuning rules are more concrete than anything we currently have written down.

---

## Related notes

- [`README.md`](README.md) — index
- [`dornean-artificial-reverberation.md`](dornean-artificial-reverberation.md) — a modern re-implementation of exactly these Schroeder/Moorer structures
- [`smith-waveguides.md`](smith-waveguides.md) — the waveguide/FDN generalisation that superseded parallel combs
