import { describe, expect, it } from "vitest";
import { cells, knob, toggle } from "./grid";

describe("A dimmed control the original drew", () => {
  const box = { x: 0, y: 0, w: 98, h: 40 };

  it("draws a dimmed dial as a circle at the top of its cell, and names it by its label", () => {
    const placed = cells(box, [[knob("tempo", "Tempo", { inert: "no tempo here" }), knob("rate", "Rate")]]);
    expect(placed.inert).toEqual([{ label: "Tempo", kind: "knob", why: "no tempo here", x: 4, y: 0, w: 40, h: 40 }]);
    expect(placed.controls.map((c) => c.param)).toEqual(["rate"]);
  });

  it("draws a dimmed switch the size of its cell, and names a cell with no label by its parameter", () => {
    const placed = cells(box, [[{ param: "lock", kind: "switch", inert: "fixed" }, toggle("on", "On")]]);
    expect(placed.inert).toEqual([{ label: "lock", kind: "switch", why: "fixed", x: 0, y: 0, w: 48, h: 40 }]);
  });

  it("draws a dimmed dial with no room as its whole cell", () => {
    const placed = cells({ x: 0, y: 0, w: 0, h: 40 }, [[knob("tempo", "Tempo", { inert: "no room" })]]);
    expect(placed.inert[0]).toMatchObject({ x: 0, y: 0, w: 0, h: 40 });
  });
});
