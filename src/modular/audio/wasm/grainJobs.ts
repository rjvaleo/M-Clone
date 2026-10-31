// What the Grain Engine's worker computes, and when.
//
// MultiGrainLive does three things off its audio thread: separates the source
// for the hybrid (`separate_soon`), finds WSOLA's transient onsets
// (`map_for`), and enumerates the grains its cloud pad draws (`/api/grains`).
// Here a Web Worker does them (`grainWorker.ts`, on `grain_jobs.rs`), and this
// decides which are wanted: the separation only while the hybrid is chosen,
// the onsets only while transients are preserved, the grains always, and each
// again only when something it is made from has moved. Requests are throttled
// as MultiGrainLive throttles its preview (90 ms), one at a time per module and
// kind, the newest replacing any not yet sent; a result is passed on only if
// it is still the newest asked for.

import type { AudioPlan } from "../audioPlan";
import { PARAM_INDICES } from "./engineBridge";

/** `grain_jobs::PARTS`, `ONSETS`, `GRAINS`. */
export const JOB_PARTS = 1;
export const JOB_ONSETS = 2;
export const JOB_GRAINS = 3;
/** `grain_jobs::GRAIN_CAP`: MultiGrainLive's default grain cap. */
export const GRAIN_CAP = 8_000;
/** MultiGrainLive's preview throttle. */
export const JOB_THROTTLE_MS = 90;
/** `GrainEngineModule::PARAM_COUNT`. */
export const GRAIN_PARAM_COUNT = 62;

export type GrainWorkerRequest =
  | { type: "init"; module: WebAssembly.Module; rackRate: number }
  | { type: "sample"; slot: number; channels: Float32Array[]; sampleRate: number }
  | { type: "job"; id: number; nodeId: string; kind: number; slot: number; params: Float32Array; cap: number };

export type GrainWorkerReply = { type: "result"; id: number; nodeId: string; kind: number; data: Float32Array };

/** A cloud's grains as the pad draws them (`grain_jobs::grains_job`). */
export type GrainCloud = {
  total: number;
  count: number;
  /** `GRAIN_FIELDS` floats a grain: out hi, out lo, source frame, size, pitch, rms, brightness. */
  grains: Float32Array;
  /** The file's own rate and length, which the grains are counted in. */
  sampleRate: number;
  frames: number;
};

export const GRAIN_FIELDS = 7;

/** A grain job's output, read. */
export function readGrains(data: Float32Array, sampleRate: number, frames: number): GrainCloud {
  const total = data[0] * 65_536 + data[1];
  const count = data[2] ?? 0;
  return { total, count, grains: data.subarray(3, 3 + count * GRAIN_FIELDS), sampleRate, frames };
}

const ENGINE = PARAM_INDICES["m.grain-engine"];

/** What each job is made from, by parameter: anything else moving leaves it as it is. */
const PARTS_FROM = ["resolution", "hold", "spread", "margin"];
const ONSETS_FROM = ["preserve-transients", "detector", "floor"];
const GRAINS_FROM = [
  "stretch", "semitones", "scale", "pitch-step", "window-ms",
  "grain-rate", "density", "overlap", "size-jitter", "position-jitter", "pitch-jitter", "pitch-drift", "drift-rate",
  "layers", "seed", "position", "scan", "reverse", "envelope", "size-range", "wrap", "layer-spread",
  "layer-scatter", "layer-scatter-ms", "link-jitter", "drift-step", "pan-spread",
];

/** The module's controls in its parameter order, as the bridge sets them. */
export function engineParams(parameters: Readonly<Record<string, number>>): Float32Array {
  const out = new Float32Array(GRAIN_PARAM_COUNT);
  for (const [id, index] of Object.entries(ENGINE)) {
    const value = parameters[id];
    if (typeof value === "number" && index < GRAIN_PARAM_COUNT) out[index] = value;
  }
  return out;
}

/** The jobs a Grain Engine wants for these settings, each with what it is made from. */
export function wantedJobs(parameters: Readonly<Record<string, number>>, slot: number): { kind: number; signature: string }[] {
  const sign = (ids: string[]) => JSON.stringify([slot, ...ids.map((id) => parameters[id] ?? null)]);
  const jobs = [{ kind: JOB_GRAINS, signature: sign(GRAINS_FROM) }];
  // The engine travels as its option's index; 4 is the hybrid.
  if (parameters.engine === 4) jobs.push({ kind: JOB_PARTS, signature: sign(PARTS_FROM) });
  if (parameters["preserve-transients"] === 1) jobs.push({ kind: JOB_ONSETS, signature: sign(ONSETS_FROM) });
  return jobs;
}

export type GrainJobSinks = {
  /** Post to the worker. */
  post(request: GrainWorkerRequest, transfer?: Transferable[]): void;
  /** A separation or onsets, for the worklet. */
  rack(nodeId: string, kind: number, data: Float32Array): void;
  /** A cloud's grains, for the pad; null when the module is gone. */
  grains(nodeId: string, cloud: GrainCloud | null): void;
  /** When to send what has been asked for; a timer by default. */
  later?: (send: () => void) => void;
};

type Want = { signature: string; slot: number; params: Float32Array; sampleRate: number; frames: number };

export class GrainJobs {
  private readonly sentSamples = new Set<number>();
  /** What is wanted now, by `nodeId:kind`. */
  private readonly wanted = new Map<string, Want>();
  /** What is in the worker, by `nodeId:kind`: its id and signature. */
  private readonly running = new Map<string, { id: number; signature: string }>();
  /** The signature last sent, by `nodeId:kind`. */
  private readonly sent = new Map<string, string>();
  private nextId = 1;
  private queued = false;

  constructor(private readonly sinks: GrainJobSinks) {}

  /**
   * The plan's Grain Engines: the samples the worker needs, and the jobs
   * their settings want. `sample` gives an asset's bank slot and audio.
   */
  update(plan: AudioPlan, sample: (assetId: string) => { slot: number; channels: () => Float32Array[]; sampleRate: number; frames: number } | undefined): void {
    const live = new Set<string>();
    for (const spec of Object.values(plan.nodes)) {
      if (spec.moduleType !== "m.grain-engine") continue;
      const assetId = spec.structure["asset-id"];
      const found = typeof assetId === "string" && assetId ? sample(assetId) : undefined;
      if (!found) continue;
      if (!this.sentSamples.has(found.slot)) {
        const channels = found.channels();
        this.sinks.post({ type: "sample", slot: found.slot, channels, sampleRate: found.sampleRate }, channels.map((c) => c.buffer));
        this.sentSamples.add(found.slot);
      }
      for (const job of wantedJobs(spec.parameters, found.slot)) {
        const key = `${spec.nodeId}:${job.kind}`;
        live.add(key);
        if (this.wanted.get(key)?.signature === job.signature) continue;
        this.wanted.set(key, { signature: job.signature, slot: found.slot, params: engineParams(spec.parameters), sampleRate: found.sampleRate, frames: found.frames });
      }
    }
    for (const key of [...this.wanted.keys()]) {
      if (live.has(key)) continue;
      this.wanted.delete(key);
      this.sent.delete(key);
      const [nodeId, kind] = key.split(":");
      if (Number(kind) === JOB_GRAINS) this.sinks.grains(nodeId, null);
    }
    this.schedule();
  }

  /** A job's result from the worker. */
  receive(reply: GrainWorkerReply): void {
    const key = `${reply.nodeId}:${reply.kind}`;
    const running = this.running.get(key);
    if (!running || running.id !== reply.id) return;
    this.running.delete(key);
    const want = this.wanted.get(key);
    if (want && want.signature === running.signature) {
      if (reply.kind === JOB_GRAINS) this.sinks.grains(reply.nodeId, readGrains(reply.data, want.sampleRate, want.frames));
      else this.sinks.rack(reply.nodeId, reply.kind, reply.data);
    }
    this.schedule();
  }

  /** Forget what the worker holds: a new rack, a new worker. */
  reset(): void {
    this.sentSamples.clear();
    this.wanted.clear();
    this.running.clear();
    this.sent.clear();
  }

  private schedule(): void {
    if (this.queued) return;
    this.queued = true;
    const later = this.sinks.later ?? ((send) => { setTimeout(send, JOB_THROTTLE_MS); });
    later(() => {
      this.queued = false;
      this.flush();
    });
  }

  private flush(): void {
    for (const [key, want] of this.wanted) {
      if (this.running.has(key) || this.sent.get(key) === want.signature) continue;
      const [nodeId, kind] = key.split(":");
      const id = this.nextId++;
      this.running.set(key, { id, signature: want.signature });
      this.sent.set(key, want.signature);
      this.sinks.post({ type: "job", id, nodeId, kind: Number(kind), slot: want.slot, params: want.params, cap: GRAIN_CAP });
    }
  }
}
