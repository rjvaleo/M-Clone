// When the Grain Engine's builder is asked for the cloud pad's grains.
//
// MultiGrainLive's pad draws the grains its server enumerates (`/api/grains`),
// fetched again whenever the document changes. Here the Grain Engine's builder
// worker enumerates them (`buildGrains` in `grainBuilder.ts`), on its second
// instance of the engine, which already holds the same samples under the same
// slots. This decides when: again only when something the grains are made from
// has moved, throttled as MultiGrainLive throttles its preview (90 ms), one
// request at a time per module, and an answer is passed on only if it is still
// the newest asked for.

import type { AudioPlan } from "../audioPlan";
import { PARAM_INDICES } from "./engineBridge";
import type { GrainsRequest, GrainsResult } from "./grainBuilder";

/** `grain_jobs::GRAIN_CAP`: MultiGrainLive's default grain cap. */
export const GRAIN_CAP = 8_000;
/** MultiGrainLive's preview throttle. */
export const JOB_THROTTLE_MS = 90;
/** `GrainEngineModule::PARAM_COUNT`. */
export const GRAIN_PARAM_COUNT = 62;

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
  const total = (data[0] ?? 0) * 65_536 + (data[1] ?? 0);
  const count = data[2] ?? 0;
  return { total, count, grains: data.subarray(3, 3 + count * GRAIN_FIELDS), sampleRate, frames };
}

const ENGINE = PARAM_INDICES["m.grain-engine"];

/** What the grains are made from: `grains_sampled`'s arguments. Anything else moving leaves them. */
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

/** What a Grain Engine's grains are made from, as a signature. */
export const grainsSignature = (parameters: Readonly<Record<string, number>>, slot: number): string =>
  JSON.stringify([slot, ...GRAINS_FROM.map((id) => parameters[id] ?? null)]);

export type GrainJobSinks = {
  /** Ask the builder. */
  request(request: GrainsRequest): void;
  /** A cloud's grains, for the pad; null when the module is gone. */
  grains(nodeId: string, cloud: GrainCloud | null): void;
  /** When to send what has been asked for; a timer by default. */
  later?: (send: () => void) => void;
};

/** An asset's bank slot and its file's own rate and length. */
export type GrainSample = { slot: number; sampleRate: number; frames: number };

type Want = { signature: string; slot: number; params: Float32Array; sampleRate: number; frames: number };

export class GrainJobs {
  /** What is wanted now, by node. */
  private readonly wanted = new Map<string, Want>();
  /** What the builder is making, by node: its id and signature. */
  private readonly running = new Map<string, { id: number; signature: string }>();
  /** The signature last sent, by node. */
  private readonly sent = new Map<string, string>();
  private nextId = 1;
  private queued = false;

  constructor(private readonly sinks: GrainJobSinks) {}

  /** The plan's Grain Engines, and the grains their settings want. */
  update(plan: AudioPlan, sample: (assetId: string) => GrainSample | undefined): void {
    const live = new Set<string>();
    for (const spec of Object.values(plan.nodes)) {
      if (spec.moduleType !== "m.grain-engine") continue;
      const assetId = spec.structure["asset-id"];
      const found = typeof assetId === "string" && assetId ? sample(assetId) : undefined;
      if (!found) continue;
      live.add(spec.nodeId);
      const signature = grainsSignature(spec.parameters, found.slot);
      if (this.wanted.get(spec.nodeId)?.signature === signature) continue;
      this.wanted.set(spec.nodeId, { signature, slot: found.slot, params: engineParams(spec.parameters), sampleRate: found.sampleRate, frames: found.frames });
    }
    for (const nodeId of [...this.wanted.keys()]) {
      if (live.has(nodeId)) continue;
      this.wanted.delete(nodeId);
      this.sent.delete(nodeId);
      this.sinks.grains(nodeId, null);
    }
    this.schedule();
  }

  /** The builder's answer. */
  receive(result: GrainsResult): void {
    const running = this.running.get(result.nodeId);
    if (!running || running.id !== result.id) return;
    this.running.delete(result.nodeId);
    const want = this.wanted.get(result.nodeId);
    if (want && want.signature === running.signature) {
      this.sinks.grains(result.nodeId, readGrains(result.data, want.sampleRate, want.frames));
    }
    this.schedule();
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
    for (const [nodeId, want] of this.wanted) {
      if (this.running.has(nodeId) || this.sent.get(nodeId) === want.signature) continue;
      const id = this.nextId++;
      this.running.set(nodeId, { id, signature: want.signature });
      this.sent.set(nodeId, want.signature);
      this.sinks.request({ type: "grains", id, nodeId, slot: want.slot, params: want.params, cap: GRAIN_CAP });
    }
  }
}
