import { describe, expect, it } from "vitest";
import { emptyGraph, type GraphDocument } from "../model/graph";
import { createNode } from "../registry/registry";
import { variableLinkUpdates, variablesStateOf, quantizeMorph } from "./links";
import { activate } from "./variables";

const canvas = (types: [string, string][]): GraphDocument => {
  const graph = emptyGraph();
  for (const [id, type] of types) graph.nodes[id] = createNode(type, id, { x: 0, y: 0 });
  return graph;
};

describe("position links from M Variables", () => {
  it("writes nothing when there is no M Variables", () => {
    expect(variableLinkUpdates(canvas([["ns", "m.lab-noteseq"]]))).toEqual([]);
  });

  it("sets each M module on the canvas to the variables' positions", () => {
    const graph = canvas([["vars", "m.lab-variables"], ["ns1", "m.lab-noteseq"], ["ns2", "m.lab-noteseq"], ["tw", "m.lab-time-warp"]]);
    graph.nodes.ns2.parameters.voice = 2;
    const state = activate(activate(variablesStateOf(graph.nodes.vars), "patternGroup", 2), "timeDistortion", 3);
    graph.nodes.vars.parameters.active = state.active as never;
    const updates = variableLinkUpdates(graph);
    expect(updates.find((u) => u.nodeId === "ns1")?.values.group).toBe(2);
    expect(updates.find((u) => u.nodeId === "ns2")?.values.group).toBe(2);
    expect(updates.find((u) => u.nodeId === "tw")?.values).toEqual({ position: 3 });
  });

  it("settles: once applied, there is nothing more to write", () => {
    const graph = canvas([["vars", "m.lab-variables"], ["ns", "m.lab-noteseq"], ["tw", "m.lab-time-warp"], ["or", "m.lab-orchestra"]]);
    for (const update of variableLinkUpdates(graph)) Object.assign(graph.nodes[update.nodeId].parameters, update.values);
    expect(variableLinkUpdates(graph)).toEqual([]);
  });

  it("lands changes now, on the beat or on the bar, as Snapshots on says", () => {
    expect(quantizeMorph("now")).toBe("immediate");
    expect(quantizeMorph("beat")).toBe("next-beat");
    expect(quantizeMorph("bar")).toBe("next-bar");
  });
});
