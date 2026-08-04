import { describe, expect, it } from "vitest";
import { executeGraphCommand } from "./commands";
import { emptyGraph, type Edge } from "./graph";
import { createNode } from "../registry/registry";

describe("Modular graph commands", () => {
  it("adds, moves, edits, connects, removes, and restores nodes with inverses", () => {
    const clock = createNode("m.transport-clock", "clock", { x: 10, y: 20 });
    const editor = createNode("m.note-editor", "editor", { x: 100, y: 20 });
    const output = createNode("m.midi-output", "output", { x: 500, y: 20 });
    let graph = emptyGraph();
    graph = executeGraphCommand(graph, { type: "add-node", node: clock }).graph;
    graph = executeGraphCommand(graph, { type: "add-node", node: editor }).graph;
    graph = executeGraphCommand(graph, { type: "add-node", node: output }).graph;

    const moved = executeGraphCommand(graph, {
      type: "move-nodes", positions: { editor: { x: 180, y: 90 } },
    });
    expect(moved.graph.nodes.editor.position).toEqual({ x: 180, y: 90 });
    expect(executeGraphCommand(moved.graph, moved.inverse).graph.nodes.editor.position)
      .toEqual({ x: 100, y: 20 });

    const changed = executeGraphCommand(graph, {
      type: "set-parameter", nodeId: "clock", parameterId: "tempo", value: 137,
    });
    expect(changed.graph.nodes.clock.parameters.tempo).toBe(137);
    expect(executeGraphCommand(changed.graph, changed.inverse).graph.nodes.clock.parameters.tempo)
      .toBe(120);

    const edge: Edge = {
      id: "audition-to-midi",
      from: { nodeId: "editor", portId: "audition-out" },
      to: { nodeId: "output", portId: "notes-in" },
      enabled: true,
    };
    graph = executeGraphCommand(graph, { type: "add-edge", edge }).graph;
    const removed = executeGraphCommand(graph, { type: "remove-nodes", nodeIds: ["editor"] });
    expect(removed.graph.nodes.editor).toBeUndefined();
    expect(removed.graph.edges[edge.id]).toBeUndefined();
    const restored = executeGraphCommand(removed.graph, removed.inverse).graph;
    expect(restored.nodes.editor).toEqual(editor);
    expect(restored.edges[edge.id]).toEqual(edge);
  });

  it("rejects unknown parameters", () => {
    const graph = executeGraphCommand(emptyGraph(), {
      type: "add-node", node: createNode("m.transport-clock", "clock", { x: 0, y: 0 }),
    }).graph;
    expect(() => executeGraphCommand(graph, {
      type: "set-parameter", nodeId: "clock", parameterId: "hidden", value: 1,
    })).toThrow("Unknown parameter");
  });

  it("updates related preset parameters atomically", () => {
    const density = createNode("m.note-density", "density", { x: 0, y: 0 });
    const graph = executeGraphCommand(emptyGraph(), { type: "add-node", node: density }).graph;
    const changed = executeGraphCommand(graph, {
      type: "set-parameters", nodeId: "density",
      values: { density: 42, "active-position": 3 },
    });
    expect(changed.graph.nodes.density.parameters.density).toBe(42);
    expect(changed.graph.nodes.density.parameters["active-position"]).toBe(3);
    const restored = executeGraphCommand(changed.graph, changed.inverse).graph;
    expect(restored.nodes.density.parameters.density).toBe(57);
    expect(restored.nodes.density.parameters["active-position"]).toBe(0);
  });

  it("rejects an unknown parameter in a multi-parameter edit, writing none of it", () => {
    // An atomic command that half-applied would leave a preset in a state no
    // slot describes.
    const density = createNode("m.note-density", "density", { x: 0, y: 0 });
    const graph = executeGraphCommand(emptyGraph(), { type: "add-node", node: density }).graph;
    expect(() => executeGraphCommand(graph, {
      type: "set-parameters", nodeId: "density", values: { density: 42, invented: 1 },
    })).toThrow("Unknown parameter");
    expect(graph.nodes.density.parameters.density).toBe(57);
  });

  it("takes the cables on both sides of a removed node", () => {
    // Removing the node a cable *arrives* at must take that cable too, or the
    // graph keeps an edge pointing at nothing.
    const editor = createNode("m.note-editor", "editor", { x: 0, y: 0 });
    const output = createNode("m.midi-output", "output", { x: 400, y: 0 });
    let graph = executeGraphCommand(emptyGraph(), { type: "add-node", node: editor }).graph;
    graph = executeGraphCommand(graph, { type: "add-node", node: output }).graph;
    graph = executeGraphCommand(graph, {
      type: "add-edge",
      edge: {
        id: "into-output",
        from: { nodeId: "editor", portId: "audition-out" },
        to: { nodeId: "output", portId: "notes-in" },
        enabled: true,
      },
    }).graph;

    const removed = executeGraphCommand(graph, { type: "remove-nodes", nodeIds: ["output"] });
    expect(removed.graph.edges["into-output"]).toBeUndefined();
    expect(executeGraphCommand(removed.graph, removed.inverse).graph.edges["into-output"])
      .toBeDefined();
  });

  it("refuses to restore a node that is already back", () => {
    const clock = createNode("m.transport-clock", "clock", { x: 0, y: 0 });
    const graph = executeGraphCommand(emptyGraph(), { type: "add-node", node: clock }).graph;
    expect(() => executeGraphCommand(graph, {
      type: "restore-subgraph", nodes: [clock], edges: [],
    })).toThrow("Duplicate node");
  });

  it("removes a cable and puts it back exactly", () => {
    const editor = createNode("m.note-editor", "editor", { x: 0, y: 0 });
    const output = createNode("m.midi-output", "output", { x: 400, y: 0 });
    const edge: Edge = {
      id: "e",
      from: { nodeId: "editor", portId: "audition-out" },
      to: { nodeId: "output", portId: "notes-in" },
      enabled: true,
    };
    let graph = executeGraphCommand(emptyGraph(), { type: "add-node", node: editor }).graph;
    graph = executeGraphCommand(graph, { type: "add-node", node: output }).graph;
    graph = executeGraphCommand(graph, { type: "add-edge", edge }).graph;

    const removed = executeGraphCommand(graph, { type: "remove-edge", edgeId: "e" });
    expect(removed.graph.edges.e).toBeUndefined();
    expect(executeGraphCommand(removed.graph, removed.inverse).graph.edges.e).toEqual(edge);
  });

  it("refuses commands that name something that is not there", () => {
    const clock = createNode("m.transport-clock", "clock", { x: 0, y: 0 });
    const graph = executeGraphCommand(emptyGraph(), { type: "add-node", node: clock }).graph;

    expect(() => executeGraphCommand(graph, { type: "add-node", node: clock }))
      .toThrow("Duplicate node");
    expect(() => executeGraphCommand(graph, { type: "remove-edge", edgeId: "ghost" }))
      .toThrow("Unknown edge");
    expect(() => executeGraphCommand(graph, {
      type: "set-parameter", nodeId: "ghost", parameterId: "tempo", value: 1,
    })).toThrow("Unknown node");
    expect(() => executeGraphCommand(graph, { type: "remove-nodes", nodeIds: ["ghost"] }))
      .toThrow("Unknown node");

    const edge: Edge = {
      id: "e",
      from: { nodeId: "clock", portId: "transport-out" },
      to: { nodeId: "ghost", portId: "transport-in" },
      enabled: true,
    };
    expect(() => executeGraphCommand(graph, { type: "add-edge", edge })).toThrow("Unknown node");
    const withEdge = executeGraphCommand(graph, {
      type: "add-edge",
      edge: { ...edge, to: { nodeId: "clock", portId: "reset-in" } },
    }).graph;
    expect(() => executeGraphCommand(withEdge, {
      type: "add-edge", edge: { ...edge, to: { nodeId: "clock", portId: "reset-in" } },
    })).toThrow("Duplicate edge");
  });
});
