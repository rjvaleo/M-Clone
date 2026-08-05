import { describe, expect, it } from "vitest";
import {
  clamp,
  denormalize,
  describeArc,
  dragDeltaToValue,
  knobAngle,
  KNOB_END_DEG,
  KNOB_START_DEG,
  normalize,
  polarToCartesian,
  sliderPosition,
  snap,
  stepBy,
  stepperStep,
  tickAngles,
} from "./geometry";

describe("clamp", () => {
  it("holds a value inside its bounds", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-5, 0, 10)).toBe(0);
    expect(clamp(15, 0, 10)).toBe(10);
  });

  it("treats NaN as the low bound rather than propagating it", () => {
    // A parameter read from a document that failed to parse is NaN, not
    // absent — the knob still has to draw somewhere.
    expect(clamp(Number.NaN, 2, 8)).toBe(2);
  });
});

describe("normalize / denormalize", () => {
  it("round-trips a value through its range", () => {
    expect(normalize(75, 0, 100)).toBe(0.75);
    expect(denormalize(0.75, 0, 100)).toBe(75);
  });

  it("clamps values outside the declared range", () => {
    expect(normalize(-10, 0, 100)).toBe(0);
    expect(normalize(200, 0, 100)).toBe(1);
  });

  it("degrades a zero-width range to the start rather than dividing by zero", () => {
    expect(normalize(5, 5, 5)).toBe(0);
    expect(Number.isFinite(normalize(5, 5, 5))).toBe(true);
  });

  it("handles a negative-to-positive range symmetrically", () => {
    expect(normalize(0, -1, 1)).toBe(0.5);
    expect(denormalize(0.5, -1, 1)).toBe(0);
  });
});

describe("snap", () => {
  it("rounds to the nearest step from the range minimum", () => {
    expect(snap(23, 10, 0)).toBe(20);
    expect(snap(27, 10, 0)).toBe(30);
  });

  it("respects a non-zero minimum as the snap origin", () => {
    // Steps count from where the range starts, not from zero — a knob
    // running 5..25 in steps of 5 should land on 10, not on 8.
    expect(snap(12, 5, 5)).toBe(10);
  });

  it("passes the value through unchanged when there is no step", () => {
    expect(snap(23.4, undefined, 0)).toBe(23.4);
    expect(snap(23.4, 0, 0)).toBe(23.4);
  });
});

describe("knobAngle", () => {
  it("starts and ends on the documented 270° sweep", () => {
    expect(knobAngle(0)).toBe(KNOB_START_DEG);
    expect(knobAngle(1)).toBe(KNOB_END_DEG);
    expect(KNOB_END_DEG - KNOB_START_DEG).toBe(270);
  });

  it("points straight down at the midpoint", () => {
    // 90° in SVG's clockwise-from-3-o'clock convention is straight down —
    // matching every knob in the catalogue, which sits at 12 o'clock only
    // at its centre value, not at rest.
    expect(knobAngle(0.5)).toBe(270);
  });

  it("clamps a position outside 0..1", () => {
    expect(knobAngle(-0.5)).toBe(KNOB_START_DEG);
    expect(knobAngle(1.5)).toBe(KNOB_END_DEG);
  });
});

describe("polarToCartesian", () => {
  it("places 0° at three o'clock", () => {
    const point = polarToCartesian(0, 0, 10, 0);
    expect(point.x).toBeCloseTo(10);
    expect(point.y).toBeCloseTo(0);
  });

  it("places 90° straight down, not up", () => {
    // SVG y grows downward, so this is the convention check that matters —
    // getting it backwards would draw every knob pointer upside down.
    const point = polarToCartesian(0, 0, 10, 90);
    expect(point.x).toBeCloseTo(0);
    expect(point.y).toBeCloseTo(10);
  });

  it("respects the centre offset", () => {
    const point = polarToCartesian(50, 50, 10, 0);
    expect(point.x).toBeCloseTo(60);
    expect(point.y).toBeCloseTo(50);
  });
});

describe("describeArc", () => {
  it("starts and ends the path at the swept angles", () => {
    const d = describeArc(0, 0, 10, 0, 90);
    expect(d.startsWith("M 10 0")).toBe(true);
    expect(d).toContain("0 0 1");
  });

  it("never sets the large-arc flag for a knob's 270° sweep", () => {
    // Every real call site sweeps at most 270°, which is more than half a
    // circle — worth pinning that the flag *does* flip for a genuine
    // majority-circle sweep, since a hardcoded 0 would draw the short way
    // around and look like a stuck knob.
    const short = describeArc(0, 0, 10, 0, 90);
    expect(short).toContain(" 0 1 ");
    const long = describeArc(0, 0, 10, 0, 270);
    expect(long).toContain(" 1 1 ");
  });

  it("flips the sweep flag for a counter-clockwise arc", () => {
    const forward = describeArc(0, 0, 10, 0, 90);
    const backward = describeArc(0, 0, 10, 90, 0);
    expect(forward).toContain(" 0 1 ");
    expect(backward).toContain(" 0 0 ");
  });
});

describe("tickAngles", () => {
  it("places count ticks evenly across the sweep, one at each end", () => {
    const ticks = tickAngles(11);
    expect(ticks).toHaveLength(11);
    expect(ticks[0]).toBe(KNOB_START_DEG);
    expect(ticks[10]).toBe(KNOB_END_DEG);
  });

  it("spaces ticks evenly, not just correctly at the ends", () => {
    const ticks = tickAngles(3);
    const gap1 = ticks[1] - ticks[0];
    const gap2 = ticks[2] - ticks[1];
    expect(gap1).toBeCloseTo(gap2);
  });

  it("degrades to a single tick at the start rather than dividing by zero", () => {
    expect(tickAngles(1)).toEqual([KNOB_START_DEG]);
    expect(tickAngles(0)).toEqual([KNOB_START_DEG]);
  });
});

describe("sliderPosition", () => {
  it("runs from 0 to the track length", () => {
    expect(sliderPosition(0, 100, false)).toBe(0);
    expect(sliderPosition(1, 100, false)).toBe(100);
    expect(sliderPosition(0.5, 100, false)).toBe(50);
  });

  it("inverts for a vertical fader, where max is at the top", () => {
    // A physical fader's handle sits at track-length (the bottom) when the
    // value is at minimum, and at 0 (the top) at maximum.
    expect(sliderPosition(0, 100, true)).toBe(100);
    expect(sliderPosition(1, 100, true)).toBe(0);
  });

  it("clamps a position outside 0..1", () => {
    expect(sliderPosition(-1, 100, false)).toBe(0);
    expect(sliderPosition(2, 100, false)).toBe(100);
  });
});

describe("stepBy", () => {
  it("moves by the declared step in either direction", () => {
    expect(stepBy(10, 1, 5, 0, 100)).toBe(15);
    expect(stepBy(10, -1, 5, 0, 100)).toBe(5);
  });

  it("moves by 1 when no step is declared", () => {
    // A stepper with no declared step still has to do something on every
    // click — falling through to 0 would make the + button inert.
    expect(stepBy(10, 1, undefined, 0, 100)).toBe(11);
    expect(stepBy(10, 1, 0, 0, 100)).toBe(11);
  });

  it("clamps at both ends of the range", () => {
    expect(stepBy(98, 1, 5, 0, 100)).toBe(100);
    expect(stepBy(2, -1, 5, 0, 100)).toBe(0);
  });
});

describe("stepperStep", () => {
  it("calls onChange with the stepped, clamped value", () => {
    const calls: number[] = [];
    const props = { value: 10, min: 0, max: 20, step: 5, onChange: (v: number) => calls.push(v) };
    stepperStep(props, 1);
    stepperStep(props, -1);
    expect(calls).toEqual([15, 5]);
  });

  it("does not call onChange more than once per press", () => {
    const calls: number[] = [];
    stepperStep({ value: 0, min: 0, max: 10, onChange: (v) => calls.push(v) }, 1);
    expect(calls).toHaveLength(1);
  });
});

describe("dragDeltaToValue", () => {
  it("increases the value when dragging up (negative pixel delta)", () => {
    const result = dragDeltaToValue(50, -75, 0, 100, 150);
    expect(result).toBeGreaterThan(50);
    expect(result).toBeCloseTo(100); // half the sensitivity, half the range
  });

  it("decreases the value when dragging down", () => {
    const result = dragDeltaToValue(50, 75, 0, 100, 150);
    expect(result).toBeLessThan(50);
    expect(result).toBeCloseTo(0);
  });

  it("clamps at both ends of the range", () => {
    expect(dragDeltaToValue(90, -1000, 0, 100)).toBe(100);
    expect(dragDeltaToValue(10, 1000, 0, 100)).toBe(0);
  });

  it("scales with sensitivity: a shorter sensitivity is a touchier control", () => {
    const touchy = dragDeltaToValue(50, -10, 0, 100, 50);
    const relaxed = dragDeltaToValue(50, -10, 0, 100, 500);
    expect(touchy).toBeGreaterThan(relaxed);
  });

  it("is a no-op for a zero-pixel drag", () => {
    expect(dragDeltaToValue(42, 0, 0, 100)).toBe(42);
  });
});
