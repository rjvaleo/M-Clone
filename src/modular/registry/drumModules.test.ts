import { describe, expect, it } from "vitest";
import { createNode, moduleRegistry, validateModuleDescriptor } from "./registry";
import { DRUM_SEQ_TYPE } from "./drumModules";
import { defaultDrumRows, MAX_DRUM_ROWS, MAX_DRUM_STEPS } from "../drums/drumSeq";
import { compileGraph } from "../compiler/compileGraph";
import { emptyGraph } from "../model/graph";
import { snapshotOf } from "../mlab/presets";

const descriptor = () => moduleRegistry.get(DRUM_SEQ_TYPE)!;
const ports = (direction: "input" | "output") =>
  descriptor().ports.filter((port) => port.direction === direction).map((port) => `${port.id}:${port.signal.kind}`);
const parameter = (id: string) => descriptor().parameters.find((p) => p.id === id)!;

describe("m.drum-seq in the registry", () => {
  it("is registered, valid, and listed with the sequencers", () => {
    expect(DRUM_SEQ_TYPE).toBe("m.drum-seq");
    expect(validateModuleDescriptor(descriptor())).toEqual([]);
    expect(descriptor().family).toBe("source");
    expect(descriptor().label).toBe("Drum Sequencer");
  });

  it("wires as a Numerology sequencer: a clock and Sync in, notes out", () => {
    expect(ports("input")).toEqual(["clock-in:transport", "sync-in:reset"]);
    expect(ports("output")).toEqual(["notes-out:note-event"]);
    expect(descriptor().ports.find((port) => port.id === "clock-in")?.required).toBe(true);
    expect(descriptor().commands?.map((c) => c.id)).toEqual(["reset"]);
  });

  it("starts with the default rows, ten in play, a sixteen-step bar of sixteenths on channel 10", () => {
    const node = createNode(DRUM_SEQ_TYPE, "d", { x: 0, y: 0 });
    expect(node.parameters.rows).toEqual(defaultDrumRows());
    expect(node.parameters).toMatchObject({
      tracks: 10, length: 16, "rate-num": 1, "rate-den": 16, swing: 50, "flam-level": 0.6, free: false,
      play: true, seed: 0, channel: 10, "edit-lane": "vel", "edit-row": 0, scroll: 0,
    });
    expect(parameter("tracks")).toMatchObject({ minimum: 1, maximum: MAX_DRUM_ROWS });
    expect(parameter("length")).toMatchObject({ minimum: 1, maximum: MAX_DRUM_STEPS });
    expect(parameter("swing")).toMatchObject({ minimum: 50, maximum: 75 });
  });

  it("has a Numerology header and one custom face that lists every parameter it edits", () => {
    const node = createNode(DRUM_SEQ_TYPE, "d", { x: 0, y: 0 });
    expect(node.parameters.comment).toBe("...");
    expect(node.parameters.collapsed).toBe(false);
    const elements = descriptor().face.flatMap((section) => section.elements);
    expect(elements).toHaveLength(1);
    const face = elements[0];
    expect(face).toMatchObject({ kind: "custom", id: "m-drum-seq" });
    if (face.kind !== "custom") throw new Error("custom face expected");
    for (const p of descriptor().parameters) expect(face.parameterIds, p.id).toContain(p.id);
  });

  it("keeps what the face shows out of its presets: the lane, the row edited, the scroll", () => {
    const snapshot = snapshotOf(createNode(DRUM_SEQ_TYPE, "d", { x: 0, y: 0 }).parameters);
    expect(Object.keys(snapshot)).toContain("rows");
    for (const id of ["edit-lane", "edit-row", "scroll"]) expect(Object.keys(snapshot)).not.toContain(id);
  });

  it("compiles into a patch: transport into the sequencer, its notes into m.percussion", () => {
    const graph = emptyGraph();
    graph.nodes.t = createNode("m.transport-clock", "t", { x: 0, y: 0 });
    graph.nodes.d = createNode(DRUM_SEQ_TYPE, "d", { x: 0, y: 0 });
    graph.nodes.p = createNode("m.percussion", "p", { x: 0, y: 0 });
    const wire = (id: string, from: string, fromPort: string, to: string, toPort: string) => {
      graph.edges[id] = { id, from: { nodeId: from, portId: fromPort }, to: { nodeId: to, portId: toPort }, enabled: true };
    };
    wire("a", "t", "transport-out", "d", "clock-in");
    wire("b", "t", "reset-out", "d", "sync-in");
    wire("c", "d", "notes-out", "p", "notes-in");
    expect(compileGraph(graph, moduleRegistry, { seed: 1 }).ok).toBe(true);
  });
});
