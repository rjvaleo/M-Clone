import { describe, it, expect } from "vitest";
import { Rng, BrownianWalk } from "./rng";

describe("Rng determinism", () => {
  it("produces identical sequences for the same seed", () => {
    const a = new Rng(42);
    const b = new Rng(42);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });
  it("produces different sequences for different seeds", () => {
    const a = new Rng(1);
    const b = new Rng(2);
    let differ = false;
    for (let i = 0; i < 10; i++) if (a.next() !== b.next()) differ = true;
    expect(differ).toBe(true);
  });
});

describe("Rng range", () => {
  it("next() stays in [0,1)", () => {
    const r = new Rng(7);
    for (let i = 0; i < 1000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
  it("int(n) stays in [0,n)", () => {
    const r = new Rng(9);
    for (let i = 0; i < 1000; i++) {
      const v = r.int(5);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(5);
      expect(Number.isInteger(v)).toBe(true);
    }
  });
  it("int(0) returns 0", () => {
    expect(new Rng(1).int(0)).toBe(0);
  });
});

describe("Rng chance", () => {
  it("chance(0) is always false", () => {
    const r = new Rng(3);
    for (let i = 0; i < 100; i++) expect(r.chance(0)).toBe(false);
  });
  it("chance(1) is always true", () => {
    const r = new Rng(3);
    for (let i = 0; i < 100; i++) expect(r.chance(1)).toBe(true);
  });
  it("chance(0.5) is roughly balanced", () => {
    const r = new Rng(123);
    let hits = 0;
    for (let i = 0; i < 2000; i++) if (r.chance(0.5)) hits++;
    expect(hits).toBeGreaterThan(800);
    expect(hits).toBeLessThan(1200);
  });
});

describe("Rng pick", () => {
  it("picks a member of the array", () => {
    const r = new Rng(5);
    const arr = ["a", "b", "c"];
    for (let i = 0; i < 50; i++) expect(arr).toContain(r.pick(arr));
  });
});

describe("Rng pickIndexAvoiding (no immediate repeats)", () => {
  it("never returns the avoided index when others exist", () => {
    const r = new Rng(11);
    for (let i = 0; i < 500; i++) {
      expect(r.pickIndexAvoiding(4, 2)).not.toBe(2);
    }
  });
  it("returns 0 for a single-element pool", () => {
    expect(new Rng(1).pickIndexAvoiding(1, 0)).toBe(0);
  });
  it("ignores an out-of-range avoid and still covers all indices", () => {
    const r = new Rng(2);
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) seen.add(r.pickIndexAvoiding(3, -1));
    expect(seen).toEqual(new Set([0, 1, 2]));
  });
  it("eventually covers every non-avoided index", () => {
    const r = new Rng(99);
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) seen.add(r.pickIndexAvoiding(4, 1));
    expect(seen).toEqual(new Set([0, 2, 3]));
  });
});

describe("BrownianWalk (1/f-ish smooth randomness)", () => {
  it("stays within [0,1]", () => {
    const w = new BrownianWalk(new Rng(4), 0.5, 0.2);
    for (let i = 0; i < 1000; i++) {
      const v = w.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
  it("moves in small steps (smoothness)", () => {
    const w = new BrownianWalk(new Rng(4), 0.5, 0.1);
    let prev = w.value;
    for (let i = 0; i < 500; i++) {
      const v = w.next();
      expect(Math.abs(v - prev)).toBeLessThanOrEqual(0.1 + 1e-9);
      prev = v;
    }
  });
  it("is deterministic for a given seed", () => {
    const a = new BrownianWalk(new Rng(8), 0.3, 0.15);
    const b = new BrownianWalk(new Rng(8), 0.3, 0.15);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });
  it("reflects at the upper bound", () => {
    const w = new BrownianWalk(new Rng(1), 1.0, 0.2);
    const v = w.next();
    expect(v).toBeLessThanOrEqual(1);
    expect(v).toBeGreaterThanOrEqual(0);
  });
  it("reflects at the lower bound", () => {
    const w = new BrownianWalk(new Rng(1), 0.0, 0.2);
    const v = w.next();
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThanOrEqual(1);
  });
});
