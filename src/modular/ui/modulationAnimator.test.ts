import { afterEach, describe, expect, it, vi } from "vitest";
import { knobAngle, liveText, ModulationAnimator, type ModulationSource } from "./modulationAnimator";

describe("The modulated pointer", () => {
  it("turns as the knob's own pointer does", () => {
    expect(knobAngle(0, 0, 1)).toBe(-135);
    expect(knobAngle(0.5, 0, 1)).toBe(0);
    expect(knobAngle(20000, 20, 20000)).toBe(135);
  });

  it("prints a live value to the knob's step", () => {
    expect(liveText(0.4567, 0.01)).toBe("0.46");
    expect(liveText(123.4, 1)).toBe("123");
    expect(liveText(0.5, 0.001)).toBe("0.500");
  });
});

describe("The modulation animator", () => {
  // A stand-in for a mapped knob: its data attributes, its pointer and its live readout.
  const knob = (dataset: Record<string, string | undefined>, parts: { pointer?: boolean; live?: boolean } = {}) => {
    const attributes = new Map<string, string>();
    const pointer = { setAttribute: (name: string, value: string) => attributes.set(name, value) };
    const live = { textContent: "stale" };
    const element = {
      dataset,
      querySelector: (selector: string) =>
        selector === ".n4-knob__mod" ? (parts.pointer === false ? null : pointer) : parts.live === false ? null : live,
    };
    return { element, attributes, live };
  };
  const rootOf = (...elements: { element: unknown }[]) =>
    ({ querySelectorAll: () => elements.map((entry) => entry.element) }) as unknown as HTMLElement;

  // Drives the animator by hand: each call runs one frame at `seconds`.
  const frames = () => {
    const pending: FrameRequestCallback[] = [];
    let requested = 0;
    let cancelled = -1;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      pending.push(callback);
      return (requested += 1);
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => (cancelled = id));
    return {
      run: (seconds: number) => pending.shift()!(seconds * 1000),
      pending: () => pending.length,
      cancelled: () => cancelled,
    };
  };

  afterEach(() => vi.unstubAllGlobals());

  it("draws each mapped knob at its base plus the reported LFO, and its live value to the knob's step", () => {
    const clock = frames();
    const mapped = knob({ modLfos: "lfo", modMin: "0", modMax: "1", modBase: "0.5", modStep: "0.1" });
    const animator = new ModulationAnimator(() => rootOf(mapped), () => ({
      // A held shape (S&H): the reported value is drawn as it is.
      report: { quanta: 1, lfos: { lfo: [0.25, 0.5] } },
      lfos: new Map([["lfo", { rate: 1, shape: 5, amount: 1 }]]),
    }));
    animator.start();
    clock.run(10);
    // 0.5 + 0.5 × (1 − 0) / 2 = 0.75.
    expect(mapped.attributes.get("visibility")).toBe("visible");
    expect(mapped.attributes.get("transform")).toBe(`rotate(${knobAngle(0.75, 0, 1)} 20 20)`);
    expect(mapped.live.textContent).toBe("0.8");
    // Each frame asks for the next.
    expect(clock.pending()).toBe(1);
    // Stopping cancels the frame it asked for last.
    animator.stop();
    expect(clock.cancelled()).toBe(2);
  });

  it("carries a predictable shape forward between reports, and keeps the first report's time for a repeated one", () => {
    const clock = frames();
    const mapped = knob({ modLfos: "lfo", modMin: "-1", modMax: "1", modBase: "0" });
    const animator = new ModulationAnimator(() => rootOf(mapped), () => ({
      report: { quanta: 7, lfos: { lfo: [0, 0] } },
      lfos: new Map([["lfo", { rate: 1, shape: 0, amount: 1 }]]),
    }));
    animator.start();
    clock.run(100);
    // A quarter of a second on, a 1 Hz sine is at its top: the value runs to the maximum.
    clock.run(100.25);
    expect(mapped.attributes.get("transform")).toBe("rotate(135 20 20)");
    // No step written: two decimals.
    expect(mapped.live.textContent).toBe("1.00");
  });

  it("hides the pointer and clears the readout when nothing is heard", () => {
    const clock = frames();
    const unreported = knob({ modLfos: "other", modMin: "0", modMax: "1", modBase: "0" });
    const unknown = knob({ modLfos: "lfo", modMin: "0", modMax: "1", modBase: "0" });
    const unnamed = knob({ modMin: "0", modMax: "1", modBase: "0" }, { pointer: false, live: false });
    let report: ReturnType<ModulationSource>["report"] = { quanta: 1 };
    const lfos = new Map<string, { rate: number; shape: number; amount: number }>();
    const animator = new ModulationAnimator(() => rootOf(unreported, unknown, unnamed), () => ({ report, lfos }));
    animator.start();
    // A report without LFOs, and a reported LFO the graph no longer has.
    clock.run(1);
    report = { quanta: 2, lfos: { lfo: [0, 0.5], other: [0, 0.5] } };
    clock.run(1.1);
    expect(unreported.attributes.get("visibility")).toBe("hidden");
    expect(unreported.live.textContent).toBe("");
    expect(unknown.attributes.get("visibility")).toBe("hidden");
    // Heard once, then silent past two seconds: hidden again.
    lfos.set("other", { rate: 1, shape: 5, amount: 1 });
    clock.run(1.2);
    expect(unreported.attributes.get("visibility")).toBe("visible");
    report = null;
    clock.run(3.2);
    expect(unreported.attributes.get("visibility")).toBe("hidden");
  });

  it("does nothing while its root is not mounted", () => {
    const clock = frames();
    let asked = 0;
    const animator = new ModulationAnimator(() => null, () => {
      asked += 1;
      return { report: null, lfos: new Map() };
    });
    animator.start();
    clock.run(1);
    expect(asked).toBe(0);
  });
});
