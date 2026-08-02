import { describe, expect, it } from "vitest";
import { variablePositionGesture } from "./variablepositiongesture";

describe("Variable editor Position gestures", () => {
  it("edits on plain click, activates on Option, and quantizes Shift-Option", () => {
    expect(variablePositionGesture(false, false)).toEqual({ activate: false, quantized: false });
    expect(variablePositionGesture(true, false)).toEqual({ activate: true, quantized: false });
    expect(variablePositionGesture(true, true)).toEqual({ activate: true, quantized: true });
  });
});
