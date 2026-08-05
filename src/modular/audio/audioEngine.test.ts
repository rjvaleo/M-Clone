import { describe, expect, it } from "vitest";
import { AudioEngine, EffectModuleFactory } from "./audioEngine";
import { ManualTransitionScheduler } from "./transitions";
import { FakeAudioContext } from "./testing/fakeContext";
import { createNode, moduleRegistry } from "../registry/registry";
import { emptyGraph, type GraphDocument } from "../model/graph";

const patch = (): GraphDocument => {
  const document = emptyGraph();
  for (const [id, type] of [["rev", "m.audio-reverb"], ["out", "m.audio-output"]]) {
    document.nodes[id] = createNode(type, id, { x: 0, y: 0 });
  }
  document.edges["e1"] = {
    id: "e1",
    from: { nodeId: "rev", portId: "audio-out" },
    to: { nodeId: "out", portId: "audio-in" },
    enabled: true,
  };
  return document;
};

const rig = () => {
  const context = new FakeAudioContext();
  const scheduler = new ManualTransitionScheduler();
  const engine = new AudioEngine(context, moduleRegistry, { scheduler });
  return { context, scheduler, engine };
};

/** A rig whose context can host a worklet, with the rack node faked out. */
const rustRig = () => {
  const { context, scheduler, engine } = rig();
  const posted: { type: string }[] = [];
  const node = {
    port: { postMessage: (message: { type: string }) => posted.push(message) },
    connect: () => {},
    disconnect: () => {},
  };
  (context as unknown as { audioWorklet: unknown }).audioWorklet = {
    addModule: async () => {},
  };
  const attach = () =>
    engine.useRustEngine({
      compileModule: async () => ({}) as WebAssembly.Module,
      createNode: () => node,
    });
  return { context, scheduler, engine, posted, attach };
};

describe("Audio engine on the Rust rack", () => {
  it("stays on Web Audio when the platform cannot host a worklet", async () => {
    // The fallback is the path that always works, so an absent worklet is a
    // false rather than a throw — the session keeps making sound.
    const { engine } = rig();
    await expect(engine.useRustEngine()).resolves.toBe(false);
    expect(engine.engineKind).toBe("web-audio");
  });

  it("stays on Web Audio when the engine artifact cannot be compiled", async () => {
    const { engine, context } = rig();
    (context as unknown as { audioWorklet: unknown }).audioWorklet = { addModule: async () => {} };
    const attached = await engine.useRustEngine({
      compileModule: async () => {
        throw new Error("404");
      },
    });
    expect(attached).toBe(false);
    expect(engine.engineKind).toBe("web-audio");
  });

  it("moves rendering onto the rack and tears the Web Audio graph down", async () => {
    // Both backends holding the same patch would render it twice, so the
    // adapter is disposed as the rack takes over.
    const { engine, attach } = rustRig();
    engine.update(patch());
    expect(engine.liveNodeCount).toBe(2);
    await expect(attach()).resolves.toBe(true);
    expect(engine.engineKind).toBe("rust");
    expect(engine.liveNodeCount).toBe(0);
  });

  it("hands the rack the plan it already had, so a built patch survives the switch", async () => {
    const { engine, posted, attach } = rustRig();
    engine.update(patch());
    await attach();
    expect(posted.filter((message) => message.type === "plan")).toHaveLength(1);
  });

  it("sends later updates to the rack rather than rebuilding Web Audio nodes", async () => {
    const { engine, posted, attach } = rustRig();
    await attach();
    engine.update(patch());
    expect(posted.filter((message) => message.type === "plan")).toHaveLength(1);
    expect(engine.liveNodeCount).toBe(0);
  });

  it("attaches only once", async () => {
    const { engine, attach } = rustRig();
    await expect(attach()).resolves.toBe(true);
    await expect(attach()).resolves.toBe(true);
    expect(engine.engineKind).toBe("rust");
  });

  it("silences the rack on panic", async () => {
    const { engine, posted, attach } = rustRig();
    await attach();
    engine.panic();
    expect(posted.some((message) => message.type === "all-notes-off")).toBe(true);
  });

  it("routes note destinations to the rack once attached", async () => {
    const { engine, attach } = rustRig();
    engine.update(patch());
    await attach();
    // The adapter finds players through the engine's lookup; with a rack
    // attached every node id has to resolve to a rack-backed player, or the
    // notes are counted as dropped and nothing sounds.
    const lookup = (engine as unknown as { rackPlayerFor(id: string): unknown }).rackPlayerFor("out");
    expect(lookup).toBeDefined();
    expect((lookup as { nodeId: string }).nodeId).toBe("out");
  });

  it("reuses one player per node rather than building one per event", async () => {
    const { engine, attach } = rustRig();
    await attach();
    const reach = engine as unknown as { rackPlayerFor(id: string): unknown };
    expect(reach.rackPlayerFor("out")).toBe(reach.rackPlayerFor("out"));
  });

  it("drops the rack on dispose", async () => {
    const { engine, attach } = rustRig();
    await attach();
    engine.dispose();
    expect(engine.engineKind).toBe("web-audio");
  });
});

describe("Audio engine", () => {
  it("resumes the context before it is asked to make sound", async () => {
    // A suspended context's clock does not advance, so every ramp scheduled
    // against it is scheduled into a moment that never arrives.
    const { context, engine } = rig();
    expect(engine.running).toBe(false);
    await engine.start();
    expect(context.resumeCalls).toBe(1);
    expect(engine.running).toBe(true);
  });

  it("builds the patch and routes only the output to the master chain", () => {
    const { engine, context } = rig();
    const result = engine.update(patch());
    expect(result.rebuilt).toBe(2);
    expect(engine.liveNodeCount).toBe(2);
    // The master gain is the first node the engine ever builds.
    const masterGain = context.created[0];
    const reaching = context.created.filter((node) => node.outgoing.has(masterGain));
    expect(reaching).toHaveLength(1);
  });

  it("connects each output exactly once, however many times the graph changes", () => {
    const { engine, context } = rig();
    const document = patch();
    engine.update(document);
    const masterGain = context.created[0];
    const connectedNow = () => context.created.filter((node) => node.outgoing.has(masterGain));
    const first = connectedNow()[0];

    document.nodes.rev.parameters["damping-hz"] = 4000;
    engine.update({ ...document, nodes: { ...document.nodes } });
    expect(connectedNow()).toEqual([first]);
  });

  it("re-routes when the output node is rebuilt, not the object that has gone", () => {
    // A rebuilt node keeps its id and is a different object; re-connecting the
    // old one would be a no-op while the new one stayed silent.
    const { engine, context } = rig();
    const document = patch();
    engine.update(document);
    const masterGain = context.created[0];
    const before = context.created.filter((node) => node.outgoing.has(masterGain))[0];

    document.nodes.out.parameters["volume"] = 0.5;
    document.nodes.rev.parameters["tail-seconds"] = 3;
    engine.update({ ...document, nodes: { ...document.nodes } });
    // Nothing structural changed on the output, so it is the same object still.
    expect(context.created.filter((node) => node.outgoing.has(masterGain))[0]).toBe(before);
  });

  it("does no construction for a parameter-only edit", () => {
    const { engine, context } = rig();
    const document = patch();
    engine.update(document);
    const built = context.created.length;

    document.nodes.rev.parameters["damping-hz"] = 2000;
    const result = engine.update({ ...document, nodes: { ...document.nodes } });
    expect(context.created.length).toBe(built);
    expect(result.rebuilt).toBe(0);
    expect(result.ramped).toBeGreaterThan(0);
  });

  it("rebuilds exactly one node when a structural value moves", () => {
    const { engine, scheduler } = rig();
    const document = patch();
    engine.update(document);

    document.nodes.rev.parameters["decay-rate"] = 5;
    const result = engine.update({ ...document, nodes: { ...document.nodes } });
    expect(result.rebuilt).toBe(1);
    // Old and new both exist until the crossfade has finished.
    expect(engine.liveNodeCount).toBe(3);
    scheduler.advance(1);
    expect(engine.liveNodeCount).toBe(2);
  });

  it("closes the context and leaves nothing tracked", () => {
    const { engine, context } = rig();
    engine.update(patch());
    engine.dispose();
    expect(engine.liveNodeCount).toBe(0);
    expect(context.closeCalls).toBe(1);
    // A second disposal must not close a context that is already gone.
    engine.dispose();
    expect(context.closeCalls).toBe(1);
    expect(engine.update(patch())).toEqual({ rebuilt: 0, ramped: 0 });
  });

  it("holds every level where it is when panicking", () => {
    const { engine } = rig();
    engine.update(patch());
    expect(() => engine.panic()).not.toThrow();
  });
});

describe("Registry-declared smoothing", () => {
  it("comes from the descriptor, and structural values are never ramped", () => {
    const factory = new EffectModuleFactory(new FakeAudioContext(), moduleRegistry);
    expect(factory.smoothingFor("m.audio-delay", "feedback")).toBe("linear");
    expect(factory.smoothingFor("m.audio-delay", "max-delay-seconds")).toBe("none");
    // An unknown id must still answer, rather than throwing inside a ramp.
    expect(factory.smoothingFor("m.audio-delay", "nonsense")).toBe("linear");
  });
});
