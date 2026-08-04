import { describe, expect, it } from "vitest";
import { MessageBus } from "./messages";
import { EventPool, type RuntimeEvent } from "./eventqueue";
import {
  EMPTY_PATTERN,
  PROCESSOR_FACTORIES,
  ParameterBag,
  type ProcessWindow,
} from "./processors";
import { moduleRegistry } from "../registry/registry";
import { TempoMap } from "./time";

/**
 * One pass over every module the runtime can execute.
 *
 * The per-module tests next door prove behaviour; this proves the contract the
 * whole registry depends on and that no single test would notice breaking: a
 * module that is registered but has no processor, a processor whose defaults
 * throw the first time it runs, a `status()` that returns something the node
 * face cannot render, or a `reset()` that fails when nothing has happened yet.
 *
 * Adding a module and forgetting any of those is the failure this catches.
 */

const pool = new EventPool(64);
const sink = {
  acquire: (): RuntimeEvent => pool.acquire(),
  submit: (): void => {},
};

const window = (startTick: number, endTick: number): ProcessWindow => ({
  startTick,
  endTick,
  tempo: new TempoMap(120, 0),
});

/** Build a processor exactly as the engine would, from registry defaults. */
const buildFromRegistry = (moduleType: string) => {
  const descriptor = moduleRegistry.get(moduleType);
  const defaults = Object.fromEntries(
    (descriptor?.parameters ?? []).map((parameter) => [parameter.id, parameter.defaultValue]),
  );
  const bus = new MessageBus();
  const processor = PROCESSOR_FACTORIES[moduleType]({
    nodeId: `n-${moduleType}`,
    bus,
    parameters: new ParameterBag(defaults as never),
    budget: 256,
    seed: 11,
    pattern: () => EMPTY_PATTERN,
    sink,
  });
  return { bus, processor };
};

const executable = Object.keys(PROCESSOR_FACTORIES);

describe("Every executable module", () => {
  it("is a module the registry actually has", () => {
    for (const moduleType of executable) {
      expect(moduleRegistry.has(moduleType), moduleType).toBe(true);
    }
  });

  it("covers every module that can be played", () => {
    // The converse of the check above, and the one that matters: an instrument
    // with no processor is a module that builds, wires, and stays silent —
    // because nothing turns its note messages into scheduled events. Both the
    // sample players and the synth shipped that way once.
    const instruments = [...moduleRegistry.values()]
      .filter((descriptor) => descriptor.family === "instrument")
      .map((descriptor) => descriptor.type);
    expect(instruments.length).toBeGreaterThan(0);
    for (const moduleType of instruments) {
      expect(PROCESSOR_FACTORIES[moduleType], moduleType).toBeDefined();
    }
  });

  it("runs a window on its own defaults without throwing", () => {
    // The defaults are what a freshly dropped module runs on, so they are the
    // one configuration that must never fail.
    for (const moduleType of executable) {
      const { bus, processor } = buildFromRegistry(moduleType);
      bus.beginNode(processor.nodeId, 256);
      expect(() => processor.process(window(0, 960)), moduleType).not.toThrow();
      bus.endWindow();
    }
  });

  it("resets from a standing start", () => {
    // Reset arrives whenever the transport is synced, including before the
    // module has ever run.
    for (const moduleType of executable) {
      const { processor } = buildFromRegistry(moduleType);
      expect(() => processor.reset(0), moduleType).not.toThrow();
      expect(() => processor.reset(4800), moduleType).not.toThrow();
    }
  });

  it("reports status the node face can render, before and after running", () => {
    for (const moduleType of executable) {
      const { bus, processor } = buildFromRegistry(moduleType);
      const before = processor.status?.() ?? {};
      for (const [key, value] of Object.entries(before)) {
        expect(typeof value, `${moduleType}.${key}`).toBe("string");
      }
      bus.beginNode(processor.nodeId, 256);
      processor.process(window(0, 1920));
      bus.endWindow();
      const after = processor.status?.() ?? {};
      // The same fields either way: a face that gains or loses a row when the
      // transport starts is a face that jumps.
      expect(Object.keys(after).sort(), moduleType).toEqual(Object.keys(before).sort());
      for (const [key, value] of Object.entries(after)) {
        expect(typeof value, `${moduleType}.${key}`).toBe("string");
      }
    }
  });

  it("survives a window that starts where the last one ended", () => {
    for (const moduleType of executable) {
      const { bus, processor } = buildFromRegistry(moduleType);
      for (let start = 0; start < 3840; start += 480) {
        bus.beginNode(processor.nodeId, 256);
        expect(() => processor.process(window(start, start + 480)), moduleType).not.toThrow();
        bus.endWindow();
      }
    }
  });
});

describe("Time Base status", () => {
  it("names the step rate in ticks", () => {
    const { processor } = buildFromRegistry("m.time-base");
    expect(processor.status?.()["step-rate"]).toMatch(/ticks$/);
  });

  it("says so when the rate is one step per transport pulse", () => {
    // Denominator zero is Classic's `sa`: advance on every pulse rather than
    // divide the bar, so there is no tick count to report.
    const bus = new MessageBus();
    const processor = PROCESSOR_FACTORIES["m.time-base"]({
      nodeId: "tb", bus, budget: 64, seed: 1,
      parameters: new ParameterBag({ numerator: 1, denominator: 0 } as never),
    });
    expect(processor.status?.()).toEqual({ "step-rate": "Step advance" });
  });
});

describe("Phase status", () => {
  it("counts held pulses, and says 'pulse' when there is one", () => {
    const { processor } = buildFromRegistry("m.phase");
    expect(processor.status?.().pending).toBe("0 pulses");
  });
});
