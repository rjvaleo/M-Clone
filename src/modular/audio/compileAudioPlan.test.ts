import { describe, expect, it } from "vitest";
import { compileAudioPlan, audioOutputNodeIds, hasAudioPorts } from "./compileAudioPlan";
import { diffAudioPlans, isTopologyChange } from "./audioPlan";
import { createNode, moduleRegistry } from "../registry/registry";
import { emptyGraph, type GraphDocument } from "../model/graph";

const graphWith = (
  nodes: { id: string; type: string; parameters?: Record<string, unknown> }[],
  edges: { id: string; from: [string, string]; to: [string, string] }[] = [],
): GraphDocument => {
  const document = emptyGraph();
  for (const entry of nodes) {
    const node = createNode(entry.type, entry.id, { x: 0, y: 0 });
    Object.assign(node.parameters, entry.parameters ?? {});
    document.nodes[entry.id] = node;
  }
  for (const edge of edges) {
    document.edges[edge.id] = {
      id: edge.id,
      from: { nodeId: edge.from[0], portId: edge.from[1] },
      to: { nodeId: edge.to[0], portId: edge.to[1] },
      enabled: true,
    };
  }
  return document;
};

const chain = () => graphWith(
  [
    { id: "delay", type: "m.audio-delay" },
    { id: "out", type: "m.audio-output" },
  ],
  [{ id: "e1", from: ["delay", "audio-out"], to: ["out", "audio-in"] }],
);

describe("Compiling the audio subgraph", () => {
  it("takes only modules that carry audio ports", () => {
    const document = graphWith([
      { id: "gain", type: "m.audio-gain" },
      { id: "phase", type: "m.phase" },
    ]);
    const plan = compileAudioPlan(document, moduleRegistry);
    expect(Object.keys(plan.nodes)).toEqual(["gain"]);
    expect(hasAudioPorts(moduleRegistry, "m.phase")).toBe(false);
    expect(hasAudioPorts(moduleRegistry, "m.audio-reverb")).toBe(true);
  });

  it("sorts every parameter into the half that can carry it", () => {
    const plan = compileAudioPlan(chain(), moduleRegistry);
    const delay = plan.nodes.delay;
    // Structural: a DelayNode's maximum is fixed when it is constructed.
    expect(delay.structure).toEqual({ "max-delay-seconds": 2 });
    // Movable: every one of these is an AudioParam.
    expect(delay.parameters).toEqual({ "delay-seconds": 0.3, feedback: 0.4 });
    // Reserved: handled by the shell, so neither is an ordinary parameter.
    expect(delay.wet).toBe(0.4);
    expect(delay.bypass).toBe(false);
  });

  it("makes a knob move a diff with no topology in it", () => {
    // The single property the whole audio contract rests on.
    const before = compileAudioPlan(chain(), moduleRegistry);
    const moved = chain();
    moved.nodes.delay.parameters["feedback"] = 0.8;
    const diff = diffAudioPlans(before, compileAudioPlan(moved, moduleRegistry));
    expect(isTopologyChange(diff)).toBe(false);
    expect(diff.parameters).toEqual([{ nodeId: "delay", parameterId: "feedback", value: 0.8 }]);
  });

  it("rebuilds when a structural value moves, because it cannot be ramped", () => {
    const before = compileAudioPlan(chain(), moduleRegistry);
    const rebuilt = chain();
    rebuilt.nodes.delay.parameters["max-delay-seconds"] = 4;
    const diff = diffAudioPlans(before, compileAudioPlan(rebuilt, moduleRegistry));
    expect(diff.rebuilt.map((node) => node.nodeId)).toEqual(["delay"]);
    // The cable survives the edit but has to be re-made: one end is a new node.
    expect(diff.connected).toHaveLength(1);
  });

  it("maps mute to bypass and mix to wet", () => {
    const document = chain();
    document.nodes.delay.parameters["mute"] = true;
    document.nodes.delay.parameters["mix"] = 0.9;
    const plan = compileAudioPlan(document, moduleRegistry);
    expect(plan.nodes.delay.bypass).toBe(true);
    expect(plan.nodes.delay.wet).toBe(0.9);
    expect(plan.nodes.delay.parameters).not.toHaveProperty("mute");
    expect(plan.nodes.delay.parameters).not.toHaveProperty("mix");
  });

  it("drops disabled nodes and the cables that touch them", () => {
    const document = chain();
    document.nodes.delay.enabled = false;
    const plan = compileAudioPlan(document, moduleRegistry);
    expect(Object.keys(plan.nodes)).toEqual(["out"]);
    expect(plan.connections).toEqual([]);
  });

  it("takes only cables that actually carry audio", () => {
    const document = graphWith(
      [
        { id: "clock", type: "m.transport-clock" },
        { id: "gain", type: "m.audio-gain" },
        { id: "out", type: "m.audio-output" },
      ],
      [
        { id: "e1", from: ["gain", "audio-out"], to: ["out", "audio-in"] },
        { id: "e2", from: ["clock", "transport-out"], to: ["gain", "audio-in"] },
      ],
    );
    const plan = compileAudioPlan(document, moduleRegistry);
    expect(plan.connections).toHaveLength(1);
    expect(plan.connections[0].from.nodeId).toBe("gain");
  });

  it("compiles the same document to the same plan, so equal graphs diff empty", () => {
    const diff = diffAudioPlans(
      compileAudioPlan(chain(), moduleRegistry, { generation: 1 }),
      compileAudioPlan(chain(), moduleRegistry, { generation: 2 }),
    );
    expect(isTopologyChange(diff)).toBe(false);
    expect(diff.parameters).toEqual([]);
  });

  it("carries every parameter an audio module declares, somewhere", () => {
    // The bug this exists to prevent: `parameters` is numeric by definition, so
    // a string or JSON parameter that is not declared structural is dropped
    // silently. The module then builds perfectly and makes no sound — a
    // percussion kit with no samples, a looper with no loop.
    const orphaned: string[] = [];
    for (const descriptor of moduleRegistry.values()) {
      if (!hasAudioPorts(moduleRegistry, descriptor.type)) continue;
      const node = createNode(descriptor.type, "n", { x: 0, y: 0 });
      const document = emptyGraph();
      document.nodes.n = node;
      const spec = compileAudioPlan(document, moduleRegistry).nodes.n;
      for (const parameter of descriptor.parameters) {
        if (parameter.id === "mix" || parameter.id === "mute") continue;
        const carried = parameter.id in spec.parameters || parameter.id in spec.structure;
        if (!carried) orphaned.push(`${descriptor.type}.${parameter.id}`);
      }
    }
    expect(orphaned, "declare these structural, or the audio layer never sees them")
      .toEqual([]);
  });

  it("hands a percussion kit its slots", () => {
    const document = graphWith([{ id: "drums", type: "m.percussion" }]);
    const spec = compileAudioPlan(document, moduleRegistry).nodes.drums;
    expect(Array.isArray(spec.structure.slots)).toBe(true);
    expect(spec.structure.slots).toHaveLength(8);
  });

  it("names the nodes that reach the speakers", () => {
    expect(audioOutputNodeIds(compileAudioPlan(chain(), moduleRegistry))).toEqual(["out"]);
    const noOutput = graphWith([{ id: "gain", type: "m.audio-gain" }]);
    // Nothing patched to an output is silent, which is the right default for
    // something that can make a loud noise.
    expect(audioOutputNodeIds(compileAudioPlan(noOutput, moduleRegistry))).toEqual([]);
  });
});
