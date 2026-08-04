import { describe, expect, it } from "vitest";
import { AudioGraphAdapter, type AudioNodeLike, type ManagedAudioNode, type AudioModuleFactory } from "./graphAdapter";
import { diffAudioPlans, emptyAudioPlan, type AudioNodeSpec, type AudioPlan } from "./audioPlan";
import { ManualTransitionScheduler, CROSSFADE_SEC } from "./transitions";
import type { AudioParamLike } from "./params";

class FakeParam implements AudioParamLike {
  value = 1;
  readonly calls: { method: string; value?: number; time?: number }[] = [];
  setValueAtTime(value: number, time: number) { this.calls.push({ method: "setValueAtTime", value, time }); this.value = value; }
  linearRampToValueAtTime(value: number, time: number) { this.calls.push({ method: "linearRamp", value, time }); }
  exponentialRampToValueAtTime(value: number, time: number) { this.calls.push({ method: "expRamp", value, time }); }
  setTargetAtTime(value: number, time: number) { this.calls.push({ method: "setTarget", value, time }); }
  cancelScheduledValues(time: number) { this.calls.push({ method: "cancel", time }); }
  ramps() { return this.calls.filter((call) => call.method === "linearRamp"); }
}

class FakeNode implements AudioNodeLike {
  readonly connections: FakeNode[] = [];
  disconnectCalls = 0;
  connect(destination: AudioNodeLike) { this.connections.push(destination as FakeNode); }
  disconnect(destination?: AudioNodeLike) {
    this.disconnectCalls += 1;
    if (!destination) { this.connections.length = 0; return; }
    const index = this.connections.indexOf(destination as FakeNode);
    if (index >= 0) this.connections.splice(index, 1);
  }
}

class FakeModule implements ManagedAudioNode {
  readonly input = new FakeNode();
  readonly output = new FakeNode();
  readonly level = new FakeParam();
  readonly parameterCalls: { parameterId: string; value: number; atSec: number }[] = [];
  bypassed = false;
  wetValue = 1;
  disposed = false;
  constructor(readonly nodeId: string, readonly moduleType: string) {}
  setParameter(parameterId: string, value: number, atSec: number) {
    this.parameterCalls.push({ parameterId, value, atSec });
  }
  setBypass(bypass: boolean) { this.bypassed = bypass; }
  setWet(wet: number) { this.wetValue = wet; }
  dispose() { this.disposed = true; }
}

/** Tracks every module it builds, so leaks are countable. */
class FakeFactory implements AudioModuleFactory {
  readonly built: FakeModule[] = [];
  create(spec: AudioNodeSpec): ManagedAudioNode {
    const module = new FakeModule(spec.nodeId, spec.moduleType);
    this.built.push(module);
    return module;
  }
  smoothingFor() { return "linear" as const; }
  get undisposed() { return this.built.filter((module) => !module.disposed); }
}

const spec = (nodeId: string, overrides: Partial<AudioNodeSpec> = {}): AudioNodeSpec => ({
  nodeId,
  moduleType: "m.delay",
  structure: { maxDelaySec: 2 },
  parameters: { delayTime: 0.3 },
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

const rig = () => {
  const factory = new FakeFactory();
  const scheduler = new ManualTransitionScheduler(10);
  const adapter = new AudioGraphAdapter(factory, scheduler);
  const applyPlan = (next: AudioPlan, previous: AudioPlan = adapter.currentPlan) =>
    adapter.apply(diffAudioPlans(previous, next), next);
  return { factory, scheduler, adapter, applyPlan };
};

describe("Building and wiring", () => {
  it("builds each node once and connects the cables", () => {
    const { factory, adapter, applyPlan } = rig();
    applyPlan(plan([spec("a"), spec("b")], [cable("a", "b")]));
    expect(factory.built).toHaveLength(2);
    expect(adapter.liveNodeCount).toBe(2);
    expect(adapter.stats().connects).toBe(1);
    const a = factory.built.find((module) => module.nodeId === "a");
    expect(a?.output.connections).toHaveLength(1);
  });

  it("fades a new node up from silence", () => {
    // Wiring in a node at full level is audible as a step.
    const { factory, applyPlan, scheduler } = rig();
    applyPlan(plan([spec("a")]));
    const ramps = factory.built[0].level.ramps();
    expect(ramps[ramps.length - 1]).toEqual({
      method: "linearRamp", value: 1, time: scheduler.now() + CROSSFADE_SEC,
    });
  });

  it("applies bypass and wet at construction", () => {
    const { factory, applyPlan } = rig();
    applyPlan(plan([spec("a", { bypass: true, wet: 0.25 })]));
    expect(factory.built[0].bypassed).toBe(true);
    expect(factory.built[0].wetValue).toBe(0.25);
    // A bypassed node arrives silent rather than fading up into a bypass.
    const ramps = factory.built[0].level.ramps();
    expect(ramps[ramps.length - 1]?.value).toBe(0);
  });
});

describe("No churn on a parameter change", () => {
  /** The property the whole contract rests on. */
  it("builds, connects and disconnects nothing", () => {
    const { factory, adapter, applyPlan } = rig();
    const first = plan([spec("a"), spec("b")], [cable("a", "b")]);
    applyPlan(first);
    const before = adapter.stats();

    applyPlan(plan([spec("a", { parameters: { delayTime: 0.9 } }), spec("b")], [cable("a", "b")]), first);
    const after = adapter.stats();

    expect(after.built).toBe(before.built);
    expect(after.connects).toBe(before.connects);
    expect(after.disconnects).toBe(before.disconnects);
    expect(factory.built).toHaveLength(2);
    // The change still reached the module, as a ramp.
    const a = factory.built.find((module) => module.nodeId === "a");
    expect(a?.parameterCalls).toEqual([{ parameterId: "delayTime", value: 0.9, atSec: 10 }]);
  });

  it("routes a live control move without touching the graph", () => {
    const { factory, adapter, applyPlan } = rig();
    applyPlan(plan([spec("a")]));
    const before = adapter.stats();
    adapter.setParameter("a", "delayTime", 0.75);
    expect(adapter.stats()).toEqual(before);
    const calls = factory.built[0].parameterCalls;
    expect(calls[calls.length - 1]?.value).toBe(0.75);
  });
});

describe("Crossfade and disposal", () => {
  it("keeps the old node alive until its fade has finished", () => {
    const { factory, adapter, scheduler, applyPlan } = rig();
    const first = plan([spec("a")]);
    applyPlan(first);
    const original = factory.built[0];

    applyPlan(plan([spec("a", { structure: { maxDelaySec: 8 } })]), first);
    // Both exist: the replacement is fading in while the original fades out.
    expect(adapter.liveNodeCount).toBe(2);
    expect(adapter.retiringCount).toBe(1);
    expect(original.disposed).toBe(false);
    expect(original.level.ramps()[original.level.ramps().length - 1]).toEqual({
      method: "linearRamp", value: 0, time: 10 + CROSSFADE_SEC,
    });

    scheduler.advance(1);
    expect(original.disposed).toBe(true);
    expect(adapter.liveNodeCount).toBe(1);
    expect(adapter.retiringCount).toBe(0);
  });

  it("disposes only after the fade, never during it", () => {
    const { factory, scheduler, applyPlan } = rig();
    const first = plan([spec("a")]);
    applyPlan(first);
    const original = factory.built[0];
    applyPlan(plan([]), first);

    scheduler.advance(CROSSFADE_SEC / 2);
    expect(original.disposed).toBe(false);
    scheduler.advance(1);
    expect(original.disposed).toBe(true);
  });

  it("leaks nothing across many rebuilds", () => {
    const { factory, adapter, scheduler, applyPlan } = rig();
    let current = plan([spec("a")]);
    applyPlan(current);
    for (let i = 1; i <= 20; i++) {
      const next = plan([spec("a", { structure: { maxDelaySec: i } })]);
      applyPlan(next, current);
      current = next;
      scheduler.advance(1);
      // Exactly one node alive after each transition settles.
      expect(adapter.liveNodeCount, `after rebuild ${i}`).toBe(1);
    }
    expect(factory.undisposed).toHaveLength(1);
    expect(adapter.stats().disposed).toBe(20);
  });

  it("defers disconnection until the fade has finished", () => {
    const { factory, adapter, scheduler, applyPlan } = rig();
    const first = plan([spec("a"), spec("b")], [cable("a", "b")]);
    applyPlan(first);
    const a = factory.built.find((module) => module.nodeId === "a");
    const before = a?.output.disconnectCalls ?? 0;

    applyPlan(plan([spec("a"), spec("b")]), first);
    expect(a?.output.disconnectCalls).toBe(before);
    scheduler.advance(1);
    expect(a?.output.disconnectCalls).toBe(before + 1);
    expect(adapter.stats().disconnects).toBe(1);
  });
});

describe("Bypass", () => {
  it("fades rather than disconnecting, so it can be switched back", () => {
    const { factory, adapter, applyPlan } = rig();
    const first = plan([spec("a"), spec("b")], [cable("a", "b")]);
    applyPlan(first);
    const connectsBefore = adapter.stats().connects;

    applyPlan(plan([spec("a", { bypass: true }), spec("b")], [cable("a", "b")]), first);
    const a = factory.built.find((module) => module.nodeId === "a");
    expect(a?.bypassed).toBe(true);
    const ramps = a?.level.ramps() ?? [];
    expect(ramps[ramps.length - 1]?.value).toBe(0);
    // Still wired: no topology work was done to bypass it.
    expect(adapter.stats().connects).toBe(connectsBefore);
    expect(adapter.stats().disconnects).toBe(0);
  });

  it("keeps a wet-zero node processing", () => {
    // Wet at zero is a mix setting, not a bypass — the DSP stays alive.
    const { factory, applyPlan } = rig();
    const first = plan([spec("a")]);
    applyPlan(first);
    applyPlan(plan([spec("a", { wet: 0 })]), first);
    expect(factory.built[0].wetValue).toBe(0);
    expect(factory.built[0].bypassed).toBe(false);
  });
});

describe("Panic and teardown", () => {
  it("stops every level moving without stepping it", () => {
    const { factory, adapter, applyPlan } = rig();
    applyPlan(plan([spec("a"), spec("b")]));
    adapter.panic();
    for (const module of factory.built) {
      // Cancelling alone would let a scheduled ramp's final value snap in.
      const lastTwo = module.level.calls.slice(-2).map((call) => call.method);
      expect(lastTwo).toEqual(["cancel", "setValueAtTime"]);
    }
  });

  it("disposes everything and forgets it", () => {
    const { factory, adapter, applyPlan } = rig();
    applyPlan(plan([spec("a"), spec("b")], [cable("a", "b")]));
    adapter.dispose();
    expect(adapter.liveNodeCount).toBe(0);
    expect(factory.undisposed).toHaveLength(0);
    expect(adapter.currentPlan).toEqual(emptyAudioPlan());
  });

  it("disposes nodes still fading out", () => {
    const { factory, adapter, applyPlan } = rig();
    const first = plan([spec("a")]);
    applyPlan(first);
    applyPlan(plan([]), first);
    expect(adapter.retiringCount).toBe(1);
    adapter.dispose();
    expect(factory.undisposed).toHaveLength(0);
    expect(adapter.liveNodeCount).toBe(0);
  });
});
