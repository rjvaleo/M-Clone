import { afterEach, describe, expect, it, vi } from "vitest";
import { ModularRuntime } from "./engine";
import { ManualSchedulerDriver } from "./clock";
import { MessageBus } from "./messages";
import { PROCESSOR_FACTORIES, ParameterBag, TranspositionProcessor, type ProcessorBuild } from "./processors";
import { scheduledTickFor } from "./parameters";
import { PPQN, TempoMap } from "./time";
import { compileGraph } from "../compiler/compileGraph";
import { createNode, moduleRegistry } from "../registry/registry";
import { emptyGraph, type GraphDocument } from "../model/graph";

const restore: (() => void)[] = [];
afterEach(() => {
  while (restore.length) restore.pop()!();
});

/** Swap one factory for the length of a test. */
const patchFactory = (type: string, wrap: (build: ProcessorBuild) => ReturnType<(typeof PROCESSOR_FACTORIES)[string]>) => {
  const original = PROCESSOR_FACTORIES[type];
  PROCESSOR_FACTORIES[type] = wrap;
  restore.push(() => { PROCESSOR_FACTORIES[type] = original; });
  return original;
};

const editorAndOrder = (): GraphDocument => {
  const graph = emptyGraph();
  graph.nodes.ed = createNode("m.note-editor", "ed", { x: 0, y: 0 });
  graph.nodes.no = createNode("m.note-order", "no", { x: 0, y: 0 });
  graph.nodes.transport = createNode("m.transport-clock", "transport", { x: 0, y: 0 });
  graph.nodes.tb = createNode("m.time-base", "tb", { x: 0, y: 0 });
  const wire = (id: string, from: string, fromPort: string, to: string, toPort: string) => {
    graph.edges[id] = { id, from: { nodeId: from, portId: fromPort }, to: { nodeId: to, portId: toPort }, enabled: true };
  };
  wire("e", "ed", "pattern-out", "no", "pattern-in");
  wire("t", "transport", "transport-out", "tb", "transport-in");
  wire("c", "tb", "clock-out", "no", "clock-in");
  return graph;
};

const runtimeFor = (graph: GraphDocument) => {
  const compiled = compileGraph(graph, moduleRegistry, { seed: 7 });
  if (!compiled.ok) throw new Error(compiled.diagnostics.map((d) => d.message).join("; "));
  const runtime = new ModularRuntime({
    registry: moduleRegistry, driver: new ManualSchedulerDriver(), clock: { nowSec: () => 0 }, seed: 7, tempoBpm: 120,
  });
  runtime.build(graph, compiled.plan);
  return runtime;
};

describe("voices on the bus", () => {
  it("gives every message a voice, 0 until set", () => {
    const bus = new MessageBus();
    bus.beginNode("a", 8);
    expect(bus.acquire()!.voice).toBe(0);
  });

  it("keeps a note's voice through a transform", () => {
    const bus = new MessageBus();
    bus.connect("up", "out", "tr", "notes-in");
    bus.connect("tr", "notes-out", "sink", "in");
    bus.beginNode("up", 8);
    const note = bus.acquire()!;
    Object.assign(note, { kind: "note-event", atTick: 0, note: 60, voice: 5 });
    bus.publish("out", note);
    const transposition = new TranspositionProcessor({ nodeId: "tr", bus, parameters: new ParameterBag({}), budget: 8, seed: 1 });
    bus.beginNode("tr", 8);
    transposition.process({ startTick: 0, endTick: PPQN, tempo: new TempoMap(120, 0) });
    const { items, count } = bus.read("sink", "in");
    expect(count).toBe(1);
    expect(items[0].voice).toBe(5);
  });
});

describe("processor commands", () => {
  it("routes a command to the node's processor, and reports when nothing handles it", () => {
    const command = vi.fn(() => true);
    const original = patchFactory("m.note-order", (build) => Object.assign(original(build), { command }));
    const runtime = runtimeFor(editorAndOrder());
    expect(runtime.command("no", "tap", { at: 1 })).toBe(true);
    expect(command).toHaveBeenCalledWith("tap", { at: 1 });
    expect(runtime.command("ed", "tap")).toBe(false);
    expect(runtime.command("missing", "tap")).toBe(false);
  });
});

describe("inputs read by reference", () => {
  it("hands a processor the live parameters of whatever feeds an input", () => {
    let reference: ProcessorBuild["reference"];
    const original = patchFactory("m.note-order", (build) => {
      reference = build.reference;
      return original(build);
    });
    runtimeFor(editorAndOrder());
    const source = reference!("pattern-in")();
    expect(source).toBeInstanceOf(ParameterBag);
    expect(source!.raw("preset-values")).toBeDefined();
    expect(reference!("nothing-in")()).toBeUndefined();
  });
});

describe("beat and bar quantize", () => {
  it("lands a next-beat edit on the next beat and a next-bar edit on the next bar", () => {
    expect(scheduledTickFor("next-beat", 100, 0)).toBe(PPQN);
    expect(scheduledTickFor("next-beat", PPQN, 0)).toBe(PPQN);
    expect(scheduledTickFor("next-bar", PPQN + 1, 0)).toBe(4 * PPQN);
    expect(scheduledTickFor("next-bar", 0, 0)).toBe(0);
  });
});

describe("tempo across Play", () => {
  it("keeps a tempo set before Play", () => {
    const runtime = runtimeFor(editorAndOrder());
    runtime.setBaseTempo(90);
    runtime.start();
    expect(runtime.tempoMap.bpmAt(0)).toBe(90);
    runtime.stop();
  });
});
