import { describe, expect, it } from "vitest";
import {
  compareRuntimeEvents,
  EventHeap,
  EventPool,
  SoundingNotes,
  type RuntimeEvent,
  type RuntimeEventType,
} from "./eventqueue";

let sequence = 0;

const event = (
  type: RuntimeEventType,
  atTick: number,
  overrides: Partial<RuntimeEvent> = {},
): RuntimeEvent => ({
  type,
  atTick,
  atSec: atTick / 960,
  sequence: sequence++,
  portId: "out",
  channel: 1,
  note: 60,
  velocity: 100,
  program: 0,
  controller: 0,
  value: 0,
  noteId: 0,
  ...overrides,
});

describe("Runtime event ordering", () => {
  it("repairs state, then releases, then attacks at the same tick", () => {
    const events = [
      event("note-on", 480),
      event("note-off", 480),
      event("program-change", 480),
    ];
    expect([...events].sort(compareRuntimeEvents).map((item) => item.type))
      .toEqual(["program-change", "note-off", "note-on"]);
  });

  it("breaks ties by port, channel, then submission order", () => {
    const first = event("note-on", 0, { portId: "a", channel: 2 });
    const second = event("note-on", 0, { portId: "b", channel: 1 });
    const third = event("note-on", 0, { portId: "a", channel: 1 });
    const fourth = event("note-on", 0, { portId: "a", channel: 1 });
    expect([first, second, third, fourth].sort(compareRuntimeEvents))
      .toEqual([third, fourth, first, second]);
  });
});

describe("Event heap", () => {
  it("drains in musical order regardless of insertion order", () => {
    const heap = new EventHeap();
    for (const tick of [960, 0, 1920, 480, 240]) heap.push(event("note-on", tick));
    expect(heap.size).toBe(5);
    expect(heap.peek()?.atTick).toBe(0);
    const out: RuntimeEvent[] = [];
    const count = heap.drainBefore(2000, out);
    expect(count).toBe(5);
    expect(out.slice(0, count).map((item) => item.atTick)).toEqual([0, 240, 480, 960, 1920]);
    expect(heap.size).toBe(0);
    expect(heap.peek()).toBeNull();
    expect(heap.pop()).toBeNull();
  });

  it("leaves future events queued at the window boundary", () => {
    const heap = new EventHeap();
    for (const tick of [0, 100, 500, 900]) heap.push(event("note-on", tick));
    const out: RuntimeEvent[] = [];
    expect(heap.drainBefore(500, out)).toBe(2);
    expect(heap.size).toBe(2);
    expect(heap.drainBefore(1000, out)).toBe(2);
    expect(out.slice(0, 2).map((item) => item.atTick)).toEqual([500, 900]);
  });

  it("stays correct against a reference sort over many random events", () => {
    const heap = new EventHeap();
    const source: RuntimeEvent[] = [];
    const types: RuntimeEventType[] = ["note-on", "note-off", "program-change"];
    for (let i = 0; i < 2000; i++) {
      const item = event(types[i % 3], (i * 7919) % 5000, { channel: (i % 16) + 1 });
      source.push(item);
      heap.push(item);
    }
    const out: RuntimeEvent[] = [];
    const count = heap.drainBefore(Number.POSITIVE_INFINITY, out);
    expect(out.slice(0, count)).toEqual([...source].sort(compareRuntimeEvents));
  });

  it("clears and returns events to the pool without retaining them", () => {
    const pool = new EventPool();
    const heap = new EventHeap();
    for (let i = 0; i < 4; i++) heap.push(event("note-on", i));
    heap.clear(pool);
    expect(heap.size).toBe(0);
    expect(pool.available).toBe(4);
    const bare = new EventHeap();
    bare.push(event("note-on", 0));
    bare.clear();
    expect(bare.size).toBe(0);
  });
});

describe("Event pool", () => {
  it("reuses objects so steady-state playback allocates nothing", () => {
    const pool = new EventPool(8);
    expect(pool.created).toBe(8);
    expect(pool.available).toBe(8);
    const taken: RuntimeEvent[] = [];
    for (let i = 0; i < 8; i++) taken.push(pool.acquire());
    expect(pool.available).toBe(0);
    pool.releaseAll(taken);
    // A second identical window constructs nothing new.
    for (let i = 0; i < 8; i++) pool.acquire();
    expect(pool.created).toBe(8);
  });

  it("grows on demand and can release a partial batch", () => {
    const pool = new EventPool();
    const first = pool.acquire();
    expect(pool.created).toBe(1);
    pool.release(first);
    const batch = [pool.acquire(), pool.acquire(), pool.acquire()];
    pool.releaseAll(batch, 2);
    expect(pool.available).toBe(2);
  });
});

describe("Sounding-note shadow", () => {
  it("knows exactly what to release on panic", () => {
    const sounding = new SoundingNotes();
    sounding.markOn("a", 1, 60);
    sounding.markOn("a", 1, 64);
    sounding.markOn("b", 2, 67);
    expect(sounding.size).toBe(3);
    expect(sounding.isSounding("a", 1, 60)).toBe(true);
    expect(sounding.takeAll("a").map((note) => note.note).sort()).toEqual([60, 64]);
    expect(sounding.size).toBe(1);
    expect(sounding.takeAll()).toEqual([{ portId: "b", channel: 2, note: 67 }]);
    expect(sounding.size).toBe(0);
  });

  it("counts overlapping retriggers so no note is left stuck", () => {
    const sounding = new SoundingNotes();
    sounding.markOn("a", 1, 60);
    sounding.markOn("a", 1, 60);
    expect(sounding.active()).toHaveLength(2);
    expect(sounding.markOff("a", 1, 60)).toBe(true);
    expect(sounding.isSounding("a", 1, 60)).toBe(true);
    expect(sounding.markOff("a", 1, 60)).toBe(true);
    expect(sounding.isSounding("a", 1, 60)).toBe(false);
    expect(sounding.markOff("a", 1, 60)).toBe(false);
  });

  it("filters by port and clears wholesale", () => {
    const sounding = new SoundingNotes();
    sounding.markOn("a", 1, 60);
    sounding.markOn("b", 1, 62);
    expect(sounding.active("b")).toEqual([{ portId: "b", channel: 1, note: 62 }]);
    sounding.clear();
    expect(sounding.active()).toEqual([]);
  });
});
