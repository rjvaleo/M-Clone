import { describe, expect, it } from "vitest";
import {
  DRUM_ROW_DEFAULTS,
  FLAM_SPAN,
  MAX_DRUM_ROWS,
  MAX_DRUM_STEPS,
  blankRow,
  clearRow,
  defaultDrumRows,
  drumPlayheadMarks,
  drumSettings,
  hitsInRange,
  readDrumRows,
  rowLength,
  rowStepAt,
  setRowField,
  setStepValue,
  shiftRow,
  stepOnset,
  stepValue,
  swingOffset,
  toggleStep,
  type DrumRow,
  type DrumSettings,
} from "./drumSeq";

/** A sixteenth at 960 PPQN. */
const T = 240;
const settings = (overrides: Partial<DrumSettings> = {}): DrumSettings => ({
  tracks: 4, length: 16, stepTicks: T, swing: 50, flamLevel: 0.5, free: false, ...overrides,
});

/** Rows with nothing in them, then the steps given switched on in row 0. */
const rowsWith = (steps: number[], extra: Partial<DrumRow> = {}): DrumRow[] => {
  const rows = readDrumRows([]).map((row) => ({ ...row, on: [] as boolean[] }));
  const on: boolean[] = [];
  for (const step of steps) on[step] = true;
  rows[0] = { ...rows[0], on, ...extra };
  return rows;
};

const ticks = (hits: { tick: number }[]) => hits.map((hit) => hit.tick);

describe("the rows a drum sequencer starts with", () => {
  it("are sixteen pads, the first four on m.percussion's own notes", () => {
    expect(DRUM_ROW_DEFAULTS).toHaveLength(MAX_DRUM_ROWS);
    expect(DRUM_ROW_DEFAULTS.slice(0, 4).map((row) => row.note)).toEqual([36, 38, 42, 46]);
    const notes = DRUM_ROW_DEFAULTS.map((row) => row.note);
    expect(new Set(notes).size).toBe(notes.length);
  });

  it("make a beat out of the box: kick on the beats, snare on two and four, hats between", () => {
    const rows = defaultDrumRows();
    const on = (r: number) => rows[r].on.flatMap((value, step) => (value ? [step] : []));
    expect(on(0)).toEqual([0, 4, 8, 12]);
    expect(on(1)).toEqual([4, 12]);
    expect(on(2)).toEqual([2, 6, 10, 14]);
    for (let r = 3; r < MAX_DRUM_ROWS; r++) expect(on(r), `row ${r}`).toEqual([]);
  });

  it("a blank row follows the pattern length and is not muted", () => {
    expect(blankRow("Kick", 36)).toEqual({
      name: "Kick", note: 36, length: 0, mute: false, on: [], vel: [], prob: [], flam: [], ratchet: [],
    });
  });
});

describe("reading rows from a document", () => {
  it("always gives sixteen rows, filling the missing ones from the defaults", () => {
    const rows = readDrumRows([{ name: "Boom", note: 35 }]);
    expect(rows).toHaveLength(MAX_DRUM_ROWS);
    expect(rows[0].name).toBe("Boom");
    expect(rows[0].note).toBe(35);
    expect(rows[1].name).toBe(DRUM_ROW_DEFAULTS[1].name);
    expect(readDrumRows("nonsense")).toHaveLength(MAX_DRUM_ROWS);
  });

  it("holds every field inside its range, whatever the document says", () => {
    const [row] = readDrumRows([{
      name: 7, note: 300.6, length: 999, mute: "yes",
      on: [true, 1, null], vel: [500, -3, "x", 64.4], prob: [2, -1, 0.25], flam: [3, -1], ratchet: [0, 12, 2.6],
    }]);
    expect(row.name).toBe(DRUM_ROW_DEFAULTS[0].name);
    expect(row.note).toBe(127);
    expect(row.length).toBe(MAX_DRUM_STEPS);
    expect(row.mute).toBe(false);
    expect(row.on).toEqual([true, false, false]);
    expect(row.vel).toEqual([127, 1, 100, 64]);
    expect(row.prob).toEqual([1, 0, 0.25]);
    expect(row.flam).toEqual([1, 0]);
    expect(row.ratchet).toEqual([1, 8, 3]);
    const [low] = readDrumRows([{ note: -4, length: -2, mute: true, on: "no" }]);
    expect([low.note, low.length, low.mute, low.on]).toEqual([0, 0, true, []]);
  });

  it("reads a step's value with the lane's default where the lane is short", () => {
    const row = blankRow("Kick", 36);
    expect([stepValue(row, "vel", 3), stepValue(row, "prob", 3), stepValue(row, "flam", 3), stepValue(row, "ratchet", 3)])
      .toEqual([100, 1, 0, 1]);
    expect(stepValue({ ...row, vel: [0, 70] }, "vel", 1)).toBe(70);
  });
});

describe("settings from parameters", () => {
  it("turns the module's parameters into whole, bounded numbers", () => {
    const values: Record<string, unknown> = { tracks: 40, length: 0, "rate-num": 1, "rate-den": 16, swing: 90, "flam-level": 3, free: true };
    const read = drumSettings((id, fallback) => (typeof values[id] === "number" ? values[id] as number : fallback), (id) => values[id] === true);
    expect(read).toEqual({ tracks: MAX_DRUM_ROWS, length: 1, stepTicks: 240, swing: 75, flamLevel: 1, free: true });
    const defaults = drumSettings((_id, fallback) => fallback, () => false);
    expect(defaults).toEqual({ tracks: 10, length: 16, stepTicks: 240, swing: 50, flamLevel: 0.6, free: false });
    const odd = drumSettings((id, fallback) => (id === "rate-den" ? 0 : id === "tracks" ? -2 : id === "swing" ? 10 : fallback), () => false);
    expect([odd.stepTicks, odd.tracks, odd.swing]).toEqual([0, 1, 50]);
  });
});

describe("polymeter: each row's own length", () => {
  it("a row of length zero follows the pattern", () => {
    expect(rowLength(blankRow("a", 1), 12)).toBe(12);
    expect(rowLength({ ...blankRow("a", 1), length: 5 }, 12)).toBe(5);
  });

  it("a short row loops inside the pattern and starts again with it", () => {
    const row = { ...blankRow("a", 1), length: 3 };
    const steps = Array.from({ length: 10 }, (_, n) => rowStepAt(row, settings({ length: 8 }), n));
    expect(steps).toEqual([0, 1, 2, 0, 1, 2, 0, 1, 0, 1]);
  });

  it("with rows running free, the pattern length never pulls a row back", () => {
    const row = { ...blankRow("a", 1), length: 3 };
    const steps = Array.from({ length: 10 }, (_, n) => rowStepAt(row, settings({ length: 8, free: true }), n));
    expect(steps).toEqual([0, 1, 2, 0, 1, 2, 0, 1, 2, 0]);
  });

  it("three against four plays each row on its own cycle", () => {
    const rows = rowsWith([0], { length: 3 });
    rows[1] = { ...rows[1], on: [true], length: 4 };
    const hits = hitsInRange(rows, settings({ length: 12 }), 1, 0, 12 * T);
    expect(hits.filter((h) => h.row === 0).map((h) => h.tick / T)).toEqual([0, 3, 6, 9]);
    expect(hits.filter((h) => h.row === 1).map((h) => h.tick / T)).toEqual([0, 4, 8]);
  });
});

describe("timing", () => {
  it("puts straight steps on the grid", () => {
    expect([0, 1, 2, 3].map((n) => stepOnset(n, settings()))).toEqual([0, 240, 480, 720]);
  });

  it("swing delays every second step: 50 % straight, 75 % by half a step", () => {
    expect(swingOffset(settings({ swing: 50 }))).toBe(0);
    expect(swingOffset(settings({ swing: 75 }))).toBe(120);
    expect(swingOffset(settings({ swing: 66 }))).toBe(Math.round(0.32 * 240));
    const swung = settings({ swing: 75 });
    expect([0, 1, 2, 3].map((n) => stepOnset(n, swung))).toEqual([0, 360, 480, 840]);
  });

  it("plays a step's hit at its swung onset, with the note number and velocity of its row", () => {
    const rows = rowsWith([0, 1, 2, 3], { vel: [100, 90, 80, 70] });
    const hits = hitsInRange(rows, settings({ swing: 75 }), 1, 0, 4 * T);
    expect(hits.map((h) => [h.tick, h.note, h.velocity, h.step, h.row])).toEqual([
      [0, 36, 100, 0, 0], [360, 36, 90, 1, 0], [480, 36, 80, 2, 0], [840, 36, 70, 3, 0],
    ]);
    // A hit lasts until the next step begins.
    expect(hits.map((h) => h.duration)).toEqual([360, 120, 360, 120]);
  });

  it("loops at the pattern length", () => {
    const hits = hitsInRange(rowsWith([0, 3]), settings({ length: 4 }), 1, 0, 12 * T);
    expect(ticks(hits).map((t) => t / T)).toEqual([0, 3, 4, 7, 8, 11]);
  });

  it("plays nothing when the rate makes no steps", () => {
    expect(hitsInRange(rowsWith([0]), settings({ stepTicks: 0 }), 1, 0, 960)).toEqual([]);
  });

  it("only plays rows inside the track count, and never a muted row", () => {
    const rows = readDrumRows([]).map((row) => ({ ...row, on: [true] }));
    rows[1] = { ...rows[1], mute: true };
    const hits = hitsInRange(rows, settings({ tracks: 3 }), 1, 0, T);
    expect(hits.map((h) => h.row)).toEqual([0, 2]);
  });

  it("orders hits by time, then by row", () => {
    const rows = readDrumRows([]).map((row) => ({ ...row, on: [] as boolean[] }));
    rows[2] = { ...rows[2], on: [true, true] };
    rows[0] = { ...rows[0], on: [false, true] };
    const hits = hitsInRange(rows, settings(), 1, 0, 2 * T);
    expect(hits.map((h) => [h.tick, h.row])).toEqual([[0, 2], [240, 0], [240, 2]]);
  });
});

describe("flam and ratchet", () => {
  it("a flam puts a softer grace note before the hit, up to half a step early", () => {
    const rows = rowsWith([4], { flam: [0, 0, 0, 0, 1], vel: [0, 0, 0, 0, 100] });
    const hits = hitsInRange(rows, settings({ flamLevel: 0.5 }), 1, 0, 8 * T);
    const lead = Math.round(FLAM_SPAN * T);
    expect(hits.map((h) => [h.tick, h.velocity, h.grace, h.duration])).toEqual([
      [4 * T - lead, 50, true, lead],
      [4 * T, 100, false, T],
    ]);
  });

  it("a quarter flam is an eighth of a step early, and the grace note is never silent", () => {
    const rows = rowsWith([2], { flam: [0, 0, 0.25], vel: [0, 0, 1] });
    const hits = hitsInRange(rows, settings({ flamLevel: 0 }), 1, 0, 4 * T);
    expect(hits.map((h) => [h.tick, h.velocity, h.grace])).toEqual([[2 * T - 30, 1, true], [2 * T, 1, false]]);
  });

  it("a grace note that would fall before the start is left out", () => {
    const hits = hitsInRange(rowsWith([0], { flam: [1] }), settings(), 1, 0, T);
    expect(hits.map((h) => h.grace)).toEqual([false]);
  });

  it("a grace note falls in the window that holds it, even when its hit is in the next", () => {
    const rows = rowsWith([4], { flam: [0, 0, 0, 0, 1] });
    expect(hitsInRange(rows, settings(), 1, 0, 4 * T).map((h) => [h.tick, h.grace])).toEqual([[4 * T - 120, true]]);
    expect(hitsInRange(rows, settings(), 1, 4 * T, 8 * T).map((h) => [h.tick, h.grace])).toEqual([[4 * T, false]]);
  });

  it("a ratchet splits the step into equal repeats at the same velocity", () => {
    const rows = rowsWith([1], { ratchet: [1, 3], vel: [0, 77] });
    const hits = hitsInRange(rows, settings(), 1, 0, 4 * T);
    expect(hits.map((h) => [h.tick, h.velocity, h.duration])).toEqual([[240, 77, 80], [320, 77, 80], [400, 77, 80]]);
  });

  it("a ratchet on a swung step divides the swung step, not the grid step", () => {
    const rows = rowsWith([1], { ratchet: [1, 2] });
    const hits = hitsInRange(rows, settings({ swing: 75 }), 1, 0, 4 * T);
    expect(ticks(hits)).toEqual([360, 420]);
  });

  it("a grace note landing on the same tick as a repeat of the step before goes first", () => {
    const rows = rowsWith([0, 1], { ratchet: [2], flam: [0, 1], vel: [100, 100] });
    const hits = hitsInRange(rows, settings({ flamLevel: 0.5 }), 1, 0, 2 * T);
    expect(hits.map((h) => [h.tick, h.grace])).toEqual([[0, false], [120, true], [120, false], [240, false]]);
  });

  it("flam and ratchet together: one grace note, before the first repeat", () => {
    const rows = rowsWith([2], { ratchet: [1, 1, 2], flam: [0, 0, 0.5] });
    const hits = hitsInRange(rows, settings(), 1, 0, 4 * T);
    expect(hits.map((h) => [h.tick, h.grace])).toEqual([[420, true], [480, false], [600, false]]);
  });
});

describe("probability", () => {
  const busy = (prob: number) => rowsWith(Array.from({ length: 16 }, (_, i) => i), { prob: Array(16).fill(prob) });

  it("is the same every time for the same key, and different for another key", () => {
    const run = (key: number) => ticks(hitsInRange(busy(0.5), settings(), key, 0, 64 * T));
    expect(run(7)).toEqual(run(7));
    expect(run(7)).not.toEqual(run(8));
  });

  it("does not depend on how the timeline is cut into windows", () => {
    const whole = ticks(hitsInRange(busy(0.5), settings(), 3, 0, 64 * T));
    const pieces: number[] = [];
    for (let from = 0; from < 64 * T; from += 101) pieces.push(...ticks(hitsInRange(busy(0.5), settings(), 3, from, Math.min(64 * T, from + 101))));
    expect(pieces).toEqual(whole);
  });

  it("plays about as often as it says, and draws afresh each time round the loop", () => {
    const hits = hitsInRange(busy(0.5), settings(), 5, 0, 1024 * T);
    expect(hits.length).toBeGreaterThan(400);
    expect(hits.length).toBeLessThan(624);
    const bar = (b: number) => hits.filter((h) => h.tick >= b * 16 * T && h.tick < (b + 1) * 16 * T).map((h) => h.step);
    expect(bar(0)).not.toEqual(bar(1));
  });

  it("never at zero, always at one", () => {
    expect(hitsInRange(busy(0), settings(), 5, 0, 64 * T)).toHaveLength(0);
    expect(hitsInRange(busy(1), settings(), 5, 0, 64 * T)).toHaveLength(64);
  });

  it("decides a whole step at once: its grace note and every repeat go together", () => {
    const rows = rowsWith(Array.from({ length: 16 }, (_, i) => i), {
      prob: Array(16).fill(0.5), ratchet: Array(16).fill(2), flam: Array(16).fill(0.5),
    });
    const hits = hitsInRange(rows, settings(), 9, 0, 64 * T);
    // A half flam is 60 ticks early and the repeat 120 late, so every event of
    // step n lies in [n·T − 60, n·T + 180).
    const perStep = new Map<number, number>();
    for (const hit of hits) {
      const n = Math.floor((hit.tick + 60) / T);
      perStep.set(n, (perStep.get(n) ?? 0) + 1);
    }
    expect(perStep.size).toBeGreaterThan(20);
    expect(perStep.size).toBeLessThan(44);
    // Step 0's grace note would fall before the start, so it has only its repeats.
    for (const [n, count] of perStep) expect(count, `step ${n}`).toBe(n === 0 ? 2 : 3);
  });
});

describe("the playhead", () => {
  it("marks the pattern position on the step labels and each row's own step", () => {
    expect(drumPlayheadMarks(5, [5, 1, -1])).toEqual([
      { lane: "step", step: 5, classes: ["is-playing"] },
      { lane: "row-0", step: 5, classes: ["is-playing"] },
      { lane: "row-1", step: 1, classes: ["is-playing"] },
    ]);
    expect(drumPlayheadMarks(-1, [])).toEqual([]);
  });
});

describe("edits", () => {
  it("toggles a step, growing the lane as far as it needs", () => {
    const rows = toggleStep(defaultDrumRows(), 3, 5);
    expect(rows[3].on).toEqual([false, false, false, false, false, true]);
    expect(toggleStep(rows, 3, 5)[3].on[5]).toBe(false);
  });

  it("sets a step's velocity, chance, flam or ratchet inside its range, and switches it on with velocity", () => {
    let rows = setStepValue(defaultDrumRows(), 4, "vel", 2, 300);
    expect(rows[4].vel).toEqual([100, 100, 127]);
    expect(rows[4].on[2]).toBe(true);
    rows = setStepValue(rows, 4, "prob", 1, -2);
    expect(rows[4].prob).toEqual([1, 0]);
    rows = setStepValue(rows, 4, "ratchet", 0, 5.4);
    expect(rows[4].ratchet).toEqual([5]);
    rows = setStepValue(rows, 4, "flam", 0, 0.3);
    expect(rows[4].flam).toEqual([0.3]);
    expect(rows[4].on).toEqual([false, false, true]);
  });

  it("renames, renotes, resizes and mutes a row", () => {
    const rows = setRowField(defaultDrumRows(), 1, { name: "Snap", note: 40, length: 6, mute: true });
    expect([rows[1].name, rows[1].note, rows[1].length, rows[1].mute]).toEqual(["Snap", 40, 6, true]);
    expect(setRowField(rows, 1, { note: 200, length: 100 })[1]).toMatchObject({ note: 127, length: MAX_DRUM_STEPS });
  });

  it("shifts a row's steps round within its length, every lane together", () => {
    let rows = readDrumRows([{ on: [true, false, false, true], vel: [10, 20, 30, 40] }]);
    rows = shiftRow(rows, 0, 4, 1);
    expect(rows[0].on).toEqual([true, true, false, false]);
    expect(rows[0].vel).toEqual([40, 10, 20, 30]);
    rows = shiftRow(rows, 0, 4, -1);
    expect(rows[0].on).toEqual([true, false, false, true]);
  });

  it("leaves a row of one step as it is", () => {
    const rows = readDrumRows([{ on: [true] }]);
    expect(shiftRow(rows, 0, 1, 1)[0]).toBe(rows[0]);
  });

  it("clears a row's steps but keeps its name, note and length", () => {
    const rows = clearRow(setRowField(defaultDrumRows(), 0, { length: 7 }), 0);
    expect(rows[0]).toMatchObject({ name: "Kick", note: 36, length: 7, on: [], vel: [] });
  });

  it("leaves the other rows alone", () => {
    const before = defaultDrumRows();
    const after = toggleStep(before, 0, 1);
    expect(after[1]).toBe(before[1]);
  });
});
