import { describe, it, expect } from "vitest";
import {
  stepDurationSeconds,
  nextStepIndex,
  transposePitches,
  gate,
} from "./transform";
import { Rng } from "./rng";
import type { NoteOrderCursor } from "./types";

describe("stepDurationSeconds", () => {
  it("computes a quarter note at 120 BPM", () => {
    expect(stepDurationSeconds(120, 1, 4)).toBeCloseTo(0.5, 9);
  });
  it("computes an eighth note at 120 BPM", () => {
    expect(stepDurationSeconds(120, 1, 8)).toBeCloseTo(0.25, 9);
  });
  it("numerator multiplies duration (slower)", () => {
    expect(stepDurationSeconds(120, 2, 4)).toBeCloseTo(1.0, 9);
  });
  it("scales inversely with tempo", () => {
    expect(stepDurationSeconds(60, 1, 4)).toBeCloseTo(1.0, 9);
  });
});

describe("transposePitches", () => {
  it("adds semitones to each pitch", () => {
    expect(transposePitches([60, 64, 67], 12)).toEqual([72, 76, 79]);
  });
  it("handles negative transposition", () => {
    expect(transposePitches([60], -5)).toEqual([55]);
  });
  it("returns an empty array for a rest", () => {
    expect(transposePitches([], 7)).toEqual([]);
  });
});

describe("gate (density)", () => {
  it("always sounds at density 1", () => {
    const r = new Rng(1);
    for (let i = 0; i < 50; i++) expect(gate(1, r)).toBe(true);
  });
  it("never sounds at density 0", () => {
    const r = new Rng(1);
    for (let i = 0; i < 50; i++) expect(gate(0, r)).toBe(false);
  });
});

function run(order: any, length: number, count: number, seed = 5): number[] {
  const rng = new Rng(seed);
  let cursor: NoteOrderCursor = { pos: 0, last: -1 };
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const res = nextStepIndex(order, cursor, length, rng);
    out.push(res.index);
    cursor = res.cursor;
  }
  return out;
}

describe("nextStepIndex", () => {
  it("plays original order and wraps", () => {
    expect(run("original", 4, 6)).toEqual([0, 1, 2, 3, 0, 1]);
  });
  it("plays reverse order and wraps", () => {
    expect(run("reverse", 4, 6)).toEqual([3, 2, 1, 0, 3, 2]);
  });
  it("random stays in range with no immediate repeats", () => {
    const seq = run("random", 5, 200);
    for (let i = 0; i < seq.length; i++) {
      expect(seq[i]).toBeGreaterThanOrEqual(0);
      expect(seq[i]).toBeLessThan(5);
      if (i > 0) expect(seq[i]).not.toBe(seq[i - 1]);
    }
  });
  it("random-walk moves by one step (mod length)", () => {
    const seq = run("random-walk", 6, 200);
    for (let i = 1; i < seq.length; i++) {
      const diff = Math.abs(seq[i] - seq[i - 1]);
      const wrapped = diff === 5; // 0<->5 on a length-6 ring
      expect(diff === 1 || wrapped).toBe(true);
    }
  });
  it("handles a single-step pattern", () => {
    expect(run("random", 1, 5)).toEqual([0, 0, 0, 0, 0]);
  });
});
