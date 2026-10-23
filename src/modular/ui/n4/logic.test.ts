import { describe, expect, it } from "vitest";
import { Rng } from "../../../engine/rng";
import {
  ACTION_SHARES,
  applyRowAction,
  cellRangeDrag,
  formatLaneValue,
  laneValueFromY,
  moveSelected,
  polyNoteName,
  stepFromX,
  splitFromDrag,
} from "./logic";

describe("Numerology row actions: Skip/Select/Mute One, a Few, Some, Most, All", () => {
  const off = Array.from({ length: 16 }, () => false);

  it("turns on one, a few, some, most or all of the steps in range", () => {
    for (const [action, share] of Object.entries(ACTION_SHARES)) {
      const out = applyRowAction(off, action as keyof typeof ACTION_SHARES, true, { from: 0, to: 15 }, new Rng(3));
      const expected = action === "one" ? 1 : Math.max(1, Math.round(16 * share));
      expect(out.filter(Boolean)).toHaveLength(expected);
    }
  });

  it("only touches steps between the start and end markers", () => {
    const out = applyRowAction(off, "all", true, { from: 4, to: 7 }, new Rng(1));
    expect(out.map((on, i) => (on ? i : -1)).filter((i) => i >= 0)).toEqual([4, 5, 6, 7]);
  });

  it("Un- actions turn steps off, leaving the rest alone", () => {
    const on = Array.from({ length: 8 }, () => true);
    const out = applyRowAction(on, "most", false, { from: 0, to: 7 }, new Rng(9));
    expect(out.filter((v) => !v)).toHaveLength(6);
  });

  it("picks the same steps for the same seed", () => {
    const a = applyRowAction(off, "some", true, { from: 0, to: 15 }, new Rng(5));
    const b = applyRowAction(off, "some", true, { from: 0, to: 15 }, new Rng(5));
    expect(a).toEqual(b);
  });

  it("wraps a range whose start comes after its end", () => {
    const out = applyRowAction(off, "all", true, { from: 14, to: 1 }, new Rng(1));
    expect(out.map((on, i) => (on ? i : -1)).filter((i) => i >= 0)).toEqual([0, 1, 14, 15]);
  });
});

describe("lane values as Numerology shows them", () => {
  it("prints a gate of zero as a dash and a full gate as Tie", () => {
    expect(formatLaneValue(0, "gate")).toBe("–");
    expect(formatLaneValue(1, "gate")).toBe("Tie");
    expect(formatLaneValue(0.5, "gate")).toBe("0.50");
  });

  it("prints levels, percentages and ranges", () => {
    expect(formatLaneValue(3, "level")).toBe("3");
    expect(formatLaneValue({ min: 1, max: 4 }, "level")).toBe("1–4");
    expect(formatLaneValue(25, "percent")).toBe("25%");
    expect(formatLaneValue(-0.08, "signed")).toBe("-0.08");
  });
});

describe("pointer maths", () => {
  it("finds the step under the pointer", () => {
    expect(stepFromX(0, 160, 16)).toBe(0);
    expect(stepFromX(159, 160, 16)).toBe(15);
    expect(stepFromX(-20, 160, 16)).toBe(0);
    expect(stepFromX(500, 160, 16)).toBe(15);
  });

  it("maps height in a lane to a value, top high", () => {
    expect(laneValueFromY(0, 100, 0, 1, 0.01)).toBe(1);
    expect(laneValueFromY(100, 100, 0, 1, 0.01)).toBe(0);
    expect(laneValueFromY(50, 100, 0, 4, 1)).toBe(2);
  });
});

describe("Select: a moved step moves every selected step by the same amount", () => {
  it("adds the delta to all selected steps and clamps", () => {
    const values = [0.2, 0.5, 0.9, 0.4];
    const selected = [true, false, true, true];
    expect(moveSelected(values, selected, 0, 0.4, 0, 1)).toEqual([0.4, 0.5, 1, 0.6]);
  });

  it("moves only the step itself when it is not selected", () => {
    expect(moveSelected([0.2, 0.5], [true, false], 1, 0.1, 0, 1)).toEqual([0.2, 0.1]);
  });
});

describe("the Orig | Scram | Rand split", () => {
  it("dragging the first edge sets Original, the second sets where Random starts", () => {
    const mix = { original: 60, cyclic: 25, utterly: 15 };
    expect(splitFromDrag(mix, "originalEnd", 40)).toEqual({ original: 40, cyclic: 45, utterly: 15 });
    expect(splitFromDrag(mix, "utterlyStart", 70)).toEqual({ original: 60, cyclic: 10, utterly: 30 });
  });
});

describe("cell ranges: drag the top or bottom of a cell apart", () => {
  it("dragging the top above the bottom makes a range", () => {
    expect(cellRangeDrag(2, "top", 4)).toEqual({ min: 2, max: 4 });
    expect(cellRangeDrag({ min: 1, max: 3 }, "bottom", 0)).toEqual({ min: 0, max: 3 });
  });

  it("collapses back to a single level when the edges meet", () => {
    expect(cellRangeDrag({ min: 1, max: 3 }, "top", 1)).toBe(1);
  });

  it("dragging the middle moves the whole cell", () => {
    expect(cellRangeDrag({ min: 1, max: 2 }, "middle", 3)).toEqual({ min: 2, max: 3 });
    expect(cellRangeDrag(1, "middle", 3)).toBe(3);
  });
});

describe("note names as Numerology prints them", () => {
  it("counts MIDI 60 as C 3 and names black keys both ways", () => {
    expect(polyNoteName(60)).toBe("C 3");
    expect(polyNoteName(61)).toBe("Db,C# 3");
    expect(polyNoteName(70)).toBe("Bb,A# 3");
    expect(polyNoteName(48)).toBe("C 2");
  });
});
