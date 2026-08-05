import { describe, expect, it } from "vitest";
import { REPORT_INTERVAL_QUANTA } from "./rackProtocol";
import { WasmRack, MODULE_KINDS, PARAM_INDICES, NO_MODULE, variantOf, type EngineExports } from "./engineBridge";
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

  /** What `memory.grow` looks like from JavaScript: a fresh, larger buffer,
   * with every view into the old one now detached. */
  growMemory(): void {
    this.memory = { buffer: new ArrayBuffer(4096) };
  }
  private nextId = 0;
  /** Kinds this build does not have, to stand in for a version skew. */
  unknownKinds = new Set<number>();

  init(sampleRate: number): void {
    this.calls.push(`init:${sampleRate}`);
  }
  variants = new Map<number, number>();
  add_module(kind: number): number {
    if (this.unknownKinds.has(kind)) return -1; // u32::MAX, seen from JS as i32
    const id = this.nextId++;
    this.modules.set(id, kind);
    this.calls.push(`add:${kind}→${id}`);
    return id;
  }
  /** Records the variant so a test can assert the algorithm reached the ABI. */
  add_module_variant(kind: number, variant: number): number {
    const id = this.add_module(kind);
    if (id >= 0) this.variants.set(id, variant);
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
  note_on(module: number, note: number, velocity: number, detuneCents: number): void {
    this.calls.push(`noteon:${module}.${note}@${velocity}+${detuneCents}`);
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
  set_sample_slot(module: number, slot: number, sample: number): void {
    this.calls.push(`slot:${module}.${slot}=${sample}`);
  }
  /** A real little allocator, so the transfer's pointer maths is exercised. */
  private sampleLens = new Map<number, number>();
  private samplePtrs = new Map<number, number>();
  private nextPtr = 1024;
  sample_alloc(id: number, channels: number, frames: number, rate: number): number {
    if (channels === 0 || frames === 0 || rate <= 0) return 0;
    this.samplePtrs.set(id, this.nextPtr);
    this.sampleLens.set(id, channels * frames);
    this.nextPtr += channels * frames * 4;
    this.calls.push(`salloc:${id}=${channels}x${frames}`);
    return 1;
  }
  sample_ptr(id: number): number {
    return this.samplePtrs.get(id) ?? 0;
  }
  sample_len(id: number): number {
    return this.sampleLens.get(id) ?? 0;
  }
  sample_free(id: number): void {
    this.samplePtrs.delete(id);
    this.sampleLens.delete(id);
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
  sample_count(): number {
    return this.samplesHeld;
  }
  samplesHeld = 0;
  process_quantum(): void {
    this.process_range(0, 128);
  }
  /** What every rendered sample comes out at, so a peak is assertable. */
  renderLevel = 0;
  /** Records the range, so a test can see where a quantum was broken. */
  process_range(start: number, len: number): void {
    this.calls.push(`process:${start}+${len}`);
    const output = new Float32Array(this.memory.buffer, this.output_ptr(), 128);
    output.fill(this.renderLevel, start, start + len);
  }
  /** Every rendered range, in order, as `start+len` pairs. */
  get ranges(): string[] {
    return this.calls.filter((call) => call.startsWith("process:")).map((c) => c.slice(8));
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

describe("Samplers and their audio", () => {
  const kit = (slots: unknown) =>
    plan([node("p", "m.percussion", {}, { structure: { slots } as never })]);

  it("points each note at the slot its document names", () => {
    const engine = new FakeEngine();
    const rack = new WasmRack(engine, 48000);
    rack.setSampleMap({ kick: 0, snare: 1 });
    rack.update(kit([{ note: 36, assetId: "kick" }, { note: 38, assetId: "snare" }]));
    const id = rack.moduleIdOf("p")!;
    expect(engine.of("slot")).toEqual([`slot:${id}.36=0`, `slot:${id}.38=1`]);
  });

  it("assigns nothing for an asset the engine was never told about", () => {
    // The map is the only thing that turns a content hash into a number; an
    // asset missing from it has no audio loaded either.
    const engine = new FakeEngine();
    const rack = new WasmRack(engine, 48000);
    rack.update(kit([{ note: 36, assetId: "kick" }]));
    expect(engine.of("slot")).toEqual([]);
  });

  it("does not re-issue an assignment that has not changed", () => {
    // A knob move recompiles the plan. Re-pointing every note of every kit on
    // each of those is pure traffic on the audio thread.
    const engine = new FakeEngine();
    const rack = new WasmRack(engine, 48000);
    rack.setSampleMap({ kick: 0 });
    rack.update(kit([{ note: 36, assetId: "kick" }]));
    rack.update({ ...kit([{ note: 36, assetId: "kick" }]), generation: 2 });
    expect(engine.of("slot")).toHaveLength(1);
  });

  it("writes a sample's audio into the engine", () => {
    const engine = new FakeEngine();
    const rack = new WasmRack(engine, 48000);
    const written = rack.loadSample(3, {
      channels: [Float32Array.from([0.25, 0.5]), Float32Array.from([-0.25, -0.5])],
      sampleRate: 44100,
    });
    expect(written).toBe(true);
    const view = new Float32Array(engine.memory.buffer, engine.sample_ptr(3), engine.sample_len(3));
    // Planar, matching the Rust bank's layout.
    expect([...view]).toEqual([0.25, 0.5, -0.25, -0.5]);
  });
});

describe("variantOf", () => {
  it("maps a structural name onto the number Rust builds from", () => {
    // The order is the wire protocol: it matches `Dp4Algorithm` in Rust, so a
    // reordering here silently turns every saved hall into a plate.
    expect(variantOf("m.audio-dp4-reverb", { algorithm: "small-plate" })).toBe(0);
    expect(variantOf("m.audio-dp4-reverb", { algorithm: "hall" })).toBe(4);
    expect(variantOf("m.audio-dp4-nonlin", { variant: "non-lin-2" })).toBe(1);
  });

  it("builds the default for a name this build does not know", () => {
    // A document from a newer build should still make a sound.
    expect(variantOf("m.audio-dp4-reverb", { algorithm: "cathedral" })).toBe(0);
    expect(variantOf("m.audio-dp4-reverb", {})).toBe(0);
  });

  it("is zero for a module that has no variants at all", () => {
    expect(variantOf("m.audio-gain", { algorithm: "hall" })).toBe(0);
    expect(variantOf("m.synth", {})).toBe(0);
  });

  it("carries the algorithm through to the engine", () => {
    const engine = new FakeEngine();
    const rack = new WasmRack(engine, 48000);
    rack.update(
      plan([node("v", "m.audio-dp4-reverb", {}, { structure: { algorithm: "hall" } })]),
    );
    expect(engine.variants.get(rack.moduleIdOf("v")!)).toBe(4);
  });
});

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

  it("re-derives its buffers after WASM memory grows", () => {
    // Adding a module that allocates — a reverb's delay lines, say — can grow
    // linear memory, which *detaches* every existing view into it. The rack
    // held its input and output views from construction, so the first quantum
    // after a Blackhole was added threw
    // "Cannot perform %TypedArray%.prototype.fill on a detached ArrayBuffer"
    // and the worklet went silent. Found in the browser, not in a test.
    const engine = new FakeEngine();
    const rack = new WasmRack(engine, 48000);
    const before = rack.input;
    expect(before.byteLength).toBeGreaterThan(0);

    engine.growMemory();

    expect(rack.input).not.toBe(before);
    expect(rack.input.buffer).toBe(engine.memory.buffer);
    expect(rack.output.buffer).toBe(engine.memory.buffer);
    expect(rack.input).toHaveLength(before.length);
  });

  it("keeps handing back the same buffers while memory is stable", () => {
    // The views are on the audio path; rebuilding one per quantum for no
    // reason would allocate in the hot loop.
    const engine = new FakeEngine();
    const rack = new WasmRack(engine, 48000);
    expect(rack.input).toBe(rack.input);
    expect(rack.output).toBe(rack.output);
  });

  it("knows Blackhole's wire number and its whole parameter surface", () => {
    // The discriminants are the protocol with rust/dsp-core/src/modules.rs.
    // A drift here does not fail loudly — it sends Gravity to whatever
    // parameter happens to sit at that index instead.
    expect(MODULE_KINDS["m.audio-blackhole"]).toBe(4);
    const indices = PARAM_INDICES["m.audio-blackhole"];
    expect(Object.values(indices).sort((a, b) => a - b)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11,
    ]);
    // Spot-check the two ends and the shell's own handles.
    expect(indices.gravity).toBe(0);
    expect(indices.resonance).toBe(8);
    expect(indices.level).toBe(10);
    expect(indices.mute).toBe(11);
    // `line-count` is structural: it rebuilds the node rather than moving a
    // value, so it must not claim a parameter slot.
    expect(indices["line-count"]).toBeUndefined();
  });

  it("gives every ported module a distinct wire number", () => {
    const kinds = Object.values(MODULE_KINDS);
    expect(new Set(kinds).size).toBe(kinds.length);
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
    // During the migration some modules are still Web Audio. A plan naming one
    // must leave the rest of the rack working rather than take it down.
    //
    // `m.stream` is the stand-in because it is genuinely unported. This has
    // been `m.audio-reverb` and then `m.percussion`; each time one landed in
    // Rust this test failed, which is exactly what it is for.
    const engine = new FakeEngine();
    const rack = new WasmRack(engine, 48000);
    rack.update(
      plan(
        [node("r", "m.stream", {}), node("out", "m.audio-output", {})],
        [wire("r", "out")],
      ),
    );
    expect(rack.moduleIdOf("r")).toBeUndefined();
    expect(rack.moduleIdOf("out")).not.toBeUndefined();
    expect(rack.unsupported).toEqual(["m.stream"]);
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
        [node("r", "m.stream", {}), node("out", "m.audio-output", {})],
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
    // Nothing scheduled, so each quantum is one whole range: the common case
    // must not pay for the scheduler.
    expect(engine.ranges).toEqual(["0+128", "0+128"]);
  });

  it("breaks the quantum at the frame a scheduled note is due", () => {
    // The whole reason `process_range` exists. A note that may only start on a
    // quantum boundary carries up to 2.7 ms of jitter at 48 kHz, which is
    // audible on anything with a sharp attack.
    const engine = new FakeEngine();
    const rack = new WasmRack(engine, 48000);
    rack.update(plan([node("s", "m.synth")]));
    // Frame 1050 is 26 frames into the quantum starting at 1024.
    rack.schedule(1050 / 48000, [{ type: "note-on", note: 60, velocity: 1, detuneCents: 0 }]);
    rack.process(1024);

    expect(engine.ranges).toEqual(["0+26", "26+102"]);
    expect(engine.of("noteon")).toEqual([`noteon:${rack.moduleIdOf("s")}.60@1+0`]);
  });

  it("holds a note until the quantum it belongs to", () => {
    const engine = new FakeEngine();
    const rack = new WasmRack(engine, 48000);
    rack.update(plan([node("s", "m.synth")]));
    rack.schedule(5000 / 48000, [{ type: "note-on", note: 60, velocity: 1, detuneCents: 0 }]);

    rack.process(0);
    expect(engine.of("noteon")).toEqual([]);
    expect(engine.ranges).toEqual(["0+128"]);
  });

  it("plays a chord as one break rather than several", () => {
    // Three notes at one moment are one edge in the render, not three.
    const engine = new FakeEngine();
    const rack = new WasmRack(engine, 48000);
    rack.update(plan([node("s", "m.synth")]));
    rack.schedule(64 / 48000, [
      { type: "note-on", note: 60, velocity: 1, detuneCents: 0 },
      { type: "note-on", note: 64, velocity: 1, detuneCents: 0 },
      { type: "note-on", note: 67, velocity: 1, detuneCents: 0 },
    ]);
    rack.process(0);
    expect(engine.ranges).toEqual(["0+64", "64+64"]);
    expect(engine.of("noteon")).toHaveLength(3);
  });

  it("breaks the quantum twice for two notes at different frames", () => {
    const engine = new FakeEngine();
    const rack = new WasmRack(engine, 48000);
    rack.update(plan([node("s", "m.synth")]));
    rack.schedule(32 / 48000, [{ type: "note-on", note: 60, velocity: 1, detuneCents: 0 }]);
    rack.schedule(96 / 48000, [{ type: "note-off", note: 60 }]);
    rack.process(0);
    expect(engine.ranges).toEqual(["0+32", "32+64", "96+32"]);
  });

  it("plays an overdue note at the start of the quantum rather than dropping it", () => {
    // A note the host was slow to deliver is late; a note that never sounds is
    // a hole in the piece.
    const engine = new FakeEngine();
    const rack = new WasmRack(engine, 48000);
    rack.update(plan([node("s", "m.synth")]));
    rack.schedule(10 / 48000, [{ type: "note-on", note: 60, velocity: 1, detuneCents: 0 }]);
    rack.process(4096);
    expect(engine.ranges).toEqual(["0+128"]);
    expect(engine.of("noteon")).toHaveLength(1);
  });

  it("plays a note landing exactly on a quantum boundary in that quantum", () => {
    // The off-by-one that would make every on-the-beat note a quantum late.
    const engine = new FakeEngine();
    const rack = new WasmRack(engine, 48000);
    rack.update(plan([node("s", "m.synth")]));
    rack.schedule(128 / 48000, [{ type: "note-on", note: 60, velocity: 1, detuneCents: 0 }]);

    rack.process(0);
    expect(engine.of("noteon")).toEqual([]);
    rack.process(128);
    expect(engine.of("noteon")).toHaveLength(1);
  });

  it("schedules note off and all-notes-off, not just note on", () => {
    const engine = new FakeEngine();
    const rack = new WasmRack(engine, 48000);
    rack.update(plan([node("s", "m.synth")]));
    rack.schedule(0, [{ type: "note-off", note: 60 }, { type: "all-notes-off" }]);
    rack.process(0);
    const synth = rack.moduleIdOf("s");
    expect(engine.of("noteoff")).toEqual([`noteoff:${synth}.60`]);
    expect(engine.of("allnotesoff")).toEqual([`allnotesoff:${synth}`]);
  });

  it("cancels the future when the transport resets", () => {
    // The scheduled notes belong to a passage that is no longer playing.
    const engine = new FakeEngine();
    const rack = new WasmRack(engine, 48000);
    rack.update(plan([node("s", "m.synth")]));
    rack.schedule(64 / 48000, [{ type: "note-on", note: 60, velocity: 1, detuneCents: 0 }]);
    rack.reset();
    rack.process(0);
    expect(engine.of("noteon")).toEqual([]);
    expect(engine.ranges).toEqual(["0+128"]);
  });

  it("says nothing until a report is due", () => {
    // The audio thread must not spend its budget describing itself: at 48 kHz
    // a report per quantum would be four hundred messages a second.
    const engine = new FakeEngine();
    const rack = new WasmRack(engine, 48000);
    for (let i = 0; i < REPORT_INTERVAL_QUANTA; i += 1) {
      expect(rack.takeReport()).toBeUndefined();
      rack.process(i * 128);
    }
    expect(rack.takeReport()).toBeDefined();
  });

  it("reports what the engine holds, including how many samples arrived", () => {
    // The question that could not be asked before this existed, and the reason
    // "does a sample actually reach the bank" went unverified for so long.
    const engine = new FakeEngine();
    const rack = new WasmRack(engine, 48000);
    rack.update(plan([node("s", "m.synth"), node("out", "m.audio-output")]));
    engine.samplesHeld = 3;
    for (let i = 0; i < REPORT_INTERVAL_QUANTA; i += 1) rack.process(i * 128);

    const report = rack.takeReport();
    expect(report?.samples).toBe(3);
    expect(report?.modules).toBe(engine.modules.size);
    expect(report?.cables).toBe(engine.cables.size);
    expect(report?.quanta).toBe(REPORT_INTERVAL_QUANTA);
  });

  it("reports the loudest sample of the interval just ended", () => {
    const engine = new FakeEngine();
    const rack = new WasmRack(engine, 48000);
    engine.renderLevel = 0.5;
    for (let i = 0; i < REPORT_INTERVAL_QUANTA; i += 1) rack.process(i * 128);
    expect(rack.takeReport()?.peak).toBeCloseTo(0.5);
  });

  it("starts the peak over each interval rather than keeping a high-water mark", () => {
    // A running maximum only ever climbs, so a meter drawn from it would stick
    // at the loudest moment of the session and never fall.
    const engine = new FakeEngine();
    const rack = new WasmRack(engine, 48000);
    engine.renderLevel = 0.9;
    for (let i = 0; i < REPORT_INTERVAL_QUANTA; i += 1) rack.process(i * 128);
    rack.takeReport();

    engine.renderLevel = 0.1;
    for (let i = 0; i < REPORT_INTERVAL_QUANTA; i += 1) rack.process(i * 128);
    expect(rack.takeReport()?.peak).toBeCloseTo(0.1);
  });

  it("counts every quantum it has rendered, so a stalled worklet shows", () => {
    const engine = new FakeEngine();
    const rack = new WasmRack(engine, 48000);
    for (let i = 0; i < REPORT_INTERVAL_QUANTA * 2; i += 1) rack.process(i * 128);
    expect(rack.takeReport()?.quanta).toBe(REPORT_INTERVAL_QUANTA * 2);
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

    rack.noteOn(60, 0.8, 0);
    rack.noteOff(60);
    rack.allNotesOff();

    const synth = rack.moduleIdOf("s");
    expect(engine.of("noteon")).toEqual([`noteon:${synth}.60@0.8+0`]);
    expect(engine.of("noteoff")).toEqual([`noteoff:${synth}.60`]);
    expect(engine.of("allnotesoff")).toEqual([`allnotesoff:${synth}`]);
  });

  it("carries a note's microtonal detune across the ABI", () => {
    // The far end of the tuning library. A scale that does not fit the twelve
    // keys arrives as a note plus a remainder in cents, and the remainder has
    // to reach `note_on` or all eighty-one scales sound like 12-TET.
    const engine = new FakeEngine();
    const rack = new WasmRack(engine, 48000);
    rack.update(plan([node("s", "m.synth")]));

    rack.noteOn(60, 0.8, -33.4);

    expect(engine.of("noteon")).toEqual([`noteon:${rack.moduleIdOf("s")}.60@0.8+-33.4`]);
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
