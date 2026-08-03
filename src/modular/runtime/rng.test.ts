import { describe, expect, it } from "vitest";
import {
  DeterministicWalk,
  DrawCursor,
  hashName,
  randomBits,
  randomUnit,
  streamKey,
} from "./rng";

const drawsAt = (key: number, tick: number, count: number): number[] => {
  const cursor = new DrawCursor(key, tick);
  return Array.from({ length: count }, () => cursor.next());
};

describe("Counter-based randomness", () => {
  it("is a pure function of position, not of call history", () => {
    const key = streamKey(7, "density-1", "gate");
    expect(drawsAt(key, 4000, 3)).toEqual(drawsAt(key, 4000, 3));
    // Reaching the same tick after unrelated work elsewhere changes nothing.
    drawsAt(key, 10, 50);
    expect(drawsAt(key, 4000, 3)).toEqual(drawsAt(key, 4000, 3));
  });

  it("produces identical traces however ticks are split into windows", () => {
    const key = streamKey(99, "order-1", "step");
    const ticks = Array.from({ length: 240 }, (_, i) => i * 240);
    const wholeSpan = ticks.map((tick) => new DrawCursor(key, tick).next());
    // Simulate three different lookahead settings chopping the same span.
    for (const windowSize of [1, 7, 61]) {
      const batched: number[] = [];
      for (let start = 0; start < ticks.length; start += windowSize) {
        for (const tick of ticks.slice(start, start + windowSize)) {
          batched.push(new DrawCursor(key, tick).next());
        }
      }
      expect(batched).toEqual(wholeSpan);
    }
  });

  it("decorrelates nodes, streams, and seeds", () => {
    const a = streamKey(1, "node-a", "gate");
    const b = streamKey(1, "node-b", "gate");
    const c = streamKey(1, "node-a", "velocity");
    const d = streamKey(2, "node-a", "gate");
    const keys = new Set([a, b, c, d]);
    expect(keys.size).toBe(4);
    expect(drawsAt(a, 0, 4)).not.toEqual(drawsAt(b, 0, 4));
    expect(drawsAt(a, 0, 4)).not.toEqual(drawsAt(c, 0, 4));
    expect(drawsAt(a, 0, 4)).not.toEqual(drawsAt(d, 0, 4));
  });

  it("stays uniform enough to be musically usable", () => {
    const key = streamKey(3, "density-1", "gate");
    const buckets = new Array(10).fill(0);
    for (let tick = 0; tick < 20_000; tick++) {
      buckets[Math.floor(randomUnit(key, tick, 0) * 10)] += 1;
    }
    for (const count of buckets) {
      expect(count).toBeGreaterThan(1700);
      expect(count).toBeLessThan(2300);
    }
  });

  it("keeps distinct draws past the 32-bit tick boundary", () => {
    const key = streamKey(5, "node", "stream");
    const beyond = 4294967296 + 17;
    expect(randomBits(key, beyond, 0)).not.toBe(randomBits(key, 17, 0));
    expect(randomBits(key, beyond, 0)).toBe(randomBits(key, beyond, 0));
    // A fractional or negative position is floored to a schedulable tick.
    expect(randomBits(key, 17.9, 0)).toBe(randomBits(key, 17, 0));
    expect(randomBits(key, -4, 0)).toBe(randomBits(key, 0, 0));
  });

  it("hashes names stably and independently of length collisions", () => {
    expect(hashName("note-order")).toBe(hashName("note-order"));
    expect(hashName("note-order")).not.toBe(hashName("note-ordes"));
    expect(hashName("")).toBe(hashName(""));
  });

  it("offers the musical helpers with correct bounds", () => {
    const cursor = new DrawCursor(streamKey(11, "n", "s"), 0);
    for (let i = 0; i < 200; i++) {
      const value = cursor.int(5);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(5);
    }
    expect(cursor.int(1)).toBe(0);
    expect(cursor.chance(0)).toBe(false);
    expect(cursor.chance(1)).toBe(true);
    expect(["a", "b", "c"]).toContain(cursor.pick(["a", "b", "c"]));
    expect(cursor.drawCount).toBeGreaterThan(0);
    cursor.rewind();
    expect(cursor.drawCount).toBe(0);
  });

  it("never repeats the avoided index unless it has no alternative", () => {
    const cursor = new DrawCursor(streamKey(13, "n", "s"), 0);
    for (let i = 0; i < 300; i++) expect(cursor.pickAvoiding(4, 2)).not.toBe(2);
    expect(cursor.pickAvoiding(1, 0)).toBe(0);
    // An out-of-range "previous" index simply means no constraint.
    const free = cursor.pickAvoiding(3, 9);
    expect(free).toBeGreaterThanOrEqual(0);
    expect(free).toBeLessThan(3);
  });

  it("replays a walk from any earlier step", () => {
    const walk = new DeterministicWalk(streamKey(17, "order", "brown"));
    const forward = Array.from({ length: 40 }, (_, i) => walk.advanceTo(i + 1));
    expect(walk.stepIndex).toBe(40);
    walk.advanceTo(0);
    expect(walk.value).toBe(0.5);
    const replayed = Array.from({ length: 40 }, (_, i) => walk.advanceTo(i + 1));
    expect(replayed).toEqual(forward);
    // Jumping straight to the end matches walking there step by step.
    const jumped = new DeterministicWalk(streamKey(17, "order", "brown"));
    expect(jumped.advanceTo(40)).toBe(forward[39]);
  });

  it("keeps the walk inside the unit range for extreme settings", () => {
    const walk = new DeterministicWalk(streamKey(19, "n", "s"), 0.5, 40);
    for (let i = 1; i <= 500; i++) {
      const value = walk.advanceTo(i);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
    expect(new DeterministicWalk(0, Number.NaN).value).toBe(0.5);
    expect(new DeterministicWalk(0, 5).value).toBe(1);
    expect(new DeterministicWalk(0, 0.5, -3).advanceTo(3)).toBe(0.5);
  });
});
