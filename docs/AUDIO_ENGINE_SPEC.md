# Audio Instruments and Signature Effects Specification

**Status:** approved Studio product direction; not currently implemented except
the prototype Web Audio synth  
**Last updated:** 2026-08-01

This document defines the intended audio identity of M Studio and the constrained
audio scope of M Classic Web. Platform and plug-in details are in
[`NATIVE_PLUGIN_SPEC.md`](./NATIVE_PLUGIN_SPEC.md).

## 1. Audio identity

M Studio should sound recognizably like RJ Vallejo. Its source library will be
derived from sounds associated with the classic RJ Vallejo *September* release,
subject to documented ownership and collaborator clearance. The library is not
generic factory content; it is part of the product identity.

Signature processing includes:

- granular stutters and glitches;
- a smooth, musical bit/sample-rate crusher;
- lush, wide spatial enhancement and reverb;
- tempo-aware delay;
- controlled random variation;
- complete-song capability without third-party instruments.

## 2. Edition scope

### M Classic Web

Four lightweight engines:

1. simple drum sample player;
2. simple monophonic bass;
3. simple lead;
4. simple polyphonic chord/pad player.

One stereo mix with basic reverb and delay. The web instruments are writing and
audition tools; complete MIDI compatibility remains the core promise.

### M Studio

Seven full instruments:

1. 12-pad drum sampler;
2. monophonic bass synth;
3. Blip lead synth;
4. polyphonic FM chord synth;
5. polyphonic virtual-analog chord synth;
6. *September* pad sampler;
7. granular sample instrument.

## 3. Shared engine contract

The generative engine remains independent of synthesis:

```text
M planner → explicit musical events → routing → instrument rack → effects → audio
                          └────────────→ external MIDI
```

Audio enabled/disabled must never change generated MIDI. Internal and external
destinations can run simultaneously. Instruments consume explicit events and
must not read React/Zustand state from a real-time thread.

Each parameter requires:

- stable ID;
- normalized automation representation;
- display conversion and unit;
- default, minimum, and maximum;
- smoothing rule;
- preset serialization;
- host automation policy;
- real-time safety classification.

## 4. Twelve-pad drum engine

### Core

- 12 sample pads.
- Per-pad sample, level, pan, tune, start/end, attack, hold, decay, filter,
  drive, velocity response, mute, solo, and output.
- Stable note-to-pad mapping.
- Optional layers or round-robin variants.
- At least four choke groups.

### Deterministic variation

- bounded pitch variation;
- decay/length variation, especially for hats;
- velocity and sample-start variation;
- alternate-sample selection;
- probability.

All project-driven random decisions use deterministic seeded streams. Reopening
or offline-rendering the same project produces the same result unless the user
explicitly requests a new variation seed.

### Specialized shaping

- **Kick:** body, punch, pitch drop, length, drive.
- **Snare:** body/noise balance, snap, tone, decay.
- **Clap:** spread, repeats, gate, width.
- **Hi-hat:** tightness, tuning variance, length variance, choke.
- **Percussion:** transient, pitch, resonance, damping.
- **Cymbal:** start variation, damping, wash.

Choke examples include closed hat muting open hat and a new clap optionally
gating the previous clap tail.

## 5. Monophonic bass synth

Initial architecture is four-oscillator subtractive synthesis. “Operator” is
reserved for an FM topology.

- Sine, triangle, square, saw, variable pulse, and optional noise/sub source.
- Per-oscillator waveform, octave, tuning, and level.
- Pulse-width modulation.
- Mono priority: last, low, or high.
- Legato, glide, amplitude envelope, filter envelope, multimode filter,
  saturation, and sub reinforcement.
- Primary macros: Shape, Weight, Bite, Movement, Decay, Glide.

## 6. Blip lead synth

A focused short-gesture instrument rather than a general-purpose polysynth.

- Monophonic initially; duophonic mode is a later product decision.
- Oscillator/sample hybrid option.
- Pitch-envelope blips.
- Resonant filter and fast amplitude shaping.
- Wavefolding or soft clipping.
- Controlled pitch instability.
- Macros: Blip, Shape, Snap, Tone, Bend, Tail, Dirt, Space.

## 7. FM chord synth

- Polyphonic four-operator FM/phase modulation.
- Curated algorithms rather than unrestricted routing in Classic/Studio.
- Ratios, feedback, modulation depth, brightness envelope, amplitude envelope,
  velocity-to-modulation, stereo spread, restrained unison.
- Macros: Ratio, Metal, Bell, Body, Motion, Decay, Spread, Space.

## 8. Virtual-analog chord synth

The sonic reference is classic digital analog modeling, but product naming and
marketing must be original and must not use another manufacturer's product name.

- Polyphonic two/three-oscillator architecture.
- Detune, drift, pulse width, noise, multimode filter.
- Filter/amplitude envelopes, LFOs, voice spread, unison, and chorus.
- Macros: Shape, Detune, Color, Cutoff, Movement, Envelope, Width, Air.

## 9. Pad sample engine

- Keymapped samples and optional velocity layers.
- Sustains, resampled chords, reversed fragments, ambience, harmonic beds, and
  transformed release material from the approved source library.
- Loop start/end, crossfade, sample start, reverse, filter, slow envelope,
  stereo movement, layering, and chord/octave modes.
- Macros: Source, Blur, Color, Motion, Attack, Release, Width, Space.

## 10. Granular instrument

This is a playable sound generator, distinct from the capture-based granular
effect.

- Position, scan speed, drift, grain size, density, spray, pitch, pitch
  variation, window, freeze, stereo spread, and bounded feedback.
- Deterministic project-driven grain randomness for saved playback and offline
  render.
- Macros: Focus, Scatter, Cloud, Drift, Freeze, Motion, Width, Distance.

## 11. Granular Stutter/Glitch effect

The effect captures incoming audio into a bounded real-time buffer and creates
signature rhythmic interruption.

Modes:

- Stutter, repeat, freeze, scatter, reverse, scrub, cloud, tape stop, gate, and
  buffer jump.

Timing:

- free or transport synchronized;
- bar through 1/64 divisions;
- straight, dotted, and triplet;
- quantized trigger and deterministic probability;
- MIDI-note, UI, Variable, or Cyclic trigger where routing permits.

Controls:

- capture/buffer length, grain size, density, position/spread, pitch/variation,
  reverse probability, pan, feedback, filter, envelope, and wet/dry.
- Primary macros: Capture, Stutter, Scatter, Pitch, Gate, Repeat, Feedback, Mix.

Safety:

- fixed preallocated buffers;
- bounded feedback and output;
- click-free capture, mode, bypass, and preset changes;
- no memory allocation or locks during processing;
- deterministic offline rendering.

## 12. Smooth Crusher

Components:

- bit-depth reduction;
- sample-rate reduction;
- pre/post filtering;
- controlled dither/noise;
- soft saturation;
- stereo link/unlink;
- wet/dry and compensated gain;
- optional transient preservation and mid/side processing.

“Smooth” means parameter smoothing, crossfades between quantization states,
controlled foldback filtering, low-end preservation, soft quantization options,
and click-free automation—not simply a low-pass filter after a conventional
crusher.

Primary macros: Bits, Rate, Melt, Tone, Edge, Movement, Width, Mix.

## 13. Spatial Enhancer

- Lush algorithmic reverb with room/plate/hall characters.
- Early reflections, predelay, size, damping, modulated tails, return EQ.
- Stereo decorrelation, microshift, frequency-dependent width, and mid/side
  filtering.
- Ducking, freeze, and controlled infinite tail.
- Mono-compatible low end below a configurable crossover.
- Primary macros: Space, Distance, Bloom, Air, Width, Motion, Duck, Freeze.

Release tests must cover mono collapse, bounded feedback, freeze stability,
click-free changes, and consistent offline rendering.

## 14. Tempo Delay

- Free, straight, dotted, and triplet timing.
- Independent or linked stereo times.
- Feedback, filtering, ping-pong, modulation, ducking, freeze/hold.
- Host tempo in plug-in mode; internal or external clock in standalone mode.

## 15. Mixer and effects routing

Each instrument channel provides level, pan, mute, solo, high-pass filter,
simple saturation, delay send, and Space send.

Two controlled insert slots may host Glitch, Crusher, Filter, Saturation, Gate,
or Utility. Delay and Spatial Enhancer are shared returns by default.

```text
Instrument → Insert A → Insert B ─┬→ instrument bus
                                  ├→ Delay return
                                  └→ Space return

Instrument buses + returns → Master Color → protective limiter → Main
```

The master stage protects against probabilistic density; it is not intended to
replace mastering. It requires output metering, headroom configuration, bounded
gain, and a reliable panic/mute path.

## 16. Sample-library specification

```text
audio-library/
  sources/
  edited/
  drums/
  multisamples/
  pads/
  granular/
  loops/
  manifests/
```

Production assets use stable sample IDs rather than file paths. Metadata:

- source and processing history;
- recording/performance/ownership clearance;
- root note and tuning;
- velocity range/layers;
- loop/crossfade points;
- choke group and engine eligibility;
- normalization and peak/RMS data;
- asset version and replacement compatibility.

Web builds receive a deliberately reduced, compressed asset subset. Studio
installs the full library. A project references asset IDs and must report missing
or incompatible assets explicitly.

## 17. Implementation order

1. Four lightweight web engines and basic stereo effects.
2. Native audio runtime, mixer, and sample library.
3. Full drums.
4. Bass.
5. Blip.
6. Pad sampler.
7. FM chords.
8. Virtual-analog chords.
9. Granular instrument.
10. Smooth Crusher.
11. Tempo Delay.
12. Spatial Enhancer.
13. Granular Stutter/Glitch.
14. Master protection and multi-output certification.

The glitch effect follows native real-time infrastructure because it requires
safe buffer ownership and sample-accurate capture/triggering.
