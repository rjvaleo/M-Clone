# MIDI Reliability Technical Specification

**Status:** implemented baseline plus explicitly marked open requirements  
**Last verified:** 2026-08-01  
**Canonical source for MIDI timing and transport behavior:** this document

This specification defines what M-Clone currently guarantees, how each
guarantee is implemented, how it is tested, and what remains before the product
can claim professional native timing. UI documents describe presentation; when
they conflict with MIDI behavior, this specification is authoritative.

Edition and release scope is defined in
[`PRODUCT_RELEASE_ROADMAP.md`](./PRODUCT_RELEASE_ROADMAP.md). The MIDI/event
engine remains upstream of the audio rack specified in
[`AUDIO_ENGINE_SPEC.md`](./AUDIO_ENGINE_SPEC.md); native adapters and hosted
transport are specified in [`NATIVE_PLUGIN_SPEC.md`](./NATIVE_PLUGIN_SPEC.md).
Resolved browser/tool versions and current architecture boundaries are listed
in [`TECH_STACK.md`](./TECH_STACK.md).

## 1. Product targets and terminology

M-Clone currently runs in a browser and is intended to become a native product
on macOS, Windows, iOS, and Android. The framework-independent planner,
transport-continuity rules, musical tick positions, event protocol, lifecycle
manager, and test traces are intended to survive that transition. Browser clock,
timer, Web Audio, and Web MIDI objects are adapters, not musical truth.

- **Musical tick:** position on the shared 960 PPQN timeline.
- **Real time:** seconds in the current `AudioContext` time domain.
- **Output time:** `DOMHighResTimeStamp` milliseconds used by Web MIDI.
- **Planning window:** base `[now, now + 120 ms)`, adaptively bounded to 80–250 ms.
- **Scheduler wake:** injected driver; the browser adapter requests every 25 ms.
- **Batch:** all explicit events submitted from one clock correlation snapshot.
- **Destination:** engine events use `synth` or `midi`; selected physical port IDs
  are retained and reconciled by the Web MIDI adapter.
- **Atomic transition:** cancel queued output, silence notes, reset or preserve
  transport state, then resume from one shared boundary.

## 2. Current architecture

```text
React/Zustand state snapshot
          |
          v
pure planner --> PlannedNote intentions (seconds + 960-PPQN ticks)
          |
          v
NoteLifecycle --> ordered Note On / Note Off / Program Change events
          |                         |
          v                         v
SynthSink (Web Audio)         MidiSink (Web MIDI)
          |
          v
UI telemetry after output submission
```

| Component | Responsibility | Platform coupling |
| --- | --- | --- |
| `engine/planner.ts` | Voice traversal, transforms, event positions, 960-PPQN positions | None |
| `engine/transport.ts` | Detect timing-map changes and create continuous timing segments | None |
| `engine/events.ts` | Event protocol, ordering, future Note Off queue, ownership | None |
| `engine/runtime.ts` | Lookahead, state snapshots, lifecycle submission, browser transport | Browser |
| `engine/outputs/webmidi.ts` | Clock conversion and MIDI byte transmission | Web MIDI |
| `engine/outputs/synth.ts` | Explicit Note On/Off realization | Web Audio |
| `engine/midiview.ts` | Diagnostic representation of planner output | None |

The runtime always plans first, submits output second, and publishes Midi View
telemetry last. A React render is therefore not placed between event planning
and device submission.

## 3. Clock and scheduler specification

### 3.1 Current browser clock

The runtime accepts injected monotonic clock and scheduler drivers. The browser
clock defaults to `AudioContext.currentTime`; its scheduler adapter wakes with
`setInterval` every 25 ms. Lookahead starts at 120 ms and adapts within 80–250 ms.
The timer is only the wake mechanism; event execution is timestamped by Web
Audio/Web MIDI rather than expected to occur precisely inside the callback.

This protects already-submitted events from ordinary short UI activity. It does
not guarantee immunity from a main-thread stall longer than the remaining
lookahead, background-tab throttling, OS suspension, driver jitter, or device
latency. A wake at least 400 ms late is a serious stall: queued output and
lifecycle ownership are cleared, unscheduled Voice timelines are rebased to a
fresh 60 ms boundary, and no overdue catch-up burst is emitted. Note attacks
more than 20 ms late are dropped; releases and state events are retained.
Suspension uses the same recovery boundary.

### 3.2 Clock-domain conversion

One correlation anchor is captured per MIDI batch:

```text
performanceTimestamp = anchor.performanceMs
                     + (event.atSec - anchor.contextSec) * 1000
```

`AudioContext.getOutputTimestamp()` is preferred. When unavailable, one
`AudioContext.currentTime`/`performance.now()` pair is sampled. The anchor is
not resampled per note, so equal real-time events receive equal Web MIDI
timestamps across Voices and channels.

### 3.3 Shared musical time

All Voices begin with tick 0 and a common real-time origin. The planner advances
an absolute 960-PPQN `transportTick` independently of real-time distortion.
Generated notes carry `atTick` and `durationTicks` as well as browser scheduling
seconds. Tempo changes therefore do not rewrite accumulated musical position.

Integer tick increments are rounded per step. Current time bases and cyclic
rhythm values are representable at 960 PPQN; exotic future divisions must add
fractional/fixed-point accumulation tests before shipping.

## 4. Tempo and Time Distortion continuity

The runtime fingerprints, per Voice:

- tempo;
- time-base numerator and denominator;
- Time Distortion map length, denominator, and points.

When a fingerprint changes, that Voice starts a new real-time segment at its
next unscheduled event. Note-order cursor, cyclic position, and absolute musical
tick are preserved. Elapsed clock time is not recomputed using the new tempo or
map. This prevents past events from becoming overdue and being emitted as a
catch-up burst.

Already-submitted events retain their original timestamps. Consequently, live
timing edits take effect at the next unscheduled boundary, up to approximately
one planning horizon later. This is deliberate continuity, not instantaneous
retroactive rescheduling.

## 5. Event protocol and ordering

The implemented protocol contains:

- `note-on` — note ID, note, velocity, Voice, channel, destination;
- `note-off` — matching note ID, note, zero release velocity;
- `program-change` — Voice, channel, program, MIDI destination.

Every event carries:

- `atSec` real-time adapter position;
- `atTick` 960-PPQN musical position;
- monotonic sequence number;
- destination, Voice, and channel.

Stable equal-time priority is Program Change, Note Off, then Note On. Remaining
ties use destination, channel, and sequence. This ensures patch selection occurs
before a note and retrigger release occurs before replacement attack.

Generated musical Control Change, Bank Select, sustain ownership, Pitch Bend,
Channel Pressure, external MIDI Clock input, SysEx, and MIDI 2.0 UMP are not
implemented and must not be represented as shipped functionality. Live Note
and controller input plus realtime MIDI Start/Clock/Stop output are implemented
through dedicated adapters rather than this planned-note event union.

## 6. Note lifecycle and overlap policy

Future Note Offs remain in `NoteLifecycle` until they enter a scheduling window.
Ownership is keyed by destination, channel, and pitch, with a unique `noteId`
for each generated instance.

For a repeated destination/channel/pitch before the old release:

1. the old pending Note Off is removed;
2. an old-owner Note Off is inserted at the replacement timestamp;
3. the replacement Note On follows it at the same timestamp;
4. the replacement receives its own future Note Off.

This is a deterministic retrigger policy, not reference-counted overlapping
polyphony for the same pitch. Two Voices intentionally sharing the same
destination/channel/pitch retrigger one another. True multi-owner merge policy
would need an explicit product decision and new conformance traces.

The synth tracks oscillators by `noteId`. MIDI adapters transmit the lifecycle's
ordered bytes. Panic resets pending lifecycle state as well as device state.

## 7. Transport semantics

| Command | Cursor result | Queued output | Active notes | Restart boundary |
| --- | --- | --- | --- | --- |
| Start while stopped | Fresh Voice/order/cyclic/RNG state | Fresh queue | None expected | Shared `now + 60 ms` |
| Start while running | No operation | Unchanged | Unchanged | Unchanged |
| Pause | Preserved | Cancelled | Panic | Shifted on Resume |
| Resume | Preserved and time-shifted | Fresh queue | None | Existing relative lead preserved |
| Stop | Discarded for next Start | Cancelled | Panic | Next Start is fresh |
| Sync | Reset immediately | Cancelled | Panic | Shared `now + 60 ms` |
| MIDI output change | Musical cursor preserved | Old port cleared | Old port panic | New port receives state next tick |

For Web MIDI, cancellation calls the standard `MIDIOutput.clear()` when the
browser exposes it, followed by Sustain Off (CC 64), Reset All Controllers
(CC 121), and All Notes Off (CC 123) on all 16 channels.
TypeScript DOM versions that omit `clear()` are handled without weakening the
runtime feature detection.

Limit: panic does not send explicit per-note offs because lifecycle ownership is
discarded atomically before the controller-aware channel panic.

## 8. Channel synchronization and routing

- A Voice may emit to zero, one, or multiple MIDI channels.
- Channels are normalized to 1–16 at the adapter boundary.
- Notes generated for multiple channels share `atSec` and therefore receive the
  same Web MIDI timestamp in one batch.
- Four Voices share one transport start boundary and musical timeline.
- Each Voice has its own deterministic RNG stream derived from the project seed
  and Voice index. Random consumption in one Voice does not alter another.
- Program Changes are emitted for every routed channel at Start/Sync and when
  program/routing state changes while a MIDI port is selected.

Physical DIN MIDI serializes messages and cannot make dense multi-channel events
electrically simultaneous. USB/OS/driver/device behavior also lies beyond the
engine's timestamp guarantee. Verification must distinguish equal submission
timestamps from measured wire or audio onset.

One or more Web MIDI ports may be selected. `MIDIAccess` and selected physical
IDs are retained; `statechange` removes only missing destinations and restores a
selected destination when its ID reconnects. Losing one port does not disturb
unaffected ports. Engine events remain adapter-neutral; `eventbatch.ts` carries
the physical destination ID across the versioned native boundary.

## 9. UI isolation

The critical tick order is:

1. take the current immutable project snapshot;
2. rebase changed timing segments;
3. plan the window using per-Voice RNG streams;
4. ingest notes into the lifecycle queue;
5. submit explicit event batches to outputs;
6. record planner output for Midi View/Zustand.

Interface clicks can change the next state snapshot but do not directly modify
an adapter queue. They can still delay the main-thread wake. The current product
therefore guarantees timestamp isolation for already-submitted events, not
zero-jitter execution under arbitrary UI or browser stalls.

Editor Sound audition uses the same lifecycle, destinations, and injected
scheduler as transport, including cancellation of outstanding one-shot wakes.

## 10. Device behavior and feature inventory

| Function | State | Verification source |
| --- | --- | --- |
| Enumerate Web MIDI outputs | Implemented | Browser manual test |
| Select/deselect output | Implemented | `webmidi.test.ts`, UI test |
| Timestamped Note On/Off | Implemented | `webmidi.test.ts` |
| Equal-time batch timestamps | Implemented | `webmidi.test.ts` |
| Program Change | Implemented | event/adapter tests |
| Queue clear before panic/switch | Implemented where `clear()` exists | runtime/Web MIDI tests |
| All Notes Off on 16 channels | Implemented | runtime/Web MIDI tests |
| Device `statechange` | Implemented | `webmidi.test.ts` |
| Reconnect/state restoration | Implemented | retained selected-ID trace |
| Multiple MIDI output ports | Implemented | independent loss/fan-out trace |
| MIDI input/controller assignment | Implemented | 16-row device/channel matrix, routing/store tests |
| MIDI file export | Implemented | deterministic Movie/SMF tests |
| MIDI file import / imported Sequence | Deliberately excluded | no product workflow |
| MIDI clock output/input | Output implemented; input excluded | realtime Start/Clock/Stop at 24 PPQN and Sync Ratio; manual excludes External Clock |
| Controller-aware panic | Implemented | CC 64 / 121 / 123 on all channels |
| Generated general CC, Bank Select, Pitch Bend, Channel Pressure | Not implemented | later I/O/instrument phase; live sustain input and panic CCs are implemented |
| Native MIDI adapters | Not implemented | native milestone |

## 11. Automated verification

Run the complete gate:

```bash
npm run typecheck
npm test
npm run test:manual
npm run coverage
npm run build
npm run build:single
```

Current verified result: 757 tests in 61 files, 167 passing executable manual
checks plus 17 explicit skips, both production builds passing, and
100% included engine/state statement, branch, function, and line coverage.

Relevant suites:

| Suite | Required assertions |
| --- | --- |
| `planner.test.ts` | timing, no cycle drift, Time Distortion, 960-PPQN positions, independent Voice RNG |
| `transport.test.ts` | unchanged timelines stay stable; tempo/map changes rebase only affected Voices |
| `events.test.ts` | future offs, retrigger order, stale-off removal, destinations, program priority, reset |
| `outputs/webmidi.test.ts` | one clock anchor, exact timestamps, channel bytes, clear/panic behavior |
| `runtime.test.ts` | output before UI telemetry, idempotent Start, clear-before-panic Stop |
| `scheduler.test.ts` | injected drivers, adaptive bounds, late attacks, 500 ms recovery, 100,000 wakes |
| `eventbatch.test.ts` | V1 ordered round trip and damaged/future rejection |
| `midiview.test.ts` | diagnostic conversion/order/history; not device timing |
| `midiinput.test.ts` | normalized live messages and device/channel routing helpers |
| `inputcontrol.test.ts` | Appendix B command lookup and value handling |
| `clockoutput.test.ts` | 24-PPQN Start/Clock/Stop scheduling at Sync Ratio |

Browser-only adapters remain excluded from the global coverage percentage, but
their behavior is exercised with fake clocks, AudioContext objects, timers, and
MIDI ports. Coverage percentage alone is not evidence of physical timing.

## 12. Manual verification protocol

Use Chromium on `localhost` or HTTPS; Web MIDI is unavailable from the standalone
`file://` build.

1. Connect a timestamp-capable virtual or hardware MIDI monitor.
2. Select the port, disable the synth, route all four Voices to distinct channels.
3. Use identical patterns/time bases and Sync.
4. Verify equal intended timestamps across channels in the monitor.
5. Drag windows and controls continuously; verify submitted timestamps retain
   cadence and record any actual onset deviation separately.
6. Sweep tempo and Time Distortion; verify no immediate catch-up clusters.
7. Set legato above one with repeated pitches; verify release-before-retrigger.
8. Press Stop, Pause, and Sync repeatedly inside the lookahead horizon; verify no
   queued Note On occurs after cancellation.
9. Change programs during playback; verify Program Change precedes the next note.
10. Disconnect one of multiple selected devices. The remaining destination must
    continue; reconnecting the same port ID must restore its selection.

For quantitative jitter measurement, loop MIDI output to a timestamp recorder or
capture audio transients from the destination. Report median, p95, p99, maximum,
test duration, browser/OS/device, connection type, buffer size, and whether the
measurement represents submission time, wire time, or audible onset.

## 13. Release invariants

The following must remain true after every MIDI change:

1. One shared start/sync timestamp for every Voice.
2. One clock anchor per output batch.
3. Stable ordering for equal-time events.
4. Output submission occurs before UI telemetry.
5. Stop/Pause/Sync/output-switch cancellation precedes panic or restart.
6. Tempo/map edits never reinterpret elapsed real time.
7. Random activity in one Voice never changes another Voice.
8. No stale Note Off survives a same-pitch retrigger in the lifecycle queue.
9. Musical tick positions never depend on React, Zustand, Web MIDI, or Web Audio.
10. Unsupported MIDI functionality is labeled as unsupported.

## 14. Reliability work after browser Phase 3

Browser Phase 3 is implemented: injected clock/scheduler drivers, unified
audition wakes, diagnostics, explicit late-event/stall policy, bounded adaptive
lookahead, retained device lifecycle, multi-port routing, suspension recovery,
controller-aware panic, versioned native event batches, and forced-stall / loss /
100,000-wake conformance tests.

Still open for later product phases:

1. physical-device integration measurements across the published browser matrix;
2. native high-priority clock, scheduler, and MIDI adapters consuming the V1
   event-batch boundary;
3. generated musical Control Change, Bank Select, sustain ownership, Pitch
   Bend, and Channel Pressure semantics;
4. platform-specific background/sleep certification and recovery telemetry;
5. physical live-input and MIDI Clock-output certification in the browser/device
   matrix; external clock input, SysEx, and MIDI 2.0 remain outside this phase.

The browser build must not be described as “zero jitter.” The implemented claim
is narrower: deterministic musical planning, equal batch timestamps, bounded
lookahead scheduling under normal foreground operation, explicit cancellation,
and tested lifecycle ordering. Native high-priority scheduling is still required
for the strongest product-level timing guarantees.

For product terminology: Classic Web exposes four Voices; Studio will expose
eight. Framework-independent MIDI/event code should migrate toward configurable
1–16 Voice capacity without changing Classic's compatibility behavior.
