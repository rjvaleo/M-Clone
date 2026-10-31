// The main thread's handle on the Rust rack.
//
// Small on purpose. Once the worklet owns the engine, the only thing left up
// here is a protocol — post a plan when it changes, post a reset when the
// transport syncs, stop when the node goes away — and the interesting decisions
// have all moved below the boundary where they belong.
//
// The generation filter is the part that earns its place. `AudioPlan.generation`
// already increments whenever the compiler produces a genuinely new plan, so
// comparing it is enough to keep an effect that fires on every document change
// from putting message traffic on the audio path.

import type { AudioPlan } from "../audioPlan";
import type { GrainBuildResult, RackMessage, RackReply, RackReport, ScheduledEvent } from "./rackProtocol";
import { resultTransfers, type BuilderMessage, type GrainsRequest, type GrainsResult } from "./grainBuilder";
import type { SampleSource } from "./sampleTransfer";

/** Which audio backend a session runs on. */
export type RackEngineChoice = "web-audio" | "rust";

/**
 * Read the engine choice out of a query string.
 *
 * Rust unless the page asks for Web Audio with `?engine=web-audio`: every
 * audio module has its Rust half now, and the shared effects and the sound
 * engines arriving next exist only there. Choosing Rust is safe on a build
 * where it cannot load — `useRustEngine` falls back to Web Audio and says so —
 * so an unrecognised value takes the default rather than the fallback.
 */
export const preferredEngine = (search: string): RackEngineChoice => {
  const value = new URLSearchParams(search).get("engine");
  return value === "web-audio" || value === "webaudio" ? "web-audio" : "rust";
};

/** Just enough of `AudioWorkletNode` to talk to, so this stays testable. */
export interface RackNodeLike {
  readonly port: {
    postMessage(message: RackMessage, transfer?: Transferable[]): void;
    onmessage?: ((event: { data: RackReply }) => void) | null;
  };
  disconnect(): void;
}

/** Just enough of a `Worker` running `grainWorker.ts`. */
export interface BuilderWorkerLike {
  postMessage(message: BuilderMessage, transfer?: Transferable[]): void;
  onmessage?: ((event: { data: GrainBuildResult | GrainsResult }) => void) | null;
  terminate(): void;
}

export class WasmRackNode {
  private lastGeneration: number | null = null;
  private disposed = false;

  /**
   * The last thing the audio thread said about itself, or `null` before it has
   * said anything.
   *
   * Held as a value the UI polls rather than delivered as an event, because
   * reports arrive about six times a second and every consumer of them —
   * meters, counts — is already redrawing on its own schedule. Turning each
   * one into a React update would be six renders a second to move a number.
   */
  get report(): RackReport | null {
    return this.lastReport;
  }
  private lastReport: RackReport | null = null;

  /**
   * `builder` makes the Grain Engine's slow builds: the worklet asks, this
   * passes the request on, and the answer goes back down. Without one the
   * requests go unanswered and a Grain Engine plays on without its map or
   * separation (the hybrid as a grain cloud), which is what MultiGrainLive
   * plays while its own build runs.
   */
  constructor(
    private readonly node: RackNodeLike,
    private readonly builder?: BuilderWorkerLike,
  ) {
    // Assigning `onmessage` also starts the port, which is why there is no
    // separate `start()` here.
    node.port.onmessage = (event) => {
      const data = event.data;
      if (data?.type === "report") this.lastReport = data;
      else if (data?.type === "grain-build") this.builder?.postMessage({ type: "build", request: data });
    };
    if (builder) {
      builder.onmessage = (event) => {
        if (this.disposed) return;
        const data = event.data;
        // The pad's grains stay up here; a build goes down to the module.
        if (data.type === "grains") this.grainsListener?.(data);
        else this.node.port.postMessage(data, resultTransfers(data));
      };
    }
  }

  /** Hand the worklet a new plan, if it is actually new. */
  update(plan: AudioPlan): void {
    if (this.disposed) return;
    if (plan.generation === this.lastGeneration) return;
    this.lastGeneration = plan.generation;
    this.node.port.postMessage({ type: "plan", plan });
  }

  /**
   * Send one decoded sample into the engine's bank.
   *
   * The channel buffers are *transferred*, not copied: a two-minute stereo
   * file is forty megabytes, and structured-cloning that per sample would
   * stall the main thread visibly. Transferring detaches the arrays here,
   * which is why the caller hands over copies it does not intend to keep —
   * `AudioBuffer.getChannelData` returns a live view, so the copy is made at
   * the call site rather than here where the intent would be invisible.
   */
  loadSample(slot: number, source: SampleSource): void {
    if (this.disposed) return;
    // The builder holds the same samples under the same slots. Its copy goes
    // first, because the worklet's transfer detaches the originals.
    if (this.builder) {
      const copies = source.channels.map((channel) => channel.slice());
      this.builder.postMessage(
        { type: "sample", slot, channels: copies, sampleRate: source.sampleRate },
        copies.map((channel) => channel.buffer),
      );
    }
    const channels = [...source.channels];
    this.node.port.postMessage(
      { type: "sample", slot, channels, sampleRate: source.sampleRate },
      channels.map((channel) => channel.buffer),
    );
  }

  /** Tell the worklet which asset hash is which slot. */
  setSampleMap(map: Record<string, number>): void {
    if (this.disposed) return;
    this.node.port.postMessage({ type: "sample-map", map });
  }

  reset(): void {
    if (this.disposed) return;
    this.node.port.postMessage({ type: "reset" });
  }

  /**
   * Play a note. Unlike `update`, never deduplicated: two identical
   * `noteOn(60, 1)` calls are two notes, not one plan sent twice.
   */
  noteOn(note: number, velocity: number, detuneCents: number): void {
    if (this.disposed) return;
    this.node.port.postMessage({ type: "note-on", note, velocity, detuneCents });
  }

  /**
   * Play these events at `atSec` on the audio clock rather than on arrival.
   *
   * A batch because a chord is one moment: sending three notes as three
   * messages gives them three chances to be handled in different quanta, and
   * the whole point of a time is that it removes that.
   */
  schedule(nodeId: string, atSec: number, events: ScheduledEvent[]): void {
    if (this.disposed || events.length === 0) return;
    this.node.port.postMessage({ type: "schedule", nodeId, atSec, events });
  }

  noteOff(note: number): void {
    if (this.disposed) return;
    this.node.port.postMessage({ type: "note-off", note });
  }

  allNotesOff(): void {
    if (this.disposed) return;
    this.node.port.postMessage({ type: "all-notes-off" });
  }

  /** Set one cell of a node's modulation matrix. */
  setModulation(nodeId: string, source: number, dest: number, amount: number): void {
    if (this.disposed) return;
    this.node.port.postMessage({ type: "modulation", nodeId, source, dest, amount });
  }

  /** Whether there is a builder to ask for the cloud pad's grains. */
  get canBuildGrains(): boolean {
    return this.builder !== undefined && !this.disposed;
  }

  /** Ask the builder for a cloud pad's grains (`grainJobs.ts`). */
  requestGrains(request: GrainsRequest): void {
    if (this.disposed || !this.builder) return;
    this.builder.postMessage(request);
  }

  /** Where the builder's grains go. */
  onGrains(listener: (result: GrainsResult) => void): void {
    this.grainsListener = listener;
  }
  private grainsListener: ((result: GrainsResult) => void) | null = null;

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.node.disconnect();
    this.builder?.terminate();
  }
}
