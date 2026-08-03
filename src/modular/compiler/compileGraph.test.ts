import { describe, expect, it } from "vitest";
import { compileGraph, PlanPublisher } from "./compileGraph";
import {
  emptyGraph,
  type Edge,
  type GraphDocument,
  type ModuleDescriptor,
  type NodeInstance,
} from "../model/graph";
import type { ModuleRegistry } from "../registry/registry";

// A tiny registry: a source, a transform, a sink, a transform with a required
// input, and a module that legally breaks feedback.
const descriptor = (
  type: string,
  ports: ModuleDescriptor["ports"],
  extra: Partial<ModuleDescriptor> = {},
): ModuleDescriptor => ({
  type,
  version: 1,
  label: type,
  family: "transform",
  layout: "compact",
  colorToken: "transform",
  ports,
  parameters: [],
  commands: [],
  face: [],
  ...extra,
});

const noteOut = { id: "out", label: "Notes", direction: "output", signal: { kind: "note-event" }, cardinality: "many" } as const;
const noteIn = { id: "in", label: "Notes", direction: "input", signal: { kind: "note-event" }, cardinality: "many" } as const;
const audioOut = { id: "audio-out", label: "Audio", direction: "output", signal: { kind: "audio", channels: 2 }, cardinality: "many" } as const;
const audioIn = { id: "audio-in", label: "Audio", direction: "input", signal: { kind: "audio", channels: 2 }, cardinality: "many" } as const;

const registry: ModuleRegistry = new Map([
  descriptor("source", [noteOut]),
  descriptor("transform", [noteIn, noteOut]),
  descriptor("sink", [noteIn]),
  descriptor("needs-input", [{ ...noteIn, required: true }, noteOut]),
  descriptor("audio-pair", [audioIn, audioOut]),
  descriptor("delay", [noteIn, noteOut], { feedbackBreak: { minDelayTicks: 1, maxGain: 0.7 } }),
].map((item) => [item.type, item]));

const node = (id: string, moduleType: string, enabled = true): NodeInstance => ({
  id,
  moduleType,
  moduleVersion: 1,
  label: id,
  position: { x: 0, y: 0 },
  parameters: {},
  enabled,
});

const edge = (id: string, from: string, to: string, ports = ["out", "in"], enabled = true): Edge => ({
  id,
  from: { nodeId: from, portId: ports[0] },
  to: { nodeId: to, portId: ports[1] },
  enabled,
});

const build = (nodes: NodeInstance[], edges: Edge[]): GraphDocument => {
  const graph = emptyGraph();
  for (const item of nodes) graph.nodes[item.id] = item;
  for (const item of edges) graph.edges[item.id] = item;
  return graph;
};

describe("Graph compilation", () => {
  it("orders processors so every producer runs before its consumer", () => {
    const graph = build(
      [node("sink", "sink"), node("mid", "transform"), node("src", "source")],
      [edge("a", "src", "mid"), edge("b", "mid", "sink")],
    );
    const result = compileGraph(graph, registry);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.order).toEqual(["src", "mid", "sink"]);
  });

  it("produces the same order regardless of node insertion order", () => {
    const edges = [edge("a", "src", "mid"), edge("b", "mid", "sink"), edge("c", "src", "other"), edge("d", "other", "sink")];
    const forward = compileGraph(
      build([node("src", "source"), node("mid", "transform"), node("other", "transform"), node("sink", "sink")], edges),
      registry,
    );
    const reversed = compileGraph(
      build([node("sink", "sink"), node("other", "transform"), node("mid", "transform"), node("src", "source")], edges),
      registry,
    );
    expect(forward.ok && reversed.ok).toBe(true);
    if (!forward.ok || !reversed.ok) return;
    expect(forward.plan.order).toEqual(reversed.plan.order);
  });

  it("rejects a cycle and names the loop", () => {
    const graph = build(
      [node("a", "transform"), node("b", "transform"), node("c", "transform")],
      [edge("ab", "a", "b"), edge("bc", "b", "c"), edge("ca", "c", "a")],
    );
    const result = compileGraph(graph, registry);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const cycle = result.diagnostics.find((item) => item.code === "unbroken-cycle");
    expect(cycle?.message).toContain("a -> b -> c -> a");
    expect(cycle?.message).toContain("at least one tick");
  });

  it("accepts a cycle that passes through a delay module", () => {
    const graph = build(
      [node("a", "transform"), node("b", "transform"), node("d", "delay")],
      [edge("ab", "a", "b"), edge("bd", "b", "d"), edge("da", "d", "a")],
    );
    const result = compileGraph(graph, registry);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.feedbackEdges).toEqual([{ edgeId: "bd", breakerNodeId: "d" }]);
    // The breaker is evaluated first: it delivers what it received earlier.
    expect(result.plan.order.indexOf("d")).toBeLessThan(result.plan.order.indexOf("a"));
  });

  it("ignores audio edges when ordering event processors", () => {
    const graph = build(
      [node("x", "audio-pair"), node("y", "audio-pair")],
      [
        edge("xy", "x", "y", ["audio-out", "audio-in"]),
        edge("yx", "y", "x", ["audio-out", "audio-in"]),
      ],
    );
    // An audio loop is a topology fact for the audio adapter, not an
    // evaluation-order dependency, so it does not block compilation here.
    expect(compileGraph(graph, registry).ok).toBe(true);
  });

  it("reports a required input that is not connected", () => {
    const graph = build([node("n", "needs-input")], []);
    const result = compileGraph(graph, registry);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics.map((item) => item.code)).toContain("missing-required-input");
  });

  it("treats a disabled node as absent and warns about its connections", () => {
    const graph = build(
      [node("src", "source"), node("mid", "transform", false), node("sink", "sink")],
      [edge("a", "src", "mid"), edge("b", "mid", "sink")],
    );
    const result = compileGraph(graph, registry);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.order).toEqual(["sink", "src"]);
    expect(result.plan.warnings.map((item) => item.code))
      .toEqual(["edge-to-disabled-node", "edge-to-disabled-node"]);
  });

  it("ignores a disabled edge", () => {
    const graph = build(
      [node("a", "transform"), node("b", "transform")],
      [edge("ab", "a", "b"), edge("ba", "b", "a", ["out", "in"], false)],
    );
    expect(compileGraph(graph, registry).ok).toBe(true);
  });

  it("counts parallel edges between two nodes as one dependency", () => {
    const graph = build(
      [node("src", "source"), node("sink", "sink")],
      [edge("a", "src", "sink"), edge("b", "src", "sink")],
    );
    const result = compileGraph(graph, registry);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.order).toEqual(["src", "sink"]);
  });

  it("fails on an unknown module rather than guessing", () => {
    const graph = build([node("ghost", "not-registered")], []);
    const result = compileGraph(graph, registry);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics.map((item) => item.code)).toContain("unknown-module");
  });

  it("derives seeds from the project seed and node id only", () => {
    const graph = build([node("src", "source"), node("sink", "sink")], []);
    const first = compileGraph(graph, registry, { seed: 42 });
    const moved = build(
      [{ ...node("src", "source"), position: { x: 900, y: 400 }, label: "Renamed" }, node("sink", "sink")],
      [],
    );
    const second = compileGraph(moved, registry, { seed: 42 });
    const other = compileGraph(graph, registry, { seed: 43 });
    expect(first.ok && second.ok && other.ok).toBe(true);
    if (!first.ok || !second.ok || !other.ok) return;
    // Moving or renaming a node must not change its music.
    expect(second.plan.seeds).toEqual(first.plan.seeds);
    expect(other.plan.seeds.src).not.toBe(first.plan.seeds.src);
    expect(first.plan.seeds.src).not.toBe(first.plan.seeds.sink);
  });

  it("carries a bounded per-node event budget", () => {
    const graph = build([node("src", "source")], []);
    const standard = compileGraph(graph, registry);
    const custom = compileGraph(graph, registry, { eventBudgetPerNode: 64 });
    expect(standard.ok && custom.ok).toBe(true);
    if (!standard.ok || !custom.ok) return;
    expect(standard.plan.eventBudgetPerNode).toBe(4096);
    expect(custom.plan.eventBudgetPerNode).toBe(64);
  });

  it("compiles an empty graph", () => {
    const result = compileGraph(emptyGraph(), registry);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.order).toEqual([]);
  });
});

describe("Plan publication", () => {
  it("keeps the last good plan running when an edit fails to compile", () => {
    const publisher = new PlanPublisher();
    const good = build(
      [node("src", "source"), node("sink", "sink")],
      [edge("a", "src", "sink")],
    );
    expect(publisher.publish(good, registry).ok).toBe(true);
    const running = publisher.current;
    expect(running?.generation).toBe(1);
    expect(publisher.invalid).toBe(false);

    const broken = build(
      [node("a", "transform"), node("b", "transform")],
      [edge("ab", "a", "b"), edge("ba", "b", "a")],
    );
    expect(publisher.publish(broken, registry).ok).toBe(false);
    expect(publisher.invalid).toBe(true);
    // The music does not stop because the user mistyped a connection.
    expect(publisher.current).toBe(running);
    expect(publisher.diagnostics.map((item) => item.code)).toEqual(["unbroken-cycle"]);
  });

  it("advances the generation only on an accepted plan", () => {
    const publisher = new PlanPublisher();
    const graph = build([node("src", "source")], []);
    publisher.publish(graph, registry);
    publisher.publish(build([node("a", "transform"), node("b", "transform")], [edge("ab", "a", "b"), edge("ba", "b", "a")]), registry);
    publisher.publish(graph, registry);
    expect(publisher.current?.generation).toBe(2);
  });

  it("does not treat warnings as invalidity", () => {
    const publisher = new PlanPublisher();
    const graph = build(
      [node("src", "source"), node("sink", "sink", false)],
      [edge("a", "src", "sink")],
    );
    expect(publisher.publish(graph, registry).ok).toBe(true);
    expect(publisher.invalid).toBe(false);
    expect(publisher.diagnostics).toHaveLength(1);
  });

  it("resets to nothing running", () => {
    const publisher = new PlanPublisher();
    publisher.publish(build([node("src", "source")], []), registry);
    publisher.reset();
    expect(publisher.current).toBeNull();
    expect(publisher.invalid).toBe(false);
    publisher.publish(build([node("src", "source")], []), registry);
    expect(publisher.current?.generation).toBe(1);
  });
});
