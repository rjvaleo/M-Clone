import { describe, expect, it } from "vitest";
import { GrainBuilder, resultTransfers, type BuildExports } from "./grainBuilder";
import { MODULE_KINDS, type EngineExports } from "./engineBridge";
import type { GrainBuildRequest } from "./rackProtocol";

/**
 * The worker's half: a second engine that builds in place what the rack's
 * Grain Engine asked for. Whether that build is the module's own is held
 * against the real `.wasm` in `rust/wasm/verify.mjs` ("built elsewhere, it
 * plays exactly as built in place"); this holds what the builder does around
 * it — the module it makes, what it reads back, and that it cleans up.
 */

/** Just the calls the builder makes, with a map and parts it pretends to have built. */
const fakeEngine = (built: { anchors?: number[] | null; parts?: number[][]; channels?: number }) => {
  const memory = { buffer: new ArrayBuffer(4096) };
  const calls: string[] = [];
  const write = (at: number, values: number[], Kind: Float32ArrayConstructor | Float64ArrayConstructor) => {
    new Kind(memory.buffer, at, values.length).set(values);
    return at;
  };
  const engine = {
    memory,
    init: (rate: number) => calls.push(`init:${rate}`),
    add_module: (kind: number) => (calls.push(`add:${kind}`), 5),
    remove_module: (id: number) => (calls.push(`remove:${id}`), 1),
    set_param: (id: number, index: number, value: number) => calls.push(`param:${id}.${index}=${value}`),
    set_sample_slot: (id: number, slot: number, sample: number) => calls.push(`slot:${id}.${slot}=${sample}`),
    process_quantum: () => calls.push("process"),
    sample_alloc: () => 1,
    sample_ptr: () => 2048,
    sample_len: (id: number) => (calls.push(`len:${id}`), 2),
    sample_free: () => undefined,
    built_map_len: () => (built.anchors === null ? -1 : (built.anchors?.length ?? 0) / 2),
    built_map_ptr: () => write(0, built.anchors ?? [], Float64Array),
    built_parts_frames: () => (built.parts ? built.parts[0].length / (built.channels ?? 1) : 0),
    built_parts_channels: () => built.channels ?? 0,
    built_parts_ptr: (_: number, which: number) => write(512 + which * 128, built.parts![which], Float32Array),
  };
  return { engine: engine as unknown as EngineExports & BuildExports, calls };
};

const request = (asks: Partial<GrainBuildRequest> = {}): GrainBuildRequest => ({
  type: "grain-build", nodeId: "g", seq: 7, map: true, parts: false,
  params: Float32Array.of(0, 2), sample: 3, sampleRate: 48000, ...asks,
});

describe("The Grain Engine's build worker", () => {
  it("starts its engine at the rack's rate", () => {
    const { engine, calls } = fakeEngine({});
    new GrainBuilder(engine, 48000);
    expect(calls).toEqual(["init:48000"]);
  });

  it("builds on a module of its own, with the settings and sample asked under, then removes it", () => {
    const { engine, calls } = fakeEngine({ anchors: [0, 0, 100, 200] });
    new GrainBuilder(engine, 48000).build(request());
    expect(calls).toEqual([
      "init:48000",
      `add:${MODULE_KINDS["m.grain-engine"]}`,
      "param:5.0=0", "param:5.1=2",
      "slot:5.0=3",
      "process",
      "remove:5",
    ]);
  });

  it("reads back the map's anchors", () => {
    const { engine } = fakeEngine({ anchors: [0, 0, 100, 200, 400, 900] });
    const result = new GrainBuilder(engine, 48000).build(request());
    expect(result).toMatchObject({ type: "grain-built", nodeId: "g", seq: 7 });
    expect([...result.map!]).toEqual([0, 0, 100, 200, 400, 900]);
    expect(result.parts).toBeUndefined();
  });

  it("answers a straight line as no map", () => {
    const { engine } = fakeEngine({ anchors: null });
    expect(new GrainBuilder(engine, 48000).build(request()).map).toBeNull();
  });

  it("reads back the separation's three parts", () => {
    const { engine } = fakeEngine({ parts: [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12]], channels: 2 });
    const result = new GrainBuilder(engine, 48000).build(request({ map: false, parts: true }));
    expect(result.map).toBeUndefined();
    expect(result.parts!.channels).toBe(2);
    expect([result.parts!.harmonic, result.parts!.percussive, result.parts!.residual].map((p) => [...p])).toEqual([
      [1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12],
    ]);
  });

  it("builds nothing for a rack at another rate, which would not be the module's build", () => {
    const { engine, calls } = fakeEngine({ anchors: [0, 0, 1, 1] });
    const result = new GrainBuilder(engine, 48000).build(request({ sampleRate: 44100 }));
    expect(result).toEqual({ type: "grain-built", nodeId: "g", seq: 7 });
    expect(calls).toEqual(["init:48000"]);
  });

  it("holds samples under the rack's slots", () => {
    const { engine, calls } = fakeEngine({});
    const builder = new GrainBuilder(engine, 48000);
    expect(builder.loadSample(3, { channels: [Float32Array.of(0.5, -0.5)], sampleRate: 44100 })).toBe(true);
    expect(calls).toContain("len:3");
  });

  it("transfers a result's arrays rather than copying them", () => {
    const map = Float64Array.of(0, 0, 1, 1);
    const parts = { channels: 1, harmonic: Float32Array.of(1), percussive: Float32Array.of(2), residual: Float32Array.of(3) };
    expect(resultTransfers({ type: "grain-built", nodeId: "g", seq: 1, map, parts })).toEqual([
      map.buffer, parts.harmonic.buffer, parts.percussive.buffer, parts.residual.buffer,
    ]);
    expect(resultTransfers({ type: "grain-built", nodeId: "g", seq: 1, map: null })).toEqual([]);
  });
});

describe("The Grain Engine's build worker, for the cloud pad", () => {
  it("enumerates grains on its own engine, as buildGrains does", () => {
    const { engine } = fakeEngine({});
    const memory = (engine as unknown as { memory: { buffer: ArrayBuffer } }).memory;
    new Float32Array(memory.buffer, 1024, 3).set([0, 2, 0]);
    let ran: [number, number] | null = null;
    Object.assign(engine, {
      job_params_ptr: () => 0,
      job_grains: (slot: number, cap: number) => { ran = [slot, cap]; return 3; },
      job_output_ptr: () => 1024,
    });
    const result = new GrainBuilder(engine, 48000).grains({ type: "grains", id: 9, nodeId: "g", slot: 1, params: Float32Array.of(0.25), cap: 50 });
    expect(ran).toEqual([1, 50]);
    expect(new Float32Array(memory.buffer, 0, 1)[0]).toBe(0.25);
    expect(result).toMatchObject({ type: "grains", id: 9, nodeId: "g" });
    expect([...result.data]).toEqual([0, 2, 0]);
  });
});
