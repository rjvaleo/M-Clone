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
};

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
};

/** Modules that take notes. Everything else inherits the trait's no-op. */
const INSTRUMENTS: ReadonlySet<string> = new Set(["m.synth"]);

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
]);

/** Every audio port on these modules is port 0; that changes with the DP/4. */
const PORT_INDEX = 0;

/** The `.wasm` exports, exactly as `rust/wasm/src/lib.rs` declares them. */
export interface EngineExports {
  init(sampleRate: number): void;
  add_module(kind: number): number;
  remove_module(id: number): number;
  connect(fromModule: number, fromPort: number, toModule: number, toPort: number): number;
  disconnect(fromModule: number, fromPort: number, toModule: number, toPort: number): number;
  set_param(module: number, index: number, value: number): void;
  note_on(module: number, note: number, velocity: number): void;
  note_off(module: number, note: number): void;
  all_notes_off(module: number): void;
  set_modulation(module: number, source: number, dest: number, amount: number): void;
  set_bypassed(module: number, bypassed: number): void;
  set_io(inputModule: number, outputModule: number): void;
  reset(): void;
  input_ptr(): number;
  output_ptr(): number;
  quantum_size(): number;
  module_count(): number;
  cable_count(): number;
  process_quantum(): void;
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

  constructor(
    private readonly engine: EngineExports,
    sampleRate: number,
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
  noteOn(note: number, velocity: number): void {
    for (const nodeId of this.instruments) {
      this.engine.note_on(this.moduleIdOf(nodeId)!, note, velocity);
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

  /** Advance one render quantum. `input` is read, `output` is written. */
  process(): void {
    this.engine.process_quantum();
  }

  reset(): void {
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
        const moduleId = asModuleId(this.engine.add_module(kind));
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
