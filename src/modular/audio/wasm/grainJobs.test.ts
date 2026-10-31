import { describe, expect, it } from "vitest";
import { GRAIN_CAP, GrainJobs, JOB_GRAINS, JOB_ONSETS, JOB_PARTS, engineParams, readGrains, wantedJobs, type GrainWorkerRequest } from "./grainJobs";
import { PARAM_INDICES } from "./engineBridge";
import type { AudioPlan } from "../audioPlan";

const plan = (parameters: Record<string, number>, assetId = "a"): AudioPlan => ({
  generation: 1,
  nodes: { g: { nodeId: "g", moduleType: "m.grain-engine", structure: { "asset-id": assetId }, parameters, bypass: false, wet: 1 } },
  connections: [],
});

const sample = () => ({ slot: 3, sampleRate: 44_100, frames: 4, channels: () => [new Float32Array(4)] });

function rig() {
  const posted: GrainWorkerRequest[] = [];
  const rack: [string, number, number][] = [];
  const grains: [string, number | null][] = [];
  let send: (() => void) | null = null;
  const jobs = new GrainJobs({
    post: (request) => posted.push(request),
    rack: (nodeId, kind, data) => rack.push([nodeId, kind, data.length]),
    grains: (nodeId, cloud) => grains.push([nodeId, cloud ? cloud.total : null]),
    later: (fn) => { send = fn; },
  });
  const flush = () => { const fn = send; send = null; fn?.(); };
  const jobsPosted = () => posted.filter((p): p is Extract<GrainWorkerRequest, { type: "job" }> => p.type === "job");
  return { jobs, posted, rack, grains, flush, jobsPosted };
}

describe("The Grain Engine's worker is asked", () => {
  it("for the grains always, the separation on the hybrid, the onsets while transients are preserved", () => {
    expect(wantedJobs({ engine: 2 }, 0).map((j) => j.kind)).toEqual([JOB_GRAINS]);
    expect(wantedJobs({ engine: 4 }, 0).map((j) => j.kind)).toEqual([JOB_GRAINS, JOB_PARTS]);
    expect(wantedJobs({ engine: 0, "preserve-transients": 1 }, 0).map((j) => j.kind)).toEqual([JOB_GRAINS, JOB_ONSETS]);
  });

  it("again only when something a job is made from moves", () => {
    const a = wantedJobs({ engine: 4, resolution: 2048, tone: 1 }, 0);
    const toneMoved = wantedJobs({ engine: 4, resolution: 2048, tone: 0.3 }, 0);
    const splitMoved = wantedJobs({ engine: 4, resolution: 1024, tone: 1 }, 0);
    const parts = (jobs: typeof a) => jobs.find((j) => j.kind === JOB_PARTS)!.signature;
    expect(parts(toneMoved)).toBe(parts(a));
    expect(parts(splitMoved)).not.toBe(parts(a));
  });

  it("with the module's controls at their engine indices", () => {
    const params = engineParams({ stretch: 2, air: 0.5, "pitch-step": 1 });
    expect(params[PARAM_INDICES["m.grain-engine"].stretch]).toBe(2);
    expect(params[PARAM_INDICES["m.grain-engine"].air]).toBe(0.5);
    expect(params[PARAM_INDICES["m.grain-engine"]["pitch-step"]]).toBe(1);
  });

  it("sending the sample once, throttled, one job at a time, passing on only the newest", () => {
    const { jobs, posted, rack, grains, flush, jobsPosted } = rig();
    jobs.update(plan({ engine: 4, stretch: 1 }), sample);
    jobs.update(plan({ engine: 4, stretch: 1 }), sample);
    expect(posted.filter((p) => p.type === "sample")).toHaveLength(1);
    expect(jobsPosted()).toHaveLength(0);
    flush();
    expect(jobsPosted().map((j) => j.kind).sort()).toEqual([JOB_PARTS, JOB_GRAINS]);
    expect(jobsPosted()[0].cap).toBe(GRAIN_CAP);
    // The stretch moves while the grains are out: the reply is stale and not passed on.
    jobs.update(plan({ engine: 4, stretch: 2 }), sample);
    const first = jobsPosted().find((j) => j.kind === JOB_GRAINS)!;
    jobs.receive({ type: "result", id: first.id, nodeId: "g", kind: JOB_GRAINS, data: new Float32Array([0, 5, 0]) });
    expect(grains).toEqual([]);
    flush();
    const second = jobsPosted().filter((j) => j.kind === JOB_GRAINS)[1];
    expect(second).toBeDefined();
    jobs.receive({ type: "result", id: second.id, nodeId: "g", kind: JOB_GRAINS, data: new Float32Array([0, 7, 0]) });
    expect(grains).toEqual([["g", 7]]);
    // The separation was not made from the stretch, so it is passed on.
    const parts = jobsPosted().find((j) => j.kind === JOB_PARTS)!;
    jobs.receive({ type: "result", id: parts.id, nodeId: "g", kind: JOB_PARTS, data: new Float32Array(9) });
    expect(rack).toEqual([["g", JOB_PARTS, 9]]);
  });

  it("and lets a module's grains go when it goes", () => {
    const { jobs, grains } = rig();
    jobs.update(plan({ engine: 2 }), sample);
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
