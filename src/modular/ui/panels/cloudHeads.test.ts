import { describe, expect, it, vi } from "vitest";
import type { GrainCloud } from "../../audio/wasm/grainJobs";
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

describe("The cloud animator", () => {
  // A stand-in 2D context: what was cleared and every dot drawn, in its colour.
  const context = () => {
    const calls: string[] = [];
    const dots: { x: number; y: number; r: number; colour: string }[] = [];
    let fillStyle = "";
    const c = {
      set fillStyle(value: string) { fillStyle = value; },
      clearRect: (x: number, y: number, w: number, h: number) => calls.push(`clear ${x} ${y} ${w} ${h}`),
      beginPath: () => calls.push("begin"),
      arc: (x: number, y: number, r: number) => dots.push({ x, y, r, colour: fillStyle }),
      fill: () => calls.push("fill"),
    };
    return { c: c as unknown as CanvasRenderingContext2D, calls, dots };
  };
  const canvasOf = (dataset: Record<string, string>, c?: CanvasRenderingContext2D | null) => ({
    dataset: { ...dataset } as Record<string, string | undefined>,
    width: 200,
    height: 120,
    ...(c === undefined ? {} : { getContext: () => c }),
  });
  // One grain at the head, in tune: out 24 000, source 12 000, size 2 400, pitch 2, brightness 0.25.
  const cloud: GrainCloud = {
    total: 1_000,
    count: 1,
    grains: new Float32Array([0, 24_000, 12_000, 2_400, 2, 0, 0.25]),
    sampleRate: 48_000,
    frames: 48_000,
  };
  const rootOf = (by: Record<string, unknown[]>) => ({ querySelectorAll: (selector: string) => (by[selector] ?? []) as never });

  it("runs a frame at a time once started, and cancels the frame it asked for when stopped", () => {
    const pending: FrameRequestCallback[] = [];
    let cancelled = -1;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => pending.push(callback));
    vi.stubGlobal("cancelAnimationFrame", (id: number) => { cancelled = id; });
    try {
      let ticks = 0;
      const animator = new CloudAnimator(() => { ticks += 1; return null; }, () => ({ report: null }));
      animator.start();
      expect(ticks).toBe(0);
      pending.shift()!(0);
      expect(ticks).toBe(1);
      // The frame asked for again: the second request.
      expect(pending).toHaveLength(1);
      animator.stop();
      expect(cancelled).toBe(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("does nothing while its root is not mounted", () => {
    const source = vi.fn(() => ({ report: null }));
    new CloudAnimator(() => null, source).tick();
    expect(source).not.toHaveBeenCalled();
  });

  it("holds a silent pad at its start, and counts the grains of a cloud it has", () => {
    const pad = element({ cloudStart: "0.25", cloudScan: "1", cloudW: "100" });
    const read = element({ cloudRead: "g", cloudStart: "0.5", cloudScan: "1", cloudSeconds: "4" });
    const unnamed = element({ cloudStart: "0", cloudScan: "1", cloudSeconds: "4" });
    const clouds = vi.fn((id: string) => (id === "g" ? cloud : undefined));
    const root = rootOf({ "[data-cloud-node]": [pad], "[data-cloud-read]": [read, unnamed] });
    new CloudAnimator(() => root, () => ({ report: null }), clouds).tick();
    expect(pad.dataset.cloudPlayed).toBe("0");
    expect(pad.styles.get("--cloud-head")).toBe("25px");
    expect(read.textContent).toBe("1,000 grains · head 2.00s");
    expect(unnamed.textContent).toBe("no cloud — raise Density or Layers");
    expect(clouds).toHaveBeenCalledWith("");
  });

  it("draws every grain of the cloud on its canvas, brightest where the engine is reading", () => {
    const drawn = context();
    const canvas = canvasOf({ cloudCanvas: "g", cloudPitch: "2", cloudSemis: "10", cloudRatio: "1" }, drawn.c);
    const root = rootOf({ "[data-cloud-canvas]": [canvas] });
    new CloudAnimator(() => root, () => ({ report: { quanta: 1, heads: { g: 0.5 } } }), () => cloud).tick();
    expect(drawn.calls).toEqual(["clear 0 0 200 120", "begin", "fill"]);
    const view = { w: 200, h: 120, frames: 48_000, sampleRate: 48_000, pitch: 2, semis: 10, playFrame: 24_000 };
    const expected = grainDot({ out: 24_000, src: 12_000, size: 2_400, pitch: 2, bright: 0.25 }, view);
    expect(drawn.dots).toEqual([expected]);
  });

  it("draws a silent cloud as though at its first frame", () => {
    const drawn = context();
    const canvas = canvasOf({ cloudCanvas: "g", cloudPitch: "2", cloudSemis: "10", cloudRatio: "1" }, drawn.c);
    new CloudAnimator(() => rootOf({ "[data-cloud-canvas]": [canvas] }), () => ({ report: { quanta: 1 } }), () => cloud).tick();
    const view = { w: 200, h: 120, frames: 48_000, sampleRate: 48_000, pitch: 2, semis: 10, playFrame: 0 };
    expect(drawn.dots).toEqual([grainDot({ out: 24_000, src: 12_000, size: 2_400, pitch: 2, bright: 0.25 }, view)]);
  });

  it("draws a canvas that names no node with the cloud of none", () => {
    const drawn = context();
    const canvas = canvasOf({ cloudPitch: "2", cloudSemis: "10", cloudRatio: "1" }, drawn.c);
    const clouds = vi.fn(() => cloud);
    new CloudAnimator(() => rootOf({ "[data-cloud-canvas]": [canvas] }), () => ({ report: { quanta: 1, heads: { "": 0.5 } } }), clouds).tick();
    expect(clouds).toHaveBeenCalledWith("");
    const view = { w: 200, h: 120, frames: 48_000, sampleRate: 48_000, pitch: 2, semis: 10, playFrame: 24_000 };
    expect(drawn.dots).toEqual([grainDot({ out: 24_000, src: 12_000, size: 2_400, pitch: 2, bright: 0.25 }, view)]);
  });

  it("clears the canvas and draws nothing when there is no cloud or it is empty, and skips a canvas it cannot draw on", () => {
    const empty = context();
    const missing = context();
    const clouds = (id: string) => (id === "empty" ? { ...cloud, count: 0 } : undefined);
    const root = rootOf({
      "[data-cloud-canvas]": [
        canvasOf({ cloudCanvas: "empty" }, empty.c),
        canvasOf({}, missing.c),
        canvasOf({ cloudCanvas: "empty" }, null),
        canvasOf({ cloudCanvas: "empty" }),
      ],
    });
    new CloudAnimator(() => root, () => ({ report: null }), clouds).tick();
    expect(empty.calls).toEqual(["clear 0 0 200 120"]);
    expect(missing.calls).toEqual(["clear 0 0 200 120"]);
    expect(empty.dots).toEqual([]);
  });
});
