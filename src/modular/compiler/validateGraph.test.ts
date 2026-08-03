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
});
