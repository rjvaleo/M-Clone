import { describe, expect, it } from "vitest";
import { CloudAnimator, cloudReadout, grainColour, grainDot, headAt } from "./cloudHeads";

const element = (dataset: Record<string, string>) => {
  const style = new Map<string, string>();
  return { dataset: { ...dataset } as Record<string, string | undefined>, style: { setProperty: (k: string, v: string) => { style.set(k, v); } }, styles: style, textContent: "" as string | null };
};

describe("The cloud pad's head", () => {
  it("sits at its start plus how far the engine has read, times Scan", () => {
    expect(headAt(0.25, 0.5, 0.4)).toBeCloseTo(0.45, 12);
    // Backwards from the end.
    expect(headAt(1, -1, 0.3)).toBeCloseTo(0.7, 12);
    // Silent: where it would start.
    expect(headAt(0.25, 1, Number.NaN)).toBe(0.25);
  });

  it("is moved from the rack's report, and tells the pad where it is", () => {
    const pad = element({ cloudNode: "g", cloudStart: "0", cloudScan: "1", cloudW: "200" });
    const read = element({ cloudRead: "g", cloudStart: "0", cloudScan: "1", cloudSeconds: "4" });
    const root = { querySelectorAll: (selector: string) => (selector === "[data-cloud-node]" ? [pad] : [read]) };
    const animator = new CloudAnimator(() => root, () => ({ report: { quanta: 1, heads: { g: 0.5 } } }));
    animator.tick();
    expect(pad.styles.get("--cloud-head")).toBe("100px");
    expect(pad.dataset.cloudPlayed).toBe("0.5");
    expect(read.textContent).toBe("no cloud — raise Density or Layers");
  });
});

describe("The cloud pad's grains, as drawCloudPad draws them", () => {
  const view = { w: 200, h: 120, frames: 48_000, sampleRate: 48_000, pitch: 2, semis: 10, playFrame: 24_000 };

  it("sit at the middle of what each reads, by its pitch from the cloud's", () => {
    const dot = grainDot({ out: 24_000, src: 12_000, size: 2_400, pitch: 2, bright: 0.1 }, view);
    // A grain two semitones up reads 2^(2/12) as far.
    expect(dot.x).toBeCloseTo(((12_000 + (2_400 * Math.pow(2, 2 / 12)) / 2) / 48_000) * 200, 9);
    expect(dot.y).toBe(60);
    expect(dot.r).toBeCloseTo(0.6 + 0.4, 9);
    // Sounding now: the brightest it gets.
    const alpha = (colour: string) => Number(/\/ ([\d.]+)\)$/.exec(colour)![1]);
    expect(alpha(dot.colour)).toBeCloseTo(0.8, 12);
    const later = grainDot({ out: 24_000 + 48_000 * 3, src: 0, size: 48_000, pitch: 12, bright: 0 }, view);
    expect(alpha(later.colour)).toBeCloseTo(0.08, 12);
    expect(later.r).toBeCloseTo(1.7, 9);
  });

  it("are coloured by MultiGrainLive's grainColour", () => {
    // In tune and of middling brightness is the neutral point of its scale.
    expect(grainColour(0, 0.1, 0.5)).toBe("oklch(66% 0.1 30 / 0.5)");
    const t = Math.max(-1, Math.min(1, (0.8 - 0.4) * 1.4));
    expect(grainColour(0, 0.2, 1)).toBe(`oklch(${66 + t * 14}% ${0.1 + t * 0.16} ${30 - t * 10} / 1)`);
  });

  it("are counted under the pad", () => {
    expect(cloudReadout(123_456, 1.234)).toBe("123,456 grains · head 1.23s");
    expect(cloudReadout(0, 1)).toBe("no cloud — raise Density or Layers");
  });
});
