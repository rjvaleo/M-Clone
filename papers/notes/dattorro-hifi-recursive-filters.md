# The Implementation of Recursive Digital Filters for High-Fidelity Audio

**Jon Dattorro**, ENSONIQ Corporation, Malvern PA. *J. Audio Eng. Soc.* **36**(11), 1988 November, pp. 851–878.

- **Source PDF:** [`../HiFi.pdf`](../HiFi.pdf) · **extracted text:** [`../text/HiFi.txt`](../text/HiFi.txt)
- Page cites are **PDF pages**, marked `=== [pN] ===` in the extracted text. Journal folios run 851–878.

**Provenance:** written at ENSONIQ — the company that built the DP/4+ — by one of the DP/4+ manual's authors, nine years before the Effect Design papers. This is the house filter doctrine the machine was built on.

**Scope note before you read further.** Roughly half this paper is about **fixed-point arithmetic**: truncation noise, error feedback, coefficient residual coding, two's-complement modulo behaviour. Web Audio runs float32/float64, so that half does not transfer directly. What *does* transfer is the topology reasoning, the unity-gain design philosophy, and the cascade guidance — and all of it becomes live again the moment we write an AudioWorklet, or if this is ever ported to fixed-point hardware. I have marked each section accordingly.

---

## 1. Topology — **applies to us** (p3–p7, §0.4, §1)

The paper's headline conclusion is blunt and against the textbook default:

| Topology | Verdict |
|---|---|
| **Direct form I**, noncanonic (Fig. 1) | **Use this for audio** |
| Direct form II, canonic (Fig. 2) | *"not for audio use"* |
| Direct form II transpose (Fig. 3a) | usable for audio |
| Direct form I transpose (Fig. 3b) | *"not for audio use"* |

Direct form II is the historically preferred choice because it is canonic — it uses the minimum number of delay elements. The paper's argument is that this is the wrong thing to optimise:

> "Why choose a topology which might require more computation or more storage? The answer has to do with numerical inaccuracy. Certain topologies react better than others to numerical errors." (p3)

**The scaling argument (p3, §0.4.1).** Direct form II needs its *input* attenuated so internal nodes do not overflow, even when the output node was never in danger. Input scaling irrevocably costs SNR. An analog filter can absorb that because it starts from ~120 dB; a 16/32-bit digital filter starting from ~90 dB cannot. The paper's verdict:

> "any 16/32-bit digital implementation employing input scaling is inadequate for high-fidelity digital audio."

Direct form I sidesteps it: its only overflow-sensitive nodes are the multiplier inputs, and intermediate sums may legally overflow (Jackson's Rule, p7 Fig. 5) provided the final result lands back in the first modulo.

> **For our build:** in float64 the overflow argument evaporates, but the *ordering* conclusion survives — direct form I keeps the recursive accumulation away from the signal path in a way that is easier to reason about. Web Audio's `BiquadFilterNode` specifies only the difference equation, not the topology, so we do not control this for native nodes. It matters for anything we write in a worklet.

---

## 2. Unity-gain design — **applies to us, and we should adopt it** (p7–p8, §1.2)

> "By the term unity gain filter we mean a filter that is designed as a **deviation from unity**."

Design every filter so its magnitude response departs from 1.0 rather than from some arbitrary level, and the scaling problem disappears along with a class of gain-staging bugs. Three qualifications the paper insists on:

1. **Boost filters are still fine** (§1.2.1). A boost above unity is legitimate; it is the user's responsibility not to overdrive the boosted band, exactly as with an analog filter. Do not "fix" this by scaling the input globally.
2. **Unity gain does not guarantee no overflow** (§1.2.2). There exist well-behaved non-sinusoidal inputs that push a unity-gain filter past unity — the time-reversed impulse response of the filter fed back into itself is the standard counterexample (matched filters).
3. Therefore: **detect overflow at the output per sample and saturate**, rather than trusting the design.

> **For our build:** point 3 is already how [`masterChain.ts`](../../src/modular/audio/masterChain.ts) is justified — an always-on limiter at the end because design intent is not a guarantee. This paper is the citation for that reasoning. Point 1 argues *against* silently attenuating to make headroom, which is worth remembering when the widener or the FDN tempts us to normalise.

---

## 3. High-order filters — **applies to us** (p4, §0.4.2)

- Build high-order filters as **cascades of second-order sections (biquads)**, never as a direct high-order form. Direct high-order forms produce "geometric increases in the range of coefficient values, pole-zero sensitivity, and truncation noise recirculation".
- **Cascade vs parallel:** parallel realisations are sometimes *less noisy*, but have "very high zero sensitivity to coefficient quantization", so cascades are usually preferable. Cites Jackson for closed-form scaling and pole-zero-pairing procedures.
- Convention the paper records: **graphic equalizers** are traditionally parallel second-order stages; **parametric equalizers** are cascades.
- The one direct high-order topology that escapes *both* scaling and truncation-noise recirculation is the **Gray–Markel all-pole four-multiplier ladder** (Fig. 4e).
- All second-order coefficients are bounded in magnitude by 2 (eq. 30).

> **For our build:** our `m.audio-eq` is a three-stage cascade (lowshelf → peaking → highshelf), which matches the parametric convention. If we ever add a graphic EQ, this says to consider parallel — and to expect worse coefficient sensitivity if we do.

---

## 4. Truncation noise and error feedback — **does not apply directly** (p8–p20, §2)

Substantial and rigorous, and largely moot in float64. Recorded here so we know what is in the paper rather than rediscovering it:

- §2.1 low-signal-level aberrations; §2.2 truncation error math; §2.3 first-order error feedback (Fig. 9)
- §2.4 second- and higher-order error feedback, with **Table 1: error feedback zeros** — the coefficient sets that place the noise-shaping zeros, without altering the filter transfer function at all
- §2.5 / §2.6 truncation error *cancellation*
- §2.7 the truncation noise spectrum E(z); §2.8 physical measurements (Table 2, measured on a Sony PCM 701)
- §3 residual coding of coefficients

**The one transferable idea:** error feedback shapes quantisation noise *without changing the filter's transfer function*. If we ever quantise — a bitcrusher is exactly this, deliberately — Table 1 is the reference for shaping the artefact rather than accepting it flat. Our `crushCurve` in [`dsp.ts`](../../src/modular/audio/dsp.ts) currently does not noise-shape; this paper is where to look if we want a "smooth" crusher, which is what [`AUDIO_ENGINE_SPEC.md`](../../docs/AUDIO_ENGINE_SPEC.md) §12 asks for.

**Also relevant to limit cycles:** truncation in a recursive loop is what produces limit cycles — self-sustaining oscillation at low signal levels. Our FDN reverbs are recursive loops. In float64 this is not a practical risk, but Smith's STAN-M-39 devotes a section to limit-cycle elimination in waveguide structures; see [`smith-waveguides.md`](smith-waveguides.md).

---

## 5. What this gives the rebuild

1. **Cascade biquads, direct form I**, for anything we hand-write. Never a direct high-order form.
2. **Design filters as deviations from unity** and let the master limiter be the safety net, rather than scaling inputs defensively.
3. **Don't normalise to buy headroom.** The paper's position is that a boost is legitimate and the user owns the overdrive. (Our un-normalised convolver in `effects.ts` already follows this, for a related reason.)
4. **Parametric EQ = cascade, graphic EQ = parallel**, with the coefficient-sensitivity caveat.
5. **Table 1 (error feedback zeros)** is the reference if the Smooth Crusher ever wants shaped quantisation noise instead of flat.

---

## Related notes

- [`README.md`](README.md) — index
- [`dattorro-effect-design-part2.md`](dattorro-effect-design-part2.md) — same author, the delay-modulation effects that sit on top of these filters
- [`smith-waveguides.md`](smith-waveguides.md) — limit cycle elimination in recursive structures
