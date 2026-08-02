import { describe, expect, it } from "vitest";
import { conductorControlTone, classicConductorLayout } from "./conductorappearance";

describe("classic conductor appearance", () => {
  it("uses the color-reference roles for transport controls", () => {
    expect(conductorControlTone("start")).toBe("start");
    expect(conductorControlTone("stop")).toBe("stop");
    expect(conductorControlTone("pause")).toBe("pause");
    expect(conductorControlTone("sync")).toBe("sync");
    expect(conductorControlTone("movie")).toBe("movie");
    expect(conductorControlTone("sequence")).toBe("sequence");
  });

  it("keeps every lower control inside the reference-width strip", () => {
    const layout = classicConductorLayout();
    expect(layout.leftWidth + layout.gridWidth).toBe(layout.width);
    expect(layout.topHeight + layout.bottomHeight).toBe(layout.height);
    expect(layout.bottomColumns.reduce((sum, width) => sum + width, 0)).toBe(layout.width);
    expect(layout.bottomColumns[3]).toBeGreaterThanOrEqual(38);
    expect(layout.bottomColumns[7]).toBeGreaterThanOrEqual(40);
    expect(layout.tempoNumericalWidth).toBeGreaterThanOrEqual(43);
  });
});
