// The runtime event queue and the sounding-note shadow.
//
// Two problems with the Classic approach are fixed here.
//
// Allocation: Classic kept pending events in a plain array, rebuilt it with
// `filter` on every retrigger, and split it into two fresh arrays on every
// drain — steady garbage at 40 Hz, and GC pauses land as timing jitter. This
// queue is a binary heap over a backing array that grows but never shrinks,
// drains into a caller-owned buffer, and hands used events back to a pool.
//
// Panic accuracy: Classic tracked *scheduled* notes and removed them when the
// note-off was drained, up to a full lookahead before the note actually
// stopped — so at no instant did it know what was really sounding, and panic
// fell back to CC 123, which plenty of hardware ignores. `SoundingNotes`
// records notes as they are genuinely sent to a port, so panic can release
// exactly the right notes and a device that disconnects mid-phrase can be
// repaired on reconnect.

import type { Tick } from "./time";

export type RuntimeEventType =
  | "note-on"
  | "note-off"
  | "program-change"
  | "control-change";

/**
 * One scheduled event.
 *
 * Deliberately a single flat shape rather than a discriminated union of
 * differently-shaped objects: every event has the same hidden class, so the
 * heap stays monomorphic and pooled instances can be reused for any type.
 * `atTick` is canonical; `atSec` is the derived real time handed to adapters.
 */
export type RuntimeEvent = {
  type: RuntimeEventType;
  atTick: Tick;
  atSec: number;
  sequence: number;
  /** Destination port — a MIDI Output or instrument node, resolved at compile. */
  portId: string;
  channel: number;
  note: number;
  /**
   * Cents away from `note`, for a pitch that is not on the twelve-tone grid.
   *
   * Travels with the note rather than being re-derived downstream: by the time
   * an event reaches an adapter the scale it was quantised against is long
   * gone, so this is the only place the microtonal part of the pitch still
   * exists. Zero for everything untouched by a quantiser.
   */
  detuneCents: number;
  velocity: number;
  program: number;
  controller: number;
  value: number;
  /** Identifies one sounding note across its on/off pair. */
  noteId: number;
};

/**
 * At the same tick, state repairs land before releases, and releases before
 * attacks — so a retrigger never leaves the previous note hanging and a
 * program change never applies to a note already sounding.
 */
export const EVENT_PRIORITY: Record<RuntimeEventType, number> = {
  "program-change": 0,
  "control-change": 0,
  "note-off": 1,
  "note-on": 2,
};

export function compareRuntimeEvents(a: RuntimeEvent, b: RuntimeEvent): number {
  return (
    a.atTick - b.atTick ||
    EVENT_PRIORITY[a.type] - EVENT_PRIORITY[b.type] ||
    (a.portId < b.portId ? -1 : a.portId > b.portId ? 1 : 0) ||
    a.channel - b.channel ||
    a.sequence - b.sequence
  );
}

const blankEvent = (): RuntimeEvent => ({
  type: "note-on",
  atTick: 0,
  atSec: 0,
  sequence: 0,
  portId: "",
  channel: 1,
  note: 60,
  detuneCents: 0,
  velocity: 100,
  program: 0,
  controller: 0,
  value: 0,
  noteId: 0,
});

/**
 * A free list of event objects. Processors acquire, fill, and schedule; the
 * runtime reclaims after adapters have consumed the batch. Steady-state
 * playback therefore allocates nothing.
 */
export class EventPool {
  private readonly free: RuntimeEvent[] = [];
  private createdCount = 0;

  constructor(preallocate = 0) {
    for (let i = 0; i < preallocate; i++) {
      this.free.push(blankEvent());
      this.createdCount += 1;
    }
  }

  /** Objects ever constructed — a steady value proves the hot path is clean. */
  get created(): number {
    return this.createdCount;
  }

  get available(): number {
    return this.free.length;
  }

  acquire(): RuntimeEvent {
    const event = this.free.pop();
    if (event) return event;
    this.createdCount += 1;
    return blankEvent();
  }

  release(event: RuntimeEvent): void {
    this.free.push(event);
  }

  releaseAll(events: readonly RuntimeEvent[], count = events.length): void {
    for (let i = 0; i < count; i++) this.free.push(events[i]);
  }
}

/** A binary min-heap of scheduled events, ordered by `compareRuntimeEvents`. */
export class EventHeap {
  private readonly items: RuntimeEvent[] = [];
  private count = 0;

  get size(): number {
    return this.count;
  }

  peek(): RuntimeEvent | null {
    return this.count === 0 ? null : this.items[0];
  }

  push(event: RuntimeEvent): void {
    this.items[this.count] = event;
    this.count += 1;
    this.siftUp(this.count - 1);
  }

  pop(): RuntimeEvent | null {
    if (this.count === 0) return null;
    const top = this.items[0];
    this.count -= 1;
    if (this.count > 0) {
      this.items[0] = this.items[this.count];
      this.siftDown(0);
    }
    // Drop the reference so a drained event is not retained by the backing
    // array while it sits in the pool.
    this.items[this.count] = undefined as unknown as RuntimeEvent;
    return top;
  }

  /**
   * Move every event before `endTick` into `out`, oldest first, and return how
   * many were written. `out` is caller-owned and reused across windows.
   */
  drainBefore(endTick: Tick, out: RuntimeEvent[]): number {
    let written = 0;
    while (this.count > 0 && this.items[0].atTick < endTick) {
      out[written] = this.pop() as RuntimeEvent;
      written += 1;
    }
    return written;
  }

  /** Remove everything, optionally returning the events to a pool. */
  clear(pool?: EventPool): void {
    for (let i = 0; i < this.count; i++) {
      if (pool) pool.release(this.items[i]);
      this.items[i] = undefined as unknown as RuntimeEvent;
    }
    this.count = 0;
  }

  private siftUp(start: number): void {
    let index = start;
    const item = this.items[index];
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (compareRuntimeEvents(item, this.items[parent]) >= 0) break;
      this.items[index] = this.items[parent];
      index = parent;
    }
    this.items[index] = item;
  }

  private siftDown(start: number): void {
    let index = start;
    const item = this.items[index];
    for (;;) {
      const left = index * 2 + 1;
      if (left >= this.count) break;
      const right = left + 1;
      const child =
        right < this.count && compareRuntimeEvents(this.items[right], this.items[left]) < 0
          ? right
          : left;
      if (compareRuntimeEvents(this.items[child], item) >= 0) break;
      this.items[index] = this.items[child];
      index = child;
    }
    this.items[index] = item;
  }
}

export type SoundingNote = { portId: string; channel: number; note: number };

/**
 * What is actually sounding right now, per destination port.
 *
 * Updated as messages are sent, not as they are scheduled, so it is accurate
 * at every instant. Repeated attacks on the same key are counted, which means
 * an overlapping retrigger releases the right number of times instead of
 * leaving a note stuck on the device.
 */
export class SoundingNotes {
  private readonly counts = new Map<string, { note: SoundingNote; count: number }>();

  private static key(portId: string, channel: number, note: number): string {
    return `${portId}\u0000${channel}\u0000${note}`;
  }

  get size(): number {
    return this.counts.size;
  }

  /** Record a note-on that has genuinely been sent. */
  markOn(portId: string, channel: number, note: number): void {
    const key = SoundingNotes.key(portId, channel, note);
    const existing = this.counts.get(key);
    if (existing) existing.count += 1;
    else this.counts.set(key, { note: { portId, channel, note }, count: 1 });
  }

  /** Record a note-off. Returns false when nothing was sounding. */
  markOff(portId: string, channel: number, note: number): boolean {
    const key = SoundingNotes.key(portId, channel, note);
    const existing = this.counts.get(key);
    if (!existing) return false;
    existing.count -= 1;
    if (existing.count <= 0) this.counts.delete(key);
    return true;
  }

  isSounding(portId: string, channel: number, note: number): boolean {
    return this.counts.has(SoundingNotes.key(portId, channel, note));
  }

  /** Everything sounding, optionally limited to one port. One entry per attack. */
  active(portId?: string): SoundingNote[] {
    const out: SoundingNote[] = [];
    for (const entry of this.counts.values()) {
      if (portId !== undefined && entry.note.portId !== portId) continue;
      for (let i = 0; i < entry.count; i++) out.push({ ...entry.note });
    }
    return out;
  }

  /**
   * The panic and device-loss primitive: hand back exactly what must be
   * released and forget it, so a reconnecting device starts clean.
   */
  takeAll(portId?: string): SoundingNote[] {
    const taken = this.active(portId);
    if (portId === undefined) this.counts.clear();
    else {
      for (const [key, entry] of this.counts) {
        if (entry.note.portId === portId) this.counts.delete(key);
      }
    }
    return taken;
  }

  clear(): void {
    this.counts.clear();
  }
}
