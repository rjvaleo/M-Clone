/**
 * The Grain Engine's slow builds, made off the audio thread.
 *
 * A Grain Engine's transient map (WSOLA preserving transients) and its hybrid
 * separation each run an analysis over the whole file: seconds on a long one.
 * Made on the audio thread, as they were, that is a dropout. MultiGrainLive
 * makes both on threads of its own; here the rack asks instead
 * (`WasmRack.takeBuildRequests`), the main thread hands the request to a
 * worker, and the worker makes it with this.
 *
 * It makes it with the engine itself: a second instance of the same `.wasm`,
 * holding the same samples, given the asking module's parameters and run for
 * one quantum, builds in place exactly what that module would have built. So
 * there is no second implementation of either analysis to keep in step; the
 * Rust test `a_build_made_on_another_engine_plays_as_one_made_in_place` holds
 * that the answer, handed back, plays sample for sample as one made in place.
 *
 * Everything with a decision in it is here, where it can be tested against a
 * fake engine; `grainWorker.ts` only wires it to a message port.
 */

import type { EngineExports } from "./engineBridge";
import { MODULE_KINDS, GRAIN_ENGINE_TYPE } from "./engineBridge";
import type { GrainBuildRequest, GrainBuildResult } from "./rackProtocol";
import { transferSample, type SampleSource } from "./sampleTransfer";

/** What the builder needs beyond the rack's half of the ABI. */
export interface BuildExports {
  // The cloud pad's grains (`dsp_core::grain_jobs::grains_job`).
  job_params_ptr(): number;
  job_grains(sample: number, cap: number): number;
  job_output_ptr(): number;
  built_map_len(module: number): number;
  built_map_ptr(): number;
  built_parts_frames(module: number): number;
  built_parts_channels(module: number): number;
  built_parts_ptr(module: number, which: number): number;
}

/** `built_map_len` for a module that made no map: a straight line. */
const NO_MAP = 0xffffffff;

export class GrainBuilder {
  /**
   * Started at the rack's rate: the rate decides how a sample is resampled
   * before anything is built from it, so the two engines must agree.
   */
  constructor(
    private readonly engine: EngineExports & BuildExports,
    private readonly sampleRate: number,
  ) {
    engine.init(sampleRate);
  }

  /** The cloud pad's grains; see `buildGrains`. */
  grains(request: GrainsRequest): GrainsResult {
    return buildGrains(this.engine, request);
  }

  /** A sample into this engine's bank, under the slot the rack gave it. */
  loadSample(slot: number, source: SampleSource): boolean {
    return transferSample(this.engine, slot, source);
  }

  /**
   * Make what `request` asks for, as the module that asked would have made it.
   *
   * The result's arrays are copies out of this engine's memory, so the caller
   * can transfer them without detaching anything here.
   */
  build(request: GrainBuildRequest): GrainBuildResult {
    const result: GrainBuildResult = { type: "grain-built", nodeId: request.nodeId, seq: request.seq };
    // Built at another rate it would not be the module's build: answer with
    // nothing, and the module keeps playing what it has.
    if (request.sampleRate !== this.sampleRate) return result;
    const engine = this.engine;
    const id = engine.add_module(MODULE_KINDS[GRAIN_ENGINE_TYPE]) >>> 0;
    request.params.forEach((value, index) => engine.set_param(id, index, value));
    engine.set_sample_slot(id, 0, request.sample);
    // One quantum: the module loads its sample and, not deferred, builds.
    engine.process_quantum();
    if (request.map) {
      const anchors = engine.built_map_len(id) >>> 0;
      result.map = anchors === NO_MAP
        ? null
        : new Float64Array(engine.memory.buffer, engine.built_map_ptr(), anchors * 2).slice();
    }
    if (request.parts) {
      const frames = engine.built_parts_frames(id) >>> 0;
      const channels = engine.built_parts_channels(id) >>> 0;
      if (frames > 0) {
        const part = (which: number) =>
          new Float32Array(engine.memory.buffer, engine.built_parts_ptr(id, which), frames * channels).slice();
        result.parts = { channels, harmonic: part(0), percussive: part(1), residual: part(2) };
      }
    }
    engine.remove_module(id);
    return result;
  }
}

/**
 * The cloud pad's grains for these settings, from the sample in `slot`: what
 * MultiGrainLive's `/api/grains` sends its pad (`grains_sampled` at the file's
 * own rate and length, capped at `cap`, each grain measured). A copy out of
 * this engine's memory, to transfer.
 */
export function buildGrains(engine: EngineExports & BuildExports, request: GrainsRequest): GrainsResult {
  new Float32Array(engine.memory.buffer, engine.job_params_ptr(), request.params.length).set(request.params);
  const len = engine.job_grains(request.slot, request.cap);
  const data = new Float32Array(engine.memory.buffer, engine.job_output_ptr(), len).slice();
  return { type: "grains", id: request.id, nodeId: request.nodeId, data };
}

/** The pad's grains asked for (`grainJobs.ts`). */
export type GrainsRequest = { type: "grains"; id: number; nodeId: string; slot: number; params: Float32Array; cap: number };
/** And the answer: `grain_jobs::grains_job`'s output. */
export type GrainsResult = { type: "grains"; id: number; nodeId: string; data: Float32Array };

/** The arrays in a result, to transfer rather than copy across a port. */
export const resultTransfers = (result: GrainBuildResult): ArrayBuffer[] => {
  const buffers: ArrayBuffer[] = [];
  if (result.map) buffers.push(result.map.buffer as ArrayBuffer);
  if (result.parts) {
    buffers.push(
      result.parts.harmonic.buffer as ArrayBuffer,
      result.parts.percussive.buffer as ArrayBuffer,
      result.parts.residual.buffer as ArrayBuffer,
    );
  }
  return buffers;
};

/** What the main thread sends the worker. */
export type BuilderMessage =
  | { type: "init"; module: WebAssembly.Module; sampleRate: number }
  | { type: "sample"; slot: number; channels: Float32Array[]; sampleRate: number }
  | { type: "build"; request: GrainBuildRequest }
  | GrainsRequest;
