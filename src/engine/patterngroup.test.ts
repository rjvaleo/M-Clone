import { describe, expect, it } from "vitest";
import { createDefaultProject } from "./project";
import { applyPatternGroup } from "./patterngroup";

describe("Pattern Group banks", () => {
  it("maps each of six groups to four independent Patterns and timing settings", () => {
    const project = createDefaultProject();
    project.patterns[9].timeBaseDenominator = 16;
    project.patterns[9].phase = 48;
    const grouped = applyPatternGroup(project, 2);
    expect(grouped.voices.map((voice) => voice.patternIndex)).toEqual([8, 9, 10, 11]);
    expect(grouped.voices[1]).toMatchObject({ timeBaseDenominator: 16, phase: 48 });
  });
  it("clamps the group and retains timing when a legacy bank is absent", () => {
    const project = createDefaultProject();
    project.patterns = project.patterns.slice(0, 4);
    const grouped = applyPatternGroup(project, 99);
    expect(grouped.voices[0]).toMatchObject({ patternIndex: 20, timeBaseDenominator: 8, phase: 0 });
  });
});
