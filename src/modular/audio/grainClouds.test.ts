import { describe, expect, it } from "vitest";
import { grainCloud, grainCloudsVersion, setGrainCloud } from "./grainClouds";

const cloud = (count: number) => ({
  total: count, count, grains: new Float32Array(count * 7), sampleRate: 48_000, frames: 1_000,
});

describe("grain clouds", () => {
  it("keeps each engine's last cloud and moves the version on every change", () => {
    const start = grainCloudsVersion();
    expect(grainCloud("g1")).toBeUndefined();
    const first = cloud(2);
    setGrainCloud("g1", first);
    expect(grainCloud("g1")).toBe(first);
    expect(grainCloudsVersion()).toBe(start + 1);
    setGrainCloud("g2", cloud(1));
    expect(grainCloud("g1")).toBe(first);
    setGrainCloud("g1", null);
    expect(grainCloud("g1")).toBeUndefined();
    expect(grainCloud("g2")?.count).toBe(1);
    expect(grainCloudsVersion()).toBe(start + 3);
  });
});
