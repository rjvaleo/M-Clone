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
});
