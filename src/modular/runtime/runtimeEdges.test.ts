import { describe, expect, it, vi } from "vitest";
import { DrawCursor } from "./rng";
import { PPQN, TempoMap } from "./time";
import { PresentationClock } from "./skew";
import { MidiOutputAdapter, type MidiPort } from "./midiadapter";
import { ModularRuntime } from "./engine";
import { ManualSchedulerDriver } from "./clock";
import { createNode, moduleRegistry } from "../registry/registry";
import { compileGraph } from "../compiler/compileGraph";
import { emptyGraph, type Edge, type GraphDocument } from "../model/graph";

/**
 * The edges of the runtime: the values that only turn up on a real machine —
 * a probability of exactly one, a tempo change looked up by wall-clock seconds,
 * a latency field somebody typed a word into, an adapter that is removed twice.
 */

describe("Deterministic probability", () => {
  const rng = () => new DrawCursor(7, 480);

  it("is certain at the ends and only rolls in between", () => {
    expect(rng().chance(0)).toBe(false);
    expect(rng().chance(-1)).toBe(false);
    expect(rng().chance(1)).toBe(true);
    expect(rng().chance(2)).toBe(true);
    // In between it is a draw, so the same seed gives the same answer twice.
    expect(rng().chance(0.5)).toBe(rng().chance(0.5));
  });
});

describe("Finding the tempo for a moment in time", () => {
  it("searches back to an earlier anchor as readily as forward", () => {
    // Several tempo changes, then a lookup that lands in the first segment:
    // the binary search has to walk down as well as up.
    const map = new TempoMap(120, 0);
    map.setTempoAt(PPQN * 4, 140);
    map.setTempoAt(PPQN * 8, 90);
    map.setTempoAt(PPQN * 16, 200);
    const early = map.secondsToTick(0.25);
    expect(early).toBeGreaterThan(0);
    expect(early).toBeLessThan(PPQN * 4);
    // And the last segment still resolves to the last anchor.
    expect(map.secondsToTick(600)).toBeGreaterThan(PPQN * 16);
  });
});

describe("The presentation clock's default time source", () => {
  it("uses the host's own clock when none is supplied", () => {
    // The default matters: passing a stub everywhere would leave the real
    // wiring — the one the browser actually runs — untested.
    const clock = new PresentationClock({ currentTime: 1 });
    expect(Number.isFinite(clock.nowSec())).toBe(true);
    // Sampling is what reads the clock, and a source with no output timestamp
    // is the path that has to fall back to `performance.now()`.
    clock.sample();
    expect(Number.isFinite(clock.nowSec())).toBe(true);
  });
});

describe("Latency trim", () => {
  it("reads a value that is not a number as no trim at all", () => {
    const sent: number[][] = [];
    const port: MidiPort = {
      id: "p", state: "connected",
      send: (data: number[] | Uint8Array, at?: number) => {
        sent.push([...(data as number[]), at ?? -1]);
      },
    };
    const adapter = new MidiOutputAdapter({
      id: "out", clock: new PresentationClock({ currentTime: 0 }, () => 0),
    });
    adapter.setPorts([port]);
    adapter.setLatency(Number.NaN);
    adapter.send([{
      type: "note-on", atTick: 0, atSec: 0, note: 60, velocity: 90, channel: 1, portId: "out",
    } as never], 1);
    expect(sent).toHaveLength(1);
  });
});

describe("Building from a graph with parts switched off", () => {
  const graphWith = (change: (graph: GraphDocument) => void): GraphDocument => {
    const graph = emptyGraph();
    graph.nodes.transport = createNode("m.transport-clock", "transport", { x: 0, y: 0 });
    graph.nodes.tb = createNode("m.time-base", "tb", { x: 200, y: 0 });
    graph.nodes.ed = createNode("m.note-editor", "ed", { x: 200, y: 200 });
    graph.nodes.no = createNode("m.note-order", "no", { x: 400, y: 0 });
    const edge = (id: string, from: string, fromPort: string, to: string, toPort: string): Edge =>
      ({ id, from: { nodeId: from, portId: fromPort }, to: { nodeId: to, portId: toPort }, enabled: true });
    graph.edges.a = edge("a", "transport", "transport-out", "tb", "transport-in");
    graph.edges.b = edge("b", "tb", "clock-out", "no", "clock-in");
    graph.edges.c = edge("c", "ed", "pattern-out", "no", "pattern-in");
    change(graph);
    return graph;
  };

  /**
   * Compile the whole graph, then switch parts off and build against that plan.
   *
   * This is the real sequence: the plan is the last one that compiled, and the
   * document has moved on. `build` has to wire only what is still live.
   */
  const buildWith = (change: (graph: GraphDocument) => void) => {
    const graph = graphWith(() => {});
    const compiled = compileGraph(graph, moduleRegistry, { seed: 3 });
    if (!compiled.ok) throw new Error(compiled.diagnostics.map((item) => item.message).join("; "));
    change(graph);
    const engine = new ModularRuntime({
      registry: moduleRegistry,
      driver: new ManualSchedulerDriver(),
      clock: { nowSec: () => 0 },
    });
    engine.build(graph, compiled.plan);
    return engine;
  };

  it("ignores a disabled cable", () => {
    const engine = buildWith((graph) => { graph.edges.b.enabled = false; });
    expect(() => engine.tick()).not.toThrow();
  });

  it("ignores a cable whose source or target node is switched off", () => {
    expect(() => buildWith((graph) => { graph.nodes.tb.enabled = false; })).not.toThrow();
    expect(() => buildWith((graph) => { graph.nodes.no.enabled = false; })).not.toThrow();
  });

  it("gives Note Order an empty pattern when its editor has gone", () => {
    // The cable survives in the plan, but the node behind it does not: reading
    // the pattern must produce an empty one rather than throw mid-window.
    const engine = buildWith((graph) => { delete graph.nodes.ed; });
    engine.start();
    expect(() => engine.tick()).not.toThrow();
  });
});

describe("A window that produces more than its budget", () => {
  it("counts the overrun rather than letting the graph run away", () => {
    const graph = emptyGraph();
    graph.nodes.transport = createNode("m.transport-clock", "transport", { x: 0, y: 0 });
    graph.nodes.tb = createNode("m.time-base", "tb", { x: 200, y: 0 },
      { numerator: 1, denominator: 64 });
    graph.edges.a = {
      id: "a", enabled: true,
      from: { nodeId: "transport", portId: "transport-out" },
      to: { nodeId: "tb", portId: "transport-in" },
    };
    const compiled = compileGraph(graph, moduleRegistry, { seed: 3 });
    if (!compiled.ok) throw new Error("did not compile");

    const clock = { seconds: 0, nowSec(): number { return this.seconds; } };
    const driver = new ManualSchedulerDriver();
    const engine = new ModularRuntime({
      registry: moduleRegistry, driver, clock,
      scheduling: { baseLookaheadSec: 2, minLookaheadSec: 2, maxLookaheadSec: 2 },
    });
    // One message per node per window: the Time Base wants far more than that.
    engine.build(graph, { ...compiled.plan, eventBudgetPerNode: 1 });
    engine.start();
    clock.seconds += 0.05;
    driver.fire();

    expect(engine.diagnostics().budgetOverruns).toBeGreaterThan(0);
  });
});

describe("Transport lifecycle", () => {
  const engine = () => new ModularRuntime({
    registry: moduleRegistry,
    driver: new ManualSchedulerDriver(),
    clock: { nowSec: () => 0 },
  });

  it("ignores a pause when it is not running, and a resume when it is", () => {
    const runtime = engine();
    expect(() => runtime.pause()).not.toThrow();
    runtime.start();
    expect(() => runtime.resume()).not.toThrow();
    runtime.pause();
    expect(() => runtime.pause()).not.toThrow();
  });

  it("disposes its adapters and its driver together", () => {
    const runtime = engine();
    const withDispose = { id: "a", send: vi.fn(), dispose: vi.fn(), panic: vi.fn() };
    const withoutDispose = { id: "b", send: vi.fn(), panic: vi.fn() };
    runtime.addAdapter(withDispose);
    runtime.addAdapter(withoutDispose);
    expect(() => runtime.dispose()).not.toThrow();
    expect(withDispose.dispose).toHaveBeenCalledTimes(1);
  });
});

describe("Adapters on the runtime", () => {
  const runtime = () => new ModularRuntime({
    registry: moduleRegistry,
    driver: new ManualSchedulerDriver(),
    clock: { nowSec: () => 0 },
  });

  it("ignores a request to remove one that was never added", () => {
    const engine = runtime();
    const adapter = { id: "a", send: vi.fn(), dispose: vi.fn(), panic: vi.fn() };
    expect(() => engine.removeAdapter(adapter)).not.toThrow();
    expect(adapter.dispose).not.toHaveBeenCalled();
  });

  it("adds an adapter once, however many times it is offered", () => {
    const engine = runtime();
    const adapter = { id: "a", send: vi.fn(), dispose: vi.fn(), panic: vi.fn() };
    engine.addAdapter(adapter);
    engine.addAdapter(adapter);
    engine.removeAdapter(adapter);
    expect(adapter.dispose).toHaveBeenCalledTimes(1);
    // Gone after one removal, so a second does nothing.
    engine.removeAdapter(adapter);
    expect(adapter.dispose).toHaveBeenCalledTimes(1);
  });

  it("exposes the tempo map the schedule is being built against", () => {
    expect(runtime().tempoMap.bpmAt(0)).toBe(120);
  });
});
