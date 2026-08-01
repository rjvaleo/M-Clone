import { describe, expect, it } from "vitest";
import {
  cycleChordMode,
  cycleInputUse,
  cycleInsertMode,
  cycleSourceChannel,
} from "./patternwindow";

describe("Patterns Window picture controls", () => {
  it("cycles Source through All and the sixteen M Input Channels", () => {
    expect(cycleSourceChannel("all")).toBe(1);
    expect(cycleSourceChannel(7)).toBe(8);
    expect(cycleSourceChannel(16)).toBe("all");
  });

  it("cycles the Use picture between disabled and record", () => {
    expect(cycleInputUse("disabled")).toBe("record");
    expect(cycleInputUse("record")).toBe("disabled");
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
