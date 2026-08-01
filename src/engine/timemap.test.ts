// Tests for the Time Distortion Map, written against what the M 2.7 manual
// says the feature does. Each block quotes the claim it is pinning down, so a
// failure points at a sentence in the manual rather than at an opinion.

import { describe, it, expect } from "vitest";
import {
  type TimeMap,
  TIME_MAP_DENOMINATORS,
  MAX_TIME_MAP_LENGTH,
  addBreakpoint,
  clearTimeMap,
  clockToReal,
  cloneTimeMap,
  distortClockSeconds,
  isNeutralTimeMap,
  moveBreakpoint,
  neutralTimeMap,
  normalizeTimeMap,
  realToClock,
  removeBreakpoint,
  setTimeMapLength,
  timeMapPolyline,
  timeMapSeconds,
} from "./timemap";

const map = (points: { x: number; y: number }[], over: Partial<TimeMap> = {}): TimeMap => ({
  ...neutralTimeMap(),
  points,
  ...over,
});

describe("the neutral map", () => {
  // "The Time Distortion Edit Window opens with a neutral Time Distortion Map."
  // "...shows a normal relationship between Real Time and Clock Time, in that
  //  ticks of the clock take a consistent amount of Real Time."
  it("is a straight diagonal with no breakpoints", () => {
    const m = neutralTimeMap();
    expect(m.points).toEqual([]);
    expect(timeMapPolyline(m)).toEqual([{ x: 0, y: 0 }, { x: 1, y: 1 }]);
  });

  it("covers one quarter note by default", () => {
    // "The graph shown above covers the space of a quarter note."
    expect(neutralTimeMap()).toMatchObject({ length: 1, denominator: 4 });
  });

  it("leaves time completely alone", () => {
    const m = neutralTimeMap();
    for (const t of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
      expect(realToClock(m, t)).toBeCloseTo(t, 9);
      expect(clockToReal(m, t)).toBeCloseTo(t, 9);
    }
  });

  it("is recognised as neutral even with breakpoints left on the diagonal", () => {
    expect(isNeutralTimeMap(neutralTimeMap())).toBe(true);
    expect(isNeutralTimeMap(map([{ x: 0.5, y: 0.5 }]))).toBe(true);
    expect(isNeutralTimeMap(map([{ x: 0.25, y: 0.6 }]))).toBe(false);
  });
});

describe("the two axes", () => {
  // "The horizontal axis is Real Time. The vertical axis is Clock Time."
  const steep = map([{ x: 0.25, y: 0.75 }]);

  it("reads Real Time across and Clock Time up", () => {
    // A quarter of the way through real time, three quarters of the clock has
    // already gone by.
    expect(realToClock(steep, 0.25)).toBeCloseTo(0.75, 9);
  });

  it("inverts cleanly, which is the direction the planner asks in", () => {
    // Three quarters of the way through the clock, only a quarter of the real
    // time has elapsed.
    expect(clockToReal(steep, 0.75)).toBeCloseTo(0.25, 9);
  });

  it("round-trips through both directions", () => {
    for (const t of [0, 0.2, 0.4, 0.6, 0.8, 1]) {
      expect(clockToReal(steep, realToClock(steep, t))).toBeCloseTo(t, 9);
    }
  });

  it("interpolates linearly between breakpoints", () => {
    // Halfway along the first segment of a (0,0)→(0.25,0.75)→(1,1) map.
    expect(realToClock(steep, 0.125)).toBeCloseTo(0.375, 9);
    // ...and halfway along the second.
    expect(realToClock(steep, 0.625)).toBeCloseTo(0.875, 9);
  });

  it("pins the corners, which is what preserves total time", () => {
    // "the same amount of time will go by when you use a Time Distortion Map,
    //  it'll just go by rather, well, distorted."
    const wild = map([
      { x: 0.1, y: 0.8 },
      { x: 0.3, y: 0.85 },
      { x: 0.9, y: 0.95 },
    ]);
    expect(realToClock(wild, 0)).toBe(0);
    expect(realToClock(wild, 1)).toBe(1);
    expect(clockToReal(wild, 0)).toBe(0);
    expect(clockToReal(wild, 1)).toBe(1);
  });

  it("clamps input outside the cycle instead of extrapolating", () => {
    expect(realToClock(steep, -0.5)).toBe(0);
    expect(realToClock(steep, 1.5)).toBe(1);
  });
});

describe("swing", () => {
  // "You've all heard a 'swing' or shuffle rhythm. It's simply a slowing down
  //  and then a speeding up in the space of a quarter note, so that the eighth
  //  note in the middle is delayed."
  it("delays the eighth note in the middle", () => {
    // Clock reaches its midpoint only two thirds of the way through real time.
    const swing = map([{ x: 2 / 3, y: 0.5 }]);
    const middle = clockToReal(swing, 0.5);
    expect(middle).toBeCloseTo(2 / 3, 9);
    expect(middle).toBeGreaterThan(0.5); // later than it would be straight
  });

  it("still starts and ends the quarter note on time", () => {
    const swing = map([{ x: 2 / 3, y: 0.5 }]);
    expect(clockToReal(swing, 0)).toBe(0);
    expect(clockToReal(swing, 1)).toBe(1);
  });
});

describe("a flurry then slow notes", () => {
  // The tutorial map: a steep climb to a sharp corner, then a shallow run to
  // the top right. "You should hear a flurry of notes, followed by a few very
  // slow notes."
  const tutorial = map([{ x: 0.2, y: 0.8 }], { length: 8, denominator: 4 });

  it("packs most of the clock into the first slice of real time", () => {
    expect(realToClock(tutorial, 0.2)).toBeCloseTo(0.8, 9);
  });

  it("puts evenly spaced clock ticks close together early", () => {
    const early = [0, 0.1, 0.2, 0.3, 0.4].map((c) => clockToReal(tutorial, c));
    const gaps = early.slice(1).map((v, i) => v - early[i]);
    for (const g of gaps) expect(g).toBeCloseTo(0.025, 9);
  });

  it("and far apart late", () => {
    const late = [0.8, 0.9, 1].map((c) => clockToReal(tutorial, c));
    const gaps = late.slice(1).map((v, i) => v - late[i]);
    // The shallow run stretches each 0.1 of clock over 0.4 of real time.
    for (const g of gaps) expect(g).toBeCloseTo(0.4, 9);
    // Sixteen times the early spacing: the flurry, then the crawl.
    expect(gaps[0] / 0.025).toBeCloseTo(16, 9);
  });
});

describe("map length", () => {
  // "The right-hand numerical sets the units of the length, for example,
  //  quarter notes. The left-hand numerical sets how many of these units are
  //  covered in the map."
  it("measures one quarter note at 120bpm as half a second", () => {
    expect(timeMapSeconds(neutralTimeMap(), 120)).toBeCloseTo(0.5, 9);
  });

  it("scales with the count", () => {
    // The tutorial sets the length to eight quarter notes.
    expect(timeMapSeconds(map([], { length: 8, denominator: 4 }), 120))
      .toBeCloseTo(4, 9);
  });

  it("treats 1 whole note and 4 quarter notes as the same span", () => {
    // "Obviously combinations are equivalent, such as 1 whole note and 4
    //  quarter notes. There is absolutely no difference between one of these
    //  combinations and another."
    const whole = map([], { length: 1, denominator: 1 });
    const quarters = map([], { length: 4, denominator: 4 });
    const eighths = map([], { length: 8, denominator: 8 });
    expect(timeMapSeconds(whole, 120)).toBeCloseTo(timeMapSeconds(quarters, 120), 9);
    expect(timeMapSeconds(eighths, 120)).toBeCloseTo(timeMapSeconds(quarters, 120), 9);
  });

  it("follows the tempo", () => {
    expect(timeMapSeconds(neutralTimeMap(), 60)).toBeCloseTo(1, 9);
    expect(timeMapSeconds(neutralTimeMap(), 240)).toBeCloseTo(0.25, 9);
  });

  it("refuses nonsense spans rather than dividing by zero", () => {
    expect(timeMapSeconds(neutralTimeMap(), 0)).toBe(0);
    expect(timeMapSeconds(map([], { length: 0 }), 120)).toBe(0);
    expect(timeMapSeconds(map([], { denominator: 0 }), 120)).toBe(0);
  });

  it("clamps the length numerical to a usable range", () => {
    expect(setTimeMapLength(neutralTimeMap(), 0, 4).length).toBe(1);
    expect(setTimeMapLength(neutralTimeMap(), -5, 4).length).toBe(1);
    expect(setTimeMapLength(neutralTimeMap(), 999, 4).length)
      .toBe(MAX_TIME_MAP_LENGTH);
    expect(setTimeMapLength(neutralTimeMap(), NaN, 4).length).toBe(1);
  });

  it("accepts only real note values as the unit", () => {
    for (const d of TIME_MAP_DENOMINATORS) {
      expect(setTimeMapLength(neutralTimeMap(), 1, d).denominator).toBe(d);
    }
    // A bogus unit leaves the existing one alone.
    expect(setTimeMapLength(neutralTimeMap(), 1, 5).denominator).toBe(4);
  });

  it("keeps the drawn map when the length changes", () => {
    const m = map([{ x: 0.25, y: 0.75 }]);
    expect(setTimeMapLength(m, 8, 4).points).toEqual(m.points);
  });
});

describe("the map repeats", () => {
  // "The Voice will repeat its Time Distortion Cycle until you get tired of
  //  listening to it and stop the music."
  const steep = map([{ x: 0.25, y: 0.75 }]); // 1 quarter note @120bpm = 0.5s

  it("applies the same shape in every cycle", () => {
    // 0.375s of clock is three quarters through cycle 1 -> a quarter of its
    // real span, i.e. 0.125s. The same offset in cycle 2 lands 0.5s later.
    expect(distortClockSeconds(steep, 120, 0.375)).toBeCloseTo(0.125, 9);
    expect(distortClockSeconds(steep, 120, 0.875)).toBeCloseTo(0.625, 9);
    expect(distortClockSeconds(steep, 120, 1.375)).toBeCloseTo(1.125, 9);
  });

  it("lands every cycle boundary exactly on time", () => {
    // This is the time-preservation property across a whole performance.
    for (const cycle of [0, 1, 2, 5, 20]) {
      expect(distortClockSeconds(steep, 120, cycle * 0.5)).toBeCloseTo(cycle * 0.5, 9);
    }
  });

  it("never runs backwards", () => {
    let previous = -Infinity;
    for (let clock = 0; clock <= 3; clock += 0.01) {
      const real = distortClockSeconds(steep, 120, clock);
      expect(real).toBeGreaterThanOrEqual(previous);
      previous = real;
    }
  });

  it("is a no-op for a neutral map", () => {
    expect(distortClockSeconds(neutralTimeMap(), 120, 1.234)).toBeCloseTo(1.234, 9);
  });

  it("is a no-op when the span is degenerate or the clock is negative", () => {
    expect(distortClockSeconds(steep, 0, 1.234)).toBeCloseTo(1.234, 9);
    expect(distortClockSeconds(steep, 120, -1)).toBe(-1);
  });
});

describe("drawing and editing maps", () => {
  // "Click anywhere off the highlighted line, then move the mouse to each
  //  successive breakpoint in the map and click."
  it("adds a breakpoint", () => {
    const m = addBreakpoint(neutralTimeMap(), { x: 0.25, y: 0.75 });
    expect(m.points).toEqual([{ x: 0.25, y: 0.75 }]);
  });

  it("keeps breakpoints ordered by real time however they're added", () => {
    let m = neutralTimeMap();
    m = addBreakpoint(m, { x: 0.8, y: 0.9 });
    m = addBreakpoint(m, { x: 0.2, y: 0.4 });
    m = addBreakpoint(m, { x: 0.5, y: 0.6 });
    expect(m.points.map((p) => p.x)).toEqual([0.2, 0.5, 0.8]);
  });

  it("clamps breakpoints into the graph", () => {
    const m = addBreakpoint(neutralTimeMap(), { x: 5, y: -3 });
    expect(m.points).toEqual([{ x: 1, y: 0 }]);
  });

  // "you can tug on the breakpoints and move them around for fine tuning"
  it("tugs a breakpoint to a new place", () => {
    const m = moveBreakpoint(map([{ x: 0.25, y: 0.75 }]), 0, { x: 0.6, y: 0.3 });
    expect(m.points).toEqual([{ x: 0.6, y: 0.3 }]);
  });

  it("ignores a tug at an index that isn't there", () => {
    const m = map([{ x: 0.25, y: 0.75 }]);
    expect(moveBreakpoint(m, 7, { x: 0.5, y: 0.5 })).toBe(m);
    expect(moveBreakpoint(m, -1, { x: 0.5, y: 0.5 })).toBe(m);
  });

  it("stops a tugged breakpoint from doubling back past its neighbour", () => {
    // Clock time can't run backwards, so dragging point 2 below point 1 pins
    // it rather than producing a map that unwinds.
    const m = map([{ x: 0.3, y: 0.6 }, { x: 0.7, y: 0.8 }]);
    const dragged = moveBreakpoint(m, 1, { x: 0.1, y: 0.2 });
    expect(dragged.points[0]).toEqual({ x: 0.1, y: 0.2 });
    expect(dragged.points[1].x).toBeGreaterThanOrEqual(dragged.points[0].x);
    expect(dragged.points[1].y).toBeGreaterThanOrEqual(dragged.points[0].y);
  });

  it("removes a breakpoint", () => {
    const m = removeBreakpoint(map([{ x: 0.3, y: 0.6 }, { x: 0.7, y: 0.8 }]), 0);
    expect(m.points).toEqual([{ x: 0.7, y: 0.8 }]);
  });

  it("ignores a removal at an index that isn't there", () => {
    const m = map([{ x: 0.3, y: 0.6 }]);
    expect(removeBreakpoint(m, 9)).toBe(m);
    expect(removeBreakpoint(m, -1)).toBe(m);
  });

  it("refuses to grow without bound", () => {
    let m = neutralTimeMap();
    for (let i = 0; i < 100; i++) m = addBreakpoint(m, { x: i / 100, y: i / 100 });
    expect(m.points.length).toBeLessThanOrEqual(32);
  });

  // "This button erases the time distortion map currently being edited."
  it("clears back to the neutral diagonal", () => {
    const cleared = clearTimeMap(map([{ x: 0.25, y: 0.75 }], { length: 8 }));
    expect(cleared.points).toEqual([]);
    expect(isNeutralTimeMap(cleared)).toBe(true);
  });

  it("leaves the length alone when clearing", () => {
    const cleared = clearTimeMap(map([{ x: 0.25, y: 0.75 }], { length: 8, denominator: 8 }));
    expect(cleared).toMatchObject({ length: 8, denominator: 8 });
  });

  it("never mutates the map it was given", () => {
    const original = map([{ x: 0.25, y: 0.75 }]);
    const snapshot = JSON.stringify(original);
    addBreakpoint(original, { x: 0.5, y: 0.5 });
    moveBreakpoint(original, 0, { x: 0.9, y: 0.1 });
    removeBreakpoint(original, 0);
    clearTimeMap(original);
    setTimeMapLength(original, 8, 8);
    expect(JSON.stringify(original)).toBe(snapshot);
  });

  it("deep-copies, so two Positions can't share breakpoints", () => {
    const a = map([{ x: 0.25, y: 0.75 }]);
    const b = cloneTimeMap(a);
    b.points[0].x = 0.9;
    expect(a.points[0].x).toBe(0.25);
  });
});

describe("degenerate maps", () => {
  it("survives a vertical segment, where the clock jumps", () => {
    // Two points at the same real time: the clock leaps without time passing.
    const m = map([{ x: 0.5, y: 0.2 }, { x: 0.5, y: 0.8 }]);
    expect(realToClock(m, 0.5)).toBeCloseTo(0.2, 9);
    // Every clock value inside the jump resolves to that instant.
    expect(clockToReal(m, 0.5)).toBeCloseTo(0.5, 9);
  });

  it("survives a horizontal segment, where the clock stalls", () => {
    // Two points at the same clock time: real time passes, nothing sounds.
    const m = map([{ x: 0.2, y: 0.5 }, { x: 0.8, y: 0.5 }]);
    expect(clockToReal(m, 0.5)).toBeCloseTo(0.2, 9);
    expect(realToClock(m, 0.5)).toBeCloseTo(0.5, 9);
  });

  it("survives a breakpoint pinned to the very start of the graph", () => {
    // A point at x=0 makes the first segment vertical: the clock leaps before
    // any real time has passed. Reading at 0 must not divide by that zero.
    const atStart = map([{ x: 0, y: 0.5 }]);
    expect(realToClock(atStart, 0)).toBe(0);
    expect(realToClock(atStart, 0.5)).toBeCloseTo(0.75, 9);
    // The mirrored case: a point at y=0 stalls the clock at the start.
    const flatStart = map([{ x: 0.5, y: 0 }]);
    expect(clockToReal(flatStart, 0)).toBe(0);
    expect(clockToReal(flatStart, 0.5)).toBeCloseTo(0.75, 9);
  });

  it("orders and forward-clamps a hand-built backwards map", () => {
    const m = normalizeTimeMap(map([{ x: 0.8, y: 0.3 }, { x: 0.2, y: 0.9 }]));
    expect(m.points[0].x).toBeLessThanOrEqual(m.points[1].x);
    expect(m.points[0].y).toBeLessThanOrEqual(m.points[1].y);
  });
});
