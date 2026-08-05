import { describe, expect, it } from "vitest";
import {
  clamp,
  denormalize,
  describeArc,
  dragDeltaToValue,
  envelopePath,
  envelopePoints,
  knobAngle,
  meterSegments,
  polylinePath,
  waveformPath,
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

describe("polylinePath", () => {
  it("draws a move followed by a line per remaining point", () => {
    expect(polylinePath([{ x: 0, y: 1 }, { x: 2, y: 3 }, { x: 4, y: 5 }])).toBe("M 0 1 L 2 3 L 4 5");
  });

  it("draws a bare move for a single point", () => {
    expect(polylinePath([{ x: 7, y: 8 }])).toBe("M 7 8");
  });

  it("draws nothing at all for no points", () => {
    expect(polylinePath([])).toBe("");
  });
});

describe("envelopePoints", () => {
  const env = { attack: 1, decay: 1, sustain: 0.5, release: 1 };

  it("returns the five corners of an ADSR shape", () => {
    const points = envelopePoints(env, 100, 40);
    expect(points).toHaveLength(5);
  });

  it("splits the non-held width evenly when the three times are equal", () => {
    // 22% of the width is the sustain hold; the remaining 78 splits three ways.
    const [start, peak, sustainIn, sustainOut, end] = envelopePoints(env, 100, 40);
    expect(start).toEqual({ x: 0, y: 40 });
    expect(peak).toEqual({ x: 26, y: 0 });
    expect(sustainIn).toEqual({ x: 52, y: 20 });
    expect(sustainOut).toEqual({ x: 74, y: 20 });
    expect(end).toEqual({ x: 100, y: 40 });
  });

  it("always ends at the full width and the baseline", () => {
    const end = envelopePoints({ attack: 0.1, decay: 0.9, sustain: 0.3, release: 0.4 }, 200, 60)[4];
    expect(end.x).toBeCloseTo(200);
    expect(end.y).toBe(60);
  });

  it("puts the sustain segment on the baseline at zero sustain", () => {
    const points = envelopePoints({ ...env, sustain: 0 }, 100, 40);
    expect(points[2].y).toBe(40);
    expect(points[3].y).toBe(40);
  });

  it("puts the sustain segment at the peak when sustain is full", () => {
    const points = envelopePoints({ ...env, sustain: 1 }, 100, 40);
    expect(points[2].y).toBe(0);
    expect(points[3].y).toBe(0);
  });

  it("gives each stage an equal share when all three times are zero", () => {
    // A degenerate envelope still has to draw something recognisable rather
    // than collapsing every stage onto x=0 and showing a vertical spike.
    const points = envelopePoints({ attack: 0, decay: 0, sustain: 0.5, release: 0 }, 100, 40);
    expect(points[1].x).toBeCloseTo(26);
    expect(points[2].x).toBeCloseTo(52);
  });

  it("gives a longer stage more width than a shorter one", () => {
    const points = envelopePoints({ attack: 3, decay: 1, sustain: 0.5, release: 1 }, 100, 40);
    const attackWidth = points[1].x;
    const decayWidth = points[2].x - points[1].x;
    expect(attackWidth).toBeGreaterThan(decayWidth);
  });

  it("clamps a negative or over-unit stage into range", () => {
    const points = envelopePoints({ attack: -5, decay: 1, sustain: 4, release: 1 }, 100, 40);
    expect(points[1].x).toBe(0);
    expect(points[2].y).toBe(0);
  });
});

describe("envelopePath", () => {
  it("is the polyline through the envelope's own points", () => {
    const env = { attack: 1, decay: 1, sustain: 0.5, release: 1 };
    expect(envelopePath(env, 100, 40)).toBe(polylinePath(envelopePoints(env, 100, 40)));
  });
});

describe("waveformPath", () => {
  it("mirrors the peaks around the vertical centre and closes the shape", () => {
    expect(waveformPath([1, 0, 1], 100, 40)).toBe("M 0 0 L 50 20 L 100 0 L 100 40 L 50 20 L 0 40 Z");
  });

  it("spans the full width, first peak to last", () => {
    const path = waveformPath([0.5, 0.5, 0.5, 0.5], 80, 20);
    expect(path.startsWith("M 0 ")).toBe(true);
    expect(path).toContain("L 80 ");
  });

  it("clamps out-of-range peak data inside the box", () => {
    // A peak extractor handing back 1.4 must not draw above the top edge.
    const path = waveformPath([1.4], 100, 40);
    expect(path).not.toContain("-");
    expect(waveformPath([1.4, 1.4], 100, 40)).toBe("M 0 0 L 100 0 L 100 40 L 0 40 Z");
  });

  it("treats a negative peak as its magnitude", () => {
    expect(waveformPath([-1, -1], 100, 40)).toBe(waveformPath([1, 1], 100, 40));
  });

  it("draws nothing from fewer than two peaks", () => {
    // One sample is not a waveform; drawing a spike from it would be a lie.
    expect(waveformPath([], 100, 40)).toBe("");
    expect(waveformPath([0.5], 100, 40)).toBe("");
  });
});

describe("meterSegments", () => {
  it("lights every segment at full scale and none at silence", () => {
    expect(meterSegments(1, 8)).toBe(8);
    expect(meterSegments(0, 8)).toBe(0);
  });

  it("lights a segment as soon as there is any signal at all", () => {
    // Hardware meters tick their first segment on the faintest signal rather
    // than waiting for it to round up — a meter reading zero on audible
    // output looks broken.
    expect(meterSegments(0.001, 8)).toBe(1);
  });

  it("lights half the segments at half scale", () => {
    expect(meterSegments(0.5, 8)).toBe(4);
  });

  it("clamps out-of-range levels", () => {
    expect(meterSegments(2, 8)).toBe(8);
    expect(meterSegments(-1, 8)).toBe(0);
  });

  it("returns nothing lit for a meter with no segments", () => {
    expect(meterSegments(1, 0)).toBe(0);
    expect(meterSegments(1, -4)).toBe(0);
  });
});
