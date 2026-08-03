// Live parameter edits, scheduled rather than sampled.
//
// Classic re-read the whole project state at the top of every scheduling wake,
// so a knob move landed "whenever the next 25 ms tick happened to notice" —
// with the wake jitter and the lookahead on top of that, the same gesture
// produced a different result every time, and no golden trace could survive
// touching a control.
//
// Here the UI pushes typed edits into a bounded queue and the runtime drains
// them at window boundaries. Each edit carries the tick it takes effect at,
// chosen from the parameter's own declared morph policy — which the registry
// has always had (`ParameterDescriptor.morph`) but which previously only
// affected snapshots. A `step-end` parameter changing on the next step
// boundary is now what actually happens, not a description of intent.
//
// The queue coalesces: dragging a knob for two seconds leaves one pending edit
// per parameter per target tick, not six hundred.

import type { JsonValue, ParameterDescriptor } from "../model/graph";
import type { Tick } from "./time";

export type MorphPolicy = ParameterDescriptor["morph"];

export type ParameterEdit = {
  nodeId: string;
  parameterId: string;
  value: JsonValue;
  /** Musical position the value takes effect at. */
  applyAtTick: Tick;
  /** Submission order, so same-tick edits stay deterministic. */
  sequence: number;
};

/**
 * The next step boundary at or after `tick`, given a stream's step length and
 * where its steps began. Used to quantize step-locked parameter changes.
 */
export function nextStepBoundary(tick: Tick, stepTicks: number, originTick: Tick = 0): Tick {
  const step = Math.max(1, Math.floor(stepTicks));
  const offset = tick - originTick;
  if (offset <= 0) return originTick;
  return originTick + Math.ceil(offset / step) * step;
}

/**
 * When an edit takes effect.
 *
 * `immediate`, `linear`, and `exponential` land as soon as they can be
 * scheduled — the ramp shape is the smoothing policy's business, not the
 * scheduling policy's. `step-start` and `step-end` wait for the boundary, so a
 * pattern-affecting change never lands mid-step and split a note in half.
 */
export function scheduledTickFor(
  morph: MorphPolicy,
  earliestTick: Tick,
  boundaryTick: Tick,
): Tick {
  switch (morph) {
    case "step-start":
    case "step-end":
      return Math.max(earliestTick, boundaryTick);
    default:
      return earliestTick;
  }
}

const editKey = (edit: ParameterEdit): string =>
  `${edit.nodeId} ${edit.parameterId} ${edit.applyAtTick}`;

/**
 * A bounded queue of pending parameter edits.
 *
 * Single producer (the UI), single consumer (the scheduling wake). Unlike
 * telemetry, a lost parameter edit is a real defect — a fader that silently
 * stops responding — so overflow is counted and reported rather than shrugged
 * off, and coalescing is what keeps overflow from happening at all.
 */
export class ParameterQueue {
  private readonly capacity: number;
  private pending: ParameterEdit[] = [];
  private readonly index = new Map<string, ParameterEdit>();
  private sequence = 0;
  private coalescedCount = 0;
  private droppedCount = 0;

  constructor(capacity = 4096) {
    this.capacity = Math.max(1, Math.floor(capacity));
  }

  get size(): number {
    return this.pending.length;
  }

  /** Edits replaced by a newer value for the same parameter and target tick. */
  get coalesced(): number {
    return this.coalescedCount;
  }

  /** Edits lost to overflow. Any non-zero value is a defect worth surfacing. */
  get dropped(): number {
    return this.droppedCount;
  }

  /**
   * Queue an edit. Repeated edits to the same parameter for the same target
   * tick replace each other, which is what a continuous drag produces.
   */
  push(
    nodeId: string,
    parameterId: string,
    value: JsonValue,
    applyAtTick: Tick,
  ): ParameterEdit {
    const edit: ParameterEdit = {
      nodeId,
      parameterId,
      value,
      applyAtTick: Math.max(0, Math.floor(applyAtTick)),
      sequence: this.sequence++,
    };
    const key = editKey(edit);
    const existing = this.index.get(key);
    if (existing) {
      // Keep the original position in the queue; only the value is newer.
      existing.value = value;
      this.coalescedCount += 1;
      return existing;
    }
    if (this.pending.length >= this.capacity) {
      const evicted = this.pending.shift();
      if (evicted) this.index.delete(editKey(evicted));
      this.droppedCount += 1;
    }
    this.pending.push(edit);
    this.index.set(key, edit);
    return edit;
  }

  /**
   * Take every edit due at or before `tick`, in musical then submission order.
   * Edits scheduled further ahead stay queued for a later window.
   */
  drainThrough(tick: Tick): ParameterEdit[] {
    if (this.pending.length === 0) return [];
    const due: ParameterEdit[] = [];
    const remaining: ParameterEdit[] = [];
    for (const edit of this.pending) {
      if (edit.applyAtTick <= tick) {
        due.push(edit);
        this.index.delete(editKey(edit));
      } else remaining.push(edit);
    }
    this.pending = remaining;
    due.sort((a, b) => a.applyAtTick - b.applyAtTick || a.sequence - b.sequence);
    return due;
  }

  /** Everything still queued, for stop and re-compile paths. */
  clear(): void {
    this.pending = [];
    this.index.clear();
  }

  resetCounters(): void {
    this.coalescedCount = 0;
    this.droppedCount = 0;
  }
}

/**
 * Turn a UI gesture into a scheduled edit using the parameter's own policy.
 * This is the only place the two are connected, so no call site can quietly
 * decide a step-locked parameter should jump mid-step.
 */
export function scheduleParameterEdit(
  queue: ParameterQueue,
  descriptor: Pick<ParameterDescriptor, "id" | "morph">,
  nodeId: string,
  value: JsonValue,
  earliestTick: Tick,
  boundaryTick: Tick,
): ParameterEdit {
  return queue.push(
    nodeId,
    descriptor.id,
    value,
    scheduledTickFor(descriptor.morph, earliestTick, boundaryTick),
  );
}
