import { describe, expect, it } from "vitest";
import { cyclicEditorNote, ensureCyclicSelection } from "./cyclicselection";

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

describe("Cyclic Editor title note", () => {
  it("names the Cyclic Variable and Position being edited", () => {
    expect(cyclicEditorNote({ kind: "rhythm", position: 0 })).toBe("Rhythm a");
    expect(cyclicEditorNote({ kind: "legato", position: 4 })).toBe("Legato e");
    expect(cyclicEditorNote({ kind: "accent", position: 5 })).toBe("Accent f");
  });
});
