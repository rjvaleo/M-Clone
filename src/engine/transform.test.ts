import { describe, it, expect } from "vitest";
import {
  stepDurationSeconds,
  nextStepIndex,
  nextMixedStepIndex,
  makeCyclicOrder,
  noteOrderMixFromEdges,
  setNoteOrderEdge,
  setNoteOrderBoundary,
  noteOrderHandleLayout,
  normalizeVelocityRange,
  velocityForAccent,
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

describe("M-style Velocity Range", () => {
  it("normalizes MIDI endpoints and preserves their order", () => {
    expect(normalizeVelocityRange({ low: 140, high: -4 }))
      .toEqual({ low: 0, high: 127 });
  });

  it("makes Accent level 0 silent and maps levels 1–4 across the range", () => {
    const range = { low: 48, high: 110 };
    expect([0, 1, 2, 3, 4].map((level) => velocityForAccent(range, level)))
      .toEqual([0, 48, 69, 89, 110]);
  });
});

function run(order: any, length: number, count: number, seed = 5): number[] {
  const rng = new Rng(seed);
  let cursor: NoteOrderCursor = { pos: 0, last: -1, bval: 0.5 };
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
  it("brownian stays in range and never exceeds length-1", () => {
    const seq = run("brownian", 8, 500);
    for (const i of seq) {
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(8);
      expect(Number.isInteger(i)).toBe(true);
    }
  });
  it("brownian moves smoothly (mostly small index changes)", () => {
    const seq = run("brownian", 16, 400);
    let bigJumps = 0;
    for (let i = 1; i < seq.length; i++) {
      if (Math.abs(seq[i] - seq[i - 1]) > 4) bigJumps++;
    }
    // a smooth wander should rarely leap more than a quarter of the pattern
    expect(bigJumps).toBeLessThan(seq.length * 0.1);
  });
  it("brownian is deterministic for a seed", () => {
    expect(run("brownian", 10, 50, 7)).toEqual(run("brownian", 10, 50, 7));
  });
});

describe("M-style mixed note order", () => {
  it("uses the recorded sequence at 100% Original Order", () => {
    const rng = new Rng(1);
    const cursor = { pos: 5, last: 0, bval: 0.5 };
    const result = nextMixedStepIndex(
      { original: 100, cyclic: 0, utterly: 0 }, cursor, 4, rng,
    );
    expect(result.index).toBe(1);
    expect(result.source).toBe("original");
  });

  it("uses the stored repeating permutation at 100% Cyclic Random", () => {
    const rng = new Rng(1);
    const cursor = { pos: 5, last: 0, bval: 0.5 };
    const result = nextMixedStepIndex(
      { original: 0, cyclic: 100, utterly: 0 }, cursor, 4, rng,
    );
    expect(result.index).toBe(1);
    expect(result.source).toBe("cyclic");
  });

  it("picks anew without an immediate repeat at 100% Utterly Random", () => {
    const rng = new Rng(1);
    const cursor = { pos: 0, last: 2, bval: 0.5 };
    const result = nextMixedStepIndex(
      { original: 0, cyclic: 0, utterly: 100 },
      cursor,
      4,
      rng,
    );
    expect(result.index).not.toBe(2);
    expect(result.source).toBe("utterly");
    expect(result.cursor.pos).toBe(1);
  });

  it("creates a deterministic cyclic permutation containing every index", () => {
    const a = makeCyclicOrder(8, 42);
    expect(a).toEqual(makeCyclicOrder(8, 42));
    expect([...a].sort((x, y) => x - y)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(makeCyclicOrder(1, 42)).toEqual([0]);
  });

  it("derives Cyclic Random as the remainder between the two edge sliders", () => {
    expect(noteOrderMixFromEdges(100, 0)).toEqual({
      original: 100, cyclic: 0, utterly: 0,
    });
    expect(noteOrderMixFromEdges(0, 100)).toEqual({
      original: 0, cyclic: 0, utterly: 100,
    });
    expect(noteOrderMixFromEdges(0, 0)).toEqual({
      original: 0, cyclic: 100, utterly: 0,
    });
    expect(noteOrderMixFromEdges(40, 30)).toEqual({
      original: 40, cyclic: 30, utterly: 30,
    });
  });

  it("clamps edge sliders so the three percentages always total 100", () => {
    expect(noteOrderMixFromEdges(80, 80)).toEqual({
      original: 80, cyclic: 0, utterly: 20,
    });
    expect(noteOrderMixFromEdges(-5, -2)).toEqual({
      original: 0, cyclic: 100, utterly: 0,
    });
  });

  it("lets either edge slider push the opposite edge when they meet", () => {
    const original = { original: 100, cyclic: 0, utterly: 0 };
    expect(setNoteOrderEdge(original, "utterly", 100)).toEqual({
      original: 0, cyclic: 0, utterly: 100,
    });
    const utterly = { original: 0, cyclic: 0, utterly: 100 };
    expect(setNoteOrderEdge(utterly, "original", 75)).toEqual({
      original: 75, cyclic: 0, utterly: 25,
    });
  });

  it("leaves Cyclic Random in the space between the two edge sliders", () => {
    const mix = { original: 50, cyclic: 25, utterly: 25 };
    expect(setNoteOrderEdge(mix, "original", 40)).toEqual({
      original: 40, cyclic: 35, utterly: 25,
    });
    expect(setNoteOrderEdge(mix, "utterly", 10)).toEqual({
      original: 50, cyclic: 40, utterly: 10,
    });
  });

  it("maps the two visual bar boundaries to the three percentages", () => {
    const start = { original: 100, cyclic: 0, utterly: 0 };
    expect(setNoteOrderBoundary(start, "utterlyStart", 60)).toEqual({
      original: 60, cyclic: 0, utterly: 40,
    });
    expect(setNoteOrderBoundary(
      { original: 20, cyclic: 40, utterly: 40 },
      "originalEnd",
      35,
    )).toEqual({
      original: 35, cyclic: 25, utterly: 40,
    });
  });

  it("reports continuous boundary positions without layout modes", () => {
    expect(noteOrderHandleLayout({ original: 100, cyclic: 0, utterly: 0 }))
      .toEqual({ originalEnd: 100, utterlyStart: 100 });
    expect(noteOrderHandleLayout({ original: 0, cyclic: 0, utterly: 100 }))
      .toEqual({ originalEnd: 0, utterlyStart: 0 });
    expect(noteOrderHandleLayout({ original: 45, cyclic: 5, utterly: 50 }))
      .toEqual({ originalEnd: 45, utterlyStart: 50 });
    expect(noteOrderHandleLayout({ original: 30, cyclic: 30, utterly: 40 }))
      .toEqual({ originalEnd: 30, utterlyStart: 60 });
    expect(noteOrderHandleLayout({ original: 45, cyclic: 6, utterly: 49 }))
      .toEqual({ originalEnd: 45, utterlyStart: 51 });
  });
});
