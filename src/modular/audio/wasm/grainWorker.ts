// The Grain Engine's heavy work, off both the audio thread and the page's.
//
// A Web Worker holding a second instance of the engine, which runs the jobs
// `rust/dsp-core/src/grain_jobs.rs` defines: the hybrid's separation, WSOLA's
// transient onsets and the grains the cloud pad draws. MultiGrainLive keeps
// all three off its audio thread (`live.rs`, `/api/grains`); here they also
// keep off the page, so a long file's separation stalls neither.
//
// Like the worklet, this file is a shell: what to compute and when is decided
// in `grainJobs.ts`, which is tested; the computing is the engine's, which is
// tested in Rust.

import type { GrainWorkerReply, GrainWorkerRequest } from "./grainJobs";

type JobExports = {
  init(sampleRate: number): void;
  sample_alloc(id: number, channels: number, frames: number, sampleRate: number): number;
  sample_ptr(id: number): number;
  job_params_ptr(): number;
  job_run(kind: number, sample: number, rackRate: number, cap: number): number;
  job_output_ptr(): number;
  readonly memory: WebAssembly.Memory;
};

let engine: JobExports | null = null;
let rackRate = 48_000;

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<GrainWorkerRequest>) => void) | null;
  postMessage(message: GrainWorkerReply, transfer?: Transferable[]): void;
};

scope.onmessage = (event) => {
  const message = event.data;
  if (message.type === "init") {
    rackRate = message.rackRate;
    engine = new WebAssembly.Instance(message.module, {}).exports as unknown as JobExports;
    engine.init(rackRate);
    return;
  }
  if (!engine) return;
  if (message.type === "sample") {
    const frames = message.channels[0]?.length ?? 0;
    if (!engine.sample_alloc(message.slot, message.channels.length, frames, message.sampleRate)) return;
    // After the allocation, which may have grown memory.
    const into = new Float32Array(engine.memory.buffer, engine.sample_ptr(message.slot), frames * message.channels.length);
    message.channels.forEach((channel, i) => into.set(channel, i * frames));
    return;
  }
  new Float32Array(engine.memory.buffer, engine.job_params_ptr(), message.params.length).set(message.params);
  const len = engine.job_run(message.kind, message.slot, rackRate, message.cap);
  const data = new Float32Array(new Float32Array(engine.memory.buffer, engine.job_output_ptr(), len));
  scope.postMessage({ type: "result", id: message.id, nodeId: message.nodeId, kind: message.kind, data }, [data.buffer]);
};
