import { describe, expect, it } from "vitest";
import { METER_FLOOR_DB, MeterAnimator, falling, held, meterFraction, peakDb, type MeterRoot } from "./meters";

describe("A meter's scale", () => {
  it("reads a peak in dB, held to its floor", () => {
    expect(peakDb(1)).toBe(0);
    expect(peakDb(0.5)).toBeCloseTo(-6.0206, 4);
    expect(peakDb(0)).toBe(METER_FLOOR_DB);
    expect(peakDb(1e-9)).toBe(METER_FLOOR_DB);
    expect(peakDb(Number.NaN)).toBe(METER_FLOOR_DB);
  });

  it("fills from the floor to full scale, and no further", () => {
    expect(meterFraction(METER_FLOOR_DB)).toBe(0);
    expect(meterFraction(-30)).toBe(0.5);
    expect(meterFraction(0)).toBe(1);
    expect(meterFraction(6)).toBe(1);
  });
});

describe("A meter's fall", () => {
  it("falls at 20 dB a second from the last peak, to the floor", () => {
    expect(falling({ db: -10, at: 1 }, 1.5)).toBe(-20);
    expect(falling({ db: -10, at: 1 }, 10)).toBe(METER_FLOOR_DB);
  });

  it("jumps to a louder peak, and keeps falling past a quieter one", () => {
    expect(held(undefined, -12, 2)).toEqual({ db: -12, at: 2 });
    expect(held({ db: -30, at: 1 }, -12, 2)).toEqual({ db: -12, at: 2 });
    expect(held({ db: -6, at: 1 }, -40, 1.5)).toEqual({ db: -16, at: 1.5 });
  });
});

/** Just enough of an element for the animator: data, a style property, attributes. */
class FakeElement {
  readonly style = { values: new Map<string, string>(), setProperty(name: string, value: string) { this.values.set(name, value); } };
  readonly attributes = new Map<string, string>();
  constructor(readonly dataset: Record<string, string | undefined>) {}
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
}

function room(elements: FakeElement[]): MeterRoot {
  return {
    querySelectorAll: (selector: string) =>
      elements.filter((e) => (selector === "[data-level-dot]" ? e.dataset.levelDot !== undefined : e.dataset.levelSide !== undefined)) as never,
  };
}

describe("The meter animator", () => {
  const bar = (side: string) => new FakeElement({ levelNode: "n", levelSide: side });
  const dot = () => new FakeElement({
    levelNode: "n", levelDot: "", x0: "10", xw: "100", xmin: "-60", xmax: "0", y0: "0", yh: "100", ymin: "-60", ymax: "0",
  });

  it("fills each bar from its node's latest report, and lets it fall between reports", () => {
    const [input, output] = [bar("in"), bar("out")];
    let report: { quanta: number; levels?: Record<string, [number, number]> } | null = { quanta: 1, levels: { n: [1, 0.1] } };
    const animator = new MeterAnimator(() => room([input, output]), () => ({ report }));
    animator.tick(5);
    expect(input.style.values.get("--pnl-level")).toBe("1");
    expect(input.dataset.clip).toBe("on");
    expect(output.style.values.get("--pnl-level")).toBe(String(meterFraction(-20)));
    expect(output.dataset.live).toBe("on");
    // The same report again: nothing new, only the fall.
    animator.tick(5.5);
    expect(output.style.values.get("--pnl-level")).toBe(String(meterFraction(-30)));
    expect(input.dataset.clip).toBe("on");
    report = { quanta: 2, levels: { n: [0.5, 0.1] } };
    animator.tick(6.5);
    expect(input.dataset.clip).toBe("off");
  });

  it("goes dark when its node stops being reported, or never was", () => {
    const [input, other] = [bar("in"), new FakeElement({ levelNode: "x", levelSide: "out" })];
    const animator = new MeterAnimator(() => room([input, other]), () => ({ report: { quanta: 1, levels: { n: [0.5, 0.5] } } }));
    animator.tick(1);
    expect(input.dataset.live).toBe("on");
    expect(other.dataset.live).toBe("off");
    animator.tick(4);
    expect(input.dataset.live).toBe("off");
    expect(input.style.values.get("--pnl-level")).toBe("0");
  });

  it("puts a curve's live dot at the reported level in and out", () => {
    const point = dot();
    const animator = new MeterAnimator(() => room([point]), () => ({ report: { quanta: 1, levels: { n: [Math.pow(10, -30 / 20), Math.pow(10, -15 / 20)] } } }));
    animator.tick(1);
    expect(Number(point.attributes.get("cx"))).toBeCloseTo(60, 6);
    expect(Number(point.attributes.get("cy"))).toBeCloseTo(25, 6);
    expect(point.attributes.get("visibility")).toBe("visible");
    animator.tick(9);
    expect(point.attributes.get("visibility")).toBe("hidden");
  });

  it("does nothing with no panel to draw on, or no report", () => {
    const silent = new MeterAnimator(() => null, () => ({ report: null }));
    expect(() => silent.tick(1)).not.toThrow();
    const input = bar("in");
    new MeterAnimator(() => room([input]), () => ({ report: null })).tick(1);
    expect(input.dataset.live).toBe("off");
  });

  it("runs at frame rate once started, until stopped", () => {
    const frames: ((time: number) => void)[] = [];
    const cancelled: number[] = [];
    const g = globalThis as unknown as { requestAnimationFrame: unknown; cancelAnimationFrame: unknown };
    const [raf, caf] = [g.requestAnimationFrame, g.cancelAnimationFrame];
    g.requestAnimationFrame = (callback: (time: number) => void) => frames.push(callback);
    g.cancelAnimationFrame = (id: number) => cancelled.push(id);
    const input = bar("in");
    const animator = new MeterAnimator(() => room([input]), () => ({ report: { quanta: 1, levels: { n: [0.5, 0.5] } } }));
    animator.start();
    frames[0](1000);
    expect(input.dataset.live).toBe("on");
    expect(frames).toHaveLength(2);
    animator.stop();
    expect(cancelled).toEqual([2]);
    g.requestAnimationFrame = raf;
    g.cancelAnimationFrame = caf;
  });
});

describe("The meter animator, given reports and bars without names", () => {
  it("takes a report with no levels as nothing heard, and leaves a bar with no node dark", () => {
    const named = new FakeElement({ levelNode: "n", levelSide: "in" });
    const unnamed = new FakeElement({ levelSide: "out" });
    const animator = new MeterAnimator(() => room([named, unnamed]), () => ({ report: { quanta: 1 } }));
    animator.tick(1);
    expect(named.dataset.live).toBe("off");
    expect(unnamed.dataset.live).toBe("off");
    expect(unnamed.style.values.get("--pnl-level")).toBe("0");
  });
});
