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
import type { RackMessage } from "./rackProtocol";

/** Which audio backend a session runs on. */
export type RackEngineChoice = "web-audio" | "rust";

/**
 * Read the engine choice out of a query string.
 *
 * Opt-in, and deliberately not persisted: while the Rust path is the newer of
 * the two, someone who lands on a broken build should get the working one back
 * by removing a parameter rather than by finding a setting. An unrecognised
 * value is Web Audio — a typo has to land on the path that works.
 */
export const preferredEngine = (search: string): RackEngineChoice => {
  const value = new URLSearchParams(search).get("engine");
  return value === "rust" ? "rust" : "web-audio";
};

/** Just enough of `AudioWorkletNode` to talk to, so this stays testable. */
export interface RackNodeLike {
  readonly port: { postMessage(message: RackMessage): void };
  disconnect(): void;
}

export class WasmRackNode {
  private lastGeneration: number | null = null;
  private disposed = false;

  constructor(private readonly node: RackNodeLike) {}

  /** Hand the worklet a new plan, if it is actually new. */
  update(plan: AudioPlan): void {
    if (this.disposed) return;
    if (plan.generation === this.lastGeneration) return;
    this.lastGeneration = plan.generation;
    this.node.port.postMessage({ type: "plan", plan });
  }

  reset(): void {
    if (this.disposed) return;
    this.node.port.postMessage({ type: "reset" });
  }

  /**
   * Play a note. Unlike `update`, never deduplicated: two identical
   * `noteOn(60, 1)` calls are two notes, not one plan sent twice.
   */
  noteOn(note: number, velocity: number): void {
    if (this.disposed) return;
    this.node.port.postMessage({ type: "note-on", note, velocity });
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

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.node.disconnect();
  }
}
