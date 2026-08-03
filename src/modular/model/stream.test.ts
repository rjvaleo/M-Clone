import { describe, expect, it } from "vitest";
import { createNode } from "../registry/registry";
import { emptyGraph } from "./graph";
import { expandStreamNode, materializeStreamCompounds } from "./stream";

describe("Stream compound materialization", () => {
  it("expands one stream into standard single-stream modules", () => {
    const graph = emptyGraph();
    graph.nodes.transport = createNode("m.transport-clock", "transport", { x: 0, y: 0 });
    graph.nodes.editor = createNode("m.note-editor", "editor", { x: 100, y: 0 });
    graph.nodes.stream = createNode("m.stream", "stream", { x: 300, y: 200 });
    graph.nodes.out = createNode("m.midi-output", "out", { x: 1900, y: 0 });

    graph.edges.t1 = {
      id: "t1",
      from: { nodeId: "transport", portId: "transport-out" },
      to: { nodeId: "stream", portId: "transport-in" },
      enabled: true,
    };
    graph.edges.t2 = {
      id: "t2",
      from: { nodeId: "transport", portId: "reset-out" },
      to: { nodeId: "stream", portId: "reset-in" },
      enabled: true,
    };
    graph.edges.p1 = {
      id: "p1",
      from: { nodeId: "editor", portId: "pattern-out" },
      to: { nodeId: "stream", portId: "pattern-in" },
      enabled: true,
    };
    graph.edges.n1 = {
      id: "n1",
      from: { nodeId: "stream", portId: "notes-out" },
      to: { nodeId: "out", portId: "notes-in" },
      enabled: true,
    };

    const expanded = expandStreamNode(graph, "stream");

    expect(expanded.nodes.stream).toBeUndefined();
    expect(Object.keys(expanded.nodes).some((id) => id.includes("stream-timeBase"))).toBe(true);
    expect(Object.keys(expanded.nodes).some((id) => id.includes("stream-transposition"))).toBe(true);
    expect(Object.keys(expanded.nodes).some((id) => id.includes("stream-playEnable"))).toBe(true);

    const toTimeBase = Object.values(expanded.edges).some((edge) =>
      edge.from.nodeId === "transport" && edge.to.nodeId.includes("stream-timeBase") && edge.to.portId === "transport-in");
    expect(toTimeBase).toBe(true);

    const toNoteOrder = Object.values(expanded.edges).some((edge) =>
      edge.from.nodeId === "editor" && edge.to.nodeId.includes("stream-noteOrder") && edge.to.portId === "pattern-in");
    expect(toNoteOrder).toBe(true);

    const toMidi = Object.values(expanded.edges).some((edge) =>
      edge.to.nodeId === "out" && edge.from.nodeId.includes("stream-playEnable") && edge.from.portId === "notes-out");
    expect(toMidi).toBe(true);
  });

  it("materializes all stream nodes deterministically", () => {
    const graph = emptyGraph();
    graph.nodes.first = createNode("m.stream", "first", { x: 0, y: 0 });
    graph.nodes.second = createNode("m.stream", "second", { x: 1000, y: 0 });

    const a = materializeStreamCompounds(graph);
    const b = materializeStreamCompounds(graph);

    expect(Object.keys(a.nodes).sort()).toEqual(Object.keys(b.nodes).sort());
    expect(Object.keys(a.edges).sort()).toEqual(Object.keys(b.edges).sort());
  });
});
