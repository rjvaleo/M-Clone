import { describe, expect, it } from "vitest";
import { validateGraph } from "./validateGraph";
import { emptyGraph, type Edge } from "../model/graph";
import { executeGraphCommand } from "../model/commands";
import { createNode, moduleRegistry } from "../registry/registry";

const graphWithNodes = () => {
  let graph = emptyGraph();
  for (const node of [
    createNode("m.transport-clock", "clock", { x: 0, y: 0 }),
    createNode("m.note-editor", "editor", { x: 200, y: 0 }),
    createNode("m.note-density", "density", { x: 400, y: 0 }),
    createNode("m.midi-output", "output", { x: 600, y: 0 }),
  ]) graph = executeGraphCommand(graph, { type: "add-node", node }).graph;
  return graph;
};

describe("Modular graph validation", () => {
  it("accepts compatible event wiring", () => {
    const graph = graphWithNodes();
    const edge: Edge = {
      id: "audition", from: { nodeId: "editor", portId: "audition-out" },
      to: { nodeId: "output", portId: "notes-in" }, enabled: true,
    };
    const connected = executeGraphCommand(graph, { type: "add-edge", edge }).graph;
    expect(validateGraph(connected, moduleRegistry)).toEqual([]);
  });

  it("rejects incompatible signal types and duplicate single-input wiring", () => {
    let graph = graphWithNodes();
    for (const edge of [
      { id: "wrong", from: { nodeId: "clock", portId: "transport-out" }, to: { nodeId: "editor", portId: "clock-in" }, enabled: true },
      { id: "one", from: { nodeId: "editor", portId: "audition-out" }, to: { nodeId: "editor", portId: "record-in" }, enabled: true },
      { id: "two", from: { nodeId: "editor", portId: "audition-out" }, to: { nodeId: "editor", portId: "record-in" }, enabled: true },
    ] satisfies Edge[]) graph = executeGraphCommand(graph, { type: "add-edge", edge }).graph;
    expect(validateGraph(graph, moduleRegistry).map((item) => item.code))
      .toEqual(["incompatible-signal", "input-cardinality"]);
  });

  it("rejects telemetry edges into musical inputs", () => {
    const graph = executeGraphCommand(graphWithNodes(), {
      type: "add-edge",
      edge: {
        id: "bad-telemetry",
        from: { nodeId: "density", portId: "rejected-telemetry" },
        to: { nodeId: "output", portId: "notes-in" },
        enabled: true,
      },
    }).graph;
    expect(validateGraph(graph, moduleRegistry).map((item) => item.code))
      .toContain("telemetry-route");
  });

  it("reports an edge whose endpoint is not there, and looks no further at it", () => {
    // A document can name a node or a port that a later build removed. One
    // diagnostic per edge is enough; carrying on would report the same edge
    // several times for the same cause.
    const graph = graphWithNodes();
    graph.edges.goneNode = {
      id: "goneNode", from: { nodeId: "vanished", portId: "notes-out" },
      to: { nodeId: "output", portId: "notes-in" }, enabled: true,
    };
    graph.edges.gonePort = {
      id: "gonePort", from: { nodeId: "editor", portId: "retired-out" },
      to: { nodeId: "output", portId: "notes-in" }, enabled: true,
    };
    expect(validateGraph(graph, moduleRegistry).map((item) => item.code))
      .toEqual(["missing-endpoint", "missing-endpoint"]);
  });

  it("reports a node whose module the registry no longer has, and its cables", () => {
    const graph = graphWithNodes();
    graph.nodes.editor = { ...graph.nodes.editor, moduleType: "m.retired" };
    graph.edges.orphaned = {
      id: "orphaned", from: { nodeId: "editor", portId: "audition-out" },
      to: { nodeId: "output", portId: "notes-in" }, enabled: true,
    };
    const codes = validateGraph(graph, moduleRegistry).map((item) => item.code);
    expect(codes).toContain("unknown-module");
    expect(codes).toContain("missing-endpoint");
  });

  it("rejects a cable run backwards", () => {
    const graph = graphWithNodes();
    graph.edges.backwards = {
      id: "backwards", from: { nodeId: "output", portId: "notes-in" },
      to: { nodeId: "editor", portId: "audition-out" }, enabled: true,
    };
    expect(validateGraph(graph, moduleRegistry).map((item) => item.code))
      .toContain("wrong-direction");
  });

  it("allows telemetry to reach a telemetry input", () => {
    // The rule is one-directional: telemetry may not enter a musical input, but
    // telemetry to telemetry is exactly what a monitor is for.
    const graph = graphWithNodes();
    graph.edges.fine = {
      id: "fine", from: { nodeId: "density", portId: "rejected-telemetry" },
      to: { nodeId: "density", portId: "rejected-telemetry" }, enabled: true,
    };
    expect(validateGraph(graph, moduleRegistry).map((item) => item.code))
      .not.toContain("telemetry-route");
  });
});
