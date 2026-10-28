import { describe, expect, it } from "vitest";
import { isMappable } from "./modulationTargets";
import {
  lfoStates,
  liveLfoValue,
  LFO_COLORS,
  LFO_SHAPES,
  LFO_TYPE,
  extrapolatePhase,
  mappingsByTarget,
  modulatedValue,
  nextLfoColor,
  shapeValue,
  targetKey,
  targetsOf,
  withTarget,
  withoutTarget,
} from "./modulation";
import { createNode, moduleRegistry } from "./registry/registry";
import { emptyGraph, type GraphDocument } from "./model/graph";

const graphWith = (nodes: { id: string; type: string; parameters?: Record<string, unknown> }[]): GraphDocument => {
  const document = emptyGraph();
  for (const entry of nodes) {
    const node = createNode(entry.type, entry.id, { x: 0, y: 0 });
    Object.assign(node.parameters, entry.parameters ?? {});
    document.nodes[entry.id] = node;
  }
  return document;
};

describe("An LFO's mappings", () => {
  it("is a control module with rate, shape, amount, phase, colour and its targets", () => {
    const lfo = moduleRegistry.get(LFO_TYPE)!;
    expect(lfo.family).toBe("control");
    expect(lfo.parameters.map((p) => p.id)).toEqual(["rate", "shape", "amount", "phase", "color", "targets"]);
    expect(lfo.parameters.find((p) => p.id === "shape")?.options).toEqual(LFO_SHAPES);
  });

  it("adds a target once, and removes it", () => {
    const one = withTarget([], { nodeId: "d", parameterId: "feedback" });
    expect(withTarget(one, { nodeId: "d", parameterId: "feedback" })).toEqual(one);
    const two = withTarget(one, { nodeId: "r", parameterId: "mix" });
    expect(withoutTarget(two, { nodeId: "d", parameterId: "feedback" })).toEqual([{ nodeId: "r", parameterId: "mix" }]);
  });

  it("reads only well-formed targets from a document", () => {
    const node = createNode(LFO_TYPE, "l", { x: 0, y: 0 });
    node.parameters.targets = [{ nodeId: "d", parameterId: "feedback" }, { nodeId: 3 }, "junk"] as never;
    expect(targetsOf(node)).toEqual([{ nodeId: "d", parameterId: "feedback" }]);
  });

  it("knows every LFO on each knob, with its colour", () => {
    const graph = graphWith([
      { id: "d", type: "m.audio-delay" },
      { id: "l1", type: LFO_TYPE, parameters: { color: LFO_COLORS[2].name, targets: [{ nodeId: "d", parameterId: "feedback" }] } },
      { id: "l2", type: LFO_TYPE, parameters: { color: LFO_COLORS[5].name, targets: [{ nodeId: "d", parameterId: "feedback" }, { nodeId: "gone", parameterId: "x" }] } },
    ]);
    const map = mappingsByTarget(graph);
    expect(map.get(targetKey({ nodeId: "d", parameterId: "feedback" }))?.map((m) => [m.lfoNodeId, m.color])).toEqual([
      ["l1", LFO_COLORS[2].value],
      ["l2", LFO_COLORS[5].value],
    ]);
    // A target whose module has gone is not drawn anywhere.
    expect(map.has(targetKey({ nodeId: "gone", parameterId: "x" }))).toBe(false);
  });

  it("gives a new LFO the first colour no other LFO wears", () => {
    const graph = graphWith([
      { id: "l1", type: LFO_TYPE, parameters: { color: LFO_COLORS[0].name } },
      { id: "l2", type: LFO_TYPE, parameters: { color: LFO_COLORS[1].name } },
    ]);
    expect(nextLfoColor(graph)).toBe(LFO_COLORS[2].name);
  });
});

describe("Where a modulated knob is", () => {
  it("moves by the LFO's value over half the knob's range, inside the range", () => {
    expect(modulatedValue(0.5, 0.5, 0, 1)).toBeCloseTo(0.75);
    expect(modulatedValue(0.5, -1, 0, 1)).toBe(0);
    expect(modulatedValue(100, 1, 20, 20000)).toBe(10_090);
    expect(modulatedValue(19_000, 1, 20, 20000)).toBe(20_000);
  });

  it("draws the shapes the Rust LFO plays, and none for the random ones", () => {
    expect(shapeValue(0, 0.25)).toBeCloseTo(1);
    expect(shapeValue(1, 0.75)).toBeCloseTo(0);
    expect(shapeValue(2, 0.75)).toBeCloseTo(0.5);
    expect(shapeValue(3, 0.75)).toBeCloseTo(-0.5);
    expect(shapeValue(4, 0.6)).toBe(-1);
    expect(shapeValue(5, 0.3)).toBeNull();
    expect(shapeValue(6, 0.3)).toBeNull();
  });

  it("carries the phase forward between reports, wrapping at one", () => {
    expect(extrapolatePhase(0.25, 2, 0.25)).toBeCloseTo(0.75);
    expect(extrapolatePhase(0.9, 1, 0.2)).toBeCloseTo(0.1);
  });
});

describe("What a face draws between reports", () => {
  it("carries a predictable shape forward from the last report, scaled by the amount", () => {
    // A sine at 1 Hz reported at phase 0: a quarter second later it is at its top.
    expect(liveLfoValue({ phase: 0, value: 0, at: 10 }, { rate: 1, shape: 0, amount: 0.5 }, 10.25)).toBeCloseTo(0.5);
  });

  it("holds a random shape's reported value until the next report", () => {
    expect(liveLfoValue({ phase: 0.2, value: -0.3, at: 10 }, { rate: 1, shape: 5, amount: 1 }, 10.4)).toBe(-0.3);
  });

  it("does not run on past a report that has gone stale", () => {
    // Audio stopped: the face holds what it last heard rather than inventing.
    expect(liveLfoValue({ phase: 0, value: 0.1, at: 10 }, { rate: 1, shape: 0, amount: 1 }, 12)).toBe(0.1);
  });

  it("knows which knobs can be mapped", () => {
    expect(isMappable("m.audio-delay", "feedback")).toBe(true);
    // Structural, so Web Audio rebuilds for it and the plan never routes it.
    expect(isMappable("m.audio-delay", "max-delay-seconds")).toBe(false);
    expect(isMappable("m.prism-tremolo", "depth")).toBe(true);
    // A choice moves in steps that are names, not a range.
    expect(isMappable("m.prism-tremolo", "shape")).toBe(false);
    // Event-side modules have no engine half to move.
    expect(isMappable("m.lab-noteseq", "density")).toBe(false);
    expect(isMappable(LFO_TYPE, "rate")).toBe(false);
  });
});

describe("An LFO as a face draws it", () => {
  it("reads its rate, shape and amount from the document", () => {
    const graph = graphWith([{ id: "l", type: LFO_TYPE, parameters: { rate: 3, shape: "Saw down", amount: 0.2 } }]);
    expect(lfoStates(graph).get("l")).toEqual({ rate: 3, shape: 3, amount: 0.2 });
  });
});
