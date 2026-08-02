# Native Standalone and Plug-in Specification

**Status:** approved architecture and release target; not implemented  
**Last updated:** 2026-08-01

This specification defines M Studio's native desktop, hosted plug-in, transport,
audio-bus, and real-time requirements. It complements
[`MIDI_RELIABILITY_SPEC.md`](./MIDI_RELIABILITY_SPEC.md) and
[`AUDIO_ENGINE_SPEC.md`](./AUDIO_ENGINE_SPEC.md). It does not select an
implementation framework: Tauri/Rust are prototype candidates, VST3 is a
required investigation, and Audio Unit is an evaluated Apple target. The
current-versus-candidate boundary is canonical in
[`TECH_STACK.md`](./TECH_STACK.md).

## 1. Deliverables

- Signed/notarized macOS standalone application.
- Signed Windows standalone application/package.
- VST3 instrument on macOS and Windows.
- Audio Unit target evaluated and shipped where host behavior satisfies product
  requirements.
- Shared project documents, musical engine, presets, instruments, effects, and
  conformance traces across targets.

Virtual MIDI from standalone and in-host plug-in operation are separate
deliverables and must be tested separately.

## 2. Standalone clock modes

- Internal clock.
- External MIDI clock.
- MIDI Start, Continue, Stop.
- Song Position Pointer where the selected adapter/device supports it.
- Optional Ableton Link is a later scoped feature.

External-clock behavior requires smoothing, dropout detection, reacquisition,
start/continue semantics, and documented timeout/recovery. MIDI clock must never
be handled on the UI thread.

## 3. Plug-in synchronization

Inside a host, the plug-in follows host processing context rather than expecting
MIDI clock messages. Required context:

- sample position and block size;
- tempo and time signature;
- musical/project position;
- play/stop state;
- loop range and wrap;
- seek/jump discontinuities;
- offline rendering state;
- sample rate and processing precision.

Events are resolved to sample offsets inside each audio block. Host automation
is consumed from the block's automation queues. Transport jumps cancel/reconcile
pending notes and effects according to explicit conformance rules.

## 4. MIDI and event behavior

- Receive note and controller input for play-along and control assignment.
- Generate internal events for all eight M Voices.
- Optionally expose generated event/MIDI output where the host supports it.
- Maintain identical musical decisions between standalone and plug-in for the
  same seed, project, tempo map, and event trace.
- Never allow UI frame rate to affect event timing.

## 5. Audio outputs

Minimum eight stereo buses:

| Bus | Signal |
| --- | --- |
| Main | Complete stereo mix |
| Drums | 12-pad drum engine |
| Bass | Mono Bass presented on stereo bus |
| Blip | Blip lead |
| FM | FM chord engine |
| Analog | Virtual-analog chord engine |
| Pad | Pad sample engine |
| Grain | Granular instrument |

Optional buses:

- Delay return;
- Spatial return.

Modes:

- Main only;
- Main plus selected individual buses;
- individual buses without Main;
- dry instruments plus separate effect returns;
- printed effects in instrument buses when explicitly selected.

Hosts decide which optional buses are active. Unused buses must consume minimal
CPU and report silence correctly. Bus naming and state restoration must remain
stable across versions.

## 6. Host certification matrix

Each supported host/version/OS combination must verify:

- scan, instantiate, authorize, and remove;
- MIDI/event input and generated event output where supported;
- tempo, time signature, start/stop, seek, loop, and tempo automation;
- automation recording/playback;
- preset and project restoration;
- all audio buses and their activation;
- multiple plug-in instances;
- sample-rate and block-size changes;
- bypass, suspend, deactivate, and re-enable;
- offline/faster-than-real-time rendering;
- freeze/bounce and project reopen;
- missing library and entitlement recovery;
- crash containment and diagnostics.

Initial candidate hosts: Ableton Live, Logic Pro, Cubase/Nuendo, Reaper, Bitwig
Studio, Studio One, and FL Studio. A host is advertised only after its defined
matrix passes.

## 7. Real-time safety

The processing thread must not:

- allocate or free memory;
- take mutexes or wait on locks;
- parse JSON or rebuild documents;
- access React, DOM, Zustand, or platform UI objects;
- load samples or touch the filesystem;
- use network or licensing services;
- log synchronously;
- invoke unbounded algorithms;
- trigger garbage collection.

Required design:

- all audio buffers and effect histories preallocated;
- bounded lock-free or wait-free command/event queues;
- immutable compiled processing state;
- background asset decoding and graph compilation;
- atomic state publication at safe boundaries;
- bounded CPU per sample/block;
- denormal protection and deterministic reset;
- click-free parameter and topology transitions.

## 8. UI/audio separation

UI and processor exchange versioned snapshots, parameter changes, and bounded
telemetry. Audio owns DSP state; UI owns presentation. Meters and playheads are
rate-limited and timestamped to match audible output latency.

Closing the editor must not stop audio. Multiple editor instances, host generic
parameter views, scaling, and high-DPI behavior require explicit tests.

## 9. Project, preset, and asset compatibility

- Classic documents open in Studio.
- Studio documents retain eight Voices, rack, mixer, effects, buses, and asset
  references.
- Plug-in state is self-contained except for versioned installed sample assets.
- Missing assets produce explicit recovery UI, never silent substitution.
- Presets have stable IDs and schema versions.
- State serialization never runs on the processing thread.
- Migration tests cover every released document and preset version.

## 10. Native adapter boundary

Framework-independent event batches use versioned integer musical positions and
native monotonic/sample timing. Platform adapters include:

- CoreMIDI/Core Audio on Apple desktop;
- Windows MIDI/audio APIs selected during native prototyping;
- VST3 host adapters;
- Audio Unit host adapters where shipped.

The current browser `AudioContext`, timers, Web MIDI ports, and Web Audio nodes
must not leak into the core protocol.

## 11. Invite-beta gate

- MIDI/audio run on dedicated non-UI threads.
- Stop, panic, device loss, sleep/wake, and transport jumps leave no hanging
  notes or runaway effects.
- Configured latency is reported accurately.
- Long-session, forced-stall, and high-density tests pass.
- Signed packages install, update, downgrade/reject safely, and uninstall.
- Project interchange with Classic Web passes.
- Crash reports and diagnostics exclude user musical content unless explicitly
  authorized.

## 12. Paid-release gate

- Seven instruments and signature effects meet the audio specification.
- Eight-Voice UX and multi-output buses are production-ready.
- Supported host certification matrix passes.
- Offline renders are deterministic where specified.
- Sample rights, notices, licenses, privacy, support, and commercial entitlement
  are complete.
- Performance budgets are published for minimum and recommended systems.
