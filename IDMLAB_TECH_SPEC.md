# idMLab — Technical Specification

**Companion to [`IDMLAB_MASTER_PLAN.md`](IDMLAB_MASTER_PLAN.md).**
The plan says what to build and in what order. This says what "built" means, in
terms a test can check.

---

## 0. How to read this

### 0.1 Requirement levels

**MUST** — a conformance requirement. A build violating it is broken.
**SHOULD** — a requirement with a documented escape. Deviating requires a
comment at the site naming the reason.
**MAY** — latitude.

### 0.2 Requirement IDs

Every checkable statement carries an ID: `R-<area>-<n>`.

Cite the ID in the test name or a comment on the assertion:

```ts
it("refuses a range past the end of the buffer [R-ABI-03]", () => { … });
```

```rust
#[test] // R-DSP-22
fn limiter_never_exceeds_its_ceiling() { … }
```

A requirement with no citing test is an unmet requirement. `npm run spec:audit`
scans for IDs defined here and absent from the suites, and fails the build.

### 0.3 Units and tolerances

| Quantity | Unit | Default tolerance |
|---|---|---|
| Frequency | Hz | ±1 % |
| Gain, level | linear 0–1 unless the id ends `-db` | ±0.01 |
| Decibels | dBFS | ±0.1 dB |
| Time | seconds, `f32` | ±1 sample |
| Musical time | ticks at 960 PPQN | exact |
| Pitch | MIDI note + cents | ±0.5 cents |
| Filter slope | dB/octave | ±1.5 dB measured one octave from cutoff |
| Reverb decay | RT60 seconds | ±10 % |

### 0.4 Reference constants

```
SAMPLE_RATE_DEFAULT = 48_000        supported: 44_100 · 48_000 · 96_000
QUANTUM             = 128           frames per render callback
MAX_CHANNELS        = 16            per Frame
MAX_SAMPLE_SLOTS    = 256
MAX_SCHEDULED_NOTES = 512
MAX_POLYPHONY       = 64            allocated; the limit is a parameter
CHOKE_GROUPS        = 16            plus group 0 meaning "none"
PPQN                = 960
UNDO_DEPTH          = 30
REPORT_INTERVAL     = 16 quanta     ≈ 170 ms at 48 kHz
DENORMAL_FLOOR      = 1e-20
```

---

## 1. Global invariants

Hold in every wave, asserted by dedicated tests rather than by inspection.

| ID | Requirement |
|---|---|
| R-GLOBAL-01 | The audio thread MUST perform no heap allocation. Enforced by `assert_no_alloc` around `Engine::process`. |
| R-GLOBAL-02 | The audio thread MUST take no lock and MUST NOT block. |
| R-GLOBAL-03 | The audio thread MUST read no wall clock. Time comes from sample counts. |
| R-GLOBAL-04 | Every random value MUST derive from a seeded PRNG whose seed is in the document. |
| R-GLOBAL-05 | Two runs of the same document, seed, tempo map and input MUST produce identical output samples, bit for bit. |
| R-GLOBAL-06 | Every sample leaving any module MUST be finite. `NaN` and `±Inf` MUST NOT propagate. |
| R-GLOBAL-07 | Values whose magnitude is below `DENORMAL_FLOOR` MUST be flushed to zero. |
| R-GLOBAL-08 | No audio DSP MUST exist outside `rust/dsp-core`. Enforced by a source scan for `AudioContext`, `createGain`, `createBiquadFilter` and siblings under `src/modular/audio/` excluding the three permitted uses in R-HOST-01. |
| R-GLOBAL-09 | Every parameter write MUST be smoothed by the receiving module. Direct assignment to a live coefficient is a defect. |
| R-GLOBAL-10 | Every mapping between two vocabularies MUST be total in both directions, with an explicit, reasoned exclusion list for anything absent. |

**Tests**

- `R-GLOBAL-05`: render a fixture document twice into buffers; assert
  `a == b` element-wise. One fixture per instrument family.
- `R-GLOBAL-06`: sweep every parameter of every module across its full declared
  range in 32 steps, render 4 quanta at each, assert all finite.
- `R-GLOBAL-08`: source scan, asserted against a known-bad fixture string so the
  detector itself is tested.

---

## 2. Host boundary

`src/modular/audio/` retains exactly three uses of Web Audio.

| ID | Requirement |
|---|---|
| R-HOST-01 | Permitted Web Audio surface: `AudioContext` lifecycle and device management; `decodeAudioData`; the single `AudioWorkletNode` → destination connection. |
| R-HOST-02 | Absence of `AudioWorklet` or `WebAssembly` MUST produce a named error surfaced in the UI. Silence without explanation is a defect. |
| R-HOST-03 | The engine MUST NOT be constructed before a user gesture has resumed the context. |
| R-HOST-04 | Compressed formats MUST be decoded by the browser first. On rejection, the in-app decoders (`aiff.ts` and successors) MUST be tried before reporting failure. |
| R-HOST-05 | `decodeAudioData` detaches its input. Every caller MUST hand it a copy and retain the original. |

**Tests**

- `R-HOST-02`: construct with `audioWorklet` absent; assert the returned error
  names the missing capability and that `engineKind` reports unavailable.
- `R-HOST-05`: hash bytes, decode, assert the pre-decode hash is reproducible
  from the retained array.

---

## 3. Core data model

### 3.1 Identity

```ts
type NodeId       = string;   // stable for the life of the node
type PortId       = string;   // unique within a module descriptor
type ParameterId  = string;   // unique within a module descriptor
type EdgeId       = string;
type ModuleTypeId = `m.${string}`;

/** The one identity every subsystem uses. R-PARAM-01. */
type ParameterAddress = `${NodeId}:${ParameterId}`;
```

| ID | Requirement |
|---|---|
| R-ID-01 | `ParameterAddress` MUST be the sole identity used by snapshots, macros, automation lanes, MIDI mapping, the morph engine, host automation and the UI. |
| R-ID-02 | A `NodeId` MUST survive rebuilds. Changing a structural parameter rebuilds the engine module and retains the node id. |
| R-ID-03 | Asset identity MUST be a hash of content. Two identical files are one asset; a renamed file is the same asset; an edited file is a different asset. |

### 3.2 Parameter descriptor

```ts
type ParameterKind = "number" | "boolean" | "enum" | "string" | "json";

type Smoothing = "none" | "linear" | "exponential";

type MorphPolicy =
  | "linear" | "exponential" | "logarithmic"
  | "step-start" | "step-mid" | "step-end"
  | "crossfade" | "excluded" | "immediate";

type ViewFlag = "default" | "performance" | "always-on";

interface ParameterDescriptor {
  id: ParameterId;
  label: string;
  kind: ParameterKind;
  defaultValue: unknown;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  options?: readonly string[];   // enum only
  smoothing: Smoothing;          // "none" declares the parameter structural
  morph: MorphPolicy;
  flag: ViewFlag;                // default "default"; see §10.2
  automatable: boolean;
}
```

| ID | Requirement |
|---|---|
| R-PARAM-01 | `smoothing: "none"` MUST mean structural. The compiler MUST place such values in `structure` and every other value in `parameters`. |
| R-PARAM-02 | A change confined to `parameters` MUST NOT rebuild any engine module. |
| R-PARAM-03 | A change to any `structure` field MUST rebuild exactly the owning module and MUST leave every other module untouched. |
| R-PARAM-04 | Every `number` parameter MUST declare `min`, `max` and `unit`. |
| R-PARAM-05 | Every parameter MUST resolve to an engine index or appear in `PARAMS_HANDLED_ELSEWHERE` with a written reason. |
| R-PARAM-06 | Every engine index MUST name a declared parameter or appear in `ENGINE_ONLY_PARAMS`. |
| R-PARAM-07 | A value outside `[min, max]` MUST be clamped at the engine boundary. |
| R-PARAM-08 | A non-finite value MUST be replaced by the parameter's default. |

**Tests**

- `R-PARAM-02`: build a plan, snapshot the engine call log, change one
  non-structural value, assert zero `add_module` and zero `remove_module`.
- `R-PARAM-03`: as above with a structural value; assert exactly one
  `remove_module` and one `add_module`, and that sibling module ids are stable.
- `R-PARAM-05/06`: the existing total-contract test, extended to every module
  as each is added.

### 3.3 Graph

```ts
interface Edge {
  id: EdgeId;
  from: { nodeId: NodeId; portId: PortId };
  to:   { nodeId: NodeId; portId: PortId };
  enabled: boolean;
}
```

| ID | Requirement |
|---|---|
| R-GRAPH-01 | A connection MUST be refused when the port signal types are incompatible. |
| R-GRAPH-02 | A cycle MUST be refused unless every path around it passes through a module declaring `breaksFeedback`. |
| R-GRAPH-03 | A feedback path MUST be bounded such that a unit impulse decays to below −60 dBFS within 30 s at maximum feedback. |
| R-GRAPH-04 | Compilation MUST be deterministic: the same document MUST yield an identical plan, including ordering. |
| R-GRAPH-05 | An unknown `moduleType` MUST be preserved through load and save, and MUST be reported. |
| R-GRAPH-06 | Removing a node MUST remove every edge referencing it. |

---

## 4. The Rust module contract

### 4.1 The trait

```rust
pub trait Module: Send {
    fn process(&mut self, ctx: &ProcessContext, ports: &mut Ports);

    fn input_count(&self) -> usize;
    fn output_count(&self) -> usize;
    fn param_count(&self) -> usize;
    fn param_default(&self, index: usize) -> f32;

    fn set_sample_rate(&mut self, sample_rate: f32) {}
    fn reset(&mut self) {}

    fn set_sample_slot(&mut self, slot: u32, sample: u32) {}
    fn note_on(&mut self, note: u8, velocity: f32, detune_cents: f32) {}
    fn note_off(&mut self, note: u8) {}
    fn all_notes_off(&mut self) {}
    fn set_modulation(&mut self, source: u32, dest: u32, amount: f32) {}

    /// P7. Fill the caller's slice with this module's Stream 2 data.
    fn telemetry(&self, _out: &mut [f32]) -> usize { 0 }

    /// P15. Choke group this module currently sounds in; 0 means none.
    fn choke_group(&self) -> u8 { 0 }
    fn choke(&mut self) {}
}
```

| ID | Requirement |
|---|---|
| R-MOD-01 | `process` MUST write exactly `output_count()` outputs on every call. |
| R-MOD-02 | `process` MUST be allocation-free. |
| R-MOD-03 | `param_default(i)` MUST return the same value the descriptor declares for the parameter mapped to `i`. |
| R-MOD-04 | `reset` MUST return the module to the state a freshly constructed instance would have, retaining parameter values. |
| R-MOD-05 | `set_sample_rate` MUST re-derive every rate-dependent coefficient. |
| R-MOD-06 | Every effect MUST place `mix`, `level`, `mute` as its last three parameter indices, consecutively. |
| R-MOD-07 | An effect MUST pass its input through unchanged when `mix = 0`, within ±1e-6. |
| R-MOD-08 | `mute = 1` MUST produce silence within one smoothing window. |
| R-MOD-09 | A module MUST NOT read the sample bank outside `process`. Notes needing bank access queue and start on the next sample. |

**Tests**

- `R-MOD-06`: iterate every effect kind; assert the three indices are
  `param_count()-3 .. param_count()-1` and in that order.
- `R-MOD-07`: feed a known signal at `mix = 0`; assert output equals input.
- `R-MOD-02`: `assert_no_alloc` wrapper around a 1000-quantum render of every
  module kind.

### 4.2 Ports and frames — P1, P2

```rust
pub const MAX_CHANNELS: usize = 16;

#[derive(Clone, Copy)]
pub struct Frame {
    pub data: [f32; MAX_CHANNELS],
    pub channels: u8,
}

pub struct PortSpec {
    pub kind: SignalKind,   // Audio | Control | Note | Telemetry
    pub channels: u8,
}
```

| ID | Requirement |
|---|---|
| R-FRAME-01 | A cable MUST carry a `Frame`. Channel count travels with the signal. |
| R-FRAME-02 | Connecting an N-channel output to an M-channel input where N < M MUST duplicate the last channel. Where N > M it MUST sum the surplus into the last channel. |
| R-FRAME-03 | A cable MUST introduce exactly one sample of delay. |
| R-FRAME-04 | A module MUST declare per-port channel counts and MUST NOT assume mono. |
| R-FRAME-05 | The engine output MUST be stereo. A mono source MUST reach both channels at equal gain. |

**Tests**

- `R-FRAME-03`: patch A → B, inject an impulse, assert B sees it exactly one
  sample later.
- `R-FRAME-05`: pan a synth hard left; assert left channel energy exceeds right
  by more than 40 dB.

### 4.3 Summing bus — P3

| ID | Requirement |
|---|---|
| R-BUS-01 | A bus MUST sum its inputs sample-accurately with no scaling by input count. |
| R-BUS-02 | Summing MUST be order-independent to within `f32` associativity, asserted at ±1e-6. |
| R-BUS-03 | A disconnected input MUST contribute exact zero. |
| R-BUS-04 | A send MUST be selectable pre- or post-fader, per send. |
| R-BUS-05 | Solo on any strip MUST silence every non-soloed strip and MUST be reversible with no click. |

---

## 5. The WASM ABI

Every export, its exact signature and its refusal behaviour. `u32::MAX` is the
`NO_MODULE` sentinel and arrives in JavaScript as `-1`; every id crosses back
through `asModuleId`.

### 5.1 Lifecycle

| Export | Signature | Semantics |
|---|---|---|
| `init` | `(sample_rate: f32)` | Build the engine. Idempotent per instance. |
| `reset` | `()` | Clear DSP state, retain topology and parameters. |
| `quantum_size` | `() -> u32` | Returns `QUANTUM`. |

### 5.2 Topology

| Export | Signature | Refusal |
|---|---|---|
| `add_module` | `(kind: u32) -> u32` | `NO_MODULE` for unknown kind |
| `add_module_variant` | `(kind: u32, variant: u32) -> u32` | as above; unknown variant builds variant 0 |
| `remove_module` | `(id: u32) -> u32` | `0` when the id is unknown |
| `connect` | `(fm, fp, tm, tp: u32) -> u32` | `0` when already connected or a port is out of range |
| `disconnect` | `(fm, fp, tm, tp: u32) -> u32` | `0` when no such cable |
| `set_io` | `(input_module, output_module: u32)` | — |
| `module_count` | `() -> u32` | — |
| `cable_count` | `() -> u32` | — |

### 5.3 Parameters and notes

| Export | Signature | Notes |
|---|---|---|
| `set_param` | `(module, index: u32, value: f32)` | Out-of-range index ignored; non-finite value ignored |
| `set_bypassed` | `(module: u32, bypassed: u32)` | — |
| `set_modulation` | `(module, source, dest: u32, amount: f32)` | Unknown source or dest dropped |
| `note_on` | `(module, note: u32, velocity: f32, detune_cents: f32)` | `note > 127` refused; non-finite velocity refused; non-finite detune coerced to 0 |
| `note_off` | `(module, note: u32)` | — |
| `all_notes_off` | `(module: u32)` | — |

### 5.4 Rendering

| Export | Signature | Notes |
|---|---|---|
| `input_ptr` | `() -> *mut f32` | `QUANTUM` floats |
| `output_ptr` | `() -> *mut f32` | `QUANTUM × 2` floats once stereo lands |
| `process_quantum` | `()` | `process_range(0, QUANTUM)` |
| `process_range` | `(start: u32, len: u32)` | Renders nothing when `start + len > QUANTUM` |

### 5.5 Samples and telemetry

| Export | Signature | Notes |
|---|---|---|
| `sample_alloc` | `(id, channels, frames: u32, rate: f32) -> u32` | `0` on refusal |
| `sample_ptr` | `(id: u32) -> *mut f32` | `0` when unknown |
| `sample_len` | `(id: u32) -> u32` | channels × frames |
| `sample_free` | `(id: u32)` | Freeing nothing is safe |
| `sample_count` | `() -> u32` | — |
| `set_sample_slot` | `(module, slot, sample: u32)` | — |
| `telemetry_ptr` | `() -> *mut f32` | P7 |
| `telemetry_drain` | `() -> u32` | Floats written; resets the ring |

| ID | Requirement |
|---|---|
| R-ABI-01 | Every refusal MUST return its documented sentinel and MUST leave engine state unchanged. |
| R-ABI-02 | Growing WASM memory detaches JavaScript views. Every host-side view MUST be re-derived after any call that can allocate. |
| R-ABI-03 | `process_range` with `start + len > QUANTUM` MUST write no sample. |
| R-ABI-04 | Nonsense input MUST NOT panic. The callback MUST continue producing finite output. |
| R-ABI-05 | `rust/wasm/verify.mjs` MUST exercise every export against the real `.wasm`. |

**Tests** — `verify.mjs`, one check per row above, plus a fuzz pass driving
every export with boundary and nonsense values asserting `Number.isFinite` on
the rendered output.

---

## 6. Worklet protocol

```ts
type ScheduledEvent =
  | { type: "note-on"; note: number; velocity: number; detuneCents: number }
  | { type: "note-off"; note: number }
  | { type: "all-notes-off" };

type RackMessage =
  | ScheduledEvent
  | { type: "plan"; plan: AudioPlan }
  | { type: "sample"; slot: number; channels: Float32Array[]; sampleRate: number }
  | { type: "sample-map"; map: Record<string, number> }
  | { type: "schedule"; nodeId: NodeId; atSec: number; events: ScheduledEvent[] }
  | { type: "modulation"; nodeId: NodeId; source: number; dest: number; amount: number }
  | { type: "reset" };

interface RackReport {
  type: "report";
  modules: number; cables: number; samples: number;
  peak: number; quanta: number;
  telemetry?: Float32Array;
}
```

| ID | Requirement |
|---|---|
| R-PROTO-01 | Audio MUST reach the engine before any plan naming it. |
| R-PROTO-02 | Channel buffers MUST be transferred. The caller MUST hand over copies it does not retain. |
| R-PROTO-03 | A plan MUST be posted only when `generation` has changed. |
| R-PROTO-04 | Notes MUST NOT be deduplicated. Two identical note-ons are two notes. |
| R-PROTO-05 | A scheduled batch MUST name its target `nodeId`. |
| R-PROTO-06 | An unresolvable `nodeId` MUST sound nothing. |
| R-PROTO-07 | Reports MUST arrive every `REPORT_INTERVAL` quanta. |
| R-PROTO-08 | `peak` MUST be the maximum absolute output sample of the interval just ended, resetting each report. |

---

## 7. Timing

| ID | Requirement |
|---|---|
| R-TIME-01 | A scheduled note MUST sound at its exact frame. The quantum MUST be broken with `process_range` at every due frame. |
| R-TIME-02 | A note due at frame F MUST sound in the quantum containing F, including when F is the first frame of that quantum. |
| R-TIME-03 | An overdue note MUST sound at the start of the next quantum. |
| R-TIME-04 | Insertion into the schedule MUST be stable. A note-off MUST NOT overtake the note-on it belongs to at the same frame. |
| R-TIME-05 | A full schedule MUST shed the furthest-future entry. |
| R-TIME-06 | `reset` MUST clear the schedule. |
| R-TIME-07 | With nothing scheduled, a quantum MUST render as exactly one `process_range` call. |
| R-TIME-08 | A non-finite frame MUST be refused at push. |

**Tests** — measure the sample index of the first non-zero output against the
requested frame; assert equality (`±0 samples`).

### 7.1 Musical time

| ID | Requirement |
|---|---|
| R-TIME-10 | Musical position MUST be integer ticks at 960 PPQN. |
| R-TIME-11 | Tempo changes MUST be tempo-map events at the first affected tick and MUST NOT reinterpret elapsed real time. |
| R-TIME-12 | One shared start timestamp MUST serve every stream. |
| R-TIME-13 | One clock anchor MUST serve each output batch. |
| R-TIME-14 | Equal-time events MUST be stably ordered. |
| R-TIME-15 | Output submission MUST precede UI telemetry. |
| R-TIME-16 | Stop, Pause, Sync and output switching MUST cancel before panic or restart. |
| R-TIME-17 | Randomness in one stream MUST NOT affect another. |
| R-TIME-18 | Tick positions MUST NOT depend on React, the store, Web MIDI or Web Audio. |

### 7.2 Transport semantics

| ID | Requirement |
|---|---|
| R-TRANS-01 | **Play** MUST reset the clock to bar 1 beat 1 and MUST return every source to its loop start. |
| R-TRANS-02 | **Stop** MUST halt new material and MUST allow tails to decay naturally. |
| R-TRANS-03 | **Pause** MUST silence immediately with no tail and MUST resume from the exact frozen position. |
| R-TRANS-04 | **Panic** MUST cancel pending events, release every sounding note and bound every feedback path. |
| R-TRANS-05 | Panic MUST be asserted against the sounding-note shadow. |

---

## 8. Primitives — interface, invariants, acceptance

### 8.1 P4 · Parameter registry and morph engine

```ts
interface ParameterRegistry {
  resolve(address: ParameterAddress): ParameterDescriptor | undefined;
  addresses(): ParameterAddress[];
  read(address: ParameterAddress): unknown;
  /** Effective value: base, then macros, then an active morph. */
  effective(address: ParameterAddress): unknown;
}

interface Morph {
  start(target: Snapshot, ms: number, now: number): void;
  advance(now: number): void;
  cancel(): void;
  readonly progress: number;   // 0..1
  readonly active: boolean;
}
```

| ID | Requirement |
|---|---|
| R-P4-01 | Every parameter of every node MUST appear exactly once in `addresses()`. |
| R-P4-02 | A completed morph MUST land on the target value exactly, with no residual error. |
| R-P4-03 | An interrupted morph MUST restart from current **effective** values. |
| R-P4-04 | `excluded` parameters MUST jump on recall and MUST NOT interpolate. |
| R-P4-05 | `step-start` MUST switch at progress 0, `step-mid` at 0.5, `step-end` at 1.0. |
| R-P4-06 | Morph error at any midpoint MUST stay within 1 % of the ideal curve for that policy. |
| R-P4-07 | A morph MUST produce no discontinuity greater than the parameter's smoothing window would allow. |
| R-P4-08 | Macros MUST produce effective overrides and MUST leave the stored base value untouched. |
| R-P4-09 | A macro mapping MUST carry independent min, max, curve and polarity per target. |
| R-P4-10 | Macro curves MUST include linear, exponential, logarithmic and S-curve. |
| R-P4-11 | Snapshot capture MUST record the effective value and MUST record macro positions separately. |

**Tests**

- `R-P4-02`: morph 0 → 1 over 1000 ms, advance to exactly 1000 ms, assert
  `=== 1` with no tolerance.
- `R-P4-03`: start A → B, interrupt at 40 %, start → C; assert the first
  sample of the second morph equals the effective value at interruption.
- `R-P4-06`: sample 100 points, compare against the analytic curve.

### 8.2 P5 · Delta stream

```ts
interface DeltaEvent { atTick: number; address: ParameterAddress; value: unknown; }
interface DeltaLayer { id: string; events: DeltaEvent[]; enabled: boolean; colour: string; }
interface Capture { initial: Snapshot; layers: DeltaLayer[]; }
```

| ID | Requirement |
|---|---|
| R-P5-01 | Recording MUST begin by capturing a complete snapshot as the zero point. |
| R-P5-02 | Only changed values MUST be recorded thereafter. |
| R-P5-03 | Evaluating the capture at tick T MUST yield identical values whether reached by playback or by scrubbing. |
| R-P5-04 | Overdub MUST append a layer and MUST preserve every existing layer. |
| R-P5-05 | Overwrite MUST require explicit selection and confirmation. |
| R-P5-06 | Layers MUST be individually mutable, soloable and deletable without destroying data. |
| R-P5-07 | Re-rendering the same capture MUST produce byte-identical audio. |

### 8.3 P6 · Nested subgraph

| ID | Requirement |
|---|---|
| R-P6-01 | A compound's interior MUST be ordinary modules with no hidden processor. |
| R-P6-02 | Expand MUST drop the interior onto the parent graph and MUST produce identical scheduled output. |
| R-P6-03 | The compiler MUST treat a compound as a subgraph for cycle detection and event budgets. |
| R-P6-04 | Compounds MUST be freely instantiable with no fixed count anywhere. |
| R-P6-05 | Presets MUST exist at both levels and MUST remain distinct. |

### 8.4 P7 · Telemetry

| ID | Requirement |
|---|---|
| R-P7-01 | Each module MUST publish into a fixed-size ring allocated at construction. |
| R-P7-02 | A full ring MUST drop the oldest entry and MUST NOT block or allocate. |
| R-P7-03 | Telemetry MUST NOT alter audio output. Rendering with telemetry drained and undrained MUST be bit-identical. |
| R-P7-04 | Telemetry latency MUST NOT exceed `REPORT_INTERVAL` quanta. |
| R-P7-05 | Each module's Stream 2 payload MUST match §9.3. |

### 8.5 P8 · History buffer

| ID | Requirement |
|---|---|
| R-P8-01 | The buffer MUST be preallocated to its maximum length. |
| R-P8-02 | Writes MUST be circular and allocation-free. |
| R-P8-03 | A read of the most recent N samples MUST return them in order, N ≤ capacity. |
| R-P8-04 | Freeze MUST stop the write head and MUST leave reads working. |

### 8.6 P9 · FFT

| ID | Requirement |
|---|---|
| R-P9-01 | Forward then inverse transform MUST reconstruct the input within ±1e-5 per sample. |
| R-P9-02 | Windows MUST overlap-add to unity within ±1e-4. |
| R-P9-03 | Planning MUST occur at construction. `process` MUST perform no planning and no allocation. |
| R-P9-04 | A pure sine at bin centre MUST show ≥ 60 dB of separation from adjacent bins. |

### 8.7 P10 · Offline transport

| ID | Requirement |
|---|---|
| R-P10-01 | Offline rendering MUST use the identical `Engine` and module code as real time. |
| R-P10-02 | Rendering the same input twice MUST be byte-identical. |
| R-P10-03 | Offline output MUST match a real-time render of the same material within ±1e-6 per sample. |
| R-P10-04 | Stems MUST sum to the master mix within ±1e-6. |

### 8.8 P12 · Play states and triggers

```rust
pub enum TriggerMode {
    Sequential, WeightedSequential, Random, RoundRobin, VelocityLayered, Manual,
}
```

| ID | Requirement |
|---|---|
| R-P12-01 | A source MUST hold ≥ 1 play state and MUST refuse deletion of its last. |
| R-P12-02 | **Sequential** MUST advance one state per trigger and MUST wrap. |
| R-P12-03 | **Round robin** MUST play every state exactly once before any repeats. |
| R-P12-04 | **Random** MUST honour per-state weights, asserted over 10 000 seeded trials within ±2 % of the expected distribution. |
| R-P12-05 | **Weighted sequential** MUST play each state its configured count before advancing, and MUST repeat its cycle. |
| R-P12-06 | **Velocity layered** MUST select by user-defined thresholds, inclusive at the lower bound. |
| R-P12-07 | Playback offset MUST delay the sample by exactly `offset_ms`, asserted to ±1 sample. |
| R-P12-08 | Time-stretch MUST hold pitch constant within ±5 cents across 25 %–400 %. |
| R-P12-09 | Varispeed MUST move pitch with rate: doubling the rate MUST raise pitch by 1200 ± 5 cents. |
| R-P12-10 | Loop crossfade MUST produce no discontinuity greater than 1e-3 between adjacent samples at the loop point. |
| R-P12-11 | Crossfade curves MUST include linear, equal-power and logarithmic. Equal-power MUST hold summed power constant within ±0.5 dB. |
| R-P12-12 | Reverse MUST play the region back to front, sample-exact. |
| R-P12-13 | Granular state switching MUST crossfade, allowing states to overlap. |

### 8.9 P13 · Per-source sync

| ID | Requirement |
|---|---|
| R-P13-01 | Sync modes MUST be free, ½, 1, 2, 3, 4 bars and custom. |
| R-P13-02 | A source MUST restart at its sync boundary, truncating longer material. |
| R-P13-03 | Start offset MUST be counted in bars from global Play; the source MUST be silent until then. |
| R-P13-04 | Phase offset MUST shift entry within the bar without changing the sync period. |
| R-P13-05 | Retrigger MUST restart at the next sync boundary. |
| R-P13-06 | Mute MUST silence while the source keeps running in sync; unmute MUST re-enter at the next boundary. |
| R-P13-07 | Four sources at 1, 2, 3 and 4-bar sync MUST realign only at bar 13 (LCM), asserted on onset frames. |

### 8.10 P14 · Step sequencer

```rust
pub enum StepType { Note, Rest, Pause, Tie, Skip }
```

| ID | Requirement |
|---|---|
| R-P14-01 | **Rest** MUST consume exactly one step length and MUST emit nothing. |
| R-P14-02 | **Pause** MUST consume its own declared duration, independent of step length. |
| R-P14-03 | **Tie** MUST extend the previous note and MUST emit no new note-on. |
| R-P14-04 | **Skip** MUST consume zero time and MUST emit nothing. |
| R-P14-05 | Note length MUST be independent of step length and MAY exceed it. |
| R-P14-06 | Probability MUST be evaluated from the seeded PRNG; the same seed MUST yield the same pattern. |
| R-P14-07 | Repeat 1–4 MUST fire N evenly spaced notes within one step length. |
| R-P14-08 | Directions MUST include forward, reverse, ping-pong, random and random walk. Ping-pong MUST NOT repeat its endpoints. |
| R-P14-09 | Swing MUST delay even-numbered steps by `swing × halfStep`, 0 %–50 %. |
| R-P14-10 | Per-step velocity MUST reach the synth modulation matrix as the Velocity source. |
| R-P14-11 | Step count MUST support 1–64. |

### 8.11 P15 · Choke groups

| ID | Requirement |
|---|---|
| R-P15-01 | Groups 1–16 MUST exist session-wide; group 0 MUST mean no choke. |
| R-P15-02 | A voice firing in group N MUST cut every sounding voice in group N, across every source. |
| R-P15-03 | A choke MUST be scheduled on the audio clock at the firing voice's exact frame. |
| R-P15-04 | A choke MUST fade over 5 ms rather than cutting hard. |
| R-P15-05 | Group 0 voices MUST neither choke nor be choked. |
| R-P15-06 | Each source MUST auto-assign its own group on creation. |

### 8.12 P16 · Two-rendering faces

```tsx
type FaceMode = "edit" | "performance";
interface FaceProps { mode: FaceMode; /* … */ }
```

| ID | Requirement |
|---|---|
| R-P16-01 | Every face MUST accept `mode` and MUST render in both. |
| R-P16-02 | In `performance`, a face MUST render only parameters flagged `performance` or `always-on`. |
| R-P16-03 | Switching mode MUST change no document state. |
| R-P16-04 | A face with no flagged parameters MUST render nothing in `performance` and MUST NOT occupy space. |
| R-P16-05 | Flags MUST apply to visual elements as well as controls. |
| R-P16-06 | Performance controls MUST render at a larger hit target than edit controls. |
| R-P16-07 | Every face MUST be exercised in both modes by the DOM harness. |

### 8.13 P11 · UMP event layer

The native event representation is UMP-shaped. MIDI 1.0 becomes one encoding of
it.

```ts
interface NoteEvent {
  kind: "note-on" | "note-off";
  group: number;        // 0–15
  channel: number;      // 0–15
  note: number;         // 0–127
  velocity: number;     // 0..1
  detuneCents: number;
  noteId?: number;      // per-note identity for MPE and per-note expression
  atTick: number;
}
```

| ID | Requirement |
|---|---|
| R-P11-01 | Every generated event MUST carry a `noteId` unique to that sounding instance. |
| R-P11-02 | Encoding to MIDI 1.0 then decoding MUST round-trip note, channel, velocity and timing exactly. |
| R-P11-03 | Velocity MUST be carried as a float and MUST quantise to 7 bits only at the MIDI 1.0 encoder. |
| R-P11-04 | Per-note pitch expression MUST survive as `detuneCents` and MUST reach the instrument. |
| R-P11-05 | An MPE-capable destination MUST receive per-note channels; a non-MPE destination MUST receive the collapsed form. |
| R-P11-06 | Device loss MUST release every sounding note, asserted against the sounding-note shadow. |
| R-P11-07 | Reconnecting the same port id MUST restore its selection. |
| R-P11-08 | Configured latency MUST be reported accurately and MUST offset scheduling by exactly that amount. |

---

## 9. DSP acceptance criteria

Measurable, module by module. Every row is a test.

### 9.1 Filters and EQ

| ID | Requirement |
|---|---|
| R-DSP-01 | LP12 MUST attenuate by 12 ±1.5 dB one octave above cutoff. |
| R-DSP-02 | LP24 MUST attenuate by 24 ±1.5 dB one octave above cutoff. |
| R-DSP-03 | Cutoff MUST be accurate within ±1 % across 20 Hz–20 kHz. |
| R-DSP-04 | Resonance at maximum MUST self-oscillate at cutoff ±1 %. |
| R-DSP-05 | An EQ band at 0 dB gain MUST pass the signal within ±0.01 dB. |
| R-DSP-06 | Filter types MUST include LP12, LP24, HP, BP, Notch, and per-EQ-band bell, shelf, HP, LP, notch. |
| R-DSP-07 | Coefficients MUST remain stable across the full parameter range at every supported sample rate. |

### 9.2 Dynamics

| ID | Requirement |
|---|---|
| R-DSP-10 | Compressor gain reduction MUST match `(input − threshold) × (1 − 1/ratio)` within ±0.5 dB above the knee. |
| R-DSP-11 | The soft knee MUST be continuous in value and first derivative at both knee edges. |
| R-DSP-12 | Attack and release MUST reach 63 % of their target within the declared time ±10 %. |
| R-DSP-13 | The limiter MUST never exceed its ceiling by more than 0.1 dB for input up to +20 dBFS. |
| R-DSP-14 | The limiter knee MUST be hard. |
| R-DSP-15 | The master limiter MUST be always on and MUST NOT be patchable. |
| R-DSP-16 | Makeup gain MUST be exact within ±0.01 dB. |

### 9.3 Time and space

| ID | Requirement |
|---|---|
| R-DSP-20 | Delay time MUST be accurate to ±1 sample, free and tempo-synced. |
| R-DSP-21 | Delay feedback below 1.0 MUST decay to −60 dBFS in finite time. |
| R-DSP-22 | Ping-pong MUST alternate channels with no bleed above −60 dB. |
| R-DSP-23 | Reverb RT60 MUST match the decay parameter within ±10 %, measured by Schroeder backward integration. |
| R-DSP-24 | Pre-delay MUST be accurate to ±1 sample. |
| R-DSP-25 | Damping MUST reduce high-frequency tail energy monotonically. |
| R-DSP-26 | A reverb MUST be free of audible metallic ringing: no single mode within 20 dB of the broadband tail at any point after 100 ms. |
| R-DSP-27 | Freeze MUST sustain indefinitely with tail energy varying by less than 1 dB over 60 s. |

### 9.4 Pitch and spectrum

| ID | Requirement |
|---|---|
| R-DSP-30 | Pitch shift MUST be accurate within ±5 cents across ±24 semitones. |
| R-DSP-31 | Formant correction on MUST hold the spectral envelope centroid within ±5 % across ±12 semitones. |
| R-DSP-32 | Spectral freeze MUST hold its spectrum with frame-to-frame variation below 1 %. |
| R-DSP-33 | Shimmer intervals MUST be exact ratios of the selected interval within ±5 cents. |
| R-DSP-34 | The analyzer MUST pass audio through bit-identically. |

### 9.5 Saturation and degradation

| ID | Requirement |
|---|---|
| R-DSP-40 | Each saturation character MUST produce a distinct harmonic signature, asserted on the 2nd/3rd harmonic ratio: Tube favours 2nd, Clip favours odd, Fold produces harmonics above the 7th. |
| R-DSP-41 | Drive at zero MUST pass the signal within ±1e-6. |
| R-DSP-42 | Bit depth reduction to N bits MUST produce at most 2^N distinct output levels. |
| R-DSP-43 | Sample-rate reduction to R MUST hold each output value for exactly `round(sampleRate / R)` samples. |
| R-DSP-44 | Dither off MUST produce deterministic quantisation; dither on MUST decorrelate the error from the signal. |
| R-DSP-45 | Noise floor MUST be reproducible from the seed. |

### 9.6 Granular

| ID | Requirement |
|---|---|
| R-DSP-50 | The grain window MUST reach exactly zero at both ends. |
| R-DSP-51 | Overlapping grains at density N MUST hold summed amplitude within ±3 dB of a single grain × √N. |
| R-DSP-52 | Stretch factor F MUST advance the scan at 1/F of real time within ±1 %. |
| R-DSP-53 | Stretch MUST hold pitch within ±5 cents from 1× to 1000×. |
| R-DSP-54 | Scatter MUST be reproducible from the seed. |
| R-DSP-55 | Freeze MUST hold the read position exactly. |

### 9.7 Synthesis

| ID | Requirement |
|---|---|
| R-DSP-60 | Oscillator frequency MUST be accurate within ±1 cent. |
| R-DSP-61 | Waveforms MUST include sine, triangle, saw, square, pulse with variable width, and white and pink noise. |
| R-DSP-62 | A 50 % pulse MUST contain no even harmonics above −60 dB. |
| R-DSP-63 | Hard sync MUST reset OSC 2 phase at every OSC 1 cycle, asserted on zero-crossing alignment. |
| R-DSP-64 | Ring modulation MUST produce sum and difference frequencies within ±1 Hz and MUST suppress the carriers by ≥ 40 dB. |
| R-DSP-65 | ADSR MUST reach exactly zero at the end of release, making "finished" a fact. |
| R-DSP-66 | Glide MUST traverse from previous to target pitch over the declared time ±5 %, linear and exponential. |
| R-DSP-67 | Legato MUST change pitch without retriggering envelopes; retrigger mode MUST restart them. |
| R-DSP-68 | Voice stealing MUST take the oldest voice. |
| R-DSP-69 | Polyphony limit MUST bound simultaneously sounding voices; voices above a lowered limit MUST finish naturally. |
| R-DSP-70 | Each modulation destination MUST sum its routings then clamp to its own legal range. |
| R-DSP-71 | LFO shapes MUST include sine, triangle, saw, ramp, square, sample-and-hold, smooth random. |
| R-DSP-72 | LFO trigger modes MUST include free, note-retrigger and one-shot. |
| R-DSP-73 | Tempo-synced LFO rate MUST track the transport within ±0.1 %. |

### 9.8 Tuning

| ID | Requirement |
|---|---|
| R-DSP-80 | The library MUST hold 108 scales across the eight declared categories. |
| R-DSP-81 | Every degree MUST store true cents or an exact ratio. |
| R-DSP-82 | Degree → frequency MUST be accurate within ±0.5 cents. |
| R-DSP-83 | Root pitch MUST be settable in Hz across 20 Hz–2000 Hz. |
| R-DSP-84 | Maqam Rast degree 3 MUST sound at 351 ±5 cents above the root. |
| R-DSP-85 | Quantising to a scale MUST select the nearest degree; ties MUST resolve to the lower degree. |
| R-DSP-86 | The detune remainder MUST satisfy `|cents| ≤ 50` and MUST reach the oscillator. |

---

## 9.9 The module catalogue

### 9.9.1 The contract every module MUST satisfy

A module ships when all of the following exist. This list is the definition of
"a module is done".

| ID | Requirement |
|---|---|
| R-CAT-01 | A descriptor declaring every port with its signal kind and channel count. |
| R-CAT-02 | A descriptor declaring every parameter with kind, default, min, max, unit, smoothing, morph policy and flag. |
| R-CAT-03 | A parameter-index table, total in both directions per R-PARAM-05 and R-PARAM-06. |
| R-CAT-04 | A `ModuleKind` wire number. Appending is safe; reordering changes every saved patch. |
| R-CAT-05 | A Rust implementation satisfying §4.1 and the relevant rows of §9. |
| R-CAT-06 | A face rendering in both modes per R-P16-01. |
| R-CAT-07 | A parameter sweep test: every parameter across its full range, output finite throughout. |
| R-CAT-08 | A golden audio fixture per R-VERIFY-01. |
| R-CAT-09 | An entry in the module status grid. |
| R-CAT-10 | A `mix` / `level` / `mute` shell for every effect, per R-MOD-06. |

### 9.9.2 Wire numbers — the protocol

`ModuleKind` in `rust/dsp-core/src/modules.rs`. These numbers are persisted in
every saved patch.

| # | Kind | # | Kind |
|---|---|---|---|
| 0 | HostInput | 8 | Reverb |
| 1 | Gain | 9 | Eq |
| 2 | AudioOutput | 10 | Compressor |
| 3 | Synth | 11 | Limiter |
| 4 | Blackhole | 12 | Bitcrusher |
| 5 | Dp4Reverb | 13 | Percussion |
| 6 | Dp4NonLin | 14 | Looper |
| 7 | Delay | 15 | Granular |

| ID | Requirement |
|---|---|
| R-CAT-20 | Wire numbers MUST be append-only. |
| R-CAT-21 | An unknown kind MUST return `NO_MODULE` and MUST be reported by name. |
| R-CAT-22 | A document naming an unknown kind MUST load, MUST preserve the node, and MUST report it. |

### 9.9.3 Structural variants

Topology choices that allocate at construction. They ride in on
`add_module_variant` and rebuild the module when changed.

| Module | Field | Variants, in wire order |
|---|---|---|
| `m.audio-dp4-reverb` | `algorithm` | small-plate · large-plate · small-room · large-room · hall |
| `m.audio-dp4-nonlin` | `variant` | non-lin-1 · non-lin-2 · non-lin-3 |
| `m.looper` | `time-stretch` | false · true |
| `m.audio-reverb` | `algorithm` | algorithmic · convolution |
| `m.audio-saturation` | `character` | tube · tape · clip · fold |
| `m.audio-modulation` | `mode` | chorus · flanger · phaser |
| `m.audio-compressor` | `mode` | compressor · limiter |

| ID | Requirement |
|---|---|
| R-CAT-30 | An unrecognised variant name MUST build variant 0. |
| R-CAT-31 | Changing a variant MUST remove and re-add the module and MUST preserve its node id. |
| R-CAT-32 | Each variant MUST be audibly distinct, asserted by a measurable difference against variant 0. |

### 9.9.4 Shipped module parameters

Every effect additionally carries `mix`, `level`, `mute` as its last three
indices. Ranges are the contract; defaults are the shipped values.

**`m.audio-gain`** — `gain` 0–4 ×, default 1.

**`m.audio-output`** — `volume` 0–1, default 0.8.

**`m.audio-delay`** — `delay-seconds` 0–2 s def 0.25 · `feedback` 0–0.95 def 0.3
· `max-delay-seconds` *structural* 0.1–8 s def 2.

**`m.audio-reverb`** — `tail-seconds` 0.1–20 def 2 · `damping-hz` 200–20000 def
6000 · `decay-rate` 0.1–10 def 2 · `algorithm` *structural*.

**`m.audio-eq`** — per band ×4: `frequency` 20–20000 Hz · `gain-db` −24…+24 dB
· `q` 0.1–18 · `type` *structural* enum.

**`m.audio-compressor`** — `threshold-db` −60…0 def −24 · `ratio` 1–20 def 4 ·
`knee-db` 0–40 def 30 · `attack-seconds` 0.0001–1 def 0.003 ·
`release-seconds` 0.005–5 def 0.25 · `makeup-gain` 0–4 def 1 · `mode`
*structural*.

**`m.audio-limiter`** — `ceiling-db` −24…0 def −0.1 · `release-seconds`
0.001–1 def 0.05.

**`m.audio-bitcrusher`** — `bit-depth` 1–16 def 8 · `tone-hz` 200–20000 def 8000
· `sample-rate-hz` 500–48000 def 48000 · `noise-floor` 0–1 def 0 · `dither`
boolean def false · `output-level` 0–4 def 1.

**`m.audio-blackhole`** — `gravity` 0–1 · `size` 0–1 · `pre-delay-seconds` 0–0.5
· `low-level-db` −60…+12 · `high-level-db` −60…+12 · `mod-depth` 0–1 ·
`mod-rate` 0.01–10 Hz · `feedback` 0–1 · `resonance` 0–1 · `line-count`
*structural*.

**`m.audio-dp4-reverb`** — `decay-seconds` · `pre-delay-seconds` · `lf-decay` ·
`hf-damping` · `hf-bandwidth` · `diffusion-1` · `diffusion-2` ·
`decay-definition` · `detune-rate` · `detune-depth` · `primary-send` ·
`ref-1-level` · `ref-1-send` · `ref-2-level` · `ref-2-send` · `early-refs` ·
`algorithm` *structural*.

**`m.audio-dp4-nonlin`** — `envelope-1` … `envelope-9` · `hf-damping` ·
`hf-bandwidth` · `diffusion-1` · `diffusion-2` · `density-1` · `density-2` ·
`variant` *structural*. Carries no feedback path by design.

**`m.synth`** — `level` · per oscillator ×3: `wave` *structural* enum,
`semitones` −24…+24, `detune` −50…+50 cents, `level` 0–1, `width` 0–1 ·
`cutoff` 20–20000 Hz · `resonance` 0–1 · `filter-amount` −8…+8 octaves ·
`key-follow` 0–1 · amp ADSR · filter ADSR · per LFO ×2: `shape` *structural*,
`trigger` *structural*, `rate` 0.01–50 Hz, `depth` 0–1, `phase` 0–360° ·
`pan` −1…+1 · `volume` 0–1 · `mod-wheel` 0–1 · `max-voices` 1–64 def 16 ·
`matrix` *structural* json.

**`m.percussion`** — `pitch-semitones` −24…+24 · `decay-seconds` 0.01–10 ·
`slots` *structural* json.

**`m.looper`** — `rate` 0.05–4 × · `pitch-shift` −24…+24 st · `loop-start` 0–1 ·
`loop-end` 0–1 · `loop` *structural* · `reverse` *structural* · `gate`
*structural* · `time-stretch` *structural* · `asset-id` *structural*.

**`m.granular`** — `grain-size` 0.005–2 s · `grain-spacing` 0.005–1 s ·
`position` 0–1 · `jitter` 0–1 · `stretch` 0.05–8 × · `freeze` *structural* ·
`free-run` boolean · `asset-id` *structural*.

| ID | Requirement |
|---|---|
| R-CAT-40 | Every module above MUST be swept across every parameter's full range with finite output throughout. |
| R-CAT-41 | Every default MUST lie inside its declared range. |
| R-CAT-42 | Each module added in later waves MUST arrive with its own table in this section, in the same commit. |

---

## 10. UI contracts

### 10.1 Control kinds

| ID | Requirement |
|---|---|
| R-UI-01 | Control kind MUST be derived from the descriptor: boolean → toggle; enum → selector; string → text; number with an integer step spanning ≤ 24 → stepper; unit `dB` → fader; otherwise knob. |
| R-UI-02 | Every control MUST carry an accessible name. |
| R-UI-03 | Every pointer gesture MUST have a keyboard equivalent. |
| R-UI-04 | Every control MUST show a visible focus state. |
| R-UI-05 | Animation MUST respect `prefers-reduced-motion`. |

### 10.2 Flags and modes

| ID | Requirement |
|---|---|
| R-UI-10 | Flag state MUST be settable by right-click on the parameter in Edit mode. |
| R-UI-11 | Performance-flagged parameters MUST take the accent colour in Edit mode. |
| R-UI-12 | Always-On elements MUST refuse flagging off: transport, BPM, master level and metering, CPU meter, global panel. |
| R-UI-13 | Flag state MUST persist in the document. |

### 10.3 Canvas

| ID | Requirement |
|---|---|
| R-UI-20 | Cable endpoints MUST derive from measured port geometry at every zoom level. |
| R-UI-21 | Zoom MUST anchor to the pointer. |
| R-UI-22 | Below 0.6 zoom, controls MUST become non-interactive while remaining visible. |
| R-UI-23 | Drag-to-patch MUST work from either end and MUST cancel on Escape. |
| R-UI-24 | Compatible ports MUST highlight during a pending connection. |
| R-UI-25 | Multi-select, marquee and grouping MUST operate on the selection as a unit. |
| R-UI-26 | The module menu MUST be searchable and MUST reach every registered module. |
| R-UI-27 | The page body MUST NOT scroll horizontally at any viewport width ≥ 375 px. |

### 10.4 Undo

| ID | Requirement |
|---|---|
| R-UI-30 | Undo depth MUST be 30, per window. |
| R-UI-31 | Undo MUST survive save, open and new. |
| R-UI-32 | Undoable: parameters, node and bank create/delete/move, connections, column operations, routing, play-state changes, snapshots, flag assignments. |
| R-UI-33 | Not undoable: captured audio, file operations, preferences. |
| R-UI-34 | Exhaustion MUST drop the oldest entry and MUST warn without interrupting. |

---

## 11. Persistence

| ID | Requirement |
|---|---|
| R-DOC-01 | Every released schema version MUST keep a fixture and a migration test. |
| R-DOC-02 | Save → load → save MUST be byte-identical. |
| R-DOC-03 | The document MUST store the asset manifest and MUST NOT store audio. |
| R-DOC-04 | `.mmodpack` MUST carry the audio and MUST open on a machine that never saw the originals. |
| R-DOC-05 | A missing asset MUST load as a named, greyed entry that still saves. |
| R-DOC-06 | Workspace preferences MUST stay out of the portable document. |
| R-DOC-07 | Autosave MUST run at the configured interval and MUST support recovery after a forced reload. |
| R-DOC-08 | Decoding MUST be defensive: corrupt, partial and future-versioned documents MUST produce an actionable report rather than a throw. |

---

## 12. Verification regime

### 12.1 Gates — all MUST pass before any commit

```bash
npm run typecheck
npm test
npm run coverage        # 100% statements · lines · functions on .ts
cargo test --manifest-path rust/Cargo.toml
npm run verify:wasm     # against the real .wasm
npm run build
npm run spec:audit      # every R- id has a citing test
```

### 12.2 Test layers

| Layer | Covers | Tool |
|---|---|---|
| Pure unit | graph commands, compilation, morph curves, schedule ordering, tuning maths | vitest |
| Rust unit | every DSP module, measured against §9 | cargo test |
| ABI | every export, boundary and nonsense input | verify.mjs |
| DOM | every face in both modes, a11y | vitest + jsdom |
| Golden audio | rendered fixtures compared sample-exact | cargo test + committed fixtures |
| Golden musical | seeded traces at 1, 4, 8, 16 streams, asserted at three lookaheads and one whole-span window | vitest |
| Browser | anything a user can see | in-app browser |

### 12.3 Golden fixtures

| ID | Requirement |
|---|---|
| R-VERIFY-01 | Each instrument and effect family MUST own a rendered audio fixture committed to the repository. |
| R-VERIFY-02 | A fixture MUST be regenerated only alongside a commit explaining the change in sound. |
| R-VERIFY-03 | Fixtures MUST be mono, 1 s, 48 kHz, 32-bit float to bound their size. |
| R-VERIFY-04 | Golden musical traces MUST be identical across all three lookahead settings and the whole-span window. |

### 12.4 The browser pass

A wave closes when its gate has been demonstrated in a browser. Record in the
commit: what was patched, what was heard, what was measured.

Defects invisible to a green suite, and the reason this step is binding:
players with no processor, a rack rendering silence because the host input was
never wired, a gallery that could not scroll, a detached `ArrayBuffer`, a synth
filter section wired to nothing.

---

## 13. Latency and responsiveness

This is a real-time performance instrument. Latency is a conformance
requirement with numbers, measured rather than felt.

### 13.1 The budget

Control-to-sound at a 128-frame buffer, 48 kHz. Each stage has a ceiling; the
total is what a performer experiences.

| Stage | Ceiling | Notes |
|---|---|---|
| Pointer or key event → main thread handler | 4 ms | one frame at 240 Hz input |
| Handler → `postMessage` posted | 1 ms | encoding only |
| Message → worklet receipt | 3 ms | one render callback of jitter |
| Worklet receipt → first affected sample | 2.7 ms | one quantum |
| Engine → device | 10 ms | browser output latency, reported by `AudioContext.outputLatency` |
| **Total control-to-sound** | **≤ 20 ms** | |
| **Total, excluding device output** | **≤ 10 ms** | the part we control |

| ID | Requirement |
|---|---|
| R-LAT-01 | Control-to-sound excluding device output MUST NOT exceed 10 ms at a 128-frame buffer. |
| R-LAT-02 | A scheduled note MUST sound at its exact frame regardless of message latency. Scheduling MUST absorb jitter rather than pass it on. |
| R-LAT-03 | A parameter change MUST become audible within one quantum plus its declared smoothing window. |
| R-LAT-04 | MIDI-in to sound MUST NOT exceed 15 ms including device and driver. |
| R-LAT-05 | The engine MUST report measured output latency and MUST offset scheduling by it. |
| R-LAT-06 | Reported latency MUST be accurate within ±1 ms, verified against a loopback measurement. |
| R-LAT-07 | Buffer size MUST be user-selectable where the platform allows, and the resulting latency MUST be displayed in milliseconds. |

### 13.2 Never block the audio thread

| ID | Requirement |
|---|---|
| R-LAT-10 | A render callback MUST complete within 50 % of its wall-clock budget at the target patch size — 1.33 ms of a 2.67 ms quantum. |
| R-LAT-11 | Callback overrun MUST be counted and reported, never hidden. |
| R-LAT-12 | Sustained overrun MUST degrade gracefully: shed voices before dropping buffers. |
| R-LAT-13 | Patch compilation, asset decoding and document work MUST occur off the audio thread. |
| R-LAT-14 | A patch swap MUST NOT drop a buffer. |
| R-LAT-15 | The CPU meter MUST show the real callback load as a percentage of budget. |

### 13.3 UI responsiveness

| ID | Requirement |
|---|---|
| R-LAT-20 | A control MUST show its new value within one animation frame of the gesture. |
| R-LAT-21 | UI redraw MUST NOT gate audio. Rendering with the UI thread saturated MUST produce identical audio. |
| R-LAT-22 | Telemetry-driven displays MUST run at ≤ 30 Hz and MUST coalesce. |
| R-LAT-23 | A patch of 100 modules MUST maintain 60 fps canvas interaction on the reference machine. |
| R-LAT-24 | Meters and playheads MUST be timestamped to match audible output, compensating for output latency. |

**Tests** — a loopback harness renders a click at a known frame, captures the
device output and measures the offset; assert against R-LAT-01 and R-LAT-06.
Callback timing is sampled inside the worklet and reported in `RackReport`.

---

## 14. AV visualisation

The spec's third pillar. The engine already computes everything the image
needs; visualisation costs the transport, not the analysis.

### 14.1 Two streams

| Stream | Contents |
|---|---|
| **1 — Signal** | The audio itself: waveform, spectrum, correlation. One-to-one with what is heard. |
| **2 — Playback data** | The control and state data already driving the DSP. |

Stream 2 payload per module, published through `Module::telemetry`:

| Module | Payload |
|---|---|
| Reverb | decay curve, RT60, pre-delay position, diffusion density |
| Delay | repeat positions, feedback level, ping-pong L/R position |
| Chorus · Flanger · Phaser | LFO shape and phase, modulation depth |
| EQ | per-band gain, full curve shape |
| Compressor · Limiter | gain reduction over time, threshold crossings, attack/release arcs |
| Pitch shifter | shift amount, voice positions on a pitch grid |
| Saturation | drive curve, harmonic distribution |
| Stereo widener | width, L/R correlation coefficient |
| Granular | grain positions, density, scatter, freeze state, source position |
| Spectral freeze | frozen spectrum, shimmer interval, blur |
| Bit crusher | bit depth, rate reduction, noise floor |
| Analyzer | band levels: sub, low, mid, high, air |
| Synth | per-voice envelope stage, filter cutoff, LFO phase, active voice count |
| Sampler | playhead position, active voices, choke events |

| ID | Requirement |
|---|---|
| R-AV-01 | Every module MUST publish its declared Stream 2 payload. |
| R-AV-02 | Telemetry MUST NOT alter audio. Rendering with telemetry drained and undrained MUST be bit-identical. |
| R-AV-03 | Telemetry MUST be published from a preallocated ring, dropping oldest on overflow. |
| R-AV-04 | Visualisation MUST reflect current wet/dry and bypass state. A bypassed node MUST show its dry passthrough. |
| R-AV-05 | A module without a payload MUST publish length zero rather than absent data. |

### 14.2 Global analysis

Computed once from the master output and shared.

| ID | Requirement |
|---|---|
| R-AV-10 | The global analyser MUST publish amplitude, band levels, transient flags, spectral centroid, onset detection, pitch tracking and stereo width. |
| R-AV-11 | Onset detection MUST report within 20 ms of the transient. |
| R-AV-12 | Pitch tracking MUST be accurate within ±10 cents for a monophonic source above −30 dBFS. |
| R-AV-13 | Spectral centroid MUST be accurate within ±2 % against a reference computation. |
| R-AV-14 | Analysis MUST run once per frame at most and MUST be shared by every consumer. |

### 14.3 Connection visualisation

| ID | Requirement |
|---|---|
| R-AV-20 | Modes MUST include amplitude glow (default), waveform-on-wire and frequency colour shift, and MUST be combinable. |
| R-AV-21 | A silent connection MUST be visually distinct from an active one. |
| R-AV-22 | Connection rendering MUST be frame-budgeted and MUST degrade to amplitude glow when the budget is exceeded. |

### 14.4 The Visualizer window

| ID | Requirement |
|---|---|
| R-AV-30 | The Visualizer MUST recompose already-computed streams and MUST perform no independent analysis. |
| R-AV-31 | Opening the Visualizer MUST NOT change audio output, asserted bit-identically. |
| R-AV-32 | A preset MUST declare composition rules, an effect stack, audio mappings and its exposed parameters. |
| R-AV-33 | The effect stack MUST support blur, kaleidoscope, feedback, colour mapping, particles, waveform draw, geometric and glitch. |
| R-AV-34 | Output MUST support 1080p, 4K and custom, and MUST hold 60 fps at 1080p on the reference machine. |
| R-AV-35 | Dropping below 30 fps MUST reduce visual quality and MUST never introduce audio back-pressure. |
| R-AV-36 | A preset MUST be exportable and re-importable, round-tripping exactly. |
| R-AV-37 | Rendered video MUST stay frame-locked to the audio timeline within ±1 frame over 10 minutes. |

---

## 15. Instrument modules — playable without patching

A module that needs six cables before it makes a sound is a component. An
instrument makes sound on its own. Every module in the `instrument` family
satisfies the contract below, so dropping one on the canvas and pressing play
produces music.

### 15.1 The self-contained instrument contract

```
transport in ──► [ sequencer ─► voice ─► effects ] ──► audio out
                       ▲            ▲
                  scale/tuning   preset
```

| ID | Requirement |
|---|---|
| R-INST-01 | An instrument MUST accept transport: clock, start, stop, continue, song position. |
| R-INST-02 | An instrument MUST make sound with no cable other than its audio output. |
| R-INST-03 | An instrument MUST carry an internal sequencer per P14, enabled by default. |
| R-INST-04 | An instrument MUST start on transport start and MUST stop on transport stop, honouring its sync mode and start offset per P13. |
| R-INST-05 | An instrument MUST accept external notes, which MUST override the internal sequencer for as long as they arrive. |
| R-INST-06 | An instrument MUST carry a scale and root, and MUST quantise to true cents per R-DSP-81. |
| R-INST-07 | An instrument MUST ship ≥ 16 presets that are musically useful on load. |
| R-INST-08 | An instrument MUST expose a performance subset of ≤ 8 controls flagged by default, so it is playable in Performance mode with no configuration. |
| R-INST-09 | An instrument MUST carry its own output level, pan and mute. |
| R-INST-10 | An instrument's internal sequencer MUST be bypassable, leaving a plain note-driven voice. |
| R-INST-11 | An instrument MUST report its active voice count and current step as telemetry. |

### 15.2 The roster

Each is one module, complete, playable on drop.

| Module | Voice | Sequencer | Wave |
|---|---|---|---|
| `m.inst-tunesynth` | 3-osc subtractive, filter, 2 ADSR, 2 LFO, 8×12 matrix | mono note sequencer, 108 scales | 3 |
| `m.inst-bass` | 4-osc subtractive, mono priority, glide, sub | mono, gate/accent/slide per step | 4 |
| `m.inst-lead` | oscillator/sample hybrid, pitch-envelope blips | mono, ratchet and probability | 4 |
| `m.inst-chord` | 4-op FM, curated algorithms | chord sequencer, scale-aware voicings | 5 |
| `m.inst-poly` | virtual-analog, detune, unison, chorus | chord sequencer | 5 |
| `m.inst-drums` | 12-pad sampler, choke groups, per-pad shaping | 16-step × 12-lane grid, per-step probability and variation | 5 |
| `m.inst-pad` | keymapped sampler, layers, slow envelopes | held-chord sequencer with slow morph | 5 |
| `m.inst-grain` | granular engine, scan, spray, freeze | position sequencer | 5 |

| ID | Requirement |
|---|---|
| R-INST-20 | Every roster entry MUST satisfy §15.1 in full. |
| R-INST-21 | Each MUST be reachable from the module menu in one action. |
| R-INST-22 | Each MUST hold ≤ 20 % of one CPU core at 8-voice polyphony on the reference machine. |
| R-INST-23 | Instruments MUST reuse the shared primitives rather than carrying private copies of oscillators, filters, envelopes or sequencers. |

### 15.3 Transport contract

| ID | Requirement |
|---|---|
| R-INST-30 | Clock MUST be accepted from the internal transport, external MIDI clock or a host. |
| R-INST-31 | Start MUST reset the internal sequencer to step 1. |
| R-INST-32 | Continue MUST resume from the stored position. |
| R-INST-33 | Song position MUST relocate the sequencer to the corresponding step. |
| R-INST-34 | Tempo change MUST take effect at the next step boundary without dropping or duplicating a step. |
| R-INST-35 | Stop MUST release every sounding note through its release stage. |

---

## 16. DP/4+ conformance

Our DP/4+ clone reproduces the ENSONIQ DP/4+ (Reference Manual v2.0, 199 pages)
as a module family. Ported today: five reverb algorithms and three Non-Lin
variants — 8 of 46.

### 16.1 The unit and config model

The hardware is four independent processors (units A, B, C, D) whose inputs,
outputs and interconnections are software-defined.

| ID | Requirement |
|---|---|
| R-DP4-01 | The module MUST present four units, each independently loadable with any algorithm. |
| R-DP4-02 | Source configuration MUST support 1, 2, 3 and 4 sources. |
| R-DP4-03 | Each source MUST be selectable mono or stereo where its configuration allows. |
| R-DP4-04 | Units MUST be connectable in serial, parallel and feedback routing. |
| R-DP4-05 | Feedback routing MUST be bounded per R-GRAPH-03. |
| R-DP4-06 | Any unit MUST be bypassable individually; all four MUST be bypassable together. |
| R-DP4-07 | A Config preset MUST store every algorithm, all routing and all mixing, and MUST recall them exactly. |
| R-DP4-08 | 50 ROM presets MUST ship read-only; 50 RAM slots MUST be user-writable. |
| R-DP4-09 | An algorithm MAY claim 1, 2 or 4 units. Loading a multi-unit algorithm MUST consume its neighbours and MUST report what it displaced. |
| R-DP4-10 | Every unit MUST carry Mix and Volume as its first two parameters, matching the hardware's parameter 01 and 02. |

### 16.2 Modulation

| ID | Requirement |
|---|---|
| R-DP4-20 | Each algorithm MUST expose its modulatable parameters to the modulation system. |
| R-DP4-21 | Modulation sources MUST include CV pedal, MIDI controller, note-on velocity, LFO and envelope follower. |
| R-DP4-22 | A CV pedal source MUST map to a parameter with independent min, max and polarity. |
| R-DP4-23 | Crossfading between two units' outputs MUST be available as a modulation destination. |

### 16.3 The algorithm roster

46 algorithms. Status against the current build.

| Algorithm | Units | State |
|---|---|---|
| SMALL PLATE | 1 | **ported** |
| LARGE PLATE | 1 | **ported** |
| SMALL ROOM REV | 1 | **ported** |
| LARGE ROOM REV | 1 | **ported** |
| HALL REVERB | 1 | **ported** |
| NON LIN REVERB 1 · 2 · 3 | 1 | **ported** |
| NO EFFECT (BYPASS) | 1 | to build |
| 3.3 SEC DDL | 2 | to build |
| DUAL DELAY | 1 | to build |
| MULTI TAP DELAY | 1 | to build |
| TEMPO DELAY | 1 | to build |
| 8 VOICE CHORUS | 1 | to build |
| FLANGER | 1 | to build |
| PHASER-DDL | 1 | to build |
| EQ-CHORUS-DDL | 1 | to build |
| EQ-DDL-WITH LFO | 1 | to build |
| EQ-FLANGER-DDL | 1 | to build |
| EQ-PANNER-DDL | 1 | to build |
| EQ-TREMOLO-DDL | 1 | to build |
| EQ-VIBRATO-DDL | 1 | to build |
| EQ-COMPRESSOR | 1 | to build |
| PARAMETRIC EQ | 1 | to build |
| RUMBLE FILTER | 1 | to build |
| VAN DER POL FILTER | 1 | to build |
| VCF-DISTORT 1 · 2 | 1 | to build |
| DE-ESSER | 1 | to build |
| EXPANDER | 1 | to build |
| INVERSE EXPANDER | 1 | to build |
| KEYED EXPANDER | 1 | to build |
| DUCKER / GATE | 1 | to build |
| GATED REVERB | 1 | to build |
| REVERSE REVERB 1 · 2 | 1 | to build |
| DIGITAL TUBE AMP | 1 | to build |
| DYNAMIC TUBE AMP | 1 | to build |
| GUITAR AMP 1 · 2 · 3 · 4 | 1 | to build |
| SPEAKER CABINET | 1 | to build |
| ROTATING SPEAKER | 1 | to build |
| TUNABLE SPEAKER 1 · 2 | 1 | to build |
| PITCH SHIFTER | 1 | to build |
| FAST PITCH SHIFT | 1 | to build |
| PITCHSHIFT-DDL | 1 | to build |
| PITCH SHIFT | 2 | to build |
| VOCAL REMOVER | 1 | to build |
| VOCODER | 2 | to build |
| SINE/NOISE GEN | 1 | to build |
| GUITAR TUNER | 2 | to build |

| ID | Requirement |
|---|---|
| R-DP4-30 | Every algorithm above MUST exist as a structural variant of the DP/4+ module. |
| R-DP4-31 | Each MUST carry its complete parameter set from the manual, with the manual's ranges and units. |
| R-DP4-32 | Each MUST arrive with its parameter table in §9.9.4, per R-CAT-42. |
| R-DP4-33 | Multi-unit algorithms MUST declare their unit count and MUST refuse to load where insufficient units are free. |
| R-DP4-34 | Each MUST carry a golden audio fixture per R-VERIFY-01. |
| R-DP4-35 | Reverb algorithms MUST satisfy §9.3; dynamics algorithms §9.2; filter algorithms §9.1. |
| R-DP4-36 | Decay Definition MUST be applied inside the tank once `Fdn` gains an allpass hook. Current divergence: it is applied to the tank's feed, which is close at moderate settings and thinner at extremes. |
| R-DP4-37 | Non-Lin algorithms MUST carry no feedback path, matching the hardware. |
| R-DP4-38 | Every unit MUST hold ≤ 5 % of one CPU core, so four units and the rest of a patch coexist. |

### 16.4 What the clone changes on purpose

| Change | Reason |
|---|---|
| Cables carry one sample rather than a 20 ms block | The hardware's units are physically wired; a one-sample cable is closer to it than a render quantum |
| Any number of DP/4+ instances | The hardware is one box; the constraint is not musical |
| Tempo Delay syncs to the app transport | The hardware has no host clock |
| Parameters are automatable per §8.1 | The hardware has a pedal and MIDI CC |

---

## Appendix C — Constraints register

Every constraint established across this project, in one place, each with the
means to verify it. This is the list to check a build against.

### C.1 Architectural — settled, verify by inspection

| # | Constraint | Verify |
|---|---|---|
| C-01 | All audio DSP is Rust compiled to WASM, in one AudioWorklet | R-GLOBAL-08 source scan |
| C-02 | One audio backend. No fallback, no flag, no conditional path | grep for `engine=` and backend branches |
| C-03 | Web Audio is used for context lifecycle, `decodeAudioData`, and one output connection | R-HOST-01 |
| C-04 | The free-form canvas is the shell. Mixer and tracker are modules on it | plan §1.1 |
| C-05 | Two modes: Edit and Performance. No second layout | R-P16-01…07 |
| C-06 | The musical runtime stays in TypeScript on the main thread | by inspection |
| C-07 | The document is the truth; every view is a projection | R-P16-03 |
| C-08 | Runs from a URL. No install, no `SharedArrayBuffer`, no COOP/COEP | build and deploy |
| C-09 | One `ParameterAddress` for every value, used by every subsystem | R-ID-01 |
| C-10 | Structure rebuilds, parameters ramp; declared, never inferred | R-PARAM-01…03 |

### C.2 Real-time — measurable

| # | Constraint | Verify |
|---|---|---|
| C-11 | No allocation on the audio thread | R-GLOBAL-01, `assert_no_alloc` |
| C-12 | No locks, no blocking, no wall-clock reads on the audio thread | R-GLOBAL-02, R-GLOBAL-03 |
| C-13 | Control-to-sound ≤ 10 ms excluding device output | R-LAT-01 |
| C-14 | Render callback ≤ 50 % of budget at target patch size | R-LAT-10 |
| C-15 | Notes are sample-accurate regardless of message jitter | R-TIME-01, R-LAT-02 |
| C-16 | A patch swap drops no buffer | R-LAT-14 |
| C-17 | Telemetry never alters audio | R-AV-02 |
| C-18 | UI load never affects audio | R-LAT-21 |
| C-19 | Denormals flushed below 1e-20 | R-GLOBAL-07 |
| C-20 | Every sample leaving any module is finite | R-GLOBAL-06 |

### C.3 Determinism

| # | Constraint | Verify |
|---|---|---|
| C-21 | Same document + seed + tempo map + input → bit-identical output | R-GLOBAL-05 |
| C-22 | Every random value comes from a seeded PRNG stored in the document | R-GLOBAL-04 |
| C-23 | Offline render matches real time within ±1e-6 | R-P10-03 |
| C-24 | Rendering a capture twice is byte-identical | R-P5-07, R-P10-02 |
| C-25 | Randomness in one stream never affects another | R-TIME-17 |
| C-26 | Compilation is deterministic including ordering | R-GRAPH-04 |

### C.4 Audio safety

| # | Constraint | Verify |
|---|---|---|
| C-27 | The master limiter is always on and not patchable | R-DSP-15 |
| C-28 | No graph edit can produce unbounded gain or feedback | R-GRAPH-03 |
| C-29 | Feedback requires an explicit bounded module | R-GRAPH-02 |
| C-30 | Bypass is a mute; `mix = 0` is the pass-through | R-MOD-07, R-MOD-08 |
| C-31 | Wet at zero keeps DSP running | R-MOD-07 |
| C-32 | Every parameter write is smoothed by the receiving module | R-GLOBAL-09 |
| C-33 | Chokes and notes are scheduled on the audio clock | R-P15-03 |
| C-34 | Panic is asserted against the sounding-note shadow | R-TRANS-05 |

### C.5 Contracts

| # | Constraint | Verify |
|---|---|---|
| C-35 | Every parameter reaches the engine or carries a written reason | R-PARAM-05 |
| C-36 | Every engine index names a declared parameter or is listed engine-only | R-PARAM-06 |
| C-37 | Every audio module has a wire number; numbering is append-only | R-CAT-20 |
| C-38 | Effects carry mix · level · mute as their last three indices | R-MOD-06 |
| C-39 | Every mapping between two vocabularies is total both ways | R-GLOBAL-10 |
| C-40 | Every module ships with the ten items in §9.9.1 | R-CAT-01…10 |
| C-41 | An instrument is playable with only its audio output patched | R-INST-02 |

### C.6 Data

| # | Constraint | Verify |
|---|---|---|
| C-42 | Asset identity is a content hash | R-ID-03 |
| C-43 | The document stores the manifest, never the audio | R-DOC-03 |
| C-44 | `.mmodpack` carries audio for travel | R-DOC-04 |
| C-45 | Save → load → save is byte-identical | R-DOC-02 |
| C-46 | Every released schema version keeps a fixture and a migration test | R-DOC-01 |
| C-47 | Workspace preferences stay out of the portable document | R-DOC-06 |
| C-48 | Unknown modules survive load and save, and are reported | R-GRAPH-05 |
| C-49 | Undo is 30 levels, per window, surviving save | R-UI-30, R-UI-31 |
| C-50 | Node ids survive rebuilds | R-ID-02 |

### C.7 Process

| # | Constraint | Verify |
|---|---|---|
| C-51 | Tests first | review |
| C-52 | 100 % statements, lines, functions on `.ts` | `npm run coverage` |
| C-53 | Every requirement here is cited by a test | `npm run spec:audit` |
| C-54 | Browser verification before a wave closes | commit record |
| C-55 | Every module has a golden audio fixture | R-VERIFY-01 |
| C-56 | Fixtures regenerate only alongside an explaining commit | R-VERIFY-02 |
| C-57 | Commit messages explain why, and state divergences plainly | review |

### C.8 Accepted costs

Consequences taken deliberately. Confirm they still hold rather than testing
them.

| # | Cost | Accepted because |
|---|---|---|
| C-58 | A browser without AudioWorklet or WASM gets a named error and silence | Both are baseline; two implementations cost more than they protect |
| C-59 | v8 coverage cannot see into WASM; Rust carries its own gate | Two gates, both green, neither replacing the other |
| C-60 | Two toolchains in CI | The engine requires it |
| C-61 | A bad sample in Rust is not a DevTools breakpoint | Offset by the fake-context discipline ported into the crate |
| C-62 | Fonts are catalogued, not shipped | Licensing |
| C-63 | DP/4+ Decay Definition currently sits outside the tank | `Fdn` lacks the hook; close at moderate settings, thinner at extremes |
| C-64 | Choke groups are absent from the Rust engine today | Wave 0 must not ship this as a silent regression |
