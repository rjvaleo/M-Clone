import { describe, expect, it } from "vitest";
import {
  TIME_BASE_DENOMINATORS,
  cycleChordMode,
  cycleInputUse,
  cycleInsertMode,
  cycleSourceChannel,
} from "./patternwindow";

describe("Patterns Window picture controls", () => {
  it("offers every numeric Time Base denominator printed in Chapter 13", () => {
    expect(TIME_BASE_DENOMINATORS).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 13, 15, 16, 24,
    ]);
  });
  it("cycles Source through All and the sixteen M Input Channels", () => {
    expect(cycleSourceChannel("all")).toBe(1);
    expect(cycleSourceChannel(7)).toBe(8);
    expect(cycleSourceChannel(16)).toBe("all");
  });

  it("cycles every live-input Use mode", () => {
    expect(cycleInputUse("disabled")).toBe("record");
    expect(cycleInputUse("record")).toBe("control");
    expect(cycleInputUse("control")).toBe("keyboard-transpose");
    expect(cycleInputUse("keyboard-transpose")).toBe("echo-map");
    expect(cycleInputUse("echo-map")).toBe("disabled");
  });

  it("cycles all three Pattern Select chord modes", () => {
    expect(cycleChordMode("single")).toBe("chord");
    expect(cycleChordMode("chord")).toBe("build");
    expect(cycleChordMode("build")).toBe("single");
  });

  it("cycles all three insertion modes", () => {
    expect(cycleInsertMode("insert")).toBe("replace");
    expect(cycleInsertMode("replace")).toBe("overdub");
    expect(cycleInsertMode("overdub")).toBe("insert");
  });
});
