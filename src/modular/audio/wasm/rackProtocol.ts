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
 * Something that happens to a note, as opposed to something the rack *is*.
 *
 * Named as its own union because these three are exactly what can be given a
 * time and held: a plan or a sample cannot meaningfully wait for a frame, and
 * a schedule that accepted one would be a queue with a rebuild in it.
 */
export type ScheduledEvent =
  /**
   * `detuneCents` is the part of the pitch a MIDI note number cannot say.
   *
   * Required rather than optional, so that a caller with a tuning system
   * behind it cannot silently omit it: the scale quantisers split every pitch
   * into a note plus this remainder, and a message shape that made the
   * remainder easy to forget is exactly how all eighty-one scales in the
   * library ended up sounding like 12-TET on this path.
   */
  | { type: "note-on"; note: number; velocity: number; detuneCents: number }
  | { type: "note-off"; note: number }
  | { type: "all-notes-off" };

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
  | ScheduledEvent
  | { type: "plan"; plan: AudioPlan }
  /**
   * Decoded audio, on its way into the engine's bank.
   *
   * Sent separately from the plan and *before* it, because a plan naming a
   * sample the engine does not hold yet would assign a slot to nothing. The
   * channel buffers are transferred rather than copied — see
   * `WasmRackNode.loadSample`.
   */
  | { type: "sample"; slot: number; channels: Float32Array[]; sampleRate: number }
  /** Asset hashes to slot numbers, so the worklet can resolve a plan. */
  | { type: "sample-map"; map: Record<string, number> }
  | { type: "reset" }
  /**
   * Play these events at a moment on the audio clock rather than on arrival.
   *
   * `atSec` is `AudioContext.currentTime`, the clock the worklet's own
   * `currentTime` counts in, so the conversion to a frame happens on the audio
   * thread where the two are already in step. Without this a note sounds
   * whenever its message is handled — the main thread's schedule, not the
   * score's, and several quanta of jitter under load.
   *
   * A batch rather than one message per note: a chord is one moment, and
   * sending it as three messages would be three chances to land in different
   * quanta.
   */
  | { type: "schedule"; atSec: number; events: ScheduledEvent[] }
  | { type: "modulation"; nodeId: string; source: number; dest: number; amount: number };
