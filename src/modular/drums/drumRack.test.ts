import { describe, expect, it } from "vitest";
import { compileGraph } from "../compiler/compileGraph";
import { moduleRegistry } from "../registry/registry";
import { buildDrumRack } from "./drumRack";

describe("the Drum Machine template", () => {
  it("is a transport, a Drum Sequencer, Percussion and the audio output", () => {
    const graph = buildDrumRack();
    expect(Object.values(graph.nodes).map((node) => node.moduleType).sort())
      .toEqual(["m.audio-output", "m.drum-seq", "m.percussion", "m.transport-clock"]);
  });

  it("compiles, the sequencer clocked by the transport and heard through Percussion", () => {
    const graph = buildDrumRack();
    expect(compileGraph(graph, moduleRegistry, { seed: 1 }).ok).toBe(true);
    const cable = (from: string, fromPort: string, to: string, toPort: string) =>
      Object.values(graph.edges).some((e) => e.from.nodeId === from && e.from.portId === fromPort && e.to.nodeId === to && e.to.portId === toPort);
    expect(cable("transport-1", "transport-out", "drums-1", "clock-in")).toBe(true);
    expect(cable("transport-1", "reset-out", "drums-1", "sync-in")).toBe(true);
    expect(cable("drums-1", "notes-out", "percussion-1", "notes-in")).toBe(true);
    expect(cable("percussion-1", "audio-out", "output-1", "audio-in")).toBe(true);
  });
});
