import type { ProjectState } from "./types";

export const PATTERNS_PER_GROUP = 4;
export const PATTERN_GROUP_COUNT = 6;

export function applyPatternGroup(project: ProjectState, group: number): ProjectState {
  const normalized = Math.max(0, Math.min(PATTERN_GROUP_COUNT - 1, Math.trunc(group)));
  return {
    ...project,
    voices: project.voices.map((voice, index) => {
      const patternIndex = normalized * PATTERNS_PER_GROUP + index;
      const pattern = project.patterns[patternIndex];
      return {
        ...voice,
        patternIndex,
        timeBaseNumerator: pattern?.timeBaseNumerator ?? voice.timeBaseNumerator,
        timeBaseDenominator: pattern?.timeBaseDenominator ?? voice.timeBaseDenominator,
        phase: pattern?.phase ?? voice.phase,
      };
    }),
  };
}
