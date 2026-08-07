import { describe, expect, it } from "vitest";
import {
  ROW_HEIGHT_PX,
  SCROLL_SPEEDS,
  beatsElapsed,
  scrollSpeed,
  visibleBeatRange,
  yForBeat,
} from "./midiscroll";

const FOUR = scrollSpeed("4/4");

describe("musical time", () => {
  it("counts beats from seconds and tempo", () => {
    // 120 BPM is two beats a second, whatever the display is doing.
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
  it("offers the three the transport bar names", () => {
    expect(SCROLL_SPEEDS.map((speed) => speed.id)).toEqual(["2/4", "4/4", "8/4"]);
  });

  it("reads as rows per beat, so a bigger number scrolls faster", () => {
    expect(scrollSpeed("2/4").rowsPerBeat).toBe(2);
    expect(scrollSpeed("4/4").rowsPerBeat).toBe(4);
    expect(scrollSpeed("8/4").rowsPerBeat).toBe(8);
  });

  it("falls back to 4/4 rather than throwing on an unknown id", () => {
    // A saved document from a build with different speeds must still open.
    expect(scrollSpeed("nonsense").id).toBe("4/4");
  });
});

describe("placing a note against the playhead", () => {
  const PLAYHEAD = 300;

  it("puts a note that is sounding exactly on the playhead", () => {
    // This is the whole contract: the row you see under the line is the note
    // you are hearing. Both are the same number, not two kept in step.
    expect(yForBeat(8, 8, PLAYHEAD, FOUR)).toBe(PLAYHEAD);
  });

  it("puts a note still to come above the playhead", () => {
    // Notes arrive from the top and fall towards the line.
    expect(yForBeat(9, 8, PLAYHEAD, FOUR)).toBeLessThan(PLAYHEAD);
  });

  it("puts a note already played below it", () => {
    expect(yForBeat(7, 8, PLAYHEAD, FOUR)).toBeGreaterThan(PLAYHEAD);
  });

  it("spaces a beat by the speed setting", () => {
    // One beat is rowsPerBeat rows, so 4/4 spaces a beat twice as far as 2/4
    // and half as far as 8/4.
    const beat = (speed: ReturnType<typeof scrollSpeed>) =>
      PLAYHEAD - yForBeat(9, 8, PLAYHEAD, speed);
    expect(beat(FOUR)).toBe(4 * ROW_HEIGHT_PX);
    expect(beat(scrollSpeed("2/4"))).toBe(2 * ROW_HEIGHT_PX);
    expect(beat(scrollSpeed("8/4"))).toBe(8 * ROW_HEIGHT_PX);
  });

  it("moves a fixed note downward as the music advances", () => {
    // The note stands still in musical time; the display moves under it.
    const at = (current: number) => yForBeat(10, current, PLAYHEAD, FOUR);
    expect(at(9)).toBeLessThan(at(9.5));
    expect(at(9.5)).toBeLessThan(at(10));
  });

  it("moves continuously, not a row at a time", () => {
    // Between two whole beats the position must still change, or the display
    // steps once a beat instead of scrolling.
    expect(yForBeat(10, 9.25, PLAYHEAD, FOUR))
      .not.toBe(yForBeat(10, 9.5, PLAYHEAD, FOUR));
  });
});

describe("what is worth drawing", () => {
  const PLAYHEAD = 300;
  const HEIGHT = 400;

  it("spans from above the top of the view to below the bottom", () => {
    const range = visibleBeatRange(8, PLAYHEAD, HEIGHT, FOUR);
    expect(range.from).toBeLessThan(8);
    expect(range.to).toBeGreaterThan(8);
  });

  it("covers exactly what the viewport shows, plus a row of margin", () => {
    // Everything inside the range must land on screen, and a note one row
    // outside it must not — otherwise rows pop in at the edges.
    const range = visibleBeatRange(8, PLAYHEAD, HEIGHT, FOUR);
    expect(yForBeat(range.to, 8, PLAYHEAD, FOUR)).toBeLessThanOrEqual(0);
    expect(yForBeat(range.from, 8, PLAYHEAD, FOUR)).toBeGreaterThanOrEqual(HEIGHT);
  });

  it("shows less music when the speed is higher", () => {
    const slow = visibleBeatRange(8, PLAYHEAD, HEIGHT, scrollSpeed("2/4"));
    const fast = visibleBeatRange(8, PLAYHEAD, HEIGHT, scrollSpeed("8/4"));
    expect(fast.to - fast.from).toBeLessThan(slow.to - slow.from);
  });
});
