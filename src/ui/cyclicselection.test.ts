import { describe, expect, it } from "vitest";
import { ensureCyclicSelection } from "./cyclicselection";

describe("Cyclic Editor selection", () => {
  it("preserves the position selected by a double-click", () => {
    expect(ensureCyclicSelection({ kind: "legato", position: 4 }, 0)).toEqual({
      kind: "legato", position: 4,
    });
  });

  it("defaults a menu-opened editor to the active Accent position", () => {
    expect(ensureCyclicSelection(null, 3)).toEqual({ kind: "accent", position: 3 });
  });
});
