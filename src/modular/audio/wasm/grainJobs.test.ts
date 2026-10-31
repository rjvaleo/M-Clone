import { describe, expect, it } from "vitest";
import { GRAIN_CAP, GrainJobs, engineParams, grainsSignature, readGrains } from "./grainJobs";
import { buildGrains, type GrainsRequest } from "./grainBuilder";
import { PARAM_INDICES } from "./engineBridge";
import type { AudioPlan } from "../audioPlan";

const plan = (parameters: Record<string, number>, assetId = "a"): AudioPlan => ({
  generation: 1,
  nodes: { g: { nodeId: "g", moduleType: "m.grain-engine", structure: { "asset-id": assetId }, parameters, bypass: false, wet: 1 } },
  connections: [],
});

const sample = () => ({ slot: 3, sampleRate: 44_100, frames: 4 });

function rig() {
  const asked: GrainsRequest[] = [];
  const grains: [string, number | null][] = [];
  let send: (() => void) | null = null;
  const jobs = new GrainJobs({
    request: (request) => asked.push(request),
    grains: (nodeId, cloud) => grains.push([nodeId, cloud ? cloud.total : null]),
    later: (fn) => { send = fn; },
  });
  const flush = () => { const fn = send; send = null; fn?.(); };
  return { jobs, asked, grains, flush };
}

describe("The cloud pad's grains are asked of the builder", () => {
  it("again only when something they are made from moves", () => {
    const a = grainsSignature({ stretch: 1, tone: 1 }, 0);
    expect(grainsSignature({ stretch: 1, tone: 0.3 }, 0)).toBe(a);
    expect(grainsSignature({ stretch: 2, tone: 1 }, 0)).not.toBe(a);
    expect(grainsSignature({ stretch: 1, tone: 1 }, 1)).not.toBe(a);
  });

  it("with the module's controls at their engine indices", () => {
    const params = engineParams({ stretch: 2, air: 0.5, "pitch-step": 1 });
    expect(params[PARAM_INDICES["m.grain-engine"].stretch]).toBe(2);
    expect(params[PARAM_INDICES["m.grain-engine"].air]).toBe(0.5);
    expect(params[PARAM_INDICES["m.grain-engine"]["pitch-step"]]).toBe(1);
  });

  it("throttled, one at a time, passing on only the newest", () => {
    const { jobs, asked, grains, flush } = rig();
    jobs.update(plan({ stretch: 1 }), sample);
    jobs.update(plan({ stretch: 1 }), sample);
    expect(asked).toHaveLength(0);
    flush();
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({ type: "grains", nodeId: "g", slot: 3, cap: GRAIN_CAP });
    // The stretch moves while the grains are out: the answer is stale.
    jobs.update(plan({ stretch: 2 }), sample);
    jobs.receive({ type: "grains", id: asked[0].id, nodeId: "g", data: new Float32Array([0, 5, 0]) });
    expect(grains).toEqual([]);
    flush();
    expect(asked).toHaveLength(2);
    jobs.receive({ type: "grains", id: asked[1].id, nodeId: "g", data: new Float32Array([0, 7, 0]) });
    expect(grains).toEqual([["g", 7]]);
  });

  it("and lets a module's grains go when it goes", () => {
    const { jobs, grains } = rig();
    jobs.update(plan({}), sample);
    jobs.update({ generation: 2, nodes: {}, connections: [] }, sample);
    expect(grains).toEqual([["g", null]]);
  });

  it("reading a grain count past what one float holds", () => {
    const cloud = readGrains(new Float32Array([76, 9_000, 1, 0, 1, 2, 3, 4, 5, 6]), 44_100, 10);
    expect(cloud.total).toBe(76 * 65_536 + 9_000);
    expect(cloud.count).toBe(1);
    expect(Array.from(cloud.grains)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });
});

describe("The builder's grains", () => {
  it("are the controls in, grains_job's output out, as a copy", () => {
    const memory = { buffer: new ArrayBuffer(1024) };
    const out = new Float32Array(memory.buffer, 512, 3);
    out.set([0, 9, 0]);
    let ran: [number, number] | null = null;
    const engine = {
      memory,
      job_params_ptr: () => 0,
      job_grains: (slot: number, cap: number) => { ran = [slot, cap]; return 3; },
      job_output_ptr: () => 512,
    } as unknown as Parameters<typeof buildGrains>[0];
    const params = new Float32Array(62).fill(0.5);
    const result = buildGrains(engine, { type: "grains", id: 4, nodeId: "g", slot: 2, params, cap: 100 });
    expect(new Float32Array(memory.buffer, 0, 62)[61]).toBe(0.5);
    expect(ran).toEqual([2, 100]);
    expect(result).toMatchObject({ type: "grains", id: 4, nodeId: "g" });
    out[1] = 1;
    expect(Array.from(result.data)).toEqual([0, 9, 0]);
  });
});
