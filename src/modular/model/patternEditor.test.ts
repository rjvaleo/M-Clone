import { describe, expect, it } from "vitest";
import { PATTERN_PARTS, expandPatternEditor, materializePatternEditors } from "./patternEditor";
import { createNode, moduleRegistry } from "../registry/registry";
import { compileGraph } from "../compiler/compileGraph";
import { emptyGraph, type GraphDocument } from "./graph";

const withEditor = (): GraphDocument => {
  const graph = emptyGraph();
  graph.nodes.clock = createNode("m.transport-clock", "clock", { x: 0, y: 0 });
  graph.nodes.pe = createNode("m.pattern-editor", "pe", { x: 400, y: 0 });
  graph.nodes.out = createNode("m.midi-output", "out", { x: 900, y: 0 });
  graph.edges.e1 = {
    id: "e1",
    from: { nodeId: "clock", portId: "transport-out" },
    to: { nodeId: "pe", portId: "transport-in" },
    enabled: true,
  };
  graph.edges.e2 = {
    id: "e2",
    from: { nodeId: "pe", portId: "notes-out" },
    to: { nodeId: "out", portId: "notes-in" },
    enabled: true,
  };
  return graph;
};

describe("The Pattern Editor compound", () => {
  it("expands into the modules it stands for", () => {
    const expanded = expandPatternEditor(withEditor(), "pe");
    expect(expanded.nodes.pe).toBeUndefined();
    for (const { key, type } of PATTERN_PARTS) {
      expect(expanded.nodes[`pe-${key}`]?.moduleType, key).toBe(type);
    }
  });

  it("keeps every part available as its own module", () => {
    // The rule: merging never removes the individual modules, and the compound
    // takes a name of its own rather than one of theirs.
    for (const { type } of PATTERN_PARTS) expect(moduleRegistry.has(type)).toBe(true);
    expect(moduleRegistry.get("m.note-editor")?.label).toBe("Note Editor");
    expect(moduleRegistry.get("m.pattern-editor")?.label).toBe("Pattern Editor");
  });

  it("takes a clock in and hands out fully formed notes", () => {
    const expanded = expandPatternEditor(withEditor(), "pe");
    const edges = Object.values(expanded.edges);
    // The transport lands on the Time Base, which is where a clock enters.
    expect(edges).toContainEqual(expect.objectContaining({
      from: { nodeId: "clock", portId: "transport-out" },
      to: { nodeId: "pe-timeBase", portId: "transport-in" },
    }));
    // What leaves is a note that has already been through velocity and legato.
    expect(edges).toContainEqual(expect.objectContaining({
      from: { nodeId: "pe-legato", portId: "notes-out" },
      to: { nodeId: "out", portId: "notes-in" },
    }));
  });

  it("wires accent into velocity and legato into length", () => {
    // This is what "fully formed" means: the cyclic streams are already in the
    // note, rather than being three more cables for the user to make.
    const edges = Object.values(expandPatternEditor(withEditor(), "pe").edges);
    expect(edges).toContainEqual(expect.objectContaining({
      from: { nodeId: "pe-cyclicAccent", portId: "accent-out" },
      to: { nodeId: "pe-velocityRange", portId: "accent-in" },
    }));
    expect(edges).toContainEqual(expect.objectContaining({
      from: { nodeId: "pe-cyclicLegato", portId: "legato-out" },
      to: { nodeId: "pe-legato", portId: "legato-in" },
    }));
  });

  it("hands each part the state the compound holds for it", () => {
    const graph = withEditor();
    graph.nodes.pe.parameters.numerator = 3;
    graph.nodes.pe.parameters["offset-ticks"] = 240;
    graph.nodes.pe.parameters["accent-length"] = 5;
    const expanded = expandPatternEditor(graph, "pe");
    expect(expanded.nodes["pe-timeBase"].parameters.numerator).toBe(3);
    expect(expanded.nodes["pe-phase"].parameters["offset-ticks"]).toBe(240);
    expect(expanded.nodes["pe-cyclicAccent"].parameters["sequence-length"]).toBe(5);
  });

  it("moves every part to the same preset position", () => {
    // One bank for the whole idea: recalling a slot must not leave the accent
    // on one position and the pattern on another.
    const graph = withEditor();
    graph.nodes.pe.parameters["active-position"] = 4;
    const expanded = expandPatternEditor(graph, "pe");
    for (const { key } of PATTERN_PARTS) {
      const part = expanded.nodes[`pe-${key}`];
      // Step→Notes is a utility with no preset positions of its own.
      if (!("active-position" in part.parameters)) continue;
      expect(part.parameters["active-position"], key).toBe(4);
    }
    expect(expanded.nodes["pe-cyclicAccent"].parameters["active-position"]).toBe(4);
    expect(expanded.nodes["pe-noteEditor"].parameters["active-position"]).toBe(4);
  });

  it("compiles to a runnable plan", () => {
    const result = compileGraph(withEditor(), moduleRegistry);
    expect(result.ok, result.ok ? "" : JSON.stringify(result.diagnostics)).toBe(true);
    if (!result.ok) return;
    // Every part is a real node in the evaluation order, and the compound is not.
    expect(result.plan.order).toContain("pe-timeBase");
    expect(result.plan.order).toContain("pe-legato");
    expect(result.plan.order).not.toContain("pe");
  });

  it("leaves a graph without one untouched", () => {
    const graph = emptyGraph();
    graph.nodes.a = createNode("m.phase", "a", { x: 0, y: 0 });
    expect(materializePatternEditors(graph)).toEqual(graph);
  });
});
