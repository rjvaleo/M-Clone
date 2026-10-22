import { describe, expect, it } from "vitest";
import { CLASSIC_WINDOW_SIZES, classicWindowSize, variableEditorWindow } from "./classicWindows";

describe("Classic window geometry", () => {
  it("uses the original's content sizes, in points", () => {
    expect(CLASSIC_WINDOW_SIZES.patterns).toEqual({ width: 216, height: 104 });
    expect(CLASSIC_WINDOW_SIZES.conducting).toEqual({ width: 226, height: 104 });
    expect(CLASSIC_WINDOW_SIZES.snapshot).toEqual({ width: 57, height: 315 });
    expect(CLASSIC_WINDOW_SIZES.variables).toEqual({ width: 216, height: 158 });
    expect(CLASSIC_WINDOW_SIZES.cyclicVariables).toEqual({ width: 226, height: 158 });
    expect(CLASSIC_WINDOW_SIZES.midi).toEqual({ width: 446, height: 44 });
    expect(CLASSIC_WINDOW_SIZES.cyclicEditor).toEqual({ width: 273, height: 212 });
    expect(CLASSIC_WINDOW_SIZES.timeDistortion).toEqual({ width: 245, height: 260 });
  });

  it("gives each Variable edit window its own size", () => {
    expect(variableEditorWindow("density")).toBe("noteDensity");
    expect(variableEditorWindow("velocityRange")).toBe("velocityRange");
    expect(variableEditorWindow("noteOrderMix")).toBe("noteOrder");
    expect(variableEditorWindow("transposition")).toBe("transposition");
    expect(variableEditorWindow("timeDistort")).toBe("timeDistortion");
    expect(variableEditorWindow("outputChannels")).toBe("orchestration");
  });

  it("returns the size as a style for the window body", () => {
    expect(classicWindowSize("noteDensity")).toEqual({ width: 183, height: 100 });
  });
});
