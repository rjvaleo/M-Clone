// Tests for the Pattern Editor's constraint and scrolling rules, written
// against chapters 5 and 14 of the M 2.7 manual before the module exists.
// Each block quotes the sentence it pins down.

import { describe, it, expect } from "vitest";
import {
  clampCounter,
  clampEditRange,
  clampRegionToPattern,
  pageStart,
  scrollToFollow,
  thumbStart,
} from "./editor";

describe("selecting a Region", () => {
  // "Note that you can select only Regions that contain notes or rests."
  it("keeps a region that lies inside the Pattern", () => {
    expect(clampRegionToPattern({ from: 2, to: 5 }, 10)).toEqual({ from: 2, to: 5 });
  });

  it("trims a region that runs past the last step", () => {
    expect(clampRegionToPattern({ from: 6, to: 40 }, 10)).toEqual({ from: 6, to: 9 });
  });

  it("trims a region that starts before the first step", () => {
    expect(clampRegionToPattern({ from: -5, to: 3 }, 10)).toEqual({ from: 0, to: 3 });
  });

  it("refuses a region entirely beyond the Pattern", () => {
    expect(clampRegionToPattern({ from: 20, to: 30 }, 10)).toBe(null);
  });

  it("refuses any region in an empty Pattern", () => {
    expect(clampRegionToPattern({ from: 0, to: 0 }, 0)).toBe(null);
  });

  it("orders a region dragged right to left", () => {
    expect(clampRegionToPattern({ from: 7, to: 3 }, 10)).toEqual({ from: 3, to: 7 });
  });

  it("allows a single-step region", () => {
    expect(clampRegionToPattern({ from: 4, to: 4 }, 10)).toEqual({ from: 4, to: 4 });
  });
});

describe("the MIDI Edit Range", () => {
  // "You can set it for one step more than the number of steps you already
  //  have in your Pattern."
  it("reaches one step past the end of the Pattern", () => {
    expect(clampEditRange({ from: 0, to: 99 }, 8, 100)).toEqual({ from: 0, to: 8 });
  });

  it("keeps a range inside the Pattern untouched", () => {
    expect(clampEditRange({ from: 4, to: 7 }, 8, 100)).toEqual({ from: 4, to: 7 });
  });

  it("never runs past the Pattern's maximum size", () => {
    // A tiny Size Numerical wins over the one-step-past rule.
    expect(clampEditRange({ from: 0, to: 99 }, 8, 5).to).toBe(4);
  });

  it("clamps below zero", () => {
    expect(clampEditRange({ from: -4, to: 3 }, 8, 100)).toEqual({ from: 0, to: 3 });
  });

  it("orders a range dragged right to left", () => {
    expect(clampEditRange({ from: 6, to: 2 }, 8, 100)).toEqual({ from: 2, to: 6 });
  });

  it("collapses to a single step in an empty Pattern", () => {
    expect(clampEditRange({ from: 0, to: 5 }, 0, 100)).toEqual({ from: 0, to: 0 });
  });
});

describe("the MIDI Edit Counter", () => {
  // "you can move it only within the area designated by the MIDI Edit Range."
  it("stays inside the range", () => {
    expect(clampCounter(2, { from: 4, to: 8 })).toBe(4);
    expect(clampCounter(12, { from: 4, to: 8 })).toBe(8);
    expect(clampCounter(6, { from: 4, to: 8 })).toBe(6);
  });

  it("lands on the range when the range is a single step", () => {
    expect(clampCounter(99, { from: 5, to: 5 })).toBe(5);
  });
});

describe("following a drag past the edge", () => {
  // "you can drag the MIDI Edit Counter past the end of the Editing Grid and
  //  it will scroll along with you."
  it("does not scroll while the step stays in view", () => {
    expect(scrollToFollow(20, 10, 20, 80)).toBe(10);
  });

  it("scrolls forward when the step passes the right edge", () => {
    // Showing steps 10-29; step 30 is one past, so the view shifts by one.
    expect(scrollToFollow(30, 10, 20, 80)).toBe(11);
  });

  it("scrolls back when the step passes the left edge", () => {
    expect(scrollToFollow(7, 10, 20, 80)).toBe(7);
  });

  it("never scrolls past the start of the Pattern", () => {
    expect(scrollToFollow(-5, 3, 20, 80)).toBe(0);
  });

  it("never scrolls past the end of the scroll bar", () => {
    expect(scrollToFollow(500, 70, 20, 80)).toBe(80);
  });
});

describe("paging the scroll bar", () => {
  // "Clicking on the dotted area of the Scroll Bar 'pages' you forwards or
  //  backwards by one full Editing Grid."
  it("pages forward by a full grid", () => {
    expect(pageStart(0, 20, +1, 80)).toBe(20);
  });

  it("pages backward by a full grid", () => {
    expect(pageStart(40, 20, -1, 80)).toBe(20);
  });

  it("stops at the beginning", () => {
    expect(pageStart(5, 20, -1, 80)).toBe(0);
  });

  it("stops at the end", () => {
    expect(pageStart(70, 20, +1, 80)).toBe(80);
  });
});

describe("the scroll bar Thumb", () => {
  // "Dragging the white box (called the Thumb) of the Scroll Bar places you at
  //  a location which is proportional to the maximum size of the Pattern."
  it("maps the far left to the first step", () => {
    expect(thumbStart(0, 100, 20)).toBe(0);
  });

  it("maps the far right to the last full screen", () => {
    expect(thumbStart(1, 100, 20)).toBe(80);
  });

  it("maps the middle proportionally to the maximum size", () => {
    // Half of a 100-step maximum is step 50, still within the scrollable range.
    expect(thumbStart(0.5, 100, 20)).toBe(50);
  });

  it("is proportional to the maximum size, not the current length", () => {
    // The same fraction of a bigger Size Numerical lands further along.
    expect(thumbStart(0.5, 200, 20)).toBe(100);
  });

  it("clamps a fraction dragged outside the track", () => {
    expect(thumbStart(-1, 100, 20)).toBe(0);
    expect(thumbStart(9, 100, 20)).toBe(80);
  });

  it("stays at zero when the grid is wider than the Pattern", () => {
    expect(thumbStart(1, 10, 20)).toBe(0);
  });
});
