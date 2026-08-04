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

  it("fans a preset position out to every part that has one", () => {
    // The whole point of the compound's position input: one cable moves the
    // entire stream to the same stored idea.
    const graph = emptyGraph();
    graph.nodes.src = createNode("m.transport-clock", "src", { x: 0, y: 0 });
    graph.nodes.stream = createNode("m.stream", "stream", { x: 300, y: 0 });
    graph.edges.p = {
      id: "p",
      from: { nodeId: "src", portId: "clock-out" },
      to: { nodeId: "stream", portId: "position-in" },
      enabled: true,
    };
    const targets = Object.values(expandStreamNode(graph, "stream").edges)
      .filter((edge) => edge.to.portId === "position-in")
      .map((edge) => edge.to.nodeId);
    expect(targets.length).toBe(11);
    expect(new Set(targets).size).toBe(11);
    expect(targets).toContain("stream-cyclicAccent");
    expect(targets).toContain("stream-playEnable");
  });

  it("drops a cable on a port the expansion cannot account for", () => {
    const graph = emptyGraph();
    graph.nodes.src = createNode("m.transport-clock", "src", { x: 0, y: 0 });
    graph.nodes.stream = createNode("m.stream", "stream", { x: 300, y: 0 });
    graph.nodes.out = createNode("m.midi-output", "out", { x: 900, y: 0 });
    graph.edges.bad = {
      id: "bad",
      from: { nodeId: "src", portId: "clock-out" },
      to: { nodeId: "stream", portId: "invented-in" },
      enabled: true,
    };
    graph.edges.alsoBad = {
      id: "alsoBad",
      from: { nodeId: "stream", portId: "invented-out" },
      to: { nodeId: "out", portId: "notes-in" },
      enabled: true,
    };
    const expanded = expandStreamNode(graph, "stream");
    expect(expanded.edges.bad).toBeUndefined();
    expect(expanded.edges.alsoBad).toBeUndefined();
  });

  it("does not take an id another node or edge already owns", () => {
    const graph = emptyGraph();
    graph.nodes.src = createNode("m.transport-clock", "src", { x: 0, y: 0 });
    graph.nodes.stream = createNode("m.stream", "stream", { x: 300, y: 0 });
    graph.nodes["stream-timeBase"] = createNode("m.phase", "stream-timeBase", { x: 0, y: 500 });
    graph.edges.r = {
      id: "r",
      from: { nodeId: "src", portId: "reset-out" },
      to: { nodeId: "stream", portId: "reset-in" },
      enabled: true,
    };
    const expanded = expandStreamNode(graph, "stream");
    expect(expanded.nodes["stream-timeBase"].moduleType).toBe("m.phase");
    expect(expanded.nodes["stream-timeBase-2"].moduleType).toBe("m.time-base");
    // The reset forked into several cables, none of them colliding.
    const ids = Object.keys(expanded.edges);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps counting when the next id is taken too", () => {
    const graph = emptyGraph();
    graph.nodes.stream = createNode("m.stream", "stream", { x: 0, y: 0 });
    graph.nodes["stream-phase"] = createNode("m.time-base", "stream-phase", { x: 0, y: 500 });
    graph.nodes["stream-phase-2"] = createNode("m.time-base", "stream-phase-2", { x: 0, y: 600 });
    expect(expandStreamNode(graph, "stream").nodes["stream-phase-3"].moduleType).toBe("m.phase");
  });

  it("treats a missing preset position as the first slot", () => {
    const graph = emptyGraph();
    graph.nodes.stream = createNode("m.stream", "stream", { x: 0, y: 0 });
    delete graph.nodes.stream.parameters["active-position"];
    const expanded = expandStreamNode(graph, "stream");
    expect(expanded.nodes["stream-cyclicAccent"].parameters["active-position"]).toBe(0);
  });

  it("leaves a node that is not a Stream alone", () => {
    const graph = emptyGraph();
    graph.nodes.a = createNode("m.phase", "a", { x: 0, y: 0 });
    expect(expandStreamNode(graph, "a")).toBe(graph);
    expect(expandStreamNode(graph, "nobody")).toBe(graph);
    expect(materializeStreamCompounds(graph)).toEqual(graph);
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
