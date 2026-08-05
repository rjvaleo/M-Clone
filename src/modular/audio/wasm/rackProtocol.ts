/**
 * What the main thread and the audio thread agree on.
 *
 * Split out of `rackWorklet.ts` because that file *runs* the moment it is
 * imported: it subclasses `AudioWorkletProcessor` and calls
 * `registerProcessor`, neither of which exists outside an
 * `AudioWorkletGlobalScope`. Anything on the main thread that needs the
 * processor's name or its message shape — the loader, the node handle, their
 * tests — would take the whole worklet down with it.
 *
 * So the protocol lives here, where both sides can import it and neither side
 * executes the other.
 */

import type { AudioPlan } from "../audioPlan";

/** Named on both sides of `addModule`. */
export const RACK_PROCESSOR_NAME = "idmlab-rack";

/**
 * What the main thread sends in.
 *
 * Notes are messages rather than plan edits on purpose. A plan describes what
 * the rack *is*; a note is something that happens. Folding note-on into a plan
 * update would mean recompiling a graph to press a key, and would lose the
 * distinction the whole audio layer is built around — structure changes
 * rebuild, everything else does not.
 */
export type RackMessage =
  | { type: "plan"; plan: AudioPlan }
  | { type: "reset" }
  | { type: "note-on"; note: number; velocity: number }
  | { type: "note-off"; note: number }
  | { type: "all-notes-off" }
  | { type: "modulation"; nodeId: string; source: number; dest: number; amount: number };
