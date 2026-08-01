# Built-in Synth

## Purpose

The built-in Web Audio instrument is the immediate audible monitor for M-Clone.
It is not one of the four later role-specific Classic engines, but it now has a
complete subtractive-synth control surface instead of a fixed triangle tone.
Each of the four sequencer streams owns a separate patch. Note events select
the patch by their zero-based Voice/stream field, so changing Stream 3 cannot
alter the sound, power state, volume, or release behavior of another stream.
Pattern Editor audition follows its selected Voice into the same patch.

The Synth window uses the same draggable auxiliary-window behavior, flat title
chrome, compact labels, 4px placement rules, and light/dark palettes as the
rest of the application. Its shallow hardware-panel organization is inspired
by the supplied Moog Messenger reference without copying its branding or
keyboard. Native CSS dials remain sharp at every application zoom. Their
neutral faces have simple black position indicators; the Synth adds no
background fill beyond the host window's normal light/dark surface.
Faceplate and Synth-title typography is uppercase and 15% smaller than the
earlier layout. Compact inline selects size to their displayed value, keep one
character of padding inside each side of the border, and use centered
abbreviations with no native dropdown caret. They do not stretch across or
cover the adjacent descriptor text. The Mixer reserves padding below its
second control row. Dial rows use aligned caption baselines and explicit gaps,
so captions, adjacent selects, section dividers, and the Output power control
remain separate at the intended 150% working scale without increasing the
366-by-81-pixel faceplate.
Each transparent knob input covers the complete dial-and-caption hit area,
disables text selection, and implements a tested 120px vertical drag sweep.

The panel is 366 logical pixels wide and 81 pixels tall at 100%. It is
deliberately designed for the application's normal 150% working scale. The
wider, shallower faceplate keeps Sub wave on one line while retaining the tight
hardware density. It opens at startup for discovery and remains available from
the Windows menu after being closed.

Four numbered selectors use the global channel palette. Selecting a stream
changes the panel accent and exposes only that stream's patch; the other three
patches remain live and independent while the transport plays.
The selected stream also supplies a thick faceplate border and alternating
section bands, making patch ownership visible without coloring the dials.

## Signal path

Each generated note uses this Web Audio path:

```text
Oscillator 1 ─┐
Oscillator 2 ─┼→ Mixer → Resonant Filter → Amplifier Envelope → Master Gain
Sub oscillator┤                 ↑
Noise ────────┘                LFO
```

The synth remains a consumer of explicit planner Note On/Off events. It does
not change generative timing, MIDI output, Midi View, or Movie recording.

## Controls

- **LFO:** rate, depth, waveform, and pitch/filter/amplifier destination.
- **Oscillators:** two independently tuned and octave-shifted oscillators, four
  waveforms, a selectable sub-oscillator waveform, and glide.
- **Mixer:** independent Oscillator 1, Oscillator 2, sub-oscillator, and noise
  levels.
- **Filter:** low-pass/high-pass/band-pass mode, cutoff, resonance, bipolar
  envelope amount, and keyboard tracking.
- **Filter Envelope:** attack, decay, sustain, and release.
- **Amplifier Envelope:** attack, decay, sustain, and release.
- **Output:** power, master gain, and velocity sensitivity.

All values pass through the pure `normalizeSynthSettings` boundary before the
audio adapter receives them. This keeps UI, runtime, and future document/native
adapters on the same ranges.

## Sixteenth-note click correction

The former adapter started notes with a short ramp but released them using the
current `AudioParam.value`, which is not a reliable representation of a
scheduled envelope. Fast retriggers could expose abrupt discontinuities.

The new adapter:

- schedules complete attack/decay/sustain curves;
- uses `cancelAndHoldAtTime` when ending an in-flight envelope, with a safe
  fallback for older implementations;
- exponentially releases amplifier gain to a nonzero floor before stopping the
  oscillator;
- applies the same held/released behavior to filter cutoff;
- enforces a minimum 3 ms attack and 15 ms release;
- ships with a 10 ms attack and 50 ms amplifier release.

This keeps repeated sixteenth-note attacks responsive while removing the hard
edges that caused the audible clicks.

## State and remaining instrument work

The four Synth patches currently live in application state and reset with
New/Open.
They are deliberately not inserted into `ProjectDocumentV2` without a format
version decision. The later Classic instrument milestone still owns the four
role-specific drum, bass, lead, and chord/pad engines plus effects and mixing.
