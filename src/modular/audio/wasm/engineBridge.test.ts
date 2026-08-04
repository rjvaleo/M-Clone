import { describe, expect, it } from "vitest";
import { WasmRack, MODULE_KINDS, PARAM_INDICES, NO_MODULE, type EngineExports } from "./engineBridge";
import type { AudioPlan, AudioNodeSpec } from "../audioPlan";

/**
 * The bridge between a compiled `AudioPlan` and the Rust engine.
 *
 * Everything below the WASM boundary is covered by `cargo test` and
 * `rust/wasm/verify.mjs`; everything above it by the existing plan tests. This
 * is the join, and it is where the interesting mistakes live: a module id
 * mapped to the wrong node, a parameter sent to the wrong index, a plan update
 * that rebuilds a node it should have ramped.
 */

/** Records every call, and behaves the way the real `.wasm` behaves. */
class FakeEngine implements EngineExports {
  readonly calls: string[] = [];
  readonly params = new Map<string, number>();
  readonly cables = new Set<string>();
  readonly modules = new Map<number, number>();
  memory = { buffer: new ArrayBuffer(2048) };
  private nextId = 0;
  /** Kinds this build does not have, to stand in for a version skew. */
  unknownKinds = new Set<number>();

  init(sampleRate: number): void {
    this.calls.push(`init:${sampleRate}`);
  }
  add_module(kind: number): number {
    if (this.unknownKinds.has(kind)) return -1; // u32::MAX, seen from JS as i32
    const id = this.nextId++;
    this.modules.set(id, kind);
    this.calls.push(`add:${kind}→${id}`);
    return id;
  }
  remove_module(id: number): number {
    this.calls.push(`remove:${id}`);
    const had = this.modules.delete(id);
    for (const cable of [...this.cables]) {
      if (cable.startsWith(`${id}:`) || cable.includes(`→${id}:`)) this.cables.delete(cable);
    }
    return had ? 1 : 0;
  }
  connect(fm: number, fp: number, tm: number, tp: number): number {
    const key = `${fm}:${fp}→${tm}:${tp}`;
    this.calls.push(`connect:${key}`);
    if (this.cables.has(key)) return 0;
    this.cables.add(key);
    return 1;
  }
  disconnect(fm: number, fp: number, tm: number, tp: number): number {
    const key = `${fm}:${fp}→${tm}:${tp}`;
    this.calls.push(`disconnect:${key}`);
    return this.cables.delete(key) ? 1 : 0;
  }
  set_param(module: number, index: number, value: number): void {
    this.calls.push(`param:${module}.${index}=${value}`);
    this.params.set(`${module}.${index}`, value);
  }
  note_on(module: number, note: number, velocity: number): void {
    this.calls.push(`noteon:${module}.${note}@${velocity}`);
  }
  note_off(module: number, note: number): void {
    this.calls.push(`noteoff:${module}.${note}`);
  }
  all_notes_off(module: number): void {
    this.calls.push(`allnotesoff:${module}`);
  }
  set_modulation(module: number, source: number, dest: number, amount: number): void {
    this.calls.push(`mod:${module}.${source}->${dest}=${amount}`);
  }
  set_bypassed(module: number, bypassed: number): void {
    this.calls.push(`bypass:${module}=${bypassed}`);
  }
  set_io(input: number, output: number): void {
    this.calls.push(`io:${input},${output}`);
  }
  reset(): void {
    this.calls.push("reset");
  }
  input_ptr(): number {
    return 0;
  }
  output_ptr(): number {
    return 512;
  }
  quantum_size(): number {
    return 128;
  }
  module_count(): number {
    return this.modules.size;
  }
  cable_count(): number {
    return this.cables.size;
  }
  process_quantum(): void {
    this.calls.push("process");
  }

  /** Only the calls of one kind, for asserting on a slice of the traffic. */
  of(prefix: string): string[] {
    return this.calls.filter((call) => call.startsWith(`${prefix}:`));
  }
}

const node = (
  nodeId: string,
  moduleType: string,
  parameters: Record<string, number> = {},
  overrides: Partial<AudioNodeSpec> = {},
): AudioNodeSpec => ({
  nodeId,
  moduleType,
  structure: {},
  parameters,
  bypass: false,
  wet: 1,
  ...overrides,
});

/** Gain → Audio Output: the smallest patch that makes a sound. */
const plan = (
  nodes: AudioNodeSpec[],
  connections: AudioPlan["connections"] = [],
  generation = 1,
): AudioPlan => ({
  generation,
  nodes: Object.fromEntries(nodes.map((spec) => [spec.nodeId, spec])),
  connections,
});

const wire = (from: string, to: string) => ({
  from: { nodeId: from, portId: "audio-out" },
  to: { nodeId: to, portId: "audio-in" },
});

const simplePlan = () =>
  plan(
    [node("g", "m.audio-gain", { gain: 0.5 }), node("out", "m.audio-output", {})],
    [wire("g", "out")],
  );

describe("The plan-to-engine bridge", () => {
  it("initialises the engine at the context's sample rate", () => {
    const engine = new FakeEngine();
    new WasmRack(engine, 44100);
    expect(engine.calls[0]).toBe("init:44100");
  });

  it("builds a module for every node and wires them together", () => {
    const engine = new FakeEngine();
    const rack = new WasmRack(engine, 48000);
    rack.update(simplePlan());

    expect(rack.moduleIdOf("g")).not.toBeUndefined();
    expect(rack.moduleIdOf("out")).not.toBeUndefined();
    expect([...engine.cables]).toContain(`${rack.moduleIdOf("g")}:0→${rack.moduleIdOf("out")}:0`);
  });

  it("always builds the host input, so a rack is never deaf", () => {
    // The one module no document mentions. Forgetting it would leave a patch
    // that compiles, wires and processes silence — the failure this codebase
    // has shipped twice.
    const engine = new FakeEngine();
    const rack = new WasmRack(engine, 48000);
    rack.update(simplePlan());
    expect(engine.of("io")).toHaveLength(1);
    expect(engine.of("io")[0]).toBe(`io:${rack.hostInputId},${rack.moduleIdOf("out")}`);
  });

  it("sends each parameter to the index its module declares", () => {
    const engine = new FakeEngine();
    const rack = new WasmRack(engine, 48000);
    rack.update(simplePlan());
    const gainId = rack.moduleIdOf("g")!;
    expect(engine.params.get(`${gainId}.${PARAM_INDICES["m.audio-gain"].gain}`)).toBe(0.5);
  });

  it("opens each module's fade handle so the patch is audible", () => {
    // Every module is built silent by design. Something has to raise it, and
    // if that is nobody the whole rack is a correct, silent graph.
    const engine = new FakeEngine();
    const rack = new WasmRack(engine, 48000);
    rack.update(simplePlan());
    const gainId = rack.moduleIdOf("g")!;
    expect(engine.params.get(`${gainId}.${PARAM_INDICES["m.audio-gain"].level}`)).toBe(1);
  });

  it("ramps a parameter change without rebuilding the module", () => {
    // The rule the whole audio layer is built around, restated at this seam.
    const engine = new FakeEngine();
    const rack = new WasmRack(engine, 48000);
    rack.update(simplePlan());
    const before = rack.moduleIdOf("g");
    const addsBefore = engine.of("add").length;

    rack.update(
      plan(
        [node("g", "m.audio-gain", { gain: 0.9 }), node("out", "m.audio-output", {})],
        [wire("g", "out")],
        2,
      ),
    );

    expect(rack.moduleIdOf("g")).toBe(before);
    expect(engine.of("add")).toHaveLength(addsBefore);
    expect(engine.params.get(`${before}.${PARAM_INDICES["m.audio-gain"].gain}`)).toBe(0.9);
  });

  it("rebuilds a module when its structure changes", () => {
    const engine = new FakeEngine();
    const rack = new WasmRack(engine, 48000);
    rack.update(simplePlan());
    const before = rack.moduleIdOf("g");

    rack.update(
      plan(
        [
          node("g", "m.audio-gain", { gain: 0.5 }, { structure: { shape: "different" } }),
          node("out", "m.audio-output", {}),
        ],
        [wire("g", "out")],
        2,
      ),
    );

    expect(rack.moduleIdOf("g")).not.toBe(before);
    expect(engine.of("remove")).toContain(`remove:${before}`);
  });

  it("removes a module the plan no longer has, and its cables with it", () => {
    const engine = new FakeEngine();
    const rack = new WasmRack(engine, 48000);
    rack.update(simplePlan());
    const gainId = rack.moduleIdOf("g");

    rack.update(plan([node("out", "m.audio-output", {})], [], 2));
    expect(rack.moduleIdOf("g")).toBeUndefined();
    expect(engine.of("remove")).toContain(`remove:${gainId}`);
    expect(engine.cable_count()).toBe(0);
  });

  it("skips a module type the engine does not have yet", () => {
    // During the migration most modules are still Web Audio. A plan naming one
    // must leave the rest of the rack working rather than take it down.
    const engine = new FakeEngine();
    const rack = new WasmRack(engine, 48000);
    rack.update(
      plan(
        [node("r", "m.audio-reverb", {}), node("out", "m.audio-output", {})],
        [wire("r", "out")],
      ),
    );
    expect(rack.moduleIdOf("r")).toBeUndefined();
    expect(rack.moduleIdOf("out")).not.toBeUndefined();
    expect(rack.unsupported).toEqual(["m.audio-reverb"]);
  });

  it("treats a refused module id as a failure rather than a negative id", () => {
    // WASM returns i32, so `NO_MODULE` arrives as -1. Storing that as an id
    // would send every later parameter to module 4294967295.
    const engine = new FakeEngine();
    engine.unknownKinds.add(MODULE_KINDS["m.audio-gain"]);
    const rack = new WasmRack(engine, 48000);
    rack.update(simplePlan());
    expect(rack.moduleIdOf("g")).toBeUndefined();
    expect(engine.of("param").some((call) => call.includes(`${NO_MODULE}`))).toBe(false);
    expect(engine.of("param").some((call) => call.includes("-1"))).toBe(false);
  });

  it("drops a connection whose endpoint was never built", () => {
    const engine = new FakeEngine();
    const rack = new WasmRack(engine, 48000);
    rack.update(
      plan(
        [node("r", "m.audio-reverb", {}), node("out", "m.audio-output", {})],
        [wire("r", "out")],
      ),
    );
    expect(engine.cable_count()).toBe(0);
    expect(rack.moduleIdOf("out")).not.toBeUndefined();
  });

  it("carries bypass across", () => {
    const engine = new FakeEngine();
    const rack = new WasmRack(engine, 48000);
    rack.update(
      plan([node("g", "m.audio-gain", {}, { bypass: true }), node("out", "m.audio-output", {})]),
    );
    expect(engine.of("bypass")).toContain(`bypass:${rack.moduleIdOf("g")}=1`);
  });

  it("applies the same plan twice without emitting any work", () => {
    // Idempotence is what makes it safe to call on every document change.
    const engine = new FakeEngine();
    const rack = new WasmRack(engine, 48000);
    rack.update(simplePlan());
    const after = engine.calls.length;
    rack.update(simplePlan());
    expect(engine.calls.length).toBe(after);
  });

  it("feeds the host's audio into every input the patch left open", () => {
    // The bug this exists to prevent, found in a browser after every unit test
    // passed: `set_io` tells the engine where to *write* incoming samples, but
    // a module only hears them if the host input is actually cabled to it. The
    // plan has no node for the host input — no document mentions it — so
    // nothing in a plan-shaped test could notice the missing wire, and the rack
    // rendered pure silence while reporting a correct graph.
    const engine = new FakeEngine();
    const rack = new WasmRack(engine, 48000);
    rack.update(simplePlan());

    const hostToGain = `${rack.hostInputId}:0→${rack.moduleIdOf("g")}:0`;
    expect([...engine.cables]).toContain(hostToGain);
    // The output is already fed by the gain, so it is left alone.
    expect([...engine.cables]).not.toContain(`${rack.hostInputId}:0→${rack.moduleIdOf("out")}:0`);
  });

  it("stops feeding a module once the patch gives it a source", () => {
    // Patching something into an open input has to take the host feed away, or
    // the two sum and the module hears both at once.
    const engine = new FakeEngine();
    const rack = new WasmRack(engine, 48000);
    rack.update(plan([node("a", "m.audio-gain"), node("out", "m.audio-output")], [wire("a", "out")]));
    expect([...engine.cables]).toContain(`${rack.hostInputId}:0→${rack.moduleIdOf("a")}:0`);

    rack.update(
      plan(
        [node("src", "m.audio-gain"), node("a", "m.audio-gain"), node("out", "m.audio-output")],
        [wire("src", "a"), wire("a", "out")],
        2,
      ),
    );
    expect([...engine.cables]).not.toContain(`${rack.hostInputId}:0→${rack.moduleIdOf("a")}:0`);
    expect([...engine.cables]).toContain(`${rack.hostInputId}:0→${rack.moduleIdOf("src")}:0`);
  });

  it("never feeds the host input into the master output", () => {
    // An Audio Output with nothing patched in is an idle rack, not a wire from
    // the microphone straight to the speakers.
    const engine = new FakeEngine();
    const rack = new WasmRack(engine, 48000);
    rack.update(plan([node("out", "m.audio-output")]));
    expect(engine.cable_count()).toBe(0);
  });

  it("unpatches a cable the plan dropped, leaving both modules standing", () => {
    // Distinct from removing a node: both endpoints survive, so the mirror has
    // to issue a real disconnect rather than relying on the engine dropping
    // cables along with a module.
    const engine = new FakeEngine();
    const rack = new WasmRack(engine, 48000);
    rack.update(simplePlan());
    const documentCable = `${rack.moduleIdOf("g")}:0→${rack.moduleIdOf("out")}:0`;
    expect([...engine.cables]).toContain(documentCable);

    rack.update(
      plan([node("g", "m.audio-gain", { gain: 0.5 }), node("out", "m.audio-output", {})], [], 2),
    );

    expect(engine.of("disconnect")).toHaveLength(1);
    expect([...engine.cables]).not.toContain(documentCable);
    expect(rack.moduleIdOf("g")).not.toBeUndefined();
    expect(rack.moduleIdOf("out")).not.toBeUndefined();

    // And patching it back is a connect, not a rebuild.
    const addsBefore = engine.of("add").length;
    rack.update(simplePlan());
    expect([...engine.cables]).toContain(documentCable);
    expect(engine.of("add")).toHaveLength(addsBefore);
  });

  it("advances the engine one quantum at a time", () => {
    const engine = new FakeEngine();
    const rack = new WasmRack(engine, 48000);
    rack.update(simplePlan());
    rack.process();
    rack.process();
    expect(engine.calls.filter((call) => call === "process")).toHaveLength(2);
  });

  it("forwards a transport reset to the engine", () => {
    const engine = new FakeEngine();
    const rack = new WasmRack(engine, 48000);
    rack.reset();
    expect(engine.calls).toContain("reset");
  });

  it("exposes the quantum buffers the worklet reads and writes", () => {
    const engine = new FakeEngine();
    const rack = new WasmRack(engine, 48000);
    expect(rack.input).toHaveLength(128);
    expect(rack.output).toHaveLength(128);
  });

  it("never feeds the host input into a source", () => {
    // A synth generates rather than processes. Patching the host into it is a
    // cable to a port that is not there — the engine refuses it silently, so
    // the mirror would believe in a cable that does not exist and disconnect a
    // real one on the next update.
    const engine = new FakeEngine();
    const rack = new WasmRack(engine, 48000);
    rack.update(plan([node("s", "m.synth"), node("out", "m.audio-output")], [wire("s", "out")]));
    expect([...engine.cables]).not.toContain(`${rack.hostInputId}:0→${rack.moduleIdOf("s")}:0`);
    expect([...engine.cables]).toContain(`${rack.moduleIdOf("s")}:0→${rack.moduleIdOf("out")}:0`);
  });

  it("knows which nodes take notes", () => {
    const engine = new FakeEngine();
    const rack = new WasmRack(engine, 48000);
    rack.update(
      plan([node("s", "m.synth"), node("g", "m.audio-gain"), node("out", "m.audio-output")]),
    );
    expect(rack.instruments).toEqual(["s"]);
  });

  it("plays notes on every instrument and nothing else", () => {
    const engine = new FakeEngine();
    const rack = new WasmRack(engine, 48000);
    rack.update(plan([node("s", "m.synth"), node("g", "m.audio-gain")]));

    rack.noteOn(60, 0.8);
    rack.noteOff(60);
    rack.allNotesOff();

    const synth = rack.moduleIdOf("s");
    expect(engine.of("noteon")).toEqual([`noteon:${synth}.60@0.8`]);
    expect(engine.of("noteoff")).toEqual([`noteoff:${synth}.60`]);
    expect(engine.of("allnotesoff")).toEqual([`allnotesoff:${synth}`]);
  });

  it("sends a matrix routing to the node that owns it", () => {
    const engine = new FakeEngine();
    const rack = new WasmRack(engine, 48000);
    rack.update(plan([node("s", "m.synth")]));
    rack.setModulation("s", 0, 11, 1);
    expect(engine.of("mod")).toEqual([`mod:${rack.moduleIdOf("s")}.0->11=1`]);
  });

  it("ignores a routing for a node that is not built", () => {
    const engine = new FakeEngine();
    const rack = new WasmRack(engine, 48000);
    rack.update(plan([node("s", "m.synth")]));
    rack.setModulation("nope", 0, 11, 1);
    expect(engine.of("mod")).toHaveLength(0);
  });

  it("opens the synth's fade handle like any other module", () => {
    const engine = new FakeEngine();
    const rack = new WasmRack(engine, 48000);
    rack.update(plan([node("s", "m.synth")]));
    expect(engine.params.get(`${rack.moduleIdOf("s")}.${PARAM_INDICES["m.synth"].level}`)).toBe(1);
  });

  it("gives every synth parameter a distinct index", () => {
    // A duplicated index silently ties two controls together, which reads as a
    // wiring bug in the DSP rather than a typo in a table.
    const indices = Object.values(PARAM_INDICES["m.synth"]);
    expect(new Set(indices).size).toBe(indices.length);
    // And none of them stray past what the Rust module declares.
    expect(Math.max(...indices)).toBeLessThan(41);
  });

  it("every module kind it claims to support has parameter indices", () => {
    // A kind with no index table would send every parameter to index 0, which
    // is a gain change that looks like a wiring bug.
    for (const moduleType of Object.keys(MODULE_KINDS)) {
      expect(PARAM_INDICES[moduleType], moduleType).toBeDefined();
    }
  });
});
