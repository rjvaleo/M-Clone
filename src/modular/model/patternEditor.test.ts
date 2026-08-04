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

  it("leaves a node that is not a Pattern Editor alone", () => {
    const graph = withEditor();
    expect(expandPatternEditor(graph, "clock")).toBe(graph);
    expect(expandPatternEditor(graph, "nobody")).toBe(graph);
  });
});

describe("Cables that touched the compound", () => {
  const withCable = (from: string, to: string, portId: string): GraphDocument => {
    const graph = withEditor();
    if (from === "pe") {
      graph.edges.probe = {
        id: "probe",
        from: { nodeId: "pe", portId },
        to: { nodeId: "out", portId: "notes-in" },
        enabled: true,
      };
    } else {
      graph.edges.probe = {
        id: "probe",
        from: { nodeId: to, portId: "clock-out" },
        to: { nodeId: "pe", portId },
        enabled: true,
      };
    }
    return graph;
  };

  it("fans a reset out to every part that can be reset", () => {
    // One cable in, six cables inside: the compound was doing this invisibly.
    const graph = withEditor();
    graph.nodes.reset = createNode("m.transport-clock", "reset", { x: 0, y: 400 });
    graph.edges.r = {
      id: "r",
      from: { nodeId: "reset", portId: "reset-out" },
      to: { nodeId: "pe", portId: "reset-in" },
      enabled: true,
    };
    const targets = Object.values(expandPatternEditor(graph, "pe").edges)
      .filter((edge) => edge.from.nodeId === "reset")
      .map((edge) => edge.to.nodeId)
      .sort();
    expect(targets).toEqual([
      "pe-cyclicAccent", "pe-cyclicLegato", "pe-cyclicRhythm",
      "pe-noteEditor", "pe-noteOrder", "pe-phase", "pe-timeBase",
    ].filter((id) => targets.includes(id)));
    expect(targets.length).toBeGreaterThan(3);
  });

  it("sends a preset position only to parts that declare the port", () => {
    // Step→Notes is a utility with no positions. A cable into a port it does not
    // declare is a dangling edge the compiler would rightly refuse.
    const graph = withEditor();
    graph.nodes.src = createNode("m.transport-clock", "src", { x: 0, y: 400 });
    graph.edges.p = {
      id: "p",
      from: { nodeId: "src", portId: "clock-out" },
      to: { nodeId: "pe", portId: "position-in" },
      enabled: true,
    };
    const expanded = expandPatternEditor(graph, "pe");
    const targets = Object.values(expanded.edges)
      .filter((edge) => edge.to.portId === "position-in")
      .map((edge) => edge.to.nodeId);
    expect(targets).toContain("pe-cyclicAccent");
    expect(targets).not.toContain("pe-stepToNotes");
    // The invariant behind the filter: no cable may end on a port its node does
    // not declare. Nothing produces `control<index>` yet, so this cannot be
    // checked by compiling — it has to be checked against the descriptors.
    for (const edge of Object.values(expanded.edges)) {
      const ports = moduleRegistry.get(expanded.nodes[edge.to.nodeId].moduleType)?.ports ?? [];
      expect(ports.some((port) => port.id === edge.to.portId), edge.id).toBe(true);
    }
  });

  it("routes recording to the note editor", () => {
    const graph = withCable("x", "clock", "record-in");
    graph.edges.probe.from = { nodeId: "clock", portId: "transport-out" };
    const edges = Object.values(expandPatternEditor(graph, "pe").edges);
    expect(edges).toContainEqual(expect.objectContaining({
      to: { nodeId: "pe-noteEditor", portId: "record-in" },
    }));
  });

  it("offers the warped clock and the audition, from the parts that make them", () => {
    const clockOut = Object.values(expandPatternEditor(withCable("pe", "out", "clock-out"), "pe").edges)
      .find((edge) => edge.id === "probe");
    expect(clockOut?.from).toEqual({ nodeId: "pe-cyclicRhythm", portId: "clock-out" });

    const audition = Object.values(expandPatternEditor(withCable("pe", "out", "audition-out"), "pe").edges)
      .find((edge) => edge.id === "probe");
    expect(audition?.from).toEqual({ nodeId: "pe-noteEditor", portId: "audition-out" });
  });

  it("drops a cable whose port the expansion cannot account for", () => {
    // Better a missing cable than one pointing at a port that does not exist.
    const fromNowhere = expandPatternEditor(withCable("pe", "out", "invented-out"), "pe");
    expect(fromNowhere.edges.probe).toBeUndefined();

    const toNowhere = withEditor();
    toNowhere.edges.probe = {
      id: "probe",
      from: { nodeId: "clock", portId: "transport-out" },
      to: { nodeId: "pe", portId: "invented-in" },
      enabled: true,
    };
    expect(expandPatternEditor(toNowhere, "pe").edges.probe).toBeUndefined();
  });

  it("does not collide with node or edge ids that are already taken", () => {
    const graph = withEditor();
    graph.nodes["pe-timeBase"] = createNode("m.phase", "pe-timeBase", { x: 0, y: 900 });
    graph.edges["pe-clock-tb-ph"] = {
      id: "pe-clock-tb-ph",
      from: { nodeId: "clock", portId: "transport-out" },
      to: { nodeId: "pe-timeBase", portId: "reset-in" },
      enabled: true,
    };
    const expanded = expandPatternEditor(graph, "pe");
    // The existing node keeps its id and its type; the new part takes another.
    expect(expanded.nodes["pe-timeBase"].moduleType).toBe("m.phase");
    expect(expanded.nodes["pe-timeBase-2"].moduleType).toBe("m.time-base");
    expect(expanded.edges["pe-clock-tb-ph-2"]).toBeDefined();
  });

  it("keeps counting when the next id is taken too", () => {
    const graph = withEditor();
    graph.nodes["pe-phase"] = createNode("m.time-base", "pe-phase", { x: 0, y: 900 });
    graph.nodes["pe-phase-2"] = createNode("m.time-base", "pe-phase-2", { x: 0, y: 1000 });
    const expanded = expandPatternEditor(graph, "pe");
    expect(expanded.nodes["pe-phase-3"].moduleType).toBe("m.phase");
  });

  it("hands a part nothing for a parameter the compound has lost", () => {
    // A document written by an older build can be missing a key. The part should
    // fall back to its own default rather than receive `undefined`.
    const graph = withEditor();
    delete graph.nodes.pe.parameters.numerator;
    const timeBase = expandPatternEditor(graph, "pe").nodes["pe-timeBase"];
    expect(timeBase.parameters.numerator).toBe(1);
  });

  it("treats a missing preset position as the first slot", () => {
    const graph = withEditor();
    delete graph.nodes.pe.parameters["active-position"];
    const expanded = expandPatternEditor(graph, "pe");
    expect(expanded.nodes["pe-cyclicAccent"].parameters["active-position"]).toBe(0);
  });

  it("expands several compounds in a stable order", () => {
    const graph = withEditor();
    graph.nodes.pe2 = createNode("m.pattern-editor", "pe2", { x: 400, y: 900 });
    const expanded = materializePatternEditors(graph);
    expect(expanded.nodes["pe-timeBase"]).toBeDefined();
    expect(expanded.nodes["pe2-timeBase"]).toBeDefined();
    expect(expanded.nodes.pe).toBeUndefined();
    expect(expanded.nodes.pe2).toBeUndefined();
  });
});
