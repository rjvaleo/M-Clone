import { describe, expect, it } from "vitest";
import { grainFace } from "./grainCabinet";
import { panelFor, panelForNode } from "./index";

describe("The panel a module is drawn with now", () => {
  it("rebuilds the Grain Engine's for its engine and switches", () => {
    const parameters = { engine: "Hybrid", cloud: true };
    // As data: each build makes its own reading functions.
    const plain = (value: unknown) => JSON.parse(JSON.stringify(value));
    expect(plain(panelForNode({ moduleType: "m.grain-engine", parameters }))).toEqual(plain(grainFace(parameters)));
    // Its own banks, not the defaults' fixed panel.
    expect(panelForNode({ moduleType: "m.grain-engine", parameters })!.controls.some((c) => c.param === "tone")).toBe(true);
    expect(panelFor("m.grain-engine")!.controls.some((c) => c.param === "tone")).toBe(false);
  });

  it("gives every other module its fixed panel, and a module with none nothing", () => {
    expect(panelForNode({ moduleType: "m.prism-leslie", parameters: {} })).toBe(panelFor("m.prism-leslie"));
    expect(panelForNode({ moduleType: "m.nothing", parameters: {} })).toBeUndefined();
  });
});
