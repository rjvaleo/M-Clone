import { describe, expect, it } from "vitest";
import { canAddModule, moduleLimit } from "./limits";
import { emptyGraph } from "./graph";
import { createNode } from "../registry/registry";

describe("modules limited per canvas", () => {
  it("allows one M per canvas", () => {
    const graph = emptyGraph();
    expect(moduleLimit("m.m")).toBe(1);
    expect(canAddModule(graph, "m.m")).toBe(true);
    graph.nodes.m = createNode("m.m", "m", { x: 0, y: 0 });
    expect(canAddModule(graph, "m.m")).toBe(false);
  });

  it("leaves every other module unlimited", () => {
    const graph = emptyGraph();
    for (let i = 0; i < 5; i++) graph.nodes[`s${i}`] = createNode("m.synth", `s${i}`, { x: 0, y: 0 });
    expect(moduleLimit("m.synth")).toBe(Infinity);
    expect(canAddModule(graph, "m.synth")).toBe(true);
  });
});
