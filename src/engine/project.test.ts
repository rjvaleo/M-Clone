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
  it("stores a detached Cyclic Random copy with a generation counter", () => {
    const p = createDefaultPattern("x", true);
    expect(p.scrambledSteps).toHaveLength(p.steps.length);
    expect(p.scrambleGeneration).toBe(0);
    expect(p.scrambledSteps).not.toBe(p.steps);
    expect(p.scrambledSteps[0]).not.toBe(p.steps[0]);
    expect(p.scrambledSteps.flatMap((s) => s.pitches).sort((a, b) => a - b))
      .toEqual(p.steps.flatMap((s) => s.pitches).sort((a, b) => a - b));
    expect(p.scrambledSteps.slice(0, p.outputLength))
      .not.toEqual(p.steps.slice(0, p.outputLength));
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
  it("starts every Voice at Phase zero", () => {
    expect(createDefaultVoice(2).phase).toBe(0);
  });
});

describe("createDefaultProject", () => {
  it("has the right shape", () => {
    const p = createDefaultProject();
    expect(p.patterns).toHaveLength(PATTERN_COUNT);
    expect(p.voices).toHaveLength(VOICE_COUNT);
    expect(p.tempo).toBe(120);
    expect(p.scale).toBe("major");
    expect(p.voices[0].noteOrderMix).toEqual({
      original: 100,
      cyclic: 0,
      utterly: 0,
    });
  });
  it("gives each voice a distinct channel", () => {
    const channels = createDefaultProject().voices.map((v) => v.channel);
    expect(new Set(channels).size).toBe(VOICE_COUNT);
  });
  it("routes each Voice to its matching output channel by default", () => {
    expect(createDefaultProject().voices.map((v) => v.outputChannels))
      .toEqual([[1], [2], [3], [4]]);
  });
  it("creates neutral 16-step cyclic variables for every voice", () => {
    const p = createDefaultProject();
    expect(p.cyclic.accent).toHaveLength(VOICE_COUNT);
    expect(p.cyclic.legato).toHaveLength(VOICE_COUNT);
    expect(p.cyclic.rhythm).toHaveLength(VOICE_COUNT);
    expect(p.cyclic.accent[0]).toEqual(Array(STEP_COUNT).fill(2));
    expect(p.cyclic.legato[3]).toEqual(Array(STEP_COUNT).fill(2));
    expect(p.cyclic.rhythm[1]).toEqual(Array(STEP_COUNT).fill(2));
    expect(p.cyclicLengths).toEqual({
      accent: [16, 16, 16, 16],
      legato: [16, 16, 16, 16],
      rhythm: [16, 16, 16, 16],
    });
    expect(p.cyclicValues).toEqual({
      legato: [6, 25, 50, 75, 100],
      rhythm: [1, 1, 1.5, 2, 5],
    });
    expect(p.voices.every((voice) => voice.legato === 1)).toBe(true);
  });
});
