# Built-in Synth

## Purpose

The built-in Web Audio instrument is the immediate audible monitor for M-Clone.
It is not one of the four later role-specific Classic engines, but it now has a
complete subtractive-synth control surface instead of a fixed triangle tone.

The Synth window uses the same draggable auxiliary-window behavior, flat title
chrome, compact labels, 4px placement rules, and light/dark palettes as the
rest of the application. Its shallow hardware-panel organization is inspired
by the supplied Moog Messenger reference without copying its branding or
keyboard. Native CSS dials remain sharp at every application zoom.

The panel is only 310 logical pixels wide at 100%. It is deliberately designed
for the application's normal 150% working scale, where it remains readable and
fits to the right of the permanent modules without clipping. It opens at
startup for discovery and remains available from the Windows menu after being
closed.

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

Synth settings currently live in application state and reset with New/Open.
They are deliberately not inserted into `ProjectDocumentV2` without a format
version decision. The later Classic instrument milestone still owns the four
role-specific drum, bass, lead, and chord/pad engines plus effects and mixing.
