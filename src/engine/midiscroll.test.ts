import { describe, expect, it } from "vitest";
import {
  ROW_HEIGHT_PX,
  SCROLL_SPEEDS,
  beatsElapsed,
  rowOfTick,
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

describe("fitting notes to the grid", () => {
  const at = (tick: number, ticks: number, id = tick) =>
    ({ id, atTick: tick, durationTicks: ticks });
  const row = PPQN / 4; // one row at 4/4

  it("gives a note lasting one row a span of one", () => {
    expect(layoutStreamNotes([at(0, row)], FOUR)[0].spanRows).toBe(1);
  });

  it("stretches a longer note across the slots it fills", () => {
    // The point of showing length as height: a note twice as long is twice
    // as tall, so the shape of the phrase is visible without reading numbers.
    expect(layoutStreamNotes([at(0, row * 2)], FOUR)[0].spanRows).toBe(2);
    expect(layoutStreamNotes([at(0, row * 4)], FOUR)[0].spanRows).toBe(4);
  });

  it("still gives a very short note a whole row of height", () => {
    // Shorter than the grid is not the same as invisible.
    expect(layoutStreamNotes([at(0, 1)], FOUR)[0].spanRows).toBe(1);
  });

  it("compresses notes that share a slot so both fit in one row", () => {
    // A clock divider running faster than the grid puts two notes in the
    // space of one. They subdivide the row rather than overlapping it.
    const laid = layoutStreamNotes([at(0, row, 1), at(0, row, 2)], FOUR);
    expect(laid.map((n) => n.subCount)).toEqual([2, 2]);
    expect(laid.map((n) => n.subIndex)).toEqual([0, 1]);
  });

  it("compresses three or four the same way", () => {
    const laid = layoutStreamNotes(
      [at(0, row, 1), at(0, row, 2), at(0, row, 3)], FOUR,
    );
    expect(laid.map((n) => n.subIndex)).toEqual([0, 1, 2]);
    expect(new Set(laid.map((n) => n.subCount))).toEqual(new Set([3]));
  });

  it("leaves a note alone in its slot at full width", () => {
    const laid = layoutStreamNotes([at(0, row), at(row * 4, row)], FOUR);
    expect(laid.every((n) => n.subCount === 1)).toBe(true);
  });

  it("truncates a note that would run into the next one", () => {
    // Legato over 100% makes notes overlap in time. On a grid that would draw
    // one block on top of another, so the earlier one stops where the next
    // begins.
    const laid = layoutStreamNotes([at(0, row * 8), at(row * 2, row)], FOUR);
    expect(laid[0].spanRows).toBe(2);
  });

  it("does not truncate against a note in the same slot", () => {
    // Two notes starting together are a chord, not a collision; they
    // subdivide sideways and both keep their length.
    const laid = layoutStreamNotes([at(0, row * 3, 1), at(0, row * 3, 2)], FOUR);
    expect(laid.map((n) => n.spanRows)).toEqual([3, 3]);
  });

  it("reads the speed, so the same note spans more rows at a finer grid", () => {
    const beat = PPQN;
    expect(layoutStreamNotes([at(0, beat)], scrollSpeed("2/4"))[0].spanRows).toBe(2);
    expect(layoutStreamNotes([at(0, beat)], scrollSpeed("8/4"))[0].spanRows).toBe(8);
  });

  it("still places a note the planner gave no length", () => {
    // durationTicks is optional on a planned note, so the layout must not
    // assume it: no length is one row, not zero.
    const laid = layoutStreamNotes([{ id: 1, atTick: 0 }], FOUR);
    expect(laid[0].spanRows).toBe(1);
    expect(laid[0].subCount).toBe(1);
    expect(laid[0].subIndex).toBe(0);
  });

  it("returns nothing for an empty stream", () => {
    expect(layoutStreamNotes([], FOUR)).toEqual([]);
  });

  it("copes with notes handed to it out of order", () => {
    const laid = layoutStreamNotes([at(row * 4, row, 2), at(0, row, 1)], FOUR);
    expect(laid.find((n) => n.id === 1)?.startRow).toBe(0);
    expect(laid.find((n) => n.id === 2)?.startRow).toBe(4);
  });
})
