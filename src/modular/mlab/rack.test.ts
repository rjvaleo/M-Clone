import { describe, expect, it } from "vitest";
import { compileGraph } from "../compiler/compileGraph";
import { moduleRegistry } from "../registry/registry";
import { buildMRack } from "./rack";

describe("the M Rack template", () => {
  it("is M as a rack: a Conductor, Variables and Orchestra, then a NoteSeq per voice", () => {
    const graph = buildMRack();
    const types = Object.values(graph.nodes).map((node) => node.moduleType);
    expect(types.filter((t) => t === "m.lab-noteseq")).toHaveLength(4);
    for (const type of ["m.lab-conductor", "m.lab-variables", "m.lab-density", "m.lab-velocity-range", "m.lab-transposition", "m.lab-note-order", "m.lab-orchestra", "m.synth", "m.audio-output"]) {
      expect(types).toContain(type);
    }
    const voices = Object.values(graph.nodes).filter((n) => n.moduleType === "m.lab-noteseq").map((n) => n.parameters.voice);
    expect(voices).toEqual([1, 2, 3, 4]);
  });

  it("compiles, every voice clocked by the Conductor and heard through the Orchestra", () => {
    const graph = buildMRack();
    expect(compileGraph(graph, moduleRegistry, { seed: 1 }).ok).toBe(true);
    const into = (nodeId: string, port: string) => Object.values(graph.edges).some((e) => e.to.nodeId === nodeId && e.to.portId === port);
    for (const v of [1, 2, 3, 4]) {
      expect(into(`noteseq-${v}`, "clock-in")).toBe(true);
      expect(Object.values(graph.edges).some((e) => e.from.nodeId === `noteseq-${v}` && e.to.nodeId === "orchestra-1")).toBe(true);
    }
  });
});
