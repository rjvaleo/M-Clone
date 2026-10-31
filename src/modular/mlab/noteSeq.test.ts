import { describe, expect, it } from "vitest";
import { Rng } from "../../engine/rng";
import { createDefaultProject } from "../../engine/project";
import {
  MAX_SEQ_STEPS,
  activeSteps,
  defaultCells,
  defaultCellLengths,
  defaultNoteSeqPatterns,
  directionIndex,
  invertPitches,
  shiftSteps,
  setStepValue,
  type SeqDirection,
} from "./noteSeq";

describe("M NoteSeq defaults are M's", () => {
  it("opens on M's riff in group a and empty groups b–f", () => {
    const groups = defaultNoteSeqPatterns();
    expect(groups).toHaveLength(6);
    expect(groups[0].length).toBe(8);
    expect(groups[0].steps.slice(0, 8).map((s) => s[0])).toEqual([60, 62, 64, 65, 67, 69, 71, 72]);
    expect(groups[1].steps.every((s) => s.length === 0)).toBe(true);
  });

  it("has M's neutral cycles at every position, sixteen cells long", () => {
    const project = createDefaultProject();
    const cells = defaultCells();
    expect(cells.accent).toHaveLength(6);
    expect(cells.legato[3]).toEqual(project.cyclic.legato[0]);
    expect(defaultCellLengths().rhythm).toEqual([16, 16, 16, 16, 16, 16]);
  });

  it("takes patterns of up to 999 steps, M's own limit", () => {
    expect(MAX_SEQ_STEPS).toBe(999);
  });
});

describe("the active steps: start and end markers, and skips", () => {
  it("runs start to end", () => {
    expect(activeSteps(8, 0, [])).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(activeSteps(8, 2, [])).toEqual([2, 3, 4, 5, 6, 7]);
  });

  it("drops skipped steps, as the Moog 960 did", () => {
    expect(activeSteps(4, 0, [false, true, false, false])).toEqual([0, 2, 3]);
  });

  it("wraps when the start comes after the end", () => {
    expect(activeSteps(4, 6, [], 8)).toEqual([6, 7, 0, 1, 2, 3]);
  });

  it("is empty when every step is skipped", () => {
    expect(activeSteps(2, 0, [true, true])).toEqual([]);
  });
});

describe("Dir: Fwd, Rev, Alt1, Alt2 and the random ones", () => {
  const run = (dir: SeqDirection, length: number, count: number) => {
    let cursor = { pos: 0, last: -1, bval: 0.5 };
    const out: number[] = [];
    const rng = new Rng(4);
    for (let i = 0; i < count; i++) {
      const next = directionIndex(dir, cursor, length, rng);
      out.push(next.index);
      cursor = next.cursor;
    }
    return out;
  };

  it("Fwd and Rev", () => {
    expect(run("fwd", 4, 6)).toEqual([0, 1, 2, 3, 0, 1]);
    expect(run("rev", 4, 6)).toEqual([3, 2, 1, 0, 3, 2]);
  });

  it("Alt1 turns round without repeating the ends", () => {
    expect(run("alt1", 4, 9)).toEqual([0, 1, 2, 3, 2, 1, 0, 1, 2]);
  });

  it("Alt2 repeats the ends", () => {
    expect(run("alt2", 3, 8)).toEqual([0, 1, 2, 2, 1, 0, 0, 1]);
  });

  it("Rnd, Brownian and Walk stay inside the sequence", () => {
    for (const dir of ["rnd", "brownian", "walk"] as const) {
      expect(run(dir, 5, 40).every((i) => i >= 0 && i < 5)).toBe(true);
    }
  });

  it("a one-step sequence always plays its step", () => {
    expect(run("alt1", 1, 3)).toEqual([0, 0, 0]);
  });
});

describe("pattern edits", () => {
  it("<< and >> shift every step one place, rolling over", () => {
    expect(shiftSteps([1, 2, 3, 4], 4, -1)).toEqual([2, 3, 4, 1]);
    expect(shiftSteps([1, 2, 3, 4, 9], 4, 1)).toEqual([4, 1, 2, 3, 9]);
  });

  it("1/x inverts the pitches around the middle of their span", () => {
    expect(invertPitches([[60], [64], [], [67, 72]], 4)).toEqual([[72], [68], [], [60, 65]]);
  });

  it("sets one step's value, growing the lane if it is short", () => {
    expect(setStepValue([0.5], 3, 0.2, 0)).toEqual([0.5, 0, 0, 0.2]);
  });
});

describe("edges of the steps in play and the pattern edits", () => {
  it("an empty pattern plays nothing", () => {
    expect(activeSteps(0, 0, [])).toEqual([]);
  });

  it("<< and >> leave a single step, or none, as it is", () => {
    expect(shiftSteps([7, 8, 9], 1, -1)).toEqual([7, 8, 9]);
    expect(shiftSteps([], 4, 1)).toEqual([]);
  });

  it("1/x leaves rests alone, and steps past the end untouched", () => {
    expect(invertPitches([[], []], 2)).toEqual([[], []]);
    expect(invertPitches([[60], [64], [90]], 2)).toEqual([[64], [60], [90]]);
  });
});
