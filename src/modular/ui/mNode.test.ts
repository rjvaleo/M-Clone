import { describe, expect, it } from "vitest";
import { emptyGraph, type GraphDocument } from "../model/graph";
import { createNode, moduleRegistry } from "../registry/registry";
import { M_NODE_TYPE, M_TRACKS, findMNode, routedTracks, trackPort, trackTargets } from "./mNode";

const cable = (graph: GraphDocument, id: string, from: string, port: string, to: string, enabled = true) => {
  graph.edges[id] = { id, from: { nodeId: from, portId: port }, to: { nodeId: to, portId: "notes-in" }, enabled };
};

const patch = () => {
  const graph = emptyGraph();
  graph.nodes.m = createNode(M_NODE_TYPE, "m", { x: 0, y: 0 });
  graph.nodes.a = createNode("m.synth", "a", { x: 0, y: 0 });
  graph.nodes.b = createNode("m.percussion", "b", { x: 0, y: 0 });
  graph.nodes.c = createNode("m.synth", "c", { x: 0, y: 0 });
  return graph;
};

describe("the M node", () => {
  it("is one node with a note output per track and no audio of its own", () => {
    const descriptor = moduleRegistry.get(M_NODE_TYPE)!;
    expect(descriptor.label).toBe("M");
    const outputs = descriptor.ports.filter((port) => port.direction === "output");
    expect(outputs.map((port) => port.id)).toEqual(Array.from({ length: M_TRACKS }, (_, i) => trackPort(i)));
    expect(outputs.every((port) => port.signal.kind === "note-event")).toBe(true);
    expect(descriptor.ports.some((port) => port.signal.kind === "audio")).toBe(false);
  });

  it("finds the canvas's M", () => {
    expect(findMNode(patch())).toBe("m");
    expect(findMNode(emptyGraph())).toBeNull();
  });

  it("sends each track's notes to every sound module cabled to its output", () => {
    const graph = patch();
    cable(graph, "e1", "m", trackPort(0), "a");
    cable(graph, "e2", "m", trackPort(0), "b");
    cable(graph, "e3", "m", trackPort(2), "c");
    const targets = trackTargets(graph, "m");
    expect(targets.get(0)).toEqual(["a", "b"]);
    expect(targets.get(1)).toBeUndefined();
    expect(targets.get(2)).toEqual(["c"]);
  });

  it("ignores switched-off cables", () => {
    const graph = patch();
    cable(graph, "e1", "m", trackPort(1), "a", false);
    expect(trackTargets(graph, "m").size).toBe(0);
  });

  it("knows which tracks are routed out, so M's own synth can leave them alone", () => {
    const graph = patch();
    cable(graph, "e1", "m", trackPort(3), "a");
    expect([...routedTracks(graph, "m")]).toEqual([3]);
  });
});
