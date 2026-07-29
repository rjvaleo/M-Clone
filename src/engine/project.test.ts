import { describe, it, expect } from "vitest";
import {
  createDefaultProject,
  createDefaultPattern,
  createDefaultVoice,
  STEP_COUNT,
  VOICE_COUNT,
  PATTERN_COUNT,
} from "./project";

describe("createDefaultPattern", () => {
  it("makes an empty pattern of STEP_COUNT steps", () => {
    const p = createDefaultPattern("x");
    expect(p.steps).toHaveLength(STEP_COUNT);
    expect(p.steps.every((s) => s.pitches.length === 0)).toBe(true);
    expect(p.outputLength).toBe(STEP_COUNT);
  });
  it("seeds a riff when asked", () => {
    const p = createDefaultPattern("x", true);
    expect(p.steps[0].pitches).toEqual([60]);
    expect(p.outputLength).toBeGreaterThan(0);
    expect(p.outputLength).toBeLessThanOrEqual(STEP_COUNT);
  });
});

describe("createDefaultVoice", () => {
  it("assigns channel = index + 1", () => {
    expect(createDefaultVoice(0).channel).toBe(1);
    expect(createDefaultVoice(3).channel).toBe(4);
  });
  it("enables only the first voice by default", () => {
    expect(createDefaultVoice(0).playEnabled).toBe(true);
    expect(createDefaultVoice(1).playEnabled).toBe(false);
  });
});

describe("createDefaultProject", () => {
  it("has the right shape", () => {
    const p = createDefaultProject();
    expect(p.patterns).toHaveLength(PATTERN_COUNT);
    expect(p.voices).toHaveLength(VOICE_COUNT);
    expect(p.tempo).toBe(120);
    expect(p.scale).toBe("major");
  });
  it("gives each voice a distinct channel", () => {
    const channels = createDefaultProject().voices.map((v) => v.channel);
    expect(new Set(channels).size).toBe(VOICE_COUNT);
  });
});
