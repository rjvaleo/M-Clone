import { afterEach, describe, expect, it, vi } from "vitest";
import { AudioEngine, EffectModuleFactory } from "./audioEngine";
import { ManualTransitionScheduler } from "./transitions";
import { FakeAudioContext } from "./testing/fakeContext";
import { createNode, moduleRegistry } from "../registry/registry";
import { emptyGraph, type GraphDocument } from "../model/graph";
import { grainCloud } from "./grainClouds";
import type { RuntimeEvent } from "../runtime/eventqueue";

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
    port: {
      postMessage: (message: { type: string }) => posted.push(message),
      onmessage: null as ((event: { data: unknown }) => void) | null,
    },
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
  return { context, scheduler, engine, posted, node, attach };
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

  it("sends a sampler's audio before the plan that names it", async () => {
    // Order matters: a plan naming a sample the engine does not hold yet
    // points the sampler at nothing, and it stays silent until something
    // unrelated happens to recompile the graph.
    const { engine, posted, attach } = rustRig();
    await attach();
    const document = emptyGraph();
    document.nodes.perc = createNode("m.percussion", "perc", { x: 0, y: 0 });
    engine.update(document);
    const kinds = posted.map((message) => message.type);
    const firstSample = kinds.indexOf("sample");
    const lastPlan = kinds.lastIndexOf("plan");
    expect(firstSample).toBeGreaterThanOrEqual(0);
    expect(firstSample).toBeLessThan(lastPlan);
  });

  it("sends the asset-to-slot table alongside the audio", async () => {
    const { engine, posted, attach } = rustRig();
    await attach();
    const document = emptyGraph();
    document.nodes.perc = createNode("m.percussion", "perc", { x: 0, y: 0 });
    engine.update(document);
    expect(posted.some((message) => message.type === "sample-map")).toBe(true);
  });

  it("does not resend audio it has already transferred", async () => {
    // The buffers are transferred, so sending one twice is both wasted work
    // and a copy the pool no longer owns.
    const { engine, posted, attach } = rustRig();
    await attach();
    const document = emptyGraph();
    document.nodes.perc = createNode("m.percussion", "perc", { x: 0, y: 0 });
    engine.update(document);
    const first = posted.filter((message) => message.type === "sample").length;
    engine.update(document);
    expect(posted.filter((message) => message.type === "sample").length).toBe(first);
    expect(first).toBeGreaterThan(0);
  });

  it("has no rack report before the worklet has said anything", () => {
    // Null on Web Audio too, rather than a synthesised report: the two
    // backends do not observe the same things, and a caller that could not
    // tell the difference would draw a meter from a number nothing measured.
    const { engine } = rig();
    expect(engine.rackReport).toBeNull();
  });

  it("passes on what the audio thread reported", async () => {
    const { engine, node, attach } = rustRig();
    await attach();
    node.port.onmessage?.({
      data: { type: "report", modules: 4, cables: 3, samples: 2, peak: 0.25, quanta: 16 },
    });
    expect(engine.rackReport?.samples).toBe(2);
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

  it("answers a repeated lookup from the cache, and keeps parameters apart", () => {
    // The cache exists so that dragging a fader does not re-scan a descriptor's
    // parameters on every ramp; a counting registry is the only way to see the
    // difference between a hit and a miss from the outside.
    const registry = new Map(moduleRegistry);
    const uncached = registry.get.bind(registry);
    let lookups = 0;
    registry.get = (moduleType) => {
      lookups += 1;
      return uncached(moduleType);
    };
    const factory = new EffectModuleFactory(new FakeAudioContext(), registry);

    expect(factory.smoothingFor("m.audio-delay", "feedback")).toBe("linear");
    expect(factory.smoothingFor("m.audio-delay", "feedback")).toBe("linear");
    expect(lookups).toBe(1);

    // Two parameters on one module are distinct keys, so the second is a miss
    // and gets its own answer rather than the first one's.
    expect(factory.smoothingFor("m.audio-delay", "max-delay-seconds")).toBe("none");
    expect(lookups).toBe(2);
  });
});

describe("playing a note on a node from outside the graph", () => {
  const synthPatch = (): GraphDocument => {
    const document = emptyGraph();
    document.nodes.syn = createNode("m.synth", "syn", { x: 0, y: 0 });
    document.nodes.out = createNode("m.audio-output", "out", { x: 0, y: 0 });
    document.edges.e1 = {
      id: "e1", from: { nodeId: "syn", portId: "audio-out" }, to: { nodeId: "out", portId: "audio-in" }, enabled: true,
    };
    return document;
  };

  it("plays on the node's own player, at the audio time given", () => {
    const { engine, context } = rig();
    engine.update(synthPatch());
    expect(engine.playOnNode("syn", { type: "note-on", note: 60, velocity: 100, atSec: context.currentTime + 0.1 })).toBe(true);
    expect(engine.playOnNode("syn", { type: "note-off", note: 60, velocity: 0, atSec: context.currentTime + 0.3 })).toBe(true);
  });

  it("reports a node that cannot play notes", () => {
    const { engine } = rig();
    engine.update(synthPatch());
    expect(engine.playOnNode("out", { type: "note-on", note: 60, velocity: 100, atSec: 0 })).toBe(false);
    expect(engine.playOnNode("missing", { type: "note-on", note: 60, velocity: 100, atSec: 0 })).toBe(false);
  });

  it("silences one node's notes without muting the rest of the mix", () => {
    const { engine } = rig();
    engine.update(synthPatch());
    expect(engine.silenceNode("syn")).toBe(true);
    expect(engine.silenceNode("out")).toBe(false);
  });

  it("lends its context and master input, so another engine can play into the same mix", () => {
    const { engine, context } = rig();
    expect(engine.audioContext).toBe(context);
    expect(engine.input).toBeDefined();
  });
});

describe("Audio engine scope tap", () => {
  const synthPatch = (): GraphDocument => {
    const document = emptyGraph();
    document.nodes.syn = createNode("m.synth", "syn", { x: 0, y: 0 });
    document.nodes.out = createNode("m.audio-output", "out", { x: 0, y: 0 });
    document.edges.e1 = { id: "e1", from: { nodeId: "syn", portId: "audio-out" }, to: { nodeId: "out", portId: "audio-in" }, enabled: true };
    return document;
  };

  it("taps a module's output with one analyser and reads its live waveform", () => {
    const { context, engine } = rig();
    engine.update(synthPatch());
    const buffer = new Float32Array(8);
    expect(engine.readScope("syn", buffer)).toBe(true);
    expect([...buffer]).toEqual(Array(8).fill(0.25));
    engine.readScope("syn", buffer);
    expect(context.analysers).toHaveLength(1);
  });

  it("reads nothing for a module that makes no sound, or a context with no analyser", () => {
    const { context, engine } = rig();
    engine.update(synthPatch());
    expect(engine.readScope("nope", new Float32Array(8))).toBe(false);
    (context as unknown as { createAnalyser?: unknown }).createAnalyser = undefined;
    const other = rig();
    (other.context as unknown as { createAnalyser?: unknown }).createAnalyser = undefined;
    other.engine.update(synthPatch());
    expect(other.engine.readScope("syn", new Float32Array(8))).toBe(false);
  });
});

describe("Audio engine, the paths a session rarely takes", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const synthPatch = (): GraphDocument => {
    const document = emptyGraph();
    document.nodes.syn = createNode("m.synth", "syn", { x: 0, y: 0 });
    document.nodes.out = createNode("m.audio-output", "out", { x: 0, y: 0 });
    document.edges.e1 = {
      id: "e1", from: { nodeId: "syn", portId: "audio-out" }, to: { nodeId: "out", portId: "audio-in" }, enabled: true,
    };
    return document;
  };

  const grainPatch = (assetId: string): GraphDocument => {
    const document = emptyGraph();
    document.nodes.ge = createNode("m.grain-engine", "ge", { x: 0, y: 0 });
    document.nodes.ge.parameters["asset-id"] = assetId;
    return document;
  };

  /** A rack whose context also hosts the grain builder, with both faked out. */
  const builderRig = () => {
    const base = rustRig();
    const toBuilder: { type: string; id?: number; nodeId?: string }[] = [];
    const builder = {
      postMessage: (message: { type: string }) => toBuilder.push(message),
      onmessage: null as ((event: { data: unknown }) => void) | null,
      terminate: () => {},
    };
    const attach = () =>
      base.engine.useRustEngine({
        compileModule: async () => ({}) as WebAssembly.Module,
        createNode: () => base.node,
        createBuilder: () => builder,
      });
    return { ...base, builder, toBuilder, attach };
  };

  const noteEvent = (type: "note-on" | "note-off", portId: string): RuntimeEvent => ({
    type, portId, atTick: 0, atSec: 0, sequence: 0, channel: 0, note: 60, detuneCents: 0,
    velocity: 100, program: 0, controller: 0, value: 0, noteId: 1, stepSec: 0,
  }) as RuntimeEvent;

  it("runs its transitions on a real timer when no scheduler is given", () => {
    vi.useFakeTimers();
    const context = new FakeAudioContext();
    const engine = new AudioEngine(context, moduleRegistry, { starterKit: false });
    engine.update(patch());
    const document = patch();
    document.nodes.rev.parameters["pre-delay-ms"] = 999;
    engine.update(document);
    vi.runAllTimers();
    expect(engine.liveNodeCount).toBeGreaterThanOrEqual(2);
    engine.dispose();
  });

  it("hands a granular player the injected wake rather than a timer", () => {
    const schedulePlayerWake = vi.fn(() => () => {});
    const engine = new AudioEngine(new FakeAudioContext(), moduleRegistry, {
      scheduler: new ManualTransitionScheduler(), schedulePlayerWake,
    });
    const document = emptyGraph();
    document.nodes.gr = createNode("m.granular", "gr", { x: 0, y: 0 });
    engine.update(document);
    expect(engine.playOnNode("gr", { type: "note-on", note: 60, velocity: 100, atSec: 0 })).toBe(true);
    expect(schedulePlayerWake).toHaveBeenCalled();
  });

  it("follows the transport's tempo only for a real, new tempo, and only once there is a patch", () => {
    const { engine } = rig();
    const compiled = () => engine.currentPlan.generation;
    engine.setTempo(90);
    expect(compiled()).toBe(0);
    engine.update(synthPatch());
    const before = compiled();
    engine.setTempo(Number.NaN);
    engine.setTempo(0);
    engine.setTempo(90);
    expect(compiled()).toBe(before);
    engine.setTempo(140);
    expect(compiled()).toBe(before + 1);
  });

  it("plays and silences a node through the rack once it is attached", async () => {
    const { engine, posted, attach, context } = rustRig();
    await attach();
    context.currentTime = 2;
    expect(engine.playOnNode("syn", { type: "note-on", note: 60, velocity: 127, atSec: 1 })).toBe(true);
    expect(engine.playOnNode("syn", { type: "note-off", note: 60, velocity: 0, atSec: 3 })).toBe(true);
    expect(engine.silenceNode("syn")).toBe(true);
    const scheduled = posted.filter((message) => message.type === "schedule") as unknown as
      { atSec: number; events: { type: string }[] }[];
    expect(scheduled.map((message) => [message.atSec, message.events[0]!.type])).toEqual([
      [2, "note-on"], [3, "note-off"], [2, "all-notes-off"],
    ]);
  });

  it("resolves the runtime's notes to rack players once attached, and to graph nodes before", async () => {
    const { engine, posted, attach } = rustRig();
    engine.update(synthPatch());
    engine.notes.send([noteEvent("note-on", "syn")], 1);
    expect(engine.notes.deliveredCount).toBe(1);
    expect(posted.some((message) => message.type === "schedule")).toBe(false);
    await attach();
    engine.notes.send([noteEvent("note-off", "syn")], 1);
    expect(engine.notes.deliveredCount).toBe(2);
    expect(posted.some((message) => message.type === "schedule")).toBe(true);
  });

  it("has no rack player, and sends no samples, while no rack is attached", () => {
    const { engine } = rig();
    const reach = engine as unknown as {
      rackPlayerFor(id: string): unknown;
      sendSamples(plan: unknown): void;
    };
    expect(reach.rackPlayerFor("syn")).toBeUndefined();
    expect(() => reach.sendSamples(engine.currentPlan)).not.toThrow();
  });

  it("skips a sample that is not decoded yet, and one with no slot left for it", async () => {
    const { engine, posted, attach } = rustRig();
    await attach();
    engine.update(grainPatch("not-in-the-pool"));
    expect(posted.some((message) => message.type === "sample")).toBe(false);
    // Fill every slot the rack has, so the next real sample finds none free.
    const slots = (engine as unknown as { rackSlots: { slotFor(id: string): number | undefined } }).rackSlots;
    for (let i = 0; i < 256; i += 1) slots.slotFor(`filler-${i}`);
    engine.update(grainPatch(engine.library.list()[0]!.id));
    expect(posted.some((message) => message.type === "sample")).toBe(false);
    expect(posted.some((message) => message.type === "sample-map")).toBe(false);
  });

  it("asks the builder for a Grain Engine's grains and hands them to the cloud pad", async () => {
    vi.useFakeTimers();
    const { engine, attach, builder, toBuilder } = builderRig();
    await attach();
    const assetId = engine.library.list()[0]!.id;
    engine.update(grainPatch(assetId));
    vi.runAllTimers();
    const request = toBuilder.find((message) => message.type === "grains")!;
    expect(request).toMatchObject({ nodeId: "ge", slot: 0 });
    const data = new Float32Array([0, 1, 0]);
    builder.onmessage?.({ data: { type: "grains", id: request.id, nodeId: "ge", data } });
    expect(grainCloud("ge")).toMatchObject({ total: 1, count: 0 });
  });

  it("asks for grains already on attach when a patch was built first", async () => {
    vi.useFakeTimers();
    const { engine, attach, toBuilder } = builderRig();
    engine.update(grainPatch(engine.library.list()[0]!.id));
    await attach();
    vi.runAllTimers();
    expect(toBuilder.filter((message) => message.type === "grains")).toHaveLength(1);
  });

  it("asks for no grains from a sample the rack does not hold, or one that has left the pool", async () => {
    vi.useFakeTimers();
    const { engine, attach, toBuilder } = builderRig();
    await attach();
    engine.update(grainPatch("not-in-the-pool"));
    vi.runAllTimers();
    expect(toBuilder.some((message) => message.type === "grains")).toBe(false);
    const assetId = engine.library.list()[0]!.id;
    engine.update(grainPatch(assetId));
    engine.library.remove(assetId);
    const document = grainPatch(assetId);
    document.nodes.ge.parameters["level"] = 0.3;
    engine.update(document);
    vi.runAllTimers();
    // The buffer left before the throttled request went out, so nothing is asked for.
    expect(toBuilder.filter((message) => message.type === "grains")).toHaveLength(0);
  });

  it("stops decoding a drop once disposed, keeping only the file already in flight", async () => {
    const { engine } = rig();
    const pending = engine.addFiles([
      { name: "a.wav", bytes: new Uint8Array([10, 20, 30, 40, 50]) },
      { name: "b.wav", bytes: new Uint8Array([11, 21, 31, 41, 51]) },
    ]);
    engine.dispose();
    const result = await pending;
    expect(result.added.map((record) => record.name)).toEqual(["a.wav"]);
  });

  it("reports a pack blob that does not decode, and stops loading a pack once disposed", async () => {
    const { engine } = rig();
    const records = [
      { id: "bad", name: "bad.wav" },
      { id: "good", name: "good.wav" },
    ] as unknown as Parameters<AudioEngine["loadPack"]>[0];
    const blobs = [
      { id: "bad", bytes: new Uint8Array([1, 2]) },
      { id: "good", bytes: new Uint8Array([10, 20, 30, 40, 50]) },
    ];
    const result = await engine.loadPack(records, blobs);
    expect(result.failed.map((failure) => failure.name)).toEqual(["bad.wav"]);
    expect(result.loaded).toBe(1);

    const other = rig();
    const pending = other.engine.loadPack(records, blobs);
    other.engine.dispose();
    const stopped = await pending;
    expect(stopped.loaded + stopped.failed.length).toBe(1);
  });
});
