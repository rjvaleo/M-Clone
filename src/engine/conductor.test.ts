// Conducting primitives, written first against chapters 8 and 15 of the M 2.7
// manual. The UI and store both consume these functions so direction and edge
// behavior have one tested definition.

import { describe, expect, it } from "vitest";
import {
  axisValue,
  clampBaton,
  conductedTempo,
  continuousLegato,
  continuousVelocityRange,
  normalizeTempoRange,
  positionFromBaton,
  robotMove,
} from "./conductor";

describe("the Conducting Grid", () => {
  it("clamps the Baton to the Grid", () => {
    expect(clampBaton({ x: -1, y: 2 })).toEqual({ x: 0, y: 1 });
    expect(clampBaton({ x: 0.25, y: 0.75 })).toEqual({ x: 0.25, y: 0.75 });
  });

  // "If a Conducting Arrow is pointing towards the right ... Positions will
  // be conducted from left to right." Up runs bottom to top.
  it("reads and reverses the axis named by a Conducting Arrow", () => {
    const point = { x: 0.2, y: 0.7 };
    expect(axisValue(point, "right")).toBeCloseTo(0.2);
    expect(axisValue(point, "left")).toBeCloseTo(0.8);
    expect(axisValue(point, "down")).toBeCloseTo(0.7);
    expect(axisValue(point, "up")).toBeCloseTo(0.3);
  });

  it("maps the Grid to the six Variable Positions including both edges", () => {
    expect(positionFromBaton({ x: 0, y: 0 }, "right")).toBe(0);
    expect(positionFromBaton({ x: 0.999, y: 0 }, "right")).toBe(5);
    expect(positionFromBaton({ x: 1, y: 0 }, "right")).toBe(5);
    expect(positionFromBaton({ x: 0, y: 1 }, "up")).toBe(0);
    expect(positionFromBaton({ x: 0, y: 0 }, "up")).toBe(5);
  });
});

describe("conducting Tempo", () => {
  it("normalizes, orders, rounds, and clamps a tempo range", () => {
    expect(normalizeTempoRange(210.4, 39.5)).toEqual({ low: 40, high: 210 });
    expect(normalizeTempoRange(-10, 999)).toEqual({ low: 40, high: 240 });
  });

  // "After setting the tempo range, the midpoint becomes the new tempo."
  it("interpolates the current tempo within the range", () => {
    const range = { low: 80, high: 160 };
    expect(conductedTempo(range, 0)).toBe(80);
    expect(conductedTempo(range, 0.5)).toBe(120);
    expect(conductedTempo(range, 1)).toBe(160);
  });
});

describe("the Automatic Conductor", () => {
  // Movement Range controls "set the range of possible movement for one jump"
  // while the Baton itself can never leave the Grid.
  it("scales a signed jump by each movement range and clamps the result", () => {
    const moved = robotMove(
      { x: 0.5, y: 0.5 },
      { x: 1, y: -1 },
      { x: 0.2, y: 0.4 },
    );
    expect(moved.x).toBeCloseTo(0.7);
    expect(moved.y).toBeCloseTo(0.1);
    expect(robotMove(
      { x: 0.9, y: 0.1 },
      { x: 1, y: -1 },
      { x: 1, y: 1 },
    )).toEqual({ x: 1, y: 0 });
  });
});

describe("Continuous Conducting", () => {
  it("slides a Velocity Range without changing its width", () => {
    expect(continuousVelocityRange({ low: 48, high: 110 }, 0)).toEqual({ low: 0, high: 62 });
    expect(continuousVelocityRange({ low: 48, high: 110 }, 1)).toEqual({ low: 65, high: 127 });
  });

  it("scales Legato from one quarter through four times its current value", () => {
    expect(continuousLegato(0)).toBeCloseTo(0.25);
    expect(continuousLegato(0.5)).toBeCloseTo(1);
    expect(continuousLegato(1)).toBeCloseTo(4);
  });
});
