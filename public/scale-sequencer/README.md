# SCALE SEQUENCER / TUNING MODULE AND SYNTH PROTOTYPE

![GitHub Pages](https://img.shields.io/github/deployments/rjvaleo/scale-sequencer/github-pages?label=GitHub%20Pages&logo=github)
![License](https://img.shields.io/github/license/rjvaleo/scale-sequencer)
![JavaScript](https://img.shields.io/badge/JavaScript-ES2022-F7DF1E?logo=javascript&logoColor=black)
![Web Audio API](https://img.shields.io/badge/Web%20Audio%20API-native-4A90D9?logo=webaudio)
![HTML5](https://img.shields.io/badge/HTML5-semantic-E34F26?logo=html5&logoColor=white)
![CSS3](https://img.shields.io/badge/CSS3-custom%20properties-1572B6?logo=css3&logoColor=white)
![No Dependencies](https://img.shields.io/badge/dependencies-none-brightgreen)
![PWA Ready](https://img.shields.io/badge/PWA-ready-5A0FC8?logo=googlechrome)

A browser-based microtonal step sequencer and synthesizer with true-pitch tuning, built entirely on the Web Audio API — no frameworks, no build tools, no dependencies. Runs offline and deploys to GitHub Pages.

<img width="1522" height="833" alt="Screenshot 2026-04-06 at 10 30 12 AM" src="https://github.com/user-attachments/assets/234ba1f2-4f5a-4707-b5f5-1bbbd8f1f990" />


**[→ Live Demo](https://rjvaleo.github.io/scale-sequencer/)**

---

## Features

### Sequencer

- **1–16 steps** with per-step degree and octave control
- **BPM**: 40–240, continuously adjustable
- **Step length**: 1/16, 1/8, 1/4, or 1/2 note
- **Playback directions**: Forward, Reverse, Ping-Pong, Random
- **Per-step controls**: degree ▲▼, octave ▲▼, rest toggle, preview (click during playback)
- **Position display**: beat/step counter in transport bar

### Synthesizer

- **Oscillator types**: Sine, Triangle, Sawtooth, Square, **Pulse/PWM**
  - PWM uses a 256-harmonic Fourier synthesis to model true variable pulse width
  - Base pulse width knob (10–90% duty cycle)
- **Amplitude ADSR envelope**: Attack, Decay, Sustain, Release with live canvas visualization
- **Master volume**

### Filter

- **12dB/octave Low-Pass Filter** (Web Audio BiquadFilter)
- **Cutoff**: 20Hz–20kHz, logarithmic scale
- **Resonance (Q)**: 0.1–20
- **Filter ADSR**: independent Attack, Decay, Sustain, Release, and Amount for per-note filter sweeps
- **Key Follow**: 0–100% — cutoff tracks note pitch relative to C4

### Modulation

- **LFO 1** (filter modulation): Rate 0.05–20Hz, Depth 0–100%, waveform select (Sine/Triangle/Sawtooth/Square), live canvas
- **LFO 2** (PWM modulation): independent Rate/Depth/waveform, active only when Pulse wave is selected

### Delay

- **Tempo-synced ping-pong stereo delay**
- **Time divisions**: 1/16, 1/8 (dotted), 1/8, 1/4 (dotted), 1/4, 1/2
- **Feedback**: 0–100%
- **Wet/Dry**: 0–100%
- **Stereo Spread**: 0–100%
- **Hi-Cut filter** on the feedback path: 200Hz–20kHz
- Live ping-pong canvas showing delay path and timing

### Reverb

- **Cathedral-scale Schroeder reverb** running in parallel with the delay
- **Algorithm**: 6 parallel comb filters (each a `delay → lowpass damp → feedback gain` loop) → 2 all-pass diffusers → stereo spread panners
- **Decay**: 0.5s–30s RT60 — true cathedral scale
- **Pre-Delay**: 0–150ms — adds sense of physical distance before the tail
- **Damp**: 500Hz–20kHz hi-cut on every comb — controls brightness of the tail
- **Shimmer**: slow triangle LFO sweeps the output diffuser frequency for a lush, animated quality
- **Spread**: stereo panner pair after the diffusers (0 = mono → 100% = wide)
- **One-click macro presets**: ROOM, HALL, CATH (cathedral), ∞ (infinite wash)
- Unconditionally stable: all feedback gain values hard-capped at 0.97; no modulation inside any feedback loop

### Scale Library — 80+ Tuning Systems

All scales use **true cent values** — not approximated to 12-TET unless the scale is inherently 12-TET.

| Category                          | Examples                                                                                                              |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **Western Diatonic — 12-TET**     | Ionian, Dorian, Phrygian, Lydian, Mixolydian, Aeolian, Locrian                                                        |
| **Western Extended — 12-TET**     | Harmonic/Melodic Minor, Blues, Whole Tone, Diminished, Byzantine, Bebop                                               |
| **Just Intonation — True Ratios** | Pythagorean, Ptolemy's Intense Diatonic, 5-limit, 7-limit, Harmonic Series, Partch 43-Tone                            |
| **Historical Temperaments**       | Meantone, Werckmeister III, Kirnberger III, Vallotti, 19-EDO, 31-EDO, 53-EDO                                          |
| **Microtonal & Contemporary**     | 24-EDO (Quarter-Tone), 17-EDO, 22-EDO, 72-EDO, Wendy Carlos Alpha/Beta, Bohlen-Pierce                                 |
| **Middle Eastern — Maqam**        | Rast, Bayati, Hijaz, Hijaz Kar, Saba, Sikah, Nahawand, Persian Shur/Chahargah/Segah                                   |
| **South & East Asian**            | Ragas (Bhairav/Bhairavi/Yaman/Kafi/Todi), Gamelan Slendro/Pelog, Japanese Hirajoshi/In/Yo, Chinese Gong/Yu, 22-Shruti |

Root note is selectable (A–G#) with octave offset, mapping across all 88 MIDI pitches.

### Presets

- **Save**: captures the full synth/sequencer state with a Vonnegut-inspired auto-generated name (e.g. _"Tralfamadorian Nocturne · 2026-04-04 14:32"_)
- **Recall**: dropdown select instantly restores any saved preset
- **Delete**: removes the selected preset
- **Export**: downloads all local presets as `presets.json`
- **Import**: loads a `presets.json` file, adding only presets with new names (no duplicates)
- **Persistence**: saves to `localStorage` — survives page reloads and browser restarts
- **Default presets**: if `presets.json` exists in the repo root, it is fetched on first load and used as the starting preset bank

---

## Controls Reference

All controls are **rotary knobs** (drag up = increase, drag down = decrease). Touch is supported.

| Section     | Control                       | Range             | Notes                              |
| ----------- | ----------------------------- | ----------------- | ---------------------------------- |
| Transport   | BPM                           | 40–240            |                                    |
| Transport   | STEPS                         | 1–16              |                                    |
| Transport   | DIRECTION                     | fwd/rev/ping/rand |                                    |
| Transport   | STEP LEN                      | 1/16–1/2          |                                    |
| Synth       | ATK                           | 1–2000ms          | Amplitude envelope attack          |
| Synth       | DEC                           | 1–2000ms          |                                    |
| Synth       | SUS                           | 0–100%            |                                    |
| Synth       | REL                           | 1–4000ms          |                                    |
| Synth       | VOL                           | 0–100%            | Master output level                |
| Filter      | CUTOFF                        | 20Hz–20kHz        | Logarithmic                        |
| Filter      | RESO                          | Q 0.1–20          |                                    |
| Filter      | KEY FOLLOW                    | 0–100%            | Pitch-tracks cutoff per note       |
| Filter ADSR | F·ATK / F·DEC / F·SUS / F·REL | ms/%              | Per-note filter automation         |
| Filter ADSR | F·AMT                         | -100–+100%        | Sweep direction and depth          |
| LFO 1       | RATE                          | 0.05–20Hz         | Modulates filter cutoff            |
| LFO 1       | DEPTH                         | 0–100%            |                                    |
| LFO 2       | BASE PW                       | 10–90%            | Pulse width base (Pulse wave only) |
| LFO 2       | RATE                          | 0.05–20Hz         | Modulates pulse width              |
| LFO 2       | DEPTH                         | 0–100%            |                                    |
| Delay       | FEEDBACK                      | 0–100%            |                                    |
| Delay       | WET                           | 0–100%            |                                    |
| Delay       | SPREAD                        | 0–100%            | Stereo separation                  |
| Delay       | HI CUT                        | 200Hz–20kHz       | Logarithmic, feedback path         |
| Reverb      | WET                           | 0–100%            | Mix level into master              |
| Reverb      | DECAY                         | 0.5s–30s          | RT60 — tail length                 |
| Reverb      | PRE-DLY                       | 0–150ms           | Pre-delay before reverb onset      |
| Reverb      | DAMP                          | 500Hz–20kHz       | Hi-cut on all comb feedback paths  |
| Reverb      | SHIMMER                       | 0–100%            | LFO depth on output diffuser       |
| Reverb      | SPREAD                        | 0–100%            | Stereo width of wet signal         |

---

## Shipping Default Presets

The preset bank is local by default. To bundle presets with the deployed app:

1. Build some presets using **+ SAVE**
2. Click **↓ EXPORT** — saves `presets.json` to your downloads
3. Copy `presets.json` into the repo root
4. Commit and push — it will be deployed alongside the app
5. Any visitor with an empty preset bank will auto-load your presets on first visit

```
scale-sequencer/
├── index.html
├── app.js
├── style.css
├── presets.json        ← commit your exported presets here
└── .github/
    └── workflows/
        └── static.yml
```

---

## Architecture

Single-page application — no bundler, no framework, no runtime dependencies.

```
index.html      HTML shell, all layout and knob markup
style.css       All styles — CSS custom properties for theming, rotary knob system
app.js          All JavaScript — ~2000 lines
presets.json    Optional default preset bank (committed to repo)
```

### Audio Graph

```
OscillatorNode (osc)
    └─► GainNode (env — ADSR amplitude)
            └─► BiquadFilter (filterNode — 12dB LP)
                    ├─► GainNode (delayDryGain) ─────────────────────────────────────────────────► GainNode (masterGain) ──► destination
                    ├─► DelayNode (delayL) ◄──── cross-feed ──────────────────────────────────── DelayNode (delayR)
                    │        └─► StereoPanner (panL)                                                   └─► StereoPanner (panR)
                    │                 └─► GainNode (delayWetGain) ──────────────────────────────────────────────────────► masterGain
                    └─► DelayNode (preDelay) ──► GainNode (reverbSend, wet)
                             └─► 6× [DelayNode → BiquadFilter (damp LP) → GainNode (fb) ↩]
                                      └─► GainNode (reverbSum) ──► AllPass[0] → AllPass[1]
                                                                          └─► StereoPanner (L) ──► GainNode (reverbWetGain) ──► masterGain
                                                                          └─► StereoPanner (R) ──┘
```

- LFO 1 output → GainNode (lfoGain) → `filterNode.frequency`
- Filter ADSR automation → `filterNode.frequency` via `linearRampToValueAtTime` per note
- Key-follow multiplier applied to base cutoff before ADSR scheduling
- PWM: 256-harmonic Fourier series built via `PeriodicWave` each time pulse width changes

### Knob System

CSS `--rot` custom property drives a `::after` needle pseudo-element. The IIFE drag handler tracks `mousedown`/`touchstart` on the `.knob` div, computing delta from `dragStartY` at 200px = full range, then dispatches `input` events on the hidden `<input type="range">` for all `oninput` handlers to fire normally.

### Scheduler

Uses the standard Web Audio lookahead scheduler pattern:

- `setInterval` fires every 25ms
- Schedules notes up to 100ms ahead using `audioCtx.currentTime`
- `playNote()` creates a fresh oscillator per note (fire-and-forget), schedules all ADSR automation events at absolute audio timestamps

---

## Deployment

Deployed automatically to GitHub Pages on every push to `main` via `.github/workflows/static.yml`.

To deploy your own fork:

1. Fork the repo
2. Go to **Settings → Pages → Source** → set to **GitHub Actions**
3. Push any commit — the workflow handles the rest

---

## Validation And Regression Tests

The project now includes a browser-based validation suite at [tests/validation.html](tests/validation.html).

It runs regression checks for:

- LFO UI reduction (only LFO 1 and LFO 2 present)
- Fixed-size filter debug readout box
- Metronome toggle button behavior
- Transport counter continuity across rest steps

To run:

1. Open [tests/validation.html](tests/validation.html) in a browser.
2. Wait for the summary banner and pass/fail list.

A successful regression run reports: `Validation suite: 4/4 passed`.

---

## Browser Support

Requires Web Audio API support. Works in all modern browsers:

| Browser              | Support                                          |
| -------------------- | ------------------------------------------------ |
| Chrome / Edge 88+    | ✅ Full                                          |
| Firefox 76+          | ✅ Full                                          |
| Safari 14.1+         | ✅ Full (`webkitAudioContext` fallback included) |
| Mobile Chrome/Safari | ✅ Touch drag on knobs supported                 |

> **Note:** `cancelAndHoldAtTime` is used for glitch-free filter knob movement during automation. It is supported in all Chromium-based browsers and Firefox 90+. Safari falls back gracefully.
