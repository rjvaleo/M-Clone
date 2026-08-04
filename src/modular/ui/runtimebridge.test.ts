import { describe, expect, it, vi } from "vitest";
import type { NodeInstance } from "../model/graph";
import {
  executeRuntimeCommand,
  queueRuntimeParameter,
  type RuntimeLike,
} from "./runtimebridge";

const node = (id: string, moduleType: string): NodeInstance => ({
  id,
  moduleType,
  moduleVersion: 2,
  label: id,
  position: { x: 0, y: 0 },
  parameters: {},
  enabled: true,
});

const runtimeStub = (): RuntimeLike => ({
  start: vi.fn(),
  pause: vi.fn(),
  stop: vi.fn(),
  sync: vi.fn(),
  panic: vi.fn(),
  rescramble: vi.fn(() => true),
  queueParameter: vi.fn(),
});

describe("runtime bridge", () => {
  it("queues parameter edits with the provided morph", () => {
    const runtime = runtimeStub();
    queueRuntimeParameter(runtime, "n1", "density", 80, "step-end");
    expect(runtime.queueParameter).toHaveBeenCalledWith("n1", "density", 80, "step-end");
  });

  it("dispatches transport commands to runtime", () => {
    const runtime = runtimeStub();
    const transport = node("transport-1", "m.transport-clock");
    executeRuntimeCommand(runtime, transport, "play", "Play");
    executeRuntimeCommand(runtime, transport, "pause", "Pause");
    executeRuntimeCommand(runtime, transport, "stop", "Stop");
    executeRuntimeCommand(runtime, transport, "sync", "Sync");
    expect(runtime.start).toHaveBeenCalledTimes(1);
    expect(runtime.pause).toHaveBeenCalledTimes(1);
    expect(runtime.stop).toHaveBeenCalledTimes(1);
    expect(runtime.sync).toHaveBeenCalledTimes(1);
  });

  it("dispatches rescramble and reports unsupported nodes", () => {
    const runtime = runtimeStub();
    const order = node("order-1", "m.note-order");
    expect(executeRuntimeCommand(runtime, order, "rescramble", "ReScramble").message)
      .toContain("ReScramble");
    expect(runtime.rescramble).toHaveBeenCalledWith("order-1");

    (runtime.rescramble as ReturnType<typeof vi.fn>).mockReturnValueOnce(false);
    const timeBase = node("tb-1", "m.time-base");
    expect(executeRuntimeCommand(runtime, timeBase, "rescramble", "ReScramble").message)
      .toContain("no cyclic state");
  });

  it("reseed updates the runtime and returns document update data", () => {
    const runtime = runtimeStub();
    const density = node("density-1", "m.note-density");
    const result = executeRuntimeCommand(runtime, density, "reseed", "Reseed", () => 1234);
    expect(runtime.queueParameter).toHaveBeenCalledWith("density-1", "seed", 1234, "immediate");
    expect(result.updates).toEqual([{ parameterId: "seed", value: 1234, morph: "immediate" }]);
  });

  it("panic command maps to runtime panic", () => {
    const runtime = runtimeStub();
    const midi = node("mo-1", "m.midi-output");
    executeRuntimeCommand(runtime, midi, "panic", "Panic");
    expect(runtime.panic).toHaveBeenCalledTimes(1);
  });

  it("says so rather than throwing when there is no runtime yet", () => {
    // Pressing Play before audio has started is ordinary, not an error.
    const result = executeRuntimeCommand(null, node("t", "m.transport-clock"), "play", "Play");
    expect(result.message).toBe("t: runtime unavailable");
    expect(result.updates).toBeUndefined();
  });

  it("does nothing at all with no runtime to queue into", () => {
    expect(() => queueRuntimeParameter(null, "n1", "density", 80, "step-end")).not.toThrow();
  });

  it("reports a command it has no wiring for, under the caller's own label", () => {
    const runtime = runtimeStub();
    expect(executeRuntimeCommand(runtime, node("n", "m.phase"), "unheard-of", "Did nothing").message)
      .toBe("n: Did nothing");
    // Transport commands belong to the transport: the same id elsewhere is not
    // a transport command.
    expect(executeRuntimeCommand(runtime, node("n", "m.phase"), "play", "Fell through").message)
      .toBe("n: Fell through");
    expect(runtime.start).not.toHaveBeenCalled();
    // And reseed belongs to Density.
    expect(executeRuntimeCommand(runtime, node("n", "m.phase"), "reseed", "Fell through").message)
      .toBe("n: Fell through");
  });

  it("seeds from real randomness when the caller supplies none", () => {
    const runtime = runtimeStub();
    const result = executeRuntimeCommand(runtime, node("d", "m.note-density"), "reseed", "Reseed");
    const seed = result.updates?.[0].value as number;
    expect(Number.isInteger(seed)).toBe(true);
    expect(seed).toBeGreaterThanOrEqual(1);
  });

  it("never hands out a seed of zero", () => {
    // Zero would be a legal number and a broken seed.
    const runtime = runtimeStub();
    const result = executeRuntimeCommand(
      runtime, node("d", "m.note-density"), "reseed", "Reseed", () => 0,
    );
    expect(result.updates?.[0].value).toBe(1);
  });
});
