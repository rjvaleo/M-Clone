import { describe, expect, it } from "vitest";
import { dragEnvelope, envelopeGeometry, nearestHandle, type Adsr } from "./envelope";

const env: Adsr = { attack: 1000, decay: 1000, sustain: 0.5, release: 2000 };
const box = { width: 100, height: 40 };
const limits = { attack: 4000, decay: 4000, release: 8000 };

describe("an envelope drawn as VOSM draws one", () => {
  it("gives each time a quarter of the width, on a square-root scale, and the hold a fixed quarter", () => {
    const g = envelopeGeometry(env, box, limits);
    expect(g.start).toEqual({ x: 0, y: 40 });
    expect(g.peak).toEqual({ x: 12.5, y: 0 });         // sqrt(1/4) of 25
    expect(g.decay).toEqual({ x: 25, y: 20 });          // + sqrt(1/4) of 25, at half height
    expect(g.hold).toEqual({ x: 50, y: 20 });           // the sustain holds for a quarter
    expect(g.end).toEqual({ x: 62.5, y: 40 });          // + sqrt(2/8) of 25
  });

  it("picks the handle nearest the pointer", () => {
    const g = envelopeGeometry(env, box, limits);
    expect(nearestHandle(g, 13, 2)).toBe("attack");
    expect(nearestHandle(g, 26, 22)).toBe("decay");
    expect(nearestHandle(g, 60, 38)).toBe("release");
  });

  it("drags the peak sideways for attack, the knee for decay and sustain, the end for release", () => {
    const g = envelopeGeometry(env, box, limits);
    expect(dragEnvelope(env, "attack", 25, 10, g, box, limits).attack).toBe(4000);
    expect(dragEnvelope(env, "attack", -5, 10, g, box, limits).attack).toBe(0);
    const knee = dragEnvelope(env, "decay", 12.5 + 25, 10, g, box, limits);
    expect(knee.decay).toBe(4000);
    expect(knee.sustain).toBe(0.75);
    expect(dragEnvelope(env, "release", 50 + 12.5, 0, g, box, limits).release).toBe(2000);
    expect(dragEnvelope(env, "decay", 30, 99, g, box, limits).sustain).toBe(0);
  });
});
