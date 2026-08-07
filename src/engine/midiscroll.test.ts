import { describe, expect, it } from "vitest";
import {
  ROW_HEIGHT_PX,
  SCROLL_SPEEDS,
  beatsElapsed,
  rowOfTick,
  laneRowsPerBeat,
  layoutStreamNotes,
  rowSpanForViewport,
  scrollSpeed,
  ticksPerRow,
} from "./midiscroll";
import { PPQN } from "./planner";

const FOUR = scrollSpeed("4/4");

describe("musical time", () => {
  it("counts beats from seconds and tempo", () => {
    expect(beatsElapsed(0, 120)).toBe(0);
    expect(beatsElapsed(1, 120)).toBe(2);
    expect(beatsElapsed(2, 60)).toBe(2);
  });

  it("refuses to run backwards or divide by a stopped tempo", () => {
    expect(beatsElapsed(-1, 120)).toBe(0);
    expect(beatsElapsed(1, 0)).toBe(0);
  });
});

describe("the speed setting", () => {
  it("offers the three the readout names", () => {
    expect(SCROLL_SPEEDS.map((speed) => speed.id)).toEqual(["2/4", "4/4", "8/4"]);
  });

  it("reads as rows per beat", () => {
    expect(scrollSpeed("2/4").rowsPerBeat).toBe(2);
    expect(scrollSpeed("4/4").rowsPerBeat).toBe(4);
    expect(scrollSpeed("8/4").rowsPerBeat).toBe(8);
  });

  it("falls back to 4/4 rather than throwing on an unknown id", () => {
    expect(scrollSpeed("nonsense").id).toBe("4/4");
  });

  it("divides the beat evenly into rows", () => {
    // Every speed has to land on whole ticks, or rows drift against the grid.
    for (const speed of SCROLL_SPEEDS) {
      expect(Number.isInteger(ticksPerRow(speed))).toBe(true);
      expect(ticksPerRow(speed) * speed.rowsPerBeat).toBe(PPQN);
    }
  });
});

describe("which row a note lands in", () => {
  it("puts the downbeat in row zero", () => {
    expect(rowOfTick(0, FOUR)).toBe(0);
  });

  it("gives each subdivision its own row", () => {
    // At 4/4 a beat is four rows, so a beat later is four rows later. This is
    // the whole point: the grid comes from the subdivision, not from how many
    // notes happen to be playing.
    expect(rowOfTick(PPQN, FOUR)).toBe(4);
    expect(rowOfTick(PPQN / 4, FOUR)).toBe(1);
    expect(rowOfTick(PPQN / 2, FOUR)).toBe(2);
  });

  it("quantises anything between subdivisions into the row it falls in", () => {
    // Two notes a hair apart share a row rather than overlapping by a pixel,
    // which is what made the old display look loose.
    const row = rowOfTick(PPQN / 4, FOUR);
    expect(rowOfTick(PPQN / 4 + 5, FOUR)).toBe(row);
    expect(rowOfTick(PPQN / 4 - 5, FOUR)).not.toBe(row);
  });

  it("spaces the same music differently at each speed, and evenly at all of them", () => {
    // A bar is 8 rows at 2/4 and 32 at 8/4, but always evenly divided — the
    // display never bunches because the notes did.
    expect(rowOfTick(PPQN * 4, scrollSpeed("2/4"))).toBe(8);
    expect(rowOfTick(PPQN * 4, scrollSpeed("4/4"))).toBe(16);
    expect(rowOfTick(PPQN * 4, scrollSpeed("8/4"))).toBe(32);
  });

  it("never returns a fractional row", () => {
    for (const tick of [0, 1, 239, 240, 961, 5000]) {
      expect(Number.isInteger(rowOfTick(tick, FOUR))).toBe(true);
    }
  });
});

describe("which rows are worth drawing", () => {
  it("runs from the current row backwards, newest first", () => {
    // New rows arrive at the top and push the rest down.
    const rows = rowSpanForViewport(10, ROW_HEIGHT_PX * 3, 0);
    expect(rows).toEqual([10, 9, 8]);
  });

  it("leaves the requested lead above the current row", () => {
    expect(rowSpanForViewport(10, ROW_HEIGHT_PX * 3, 1)).toEqual([11, 10, 9]);
  });

  it("fills the viewport however tall it is", () => {
    expect(rowSpanForViewport(100, ROW_HEIGHT_PX * 9, 0)).toHaveLength(9);
    expect(rowSpanForViewport(100, ROW_HEIGHT_PX * 30, 0)).toHaveLength(30);
  });

  it("keeps the screen full before the music has got that far", () => {
    // Rows from before the start come back negative and draw as empty grid.
    // A short list would leave the top of a run half blank and grow into
    // place, which is the opposite of a display that persists.
    const rows = rowSpanForViewport(1, ROW_HEIGHT_PX * 4, 0);
    expect(rows).toHaveLength(4);
    expect(rows).toEqual([1, 0, -1, -2]);
  });

  it("always draws at least one row, even in a collapsed viewport", () => {
    expect(rowSpanForViewport(5, 0, 0)).toEqual([5]);
  });
});

describe("a lane's own rate", () => {
  it("is the base rate when the divider is one", () => {
    expect(laneRowsPerBeat(FOUR, 1)).toBe(4);
  });

  it("doubles when the voice takes steps twice as often", () => {
    // Rhythm 0.5 means the planner halves the step duration, so the lane needs
    // twice the rows to keep one step to a row.
    expect(laneRowsPerBeat(FOUR, 0.5)).toBe(8);
  });

  it("halves when the voice takes steps half as often", () => {
    expect(laneRowsPerBeat(FOUR, 2)).toBe(2);
  });

  it("falls back to the base rate when the voice reported no divider", () => {
    expect(laneRowsPerBeat(FOUR, undefined)).toBe(4);
    expect(laneRowsPerBeat(FOUR, 0)).toBe(4);
  });

  it("stays within a sane range rather than trusting an extreme divider", () => {
    // A divider near zero would ask for thousands of rows a beat and lock the
    // display up drawing them.
    expect(laneRowsPerBeat(FOUR, 0.0001)).toBeLessThanOrEqual(64);
    expect(laneRowsPerBeat(FOUR, 10000)).toBeGreaterThanOrEqual(1);
  });
});

describe("fitting notes to a lane", () => {
  const at = (tick: number, ticks: number, id = tick) =>
    ({ id, atTick: tick, durationTicks: ticks });
  const row = PPQN / 4; // one row at 4/4, divider 1

  it("gives every note a whole row of its own", () => {
    // Notes are never narrowed to share a slot: a lane running fast pushes
    // its earlier notes down sooner instead of squeezing them sideways.
    const laid = layoutStreamNotes([at(0, row, 1), at(0, row, 2)], FOUR, 1);
    expect(laid.every((n) => n.subCount === 1)).toBe(true);
  });

  it("separates notes that used to collide by giving the lane more rows", () => {
    // Two notes a sixteenth apart share a row at 4/4 with no divider, and get
    // a row each once the lane is running at the rate that produced them.
    const eighth = PPQN / 8;
    const slow = layoutStreamNotes([at(0, eighth, 1), at(eighth, eighth, 2)], FOUR, 1);
    expect(slow[0].startRow).toBe(slow[1].startRow);
    const fast = layoutStreamNotes([at(0, eighth, 1), at(eighth, eighth, 2)], FOUR, 0.5);
    expect(fast[0].startRow).not.toBe(fast[1].startRow);
  });

  it("still measures length in that lane's rows", () => {
    expect(layoutStreamNotes([at(0, row * 2)], FOUR, 1)[0].spanRows).toBe(2);
    // At twice the rate the same note covers twice as many of that lane's rows.
    expect(layoutStreamNotes([at(0, row * 2)], FOUR, 0.5)[0].spanRows).toBe(4);
  });

  it("still gives a very short note a whole row", () => {
    expect(layoutStreamNotes([at(0, 1)], FOUR, 1)[0].spanRows).toBe(1);
  });

  it("truncates a note that would run into the next one", () => {
    const laid = layoutStreamNotes([at(0, row * 8), at(row * 2, row)], FOUR, 1);
    expect(laid[0].spanRows).toBe(2);
  });

  it("copes with notes handed to it out of order", () => {
    const laid = layoutStreamNotes([at(row * 4, row, 2), at(0, row, 1)], FOUR, 1);
    expect(laid.find((n) => n.id === 1)?.startRow).toBe(0);
    expect(laid.find((n) => n.id === 2)?.startRow).toBe(4);
  });

  it("still places a note the planner gave no length", () => {
    const laid = layoutStreamNotes([{ id: 1, atTick: 0 }], FOUR, 1);
    expect(laid[0].spanRows).toBe(1);
  });

  it("returns nothing for an empty lane", () => {
    expect(layoutStreamNotes([], FOUR, 1)).toEqual([]);
  });
})
