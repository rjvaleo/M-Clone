// The join between a compiled `AudioPlan` and the Rust engine.
//
// `compileAudioPlan` already turns a document into a plan, and that stays
// exactly as it is — the plan is platform-independent and was always the right
// place to cut. What changes is what consumes it: instead of building Web Audio
// nodes, this walks the plan and issues engine commands over the WASM ABI.
//
// The structure/parameter split that `audioPlan.ts` exists to enforce survives
// intact and gets *cheaper* here. A parameter change is one `set_param` call
// into a module that smooths it internally; there is no `AudioParam`, no ramp
// scheduling, and no crossfade protocol, because swapping a value in a running
// Rust graph is atomic in a way a node graph never was.
//
// Two things about the ABI are worth knowing before reading further:
//
//   - **WASM has no unsigned integers.** A `u32` return arrives in JavaScript
//     already reinterpreted as a signed `i32`, so the engine's `NO_MODULE`
//     sentinel (`u32::MAX`) shows up as `-1`. Every id crosses back through
//     `asModuleId`, or a refusal becomes a plausible-looking id and every later
//     parameter goes somewhere harmless-looking and wrong.
//   - **Most modules are still Web Audio.** During the migration a plan will
//     name types this engine has never heard of. Those are skipped and recorded
//     rather than thrown on, so the half of the rack that has been ported keeps
//     working.

import type { AudioNodeSpec, AudioPlan } from "../audioPlan";
import { AUDIO_MIX_PARAM, AUDIO_MUTE_PARAM } from "../../registry/audioModules";
import { planSampleRefs } from "./sampleSync";
import { transferSample, type SampleSource } from "./sampleTransfer";
import { NoteSchedule } from "./noteSchedule";
import type { ScheduledEvent } from "./rackProtocol";

/** `u32::MAX`, as it appears once JavaScript has read it back as an `i32`. */
export const NO_MODULE = 0xffffffff;

/**
 * `ModuleKind` in `rust/dsp-core/src/modules.rs`.
 *
 * These numbers are the wire protocol. Appending is safe; reordering silently
 * turns every existing patch into a different one.
 */
export const HOST_INPUT_KIND = 0;

export const MODULE_KINDS: Readonly<Record<string, number>> = {
  "m.audio-gain": 1,
  "m.audio-output": 2,
  "m.synth": 3,
  "m.audio-blackhole": 4,
  "m.audio-dp4-reverb": 5,
  "m.audio-dp4-nonlin": 6,
  "m.audio-delay": 7,
  "m.audio-reverb": 8,
  "m.audio-eq": 9,
  "m.audio-compressor": 10,
  "m.audio-limiter": 11,
  "m.audio-bitcrusher": 12,
  "m.percussion": 13,
  "m.looper": 14,
  "m.granular": 15,
};

/**
 * The structural choice a module is built with, as the number
 * `add_module_variant` takes.
 *
 * Structural because it decides *topology* — how many delay lines the tank
 * has, whether there is a pre-echo section at all — which is fixed at
 * construction and allocates. The plan already treats these as structure and
 * rebuilds the node when one changes, which is the remove-then-add this pairs
 * with. Anything not listed builds at variant 0.
 */
const STRUCTURAL_VARIANTS: Readonly<Record<string, readonly string[]>> = {
  // Order is the wire protocol; it matches `Dp4Algorithm` in Rust.
  "m.audio-dp4-reverb": ["small-plate", "large-plate", "small-room", "large-room", "hall"],
  "m.audio-dp4-nonlin": ["non-lin-1", "non-lin-2", "non-lin-3"],
};

/** Which structural field carries the variant for a given module. */
const VARIANT_FIELD: Readonly<Record<string, string>> = {
  "m.audio-dp4-reverb": "algorithm",
  "m.audio-dp4-nonlin": "variant",
};

/** The variant number for a spec, or 0 where the module has none. */
export function variantOf(moduleType: string, structure: Record<string, unknown>): number {
  const options = STRUCTURAL_VARIANTS[moduleType];
  if (!options) return 0;
  const field = VARIANT_FIELD[moduleType];
  const index = options.indexOf(String(structure[field] ?? ""));
  // An unrecognised name builds the default rather than refusing: a document
  // from a newer build should still make a sound.
  return index < 0 ? 0 : index;
}

/** Per-oscillator and per-LFO parameters are strided; see `Synth` in Rust. */
const OSC_BASE = 1;
const OSC_STRIDE = 5;
const LFO_BASE = 28;
const LFO_STRIDE = 5;

const oscParams = (index: number): Record<string, number> => {
  const base = OSC_BASE + index * OSC_STRIDE;
  const n = index + 1;
  return {
    [`osc${n}-wave`]: base + 0,
    [`osc${n}-semitones`]: base + 1,
    [`osc${n}-cents`]: base + 2,
    [`osc${n}-level`]: base + 3,
    [`osc${n}-width`]: base + 4,
  };
};

const lfoParams = (index: number): Record<string, number> => {
  const base = LFO_BASE + index * LFO_STRIDE;
  const n = index + 1;
  return {
    [`lfo${n}-shape`]: base + 0,
    [`lfo${n}-trigger`]: base + 1,
    [`lfo${n}-rate`]: base + 2,
    [`lfo${n}-depth`]: base + 3,
    [`lfo${n}-phase`]: base + 4,
  };
};

/**
 * Where each document parameter lands in a module's parameter array.
 *
 * Indices rather than names because the ABI carries numbers, and a table rather
 * than a convention because the two vocabularies genuinely differ: the document
 * says `mute`, the module says index 2, and nothing should be inferring one
 * from the other.
 */
export const PARAM_INDICES: Readonly<Record<string, Readonly<Record<string, number>>>> = {
  "m.audio-gain": { gain: 0, level: 1, [AUDIO_MUTE_PARAM]: 2 },
  "m.audio-output": { level: 0 },
  "m.synth": {
    level: 0,
    ...oscParams(0),
    ...oscParams(1),
    ...oscParams(2),
    "filter-cutoff": 16,
    "filter-resonance": 17,
    "filter-env-octaves": 18,
    "key-follow": 19,
    "amp-attack": 20,
    "amp-decay": 21,
    "amp-sustain": 22,
    "amp-release": 23,
    "filter-attack": 24,
    "filter-decay": 25,
    "filter-sustain": 26,
    "filter-release": 27,
    ...lfoParams(0),
    ...lfoParams(1),
    pan: 38,
    volume: 39,
    "mod-wheel": 40,
  },
  // Mirrors `BlackholeVerb` in rust/dsp-core/src/modules.rs. `line-count` is
  // absent on purpose: it is a structural parameter, so changing it rebuilds
  // the node rather than moving a value, and the Rust tank sizes its own
  // network. `mix` and `mute` are the shell's, as on every other effect.
  "m.audio-blackhole": {
    gravity: 0,
    size: 1,
    "pre-delay-seconds": 2,
    "low-level-db": 3,
    "high-level-db": 4,
    "mod-depth": 5,
    "mod-rate": 6,
    feedback: 7,
    resonance: 8,
    [AUDIO_MIX_PARAM]: 9,
    level: 10,
    [AUDIO_MUTE_PARAM]: 11,
  },
  // Each of the eight below mirrors its module in rust/dsp-core/src/modules.rs.
  // The shell's three parameters are always last and always consecutive.
  "m.audio-dp4-reverb": {
    "decay-seconds": 0,
    "pre-delay-seconds": 1,
    "lf-decay": 2,
    "hf-damping": 3,
    "hf-bandwidth": 4,
    "diffusion-1": 5,
    "diffusion-2": 6,
    "decay-definition": 7,
    "detune-rate": 8,
    "detune-depth": 9,
    "primary-send": 10,
    "ref-1-level": 11,
    "ref-1-send": 12,
    "ref-2-level": 13,
    "ref-2-send": 14,
    "early-refs": 15,
    [AUDIO_MIX_PARAM]: 16,
    level: 17,
    [AUDIO_MUTE_PARAM]: 18,
  },
  "m.audio-dp4-nonlin": {
    "envelope-1": 0,
    "envelope-2": 1,
    "envelope-3": 2,
    "envelope-4": 3,
    "envelope-5": 4,
    "envelope-6": 5,
    "envelope-7": 6,
    "envelope-8": 7,
    "envelope-9": 8,
    "hf-damping": 9,
    "hf-bandwidth": 10,
    "diffusion-1": 11,
    "diffusion-2": 12,
    "density-1": 13,
    "density-2": 14,
    [AUDIO_MIX_PARAM]: 15,
    level: 16,
    [AUDIO_MUTE_PARAM]: 17,
  },
  "m.audio-delay": {
    "delay-seconds": 0,
    feedback: 1,
    [AUDIO_MIX_PARAM]: 2,
    level: 3,
    [AUDIO_MUTE_PARAM]: 4,
  },
  // `impulse-seed` is absent: the Rust reverb is a feedback delay network
  // rather than a convolver, so there is no impulse to seed. It stays a
  // structural parameter on the descriptor and simply reaches nothing here.
  "m.audio-reverb": {
    "damping-hz": 0,
    "tail-seconds": 1,
    "decay-rate": 2,
    [AUDIO_MIX_PARAM]: 3,
    level: 4,
    [AUDIO_MUTE_PARAM]: 5,
  },
  "m.audio-eq": {
    "low-gain-db": 0,
    "low-frequency": 1,
    "mid-gain-db": 2,
    "mid-frequency": 3,
    "mid-q": 4,
    "high-gain-db": 5,
    "high-frequency": 6,
    [AUDIO_MIX_PARAM]: 7,
    level: 8,
    [AUDIO_MUTE_PARAM]: 9,
  },
  "m.audio-compressor": {
    "threshold-db": 0,
    "knee-db": 1,
    ratio: 2,
    "attack-seconds": 3,
    "release-seconds": 4,
    "makeup-gain": 5,
    [AUDIO_MIX_PARAM]: 6,
    level: 7,
    [AUDIO_MUTE_PARAM]: 8,
  },
  "m.audio-limiter": {
    "ceiling-db": 0,
    "release-seconds": 1,
    [AUDIO_MIX_PARAM]: 2,
    level: 3,
    [AUDIO_MUTE_PARAM]: 4,
  },
  "m.audio-bitcrusher": {
    "tone-hz": 0,
    "bit-depth": 1,
    [AUDIO_MIX_PARAM]: 2,
    level: 3,
    [AUDIO_MUTE_PARAM]: 4,
  },
  // The three samplers. `asset-id` and `slots` are absent because they name
  // *audio*, not a value: they reach the engine through `set_sample_slot`
  // after the sample itself has been transferred. See sampleTransfer.ts.
  "m.percussion": {
    "pitch-semitones": 0,
    "decay-seconds": 1,
    [AUDIO_MIX_PARAM]: 2,
    level: 3,
    [AUDIO_MUTE_PARAM]: 4,
  },
  "m.looper": {
    rate: 0,
    "pitch-shift": 1,
    "loop-start": 2,
    "loop-end": 3,
    loop: 4,
    reverse: 5,
    gate: 6,
    [AUDIO_MIX_PARAM]: 7,
    level: 8,
    [AUDIO_MUTE_PARAM]: 9,
  },
  "m.granular": {
    "grain-size": 0,
    "grain-spacing": 1,
    position: 2,
    jitter: 3,
    stretch: 4,
    freeze: 5,
    "free-run": 6,
    [AUDIO_MIX_PARAM]: 7,
    level: 8,
    [AUDIO_MUTE_PARAM]: 9,
  },
};

/**
 * The module's fade handle — the one parameter the rack owns rather than the
 * document. Audio Output has none: it is the master, and a master that arrived
 * silent and waited to be faded up would never be heard at all.
 */
const FADE_HANDLE: Readonly<Record<string, number | undefined>> = {
  "m.audio-gain": PARAM_INDICES["m.audio-gain"].level,
  "m.audio-output": undefined,
  "m.synth": PARAM_INDICES["m.synth"].level,
  "m.audio-blackhole": PARAM_INDICES["m.audio-blackhole"].level,
  "m.audio-dp4-reverb": PARAM_INDICES["m.audio-dp4-reverb"].level,
  "m.audio-dp4-nonlin": PARAM_INDICES["m.audio-dp4-nonlin"].level,
  "m.audio-delay": PARAM_INDICES["m.audio-delay"].level,
  "m.audio-reverb": PARAM_INDICES["m.audio-reverb"].level,
  "m.audio-eq": PARAM_INDICES["m.audio-eq"].level,
  "m.audio-compressor": PARAM_INDICES["m.audio-compressor"].level,
  "m.audio-limiter": PARAM_INDICES["m.audio-limiter"].level,
  "m.audio-bitcrusher": PARAM_INDICES["m.audio-bitcrusher"].level,
  "m.percussion": PARAM_INDICES["m.percussion"].level,
  "m.looper": PARAM_INDICES["m.looper"].level,
  "m.granular": PARAM_INDICES["m.granular"].level,
};

/** Modules that take notes. Everything else inherits the trait's no-op. */
const INSTRUMENTS: ReadonlySet<string> = new Set([
  "m.synth",
  "m.percussion",
  "m.looper",
  "m.granular",
]);

/**
 * Modules with an audio input, and therefore somewhere for the host feed to go.
 *
 * A synth generates rather than processes: patching the host into it would be
 * a cable to a port that is not there, which the engine refuses anyway — but
 * silently, so the mirror would believe in a cable that does not exist and
 * disconnect a real one later.
 */
const TAKES_AUDIO_INPUT: ReadonlySet<string> = new Set([
  "m.audio-gain",
  "m.audio-output",
  "m.audio-blackhole",
  "m.audio-dp4-reverb",
  "m.audio-dp4-nonlin",
  "m.audio-delay",
  "m.audio-reverb",
  "m.audio-eq",
  "m.audio-compressor",
  "m.audio-limiter",
  "m.audio-bitcrusher",
]);

/** Every audio port on these modules is port 0; that changes with the DP/4. */
const PORT_INDEX = 0;

/** The `.wasm` exports, exactly as `rust/wasm/src/lib.rs` declares them. */
export interface EngineExports {
  init(sampleRate: number): void;
  add_module(kind: number): number;
  add_module_variant(kind: number, variant: number): number;
  remove_module(id: number): number;
  connect(fromModule: number, fromPort: number, toModule: number, toPort: number): number;
  disconnect(fromModule: number, fromPort: number, toModule: number, toPort: number): number;
  set_param(module: number, index: number, value: number): void;
  note_on(module: number, note: number, velocity: number, detuneCents: number): void;
  note_off(module: number, note: number): void;
  all_notes_off(module: number): void;
  set_modulation(module: number, source: number, dest: number, amount: number): void;
  set_sample_slot(module: number, slot: number, sample: number): void;
  // The sample-bank half of the ABI; see sampleTransfer.ts for why the
  // transfer is two calls rather than one.
  sample_alloc(id: number, channels: number, frames: number, sampleRate: number): number;
  sample_ptr(id: number): number;
  sample_len(id: number): number;
  sample_free(id: number): void;
  set_bypassed(module: number, bypassed: number): void;
  set_io(inputModule: number, outputModule: number): void;
  reset(): void;
  input_ptr(): number;
  output_ptr(): number;
  quantum_size(): number;
  module_count(): number;
  cable_count(): number;
  process_quantum(): void;
  /** Render part of a quantum, so a note can start between two of them. */
  process_range(start: number, len: number): void;
  readonly memory: { readonly buffer: ArrayBuffer };
}

/** Reinterpret an ABI return as a module id, or `undefined` if it was refused. */
const asModuleId = (raw: number): number | undefined => {
  const id = raw >>> 0;
  return id === NO_MODULE ? undefined : id;
};

/** What a module was built from. Changing any of it means rebuilding. */
const structureKey = (spec: AudioNodeSpec): string =>
  `${spec.moduleType}|${JSON.stringify(spec.structure)}`;

type Built = {
  moduleId: number;
  moduleType: string;
  structure: string;
  parameters: Record<string, number>;
  bypass: boolean;
};

/**
 * One Rust rack, kept in step with a plan.
 *
 * Owns no audio itself — the worklet drives `process`, and the buffers are
 * views straight into WASM linear memory, so a quantum crosses the boundary
 * without being copied.
 */
export class WasmRack {
  readonly hostInputId: number;

  private readonly quantum: number;
  private inputView: Float32Array;
  private outputView: Float32Array;

  /**
   * The host's quantum, as a view straight into WASM linear memory.
   *
   * A getter rather than a field because **growing WASM memory detaches every
   * existing view into it**, and adding a module that allocates — a reverb's
   * delay lines — does exactly that. Held as a field, the first quantum after
   * a Blackhole was added threw on a detached buffer and the worklet went
   * silent. The check below is a pointer comparison against the engine's
   * current buffer, so the common case costs nothing and no view is rebuilt
   * while memory is stable.
   */
  get input(): Float32Array {
    this.refreshViews();
    return this.inputView;
  }

  get output(): Float32Array {
    this.refreshViews();
    return this.outputView;
  }

  private refreshViews(): void {
    // `byteLength === 0` catches a detached view; the buffer identity check
    // catches a swap. Both mean the same thing here: this view no longer
    // points at the engine's memory.
    if (this.inputView.buffer === this.engine.memory.buffer && this.inputView.byteLength > 0) {
      return;
    }
    this.inputView = new Float32Array(this.engine.memory.buffer, this.engine.input_ptr(), this.quantum);
    this.outputView = new Float32Array(this.engine.memory.buffer, this.engine.output_ptr(), this.quantum);
  }

  private readonly built = new Map<string, Built>();
  /**
   * The cables actually patched, keyed by engine module id rather than node id.
   *
   * Module ids because not every cable has a document behind it: the host feed
   * comes from a module no plan mentions, so a node-keyed mirror could not
   * represent it.
   */
  private readonly cables = new Map<string, { from: number; to: number }>();
  private readonly unsupportedTypes = new Set<string>();
  private outputModuleId: number | undefined;
  /** Asset hash to engine slot, as the main thread assigned them. */
  private sampleMap: Record<string, number> = {};
  /** Slots already written, so a plan update does not re-point every note. */
  private readonly assignedSlots = new Set<string>();
  /** Notes waiting for their frame. See `noteSchedule.ts`. */
  private readonly pending = new NoteSchedule();

  constructor(
    private readonly engine: EngineExports,
    private readonly sampleRate: number,
  ) {
    engine.init(sampleRate);
    // The one module no document mentions and every rack needs: without it the
    // graph has no way to hear the host, and a patch that compiles and wires
    // correctly renders silence.
    this.hostInputId = asModuleId(engine.add_module(HOST_INPUT_KIND)) ?? NO_MODULE;

    this.quantum = engine.quantum_size();
    this.inputView = new Float32Array(engine.memory.buffer, engine.input_ptr(), this.quantum);
    this.outputView = new Float32Array(engine.memory.buffer, engine.output_ptr(), this.quantum);
  }

  /** Module types the plan asked for that this engine does not have yet. */
  get unsupported(): string[] {
    return [...this.unsupportedTypes].sort();
  }

  moduleIdOf(nodeId: string): number | undefined {
    return this.built.get(nodeId)?.moduleId;
  }

  moduleTypeOf(nodeId: string): string | undefined {
    return this.built.get(nodeId)?.moduleType;
  }

  /**
   * Bring the rack in line with `plan`.
   *
   * Safe to call on every document change: applying the same plan twice issues
   * no commands at all, which is what makes it usable straight from an effect
   * that cannot easily know whether anything moved.
   */
  update(plan: AudioPlan): void {
    this.removeDeparted(plan);
    this.buildAndRamp(plan);
    this.rewire(plan);
    // After the modules exist: a slot is set on a module id.
    this.assignSamples(plan);
    this.pointHostAtOutput(plan);
  }

  /** Every node in the current plan that takes notes. */
  get instruments(): string[] {
    return [...this.built.keys()]
      .filter((nodeId) => INSTRUMENTS.has(this.moduleTypeOf(nodeId) ?? ""))
      .sort();
  }

  /**
   * Play a note on every instrument in the plan.
   *
   * Broadcast rather than addressed, because the plan carries no routing from
   * a keyboard to an instrument — in the app that job belongs to the runtime's
   * note adapter, which already resolves an event's target by port. This is
   * what the bench and a MIDI-thru path need in the meantime.
   */
  noteOn(note: number, velocity: number, detuneCents: number): void {
    for (const nodeId of this.instruments) {
      this.engine.note_on(this.moduleIdOf(nodeId)!, note, velocity, detuneCents);
    }
  }

  noteOff(note: number): void {
    for (const nodeId of this.instruments) {
      this.engine.note_off(this.moduleIdOf(nodeId)!, note);
    }
  }

  allNotesOff(): void {
    for (const nodeId of this.instruments) {
      this.engine.all_notes_off(this.moduleIdOf(nodeId)!);
    }
  }

  /** Set one matrix cell on one node. */
  setModulation(nodeId: string, source: number, dest: number, amount: number): void {
    const moduleId = this.moduleIdOf(nodeId);
    if (moduleId === undefined) return;
    this.engine.set_modulation(moduleId, source, dest, amount);
  }

  /** Take one decoded sample into the engine's bank. */
  loadSample(slot: number, source: SampleSource): boolean {
    return transferSample(this.engine, slot, source);
  }

  /** The asset-hash-to-slot table the plan's structure is resolved against. */
  setSampleMap(map: Record<string, number>): void {
    this.sampleMap = map;
  }

  /**
   * Point every sampler's slots at the audio its document names.
   *
   * Runs after the modules exist, because a slot is set on a module id. Kept
   * idempotent by `assignedSlots`: a plan update that changed a knob must not
   * re-issue a hundred slot assignments, and re-issuing the same one is
   * harmless but pointless.
   */
  private assignSamples(plan: AudioPlan): void {
    for (const ref of planSampleRefs(plan)) {
      const moduleId = this.built.get(ref.nodeId)?.moduleId;
      const sample = this.sampleMap[ref.assetId];
      if (moduleId === undefined || sample === undefined) continue;
      const key = `${moduleId}:${ref.slot}:${sample}`;
      if (this.assignedSlots.has(key)) continue;
      this.assignedSlots.add(key);
      this.engine.set_sample_slot(moduleId, ref.slot, sample);
    }
  }

  /**
   * Hold these events until `atSec` on the audio clock.
   *
   * The conversion to a frame happens here rather than on the main thread
   * because this side already knows the sample rate and counts in the same
   * clock; sending a frame number would mean the two had to agree about a
   * conversion neither owns.
   */
  schedule(atSec: number, events: ScheduledEvent[]): void {
    const frame = Math.round(atSec * this.sampleRate);
    for (const event of events) this.pending.push({ frame, event });
  }

  /**
   * Advance one render quantum, firing scheduled notes at their exact frames.
   *
   * `startFrame` is the audio clock's frame index for the first sample of this
   * quantum — the worklet's `currentFrame`. The quantum is rendered as a run
   * of ranges broken wherever a note is due, which is what makes the timing
   * sample-accurate rather than accurate to the nearest 2.7 ms.
   *
   * With nothing scheduled this is one `process_range` over the whole buffer,
   * so the common case costs a comparison.
   */
  process(startFrame = 0): void {
    const end = startFrame + this.quantum;
    let offset = 0;
    while (offset < this.quantum) {
      // Everything due at the frame about to be rendered, including anything
      // overdue — a late note still sounds.
      for (const entry of this.pending.drainThrough(startFrame + offset)) {
        this.dispatch(entry.event);
      }
      // The drain leaves nothing at or before this frame, so the next entry is
      // strictly later and the loop always advances.
      const next = this.pending.nextFrame();
      const stop = next === undefined || next >= end ? this.quantum : next - startFrame;
      this.engine.process_range(offset, stop - offset);
      offset = stop;
    }
  }

  /** Play one scheduled event now. */
  private dispatch(event: ScheduledEvent): void {
    switch (event.type) {
      case "note-on":
        this.noteOn(event.note, event.velocity, event.detuneCents);
        break;
      case "note-off":
        this.noteOff(event.note);
        break;
      case "all-notes-off":
        this.allNotesOff();
        break;
    }
  }

  reset(): void {
    // The future is cancelled with the transport: a note held for a frame that
    // is now in a different piece is not a note anyone asked for.
    this.pending.clear();
    this.engine.reset();
  }

  private removeDeparted(plan: AudioPlan): void {
    for (const [nodeId, built] of [...this.built]) {
      const spec = plan.nodes[nodeId];
      // A rebuilt node is removed here and added below, which is the whole
      // difference between a structure change and a parameter change.
      if (spec && structureKey(spec) === built.structure) continue;
      this.engine.remove_module(built.moduleId);
      this.built.delete(nodeId);
      // The engine drops a removed module's cables itself; the mirror has to
      // agree or the next update will think they are still patched.
      for (const [key, cable] of this.cables) {
        if (cable.from === built.moduleId || cable.to === built.moduleId) this.cables.delete(key);
      }
    }
  }

  private buildAndRamp(plan: AudioPlan): void {
    for (const spec of Object.values(plan.nodes)) {
      const kind = MODULE_KINDS[spec.moduleType];
      if (kind === undefined) {
        this.unsupportedTypes.add(spec.moduleType);
        continue;
      }

      let built = this.built.get(spec.nodeId);
      if (!built) {
        // Always the variant-aware constructor: it is a superset, and a module
        // with no variants builds at 0 exactly as `add_module` would.
        const moduleId = asModuleId(
          this.engine.add_module_variant(kind, variantOf(spec.moduleType, spec.structure)),
        );
        // A refused id means this build of the engine does not have the kind
        // after all — a version skew between the JS and the `.wasm`.
        if (moduleId === undefined) {
          this.unsupportedTypes.add(spec.moduleType);
          continue;
        }
        built = {
          moduleId,
          moduleType: spec.moduleType,
          structure: structureKey(spec),
          parameters: {},
          bypass: false,
        };
        this.built.set(spec.nodeId, built);

        const fade = FADE_HANDLE[spec.moduleType];
        if (fade !== undefined) this.engine.set_param(moduleId, fade, 1);
      }

      this.applyParameters(spec, built);
      if (spec.bypass !== built.bypass) {
        this.engine.set_bypassed(built.moduleId, spec.bypass ? 1 : 0);
        built.bypass = spec.bypass;
      }
    }
  }

  private applyParameters(spec: AudioNodeSpec, built: Built): void {
    const indices = PARAM_INDICES[spec.moduleType] ?? {};
    for (const [name, value] of Object.entries(spec.parameters)) {
      const index = indices[name];
      // A parameter the module does not have is not an error: the document may
      // be newer than the engine, or the control may be Web-Audio-only still.
      if (index === undefined) continue;
      if (built.parameters[name] === value) continue;
      this.engine.set_param(built.moduleId, index, value);
      built.parameters[name] = value;
    }
  }

  private rewire(plan: AudioPlan): void {
    const wanted = new Map<string, { from: number; to: number }>();
    const want = (from: number, to: number): void => {
      wanted.set(`${from}:${PORT_INDEX}→${to}:${PORT_INDEX}`, { from, to });
    };

    for (const connection of plan.connections) {
      // A cable to a module that was never built is dropped rather than
      // half-patched — during the migration this is the common case.
      const from = this.moduleIdOf(connection.from.nodeId);
      const to = this.moduleIdOf(connection.to.nodeId);
      if (from === undefined || to === undefined) continue;
      want(from, to);
    }

    for (const moduleId of this.openInputs(plan)) want(this.hostInputId, moduleId);

    for (const [key, cable] of this.cables) {
      if (wanted.has(key)) continue;
      this.engine.disconnect(cable.from, PORT_INDEX, cable.to, PORT_INDEX);
      this.cables.delete(key);
    }

    for (const [key, cable] of wanted) {
      if (this.cables.has(key)) continue;
      this.engine.connect(cable.from, PORT_INDEX, cable.to, PORT_INDEX);
      this.cables.set(key, cable);
    }
  }

  /**
   * Modules the patch left with nothing patched into them.
   *
   * These hear the host, which is what an effects rack with a live input does
   * and what §12.1 of the functional spec calls a Channel source. Without it a
   * rack builds, wires and reports a correct graph while rendering silence —
   * `set_io` says where samples are *written*, not what is *connected*, and no
   * plan-shaped test can see the difference because no document mentions the
   * host input at all.
   *
   * The Audio Output is excluded: an idle rack is silent, not a wire from the
   * input straight to the speakers.
   */
  private openInputs(plan: AudioPlan): number[] {
    if (this.hostInputId === NO_MODULE) return [];
    const fed = new Set(plan.connections.map((connection) => connection.to.nodeId));
    const open: number[] = [];
    for (const [nodeId, built] of this.built) {
      if (fed.has(nodeId)) continue;
      // A source has no input to feed, and the Audio Output is the master —
      // an idle rack is silent, not a wire from the input to the speakers.
      if (!TAKES_AUDIO_INPUT.has(built.moduleType)) continue;
      if (built.moduleType === "m.audio-output") continue;
      open.push(built.moduleId);
    }
    return open;
  }

  private pointHostAtOutput(plan: AudioPlan): void {
    const outputNode = Object.values(plan.nodes).find(
      (spec) => spec.moduleType === "m.audio-output",
    );
    const outputId = outputNode ? this.moduleIdOf(outputNode.nodeId) : undefined;
    if (outputId === this.outputModuleId) return;
    this.outputModuleId = outputId;
    this.engine.set_io(this.hostInputId, outputId ?? NO_MODULE);
  }
}
