import { describe, expect, it } from "vitest";
import {
  centreOn,
  EMPTY_VIEW,
  openingScrollTop,
  pitchSpan,
  ROLL_PITCH_COUNT,
  viewWindow,
  type RollView,
} from "./noteRoll";

/** Eight rows visible of the full 128, sixteen steps all visible. */
const view: RollView = {
  scrollTop: 0, scrollLeft: 0,
  clientWidth: 320, clientHeight: 160,
  scrollWidth: 320, scrollHeight: 2560,
};

describe("viewWindow", () => {
  it("reports the visible fraction of each axis", () => {
    const window_ = viewWindow({ ...view, scrollTop: 1280 });
    expect(window_.y).toBeCloseTo(0.5);
    expect(window_.height).toBeCloseTo(160 / 2560);
    // Nothing to scroll sideways: the window covers the whole axis.
    expect(window_.x).toBe(0);
    expect(window_.width).toBe(1);
  });

  it("draws a full window before the element has been measured", () => {
    expect(viewWindow(EMPTY_VIEW)).toEqual({ x: 0, y: 0, width: 1, height: 1 });
  });
});

describe("centreOn", () => {
  it("puts the requested point in the middle of the window", () => {
    expect(centreOn(view, 0, 0.5).scrollTop).toBe(0.5 * 2560 - 80);
  });

  it("clamps at both ends rather than scrolling off the roll", () => {
    expect(centreOn(view, 0, 0).scrollTop).toBe(0);
    expect(centreOn(view, 0, 1).scrollTop).toBe(2560 - 160);
    expect(centreOn(view, 1, 0).scrollLeft).toBe(0);
  });
});

describe("pitchSpan", () => {
  it("finds the lowest and highest note in the pattern", () => {
    expect(pitchSpan([[60], [], [48, 72]])).toEqual({ low: 48, high: 72 });
  });

  it("is null when nothing is playing", () => {
    expect(pitchSpan([[], []])).toBeNull();
  });
});

describe("openingScrollTop", () => {
  it("opens on the notes rather than at the top of the range", () => {
    const rowHeight = 2560 / ROLL_PITCH_COUNT;
    const top = openingScrollTop([[60], [64]], view);
    // Pitch 62 is the centre of the two notes, so it should sit in the middle
    // of the window.
    const centreRow = (ROLL_PITCH_COUNT - 1 - 62 + 0.5) * rowHeight;
    expect(top + 160 / 2).toBeCloseTo(centreRow);
  });

  it("opens near middle C when the pattern is empty", () => {
    const top = openingScrollTop([[], []], view);
    const rowHeight = 2560 / ROLL_PITCH_COUNT;
    expect((top + 80) / rowHeight).toBeCloseTo(ROLL_PITCH_COUNT - 60 - 0.5);
  });

  it("never scrolls past either end", () => {
    expect(openingScrollTop([[127]], view)).toBe(0);
    expect(openingScrollTop([[0]], view)).toBe(2560 - 160);
  });
});
