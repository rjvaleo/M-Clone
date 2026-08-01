# Product and Release Roadmap

**Status:** approved product direction; implementation state is tracked in
[`STATUS.md`](./STATUS.md)  
**Last updated:** 2026-08-01

This document is authoritative for editions, platforms, access stages,
commercial progression, and compatibility. Technical MIDI behavior belongs to
[`MIDI_RELIABILITY_SPEC.md`](./MIDI_RELIABILITY_SPEC.md); instruments and effects
belong to [`AUDIO_ENGINE_SPEC.md`](./AUDIO_ENGINE_SPEC.md); native and plug-in
behavior belongs to [`NATIVE_PLUGIN_SPEC.md`](./NATIVE_PLUGIN_SPEC.md).

## 1. Three independent roadmaps

Do not conflate these axes:

1. **Product capability:** M Classic → M Studio → M Modular.
2. **Platform maturity:** browser → native desktop → hosted plug-in → mobile.
3. **Commercial access:** free public → invite-only beta → paid release.

Invite-only is a distribution stage, not a product edition. A beta tester may
receive Studio capabilities before Studio is publicly sold, while Classic
remains free.

## 2. Product family

| Edition | Position | Voices exposed | Audio | Distribution |
| --- | --- | ---: | --- | --- |
| **M Classic Web** | Faithful browser recreation and MIDI generator | 4 | Four lightweight playback engines, basic stereo effects | Free public web app |
| **M Studio** | Complete RJ Vallejo generative production instrument | 8 | Seven full instruments, signature effects, multi-output | Paid desktop standalone and plug-in |
| **M Modular** | Node-based generative MIDI/audio environment | Configurable | Modular generators, processors, instruments, effects | Later premium product |

The core engine should support a configurable 1–16 Voices even though Classic
exposes four and Studio exposes eight. Product caps belong in capability
configuration, never in musical algorithms.

## 3. M Classic Web — free

### Product promise

> The classic generative MIDI instrument, rebuilt faithfully for the web.

Classic is the compatibility edition and free entry point. It must implement the
original application's musical behavior before expanding into Studio features.

### Required scope

- Four Voices and the original M interaction model.
- Patterns, Variables, Cyclic Variables (including Phrasing through Legato),
  Conducting, Snapshots, Slideshows, Pattern editing, and original transport
  semantics.
- Complete Web MIDI generation and input appropriate to browser permissions.
- MIDI Assignment and controller workflows.
- Standard MIDI file import/export.
- Movie/Sequence recording and playback where defined by the original.
- Versioned project save/load.
- Four lightweight internal playback engines:
  - drum sampler;
  - monophonic bass;
  - lead;
  - polyphonic chord/pad.
- Basic stereo mixer, reverb, and delay.
- One stereo audio output.

### Deliberate exclusions

- Seven full Studio instruments.
- Signature granular glitch, Smooth Crusher, and full Spatial Enhancer.
- Multiple instrument output buses.
- User sample import.
- Third-party plug-in hosting.
- Studio stem rendering and advanced mixer.
- Eight-Voice interface.

### Release gate

- Every original behavior is mapped to source/manual evidence and a test or
  documented manual verification.
- No visible non-deferred placeholder controls.
- MIDI reliability Phase 3 is complete.
- MIDI device loss, reconnect, suspension, and serious scheduler stalls have
  defined behavior.
- Project format is migratable into Studio and Modular.
- Browser CPU, memory, asset loading, and long-session tests pass.
- Supported-browser and MIDI-device matrices are published.

## 4. M Classic/Desktop and Studio invite beta

### Access

Invite-only, signed builds for macOS and Windows. Mobile is not included.

### Purpose

- Prove native MIDI and audio timing.
- Prove installers, signing, updates, sleep/wake, and device lifecycle.
- Exercise real studio projects and varied driver/hardware combinations.
- Prove project compatibility with Classic Web.
- Certify standalone DAW routing before hosted plug-in release.

### Required desktop foundation

- macOS and Windows standalone applications.
- Native monotonic clock and timestamped MIDI adapters.
- Dedicated scheduler/audio processing threads.
- Multiple physical and virtual MIDI ports.
- Native audio-device selection and sample-rate/buffer configuration.
- Signed/notarized packages and controlled updates.
- Crash reporting with user privacy controls.
- Import of Classic Web project documents.
- Export back to Classic where the document uses only Classic capabilities.

## 5. M Studio — paid desktop product

### Product promise

> The complete RJ Vallejo generative MIDI and audio instrument.

### Commercial scope

- Eight generative Voices.
- Seven original internal instruments.
- Full *September*-derived sound library.
- Granular Stutter/Glitch, Smooth Crusher, Spatial Enhancer, Tempo Delay, and
  protective master processing.
- Native standalone application.
- VST3 instrument; Audio Unit target where host/product testing supports it.
- Host tempo, position, loop, transport, automation, and offline render support.
- Main stereo mix plus individual instrument outputs.
- Performance recording and editable generated MIDI.
- MIDI, stereo audio, and stem export.
- Multiple MIDI destinations and simultaneous internal/external routing.
- Presets, templates, migration, and commercial entitlement.

### Voice presentation

The engine supports eight simultaneous Voices. The UI should preserve Classic
readability rather than compressing eight narrow columns. Preferred design:

- four visible Voice columns at once;
- A/B Voice banks;
- eight-Voice overview;
- selected-Voice detail;
- pin/compare workflow.

### Paid launch gate

- Native reliability and real-time audio conformance suites pass.
- No allocation, lock, file I/O, network access, or UI dependency on the audio
  thread.
- Host certification matrix passes for supported DAWs.
- Multi-output routing and state restoration work across supported hosts.
- Sample and collaborator rights are documented.
- Installer, updater, purchase, entitlement, refund, privacy, and support flows
  are operational.
- Naming, trademark, interface-identity, and launch marketing receive qualified
  legal review.

## 6. Paid app-store family

The paid family eventually targets macOS, iOS/iPadOS, Windows, and Android, but
mobile follows the desktop release rather than sharing its initial engineering
milestone.

Recommended engineering order:

1. macOS desktop;
2. Windows desktop;
3. iPadOS;
4. Android tablets;
5. iPhone and smaller Android devices.

Mobile requires dedicated work for touch layout, audio sessions, backgrounding,
USB/Bluetooth MIDI, file exchange, purchasing, and store policy. It must not be
a scaled desktop window. Tablet is the primary mobile composition surface.

### Commercial progression

```text
Free M Classic Web
        ↓
Invite-only desktop alpha
        ↓
Invite-only standalone beta
        ↓
Invite-only plug-in beta
        ↓
Paid desktop early access
        ↓
Paid macOS/Windows production
        ↓
Closed mobile beta
        ↓
Paid app-store family
```

## 7. M Modular — future premium platform

M Modular is a graph-based generative MIDI/audio environment, not merely Studio
with more Voices. Typed nodes generate and transform event/audio streams.

Node families may include:

- clock, transport, division, and phase;
- Pattern and sequence sources;
- probabilistic, Euclidean, Markov, Brownian, and cyclic generators;
- pitch, scale, chord, harmony, and Voice allocation;
- velocity, articulation, gate, conditional, and logic processors;
- MIDI input, output, CC, expression, and routing;
- sample, oscillator, granular, filter, envelope, and modulation nodes;
- effects, sends, mixers, recorders, analyzers, and outputs.

M Classic should be available as a compound generator node. The graph engine
requires typed ports, immutable/versioned graph documents, deterministic event
packets, bounded feedback, graph compilation, real-time-safe execution, and
offline rendering.

## 8. Monetization principles

- M Classic Web remains free and useful.
- M Studio is a paid perpetual desktop product unless recurring services later
  justify a subscription.
- Maintenance updates can remain free; major upgrades may be paid.
- Studio owners should receive upgrade credit toward Modular.
- Optional sound or node expansions may provide additional revenue without
  withholding core reliability.
- Project ownership and export are never held hostage by entitlement failure.
- Licensing code never runs inside the real-time engine.

Pricing is deliberately not fixed in this specification. Invite-beta research
should measure perceived value, professional use, support burden, and willingness
to pay before a launch price is selected.

## 9. Capability configuration

Edition behavior should be data-driven:

```ts
type ProductCapabilities = {
  edition: "classic" | "studio" | "modular";
  maxVoices: number;
  maxMidiDestinations: number;
  internalEngineIds: readonly string[];
  signatureEffects: boolean;
  multiOutputAudio: boolean;
  pluginMode: boolean;
  performanceRecording: boolean;
  advancedRouting: boolean;
  modularGraph: boolean;
};
```

Rules:

- Never branch core musical algorithms on price or entitlement.
- Never hard-code four Voices in new framework-independent code.
- Keep layout limits separate from engine limits.
- Keep commerce and licensing outside project documents and real-time code.
- Classic documents open in Studio and Modular.
- Studio documents degrade explicitly when opened by Classic; never silently
  discard paid-edition state.
- All project migrations are versioned and tested.

## 10. Brand and rights gates

Before public monetization, obtain qualified advice concerning product names,
historic interface similarity, marketing language, and the rights needed for
all recordings, stems, samples, performances, collaborators, and source
libraries. Clean-room engineering is important but is not itself a complete
trademark, copyright, endorsement, or trade-dress analysis.

Do not market internal sonic references using another manufacturer or product's
name. The instruments and effects require original RJ Vallejo names, artwork,
presets, and descriptions.
