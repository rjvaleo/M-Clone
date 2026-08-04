import { describe, expect, it } from "vitest";
import {
  connectionKey,
  diffAudioPlans,
  emptyAudioPlan,
  isEmptyDiff,
  isTopologyChange,
  type AudioNodeSpec,
  type AudioPlan,
} from "./audioPlan";

const spec = (
  nodeId: string,
  overrides: Partial<AudioNodeSpec> = {},
): AudioNodeSpec => ({
  nodeId,
  moduleType: "m.delay",
  structure: { maxDelaySec: 2 },
  parameters: { delayTime: 0.3, feedback: 0.4 },
  bypass: false,
  wet: 0.5,
  ...overrides,
});

const plan = (nodes: AudioNodeSpec[], connections: AudioPlan["connections"] = []): AudioPlan => ({
  generation: 1,
  nodes: Object.fromEntries(nodes.map((node) => [node.nodeId, node])),
  connections,
});

const cable = (from: string, to: string) => ({
  from: { nodeId: from, portId: "audio-out" },
  to: { nodeId: to, portId: "audio-in" },
});

describe("Diffing an audio plan", () => {
  it("reports nothing for two identical plans", () => {
    const a = plan([spec("delay")], [cable("delay", "out")]);
    expect(isEmptyDiff(diffAudioPlans(a, a))).toBe(true);
  });

  /**
   * The contract this whole module exists for. Rebuilding a subgraph because a
   * knob moved is how an audio application acquires clicks and leaks.
   */
  it("does no topology work for a parameter-only change", () => {
    const before = plan([spec("delay")], [cable("delay", "out")]);
    const after = plan(
      [spec("delay", { parameters: { delayTime: 0.9, feedback: 0.4 } })],
      [cable("delay", "out")],
    );
    const diff = diffAudioPlans(before, after);
    expect(isTopologyChange(diff)).toBe(false);
    expect(diff.parameters).toEqual([{ nodeId: "delay", parameterId: "delayTime", value: 0.9 }]);
  });

  it("does no topology work for a wet or bypass change either", () => {
    const before = plan([spec("delay")]);
    const wetOnly = diffAudioPlans(before, plan([spec("delay", { wet: 0.9 })]));
    expect(isTopologyChange(wetOnly)).toBe(false);
    expect(wetOnly.wet).toEqual([{ nodeId: "delay", wet: 0.9 }]);

    const bypassOnly = diffAudioPlans(before, plan([spec("delay", { bypass: true })]));
    expect(isTopologyChange(bypassOnly)).toBe(false);
    expect(bypassOnly.bypass).toEqual([{ nodeId: "delay", bypass: true }]);
  });

  it("rebuilds when the structure changes", () => {
    // A delay line's maximum length decides the shape of the node, so it cannot
    // be ramped — it has to be rebuilt behind a crossfade.
    const before = plan([spec("delay")]);
    const after = plan([spec("delay", { structure: { maxDelaySec: 4 } })]);
    const diff = diffAudioPlans(before, after);
    expect(diff.rebuilt.map((node) => node.nodeId)).toEqual(["delay"]);
    expect(diff.parameters).toEqual([]);
    expect(isTopologyChange(diff)).toBe(true);
  });

  it("rebuilds when the module type changes under the same id", () => {
    const diff = diffAudioPlans(
      plan([spec("slot")]),
      plan([spec("slot", { moduleType: "m.reverb" })]),
    );
    expect(diff.rebuilt.map((node) => node.nodeId)).toEqual(["slot"]);
  });

  it("compares structure by value, not by identity", () => {
    const before = plan([spec("delay", { structure: { curve: [1, 2, 3] } })]);
    const after = plan([spec("delay", { structure: { curve: [1, 2, 3] } })]);
    expect(isTopologyChange(diffAudioPlans(before, after))).toBe(false);
  });

  it("adds and removes nodes", () => {
    const diff = diffAudioPlans(plan([spec("a")]), plan([spec("b")]));
    expect(diff.added.map((node) => node.nodeId)).toEqual(["b"]);
    expect(diff.removed).toEqual(["a"]);
  });

  it("connects new cables and disconnects departed ones", () => {
    const before = plan([spec("a"), spec("b")], [cable("a", "b")]);
    const after = plan([spec("a"), spec("b")], [cable("b", "a")]);
    const diff = diffAudioPlans(before, after);
    expect(diff.connected).toEqual([cable("b", "a")]);
    expect(diff.disconnected).toEqual([cable("a", "b")]);
  });

  it("leaves an unchanged cable alone", () => {
    const before = plan([spec("a"), spec("b")], [cable("a", "b")]);
    const after = plan(
      [spec("a"), spec("b", { parameters: { delayTime: 1, feedback: 0.4 } })],
      [cable("a", "b")],
    );
    const diff = diffAudioPlans(before, after);
    expect(diff.connected).toEqual([]);
    expect(diff.disconnected).toEqual([]);
  });

  it("re-makes the cables of a rebuilt node", () => {
    // The edge is unchanged, but one end is now a different object, so the
    // connection genuinely has to be made again.
    const before = plan([spec("a"), spec("b")], [cable("a", "b")]);
    const after = plan(
      [spec("a", { structure: { maxDelaySec: 4 } }), spec("b")],
      [cable("a", "b")],
    );
    const diff = diffAudioPlans(before, after);
    expect(diff.connected).toEqual([cable("a", "b")]);
    expect(diff.disconnected).toEqual([cable("a", "b")]);
  });

  it("does not separately disconnect a removed node's cables", () => {
    // They die with the node; disconnecting them too would be a double action.
    const before = plan([spec("a"), spec("b")], [cable("a", "b")]);
    const after = plan([spec("b")]);
    const diff = diffAudioPlans(before, after);
    expect(diff.removed).toEqual(["a"]);
    expect(diff.disconnected).toEqual([]);
  });

  it("is deterministic regardless of key insertion order", () => {
    const forward = diffAudioPlans(emptyAudioPlan(), plan([spec("a"), spec("b"), spec("c")]));
    const reverse = diffAudioPlans(emptyAudioPlan(), plan([spec("c"), spec("b"), spec("a")]));
    expect(forward.added.map((node) => node.nodeId)).toEqual(reverse.added.map((node) => node.nodeId));
    expect(forward.added.map((node) => node.nodeId)).toEqual(["a", "b", "c"]);
  });

  it("keys cables without a separator an id could contain", () => {
    expect(connectionKey(cable("a", "b"))).toBe(connectionKey(cable("a", "b")));
    const odd = {
      from: { nodeId: "a", portId: "out\",\"b" },
      to: { nodeId: "c", portId: "in" },
    };
    expect(connectionKey(odd)).not.toBe(connectionKey(cable("a", "b")));
  });

  it("treats an empty plan as a clean starting point", () => {
    const diff = diffAudioPlans(emptyAudioPlan(), emptyAudioPlan());
    expect(isEmptyDiff(diff)).toBe(true);
    expect(emptyAudioPlan(7).generation).toBe(7);
  });
});
