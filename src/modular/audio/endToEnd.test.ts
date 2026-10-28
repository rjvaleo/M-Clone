import { describe, expect, it } from "vitest";
import { AudioEngine } from "./audioEngine";
import { ManualTransitionScheduler } from "./transitions";
import { FakeAudioContext, FakeBufferSource, FakeNode, FakeOscillator } from "./testing/fakeContext";
import { ModularRuntime } from "../runtime/engine";
import { ManualSchedulerDriver } from "../runtime/clock";
import { compileGraph } from "../compiler/compileGraph";
import { createNode, moduleRegistry } from "../registry/registry";
import { emptyGraph, type Edge, type GraphDocument, type JsonValue } from "../model/graph";
import { syntheticAssetId } from "./assets";
import { readPercussionSlots } from "./players";
import { patternView } from "../runtime/engine";
import { ParameterBag } from "../runtime/processors";

/**
 * A note, from the pattern that describes it to the oscillator that sounds it.
 *
 * Every layer below this has its own tests and all of them passed while the app
 * made no sound at all, twice: once because the sample players had no runtime
 * processor to turn note messages into scheduled events, and again because the
 * synth did not either. Nothing that tests one layer can see a missing wire
 * *between* layers — only something that runs the whole path can.
 *
 * So this is the whole path. A document is compiled, a runtime plays it, the
 * note adapter carries what comes out into the audio engine, and the assertion
 * is the only one that matters: a voice started.
 */

/** A clock the test moves by hand, standing in for AudioContext time. */
class FakeClock {
  seconds = 0;
  nowSec(): number {
    return this.seconds;
  }
}

const edge = (from: string, fromPort: string, to: string, toPort: string): Edge => ({
  id: `${from}.${fromPort}-${to}.${toPort}`,
  from: { nodeId: from, portId: fromPort },
  to: { nodeId: to, portId: toPort },
  enabled: true,
});

/**
 * Transport → Time Base → Note Order → Step Notes → Play Enable → *instrument*,
 * with the instrument's audio reaching an Audio Output.
 *
 * The shortest patch that makes a sound, which is what a first-time user builds
 * and what has to work.
 */
const patchWith = (
  instrument: string,
  overrides: Record<string, Record<string, JsonValue>> = {},
): GraphDocument => {
  const graph = emptyGraph();
  const nodes: [string, string][] = [
    ["transport", "m.transport-clock"],
    ["tb", "m.time-base"],
    ["ed", "m.note-editor"],
    ["no", "m.note-order"],
    ["sn", "m.step-to-notes"],
    ["pe", "m.play-enable"],
    ["inst", instrument],
    ["out", "m.audio-output"],
  ];
  for (const [id, type] of nodes) {
    graph.nodes[id] = createNode(type, id, { x: 0, y: 0 }, overrides[id] ?? {});
  }
  for (const wire of [
    edge("transport", "transport-out", "tb", "transport-in"),
    edge("tb", "clock-out", "no", "clock-in"),
    edge("ed", "pattern-out", "no", "pattern-in"),
    edge("no", "steps-out", "sn", "steps-in"),
    edge("sn", "notes-out", "pe", "notes-in"),
    edge("pe", "notes-out", "inst", "notes-in"),
    edge("inst", "audio-out", "out", "audio-in"),
  ]) graph.edges[wire.id] = wire;
  return graph;
};

/** Build the whole stack the app builds, wired the way the app wires it. */
const stack = (graph: GraphDocument) => {
  const compiled = compileGraph(graph, moduleRegistry, { seed: 7 });
  if (!compiled.ok) {
    throw new Error(compiled.diagnostics.map((item) => item.message).join("; "));
  }

  const clock = new FakeClock();
  const driver = new ManualSchedulerDriver();
  const runtime = new ModularRuntime({
    registry: moduleRegistry,
    driver,
    clock,
    seed: 7,
    tempoBpm: 120,
    wakeIntervalMs: 25,
    scheduling: { baseLookaheadSec: 0.12, minLookaheadSec: 0.12, maxLookaheadSec: 0.12 },
  });

  const context = new FakeAudioContext();
  const engine = new AudioEngine(context, moduleRegistry, {
    scheduler: new ManualTransitionScheduler(),
    // Both clocks are the test's, so the bridge between them is exact.
    runtimeNow: () => clock.seconds,
  });

  runtime.build(graph, compiled.plan);
  // The order the app does it in: the adapter is registered when audio starts,
  // and the engine is given the document by the effect that watches it.
  runtime.addAdapter(engine.notes);
  engine.update(graph);

  const run = (seconds: number) => {
    const steps = Math.round((seconds * 1000) / 25);
    for (let i = 0; i < steps; i++) {
      clock.seconds += 0.025;
      context.currentTime = clock.seconds;
      driver.fire();
    }
  };

  return { runtime, engine, context, clock, run };
};

const nodesOf = <T extends FakeNode>(
  context: FakeAudioContext,
  Kind: abstract new (...args: never[]) => T,
): T[] => context.created.filter((node): node is T => node instanceof Kind);

describe("A note reaching the speakers", () => {
  it("plays the synth from the pattern", () => {
    const { runtime, engine, context, run } = stack(patchWith("m.synth"));
    runtime.start();
    run(2.2);

    // The assertion that no unit test could make: an oscillator exists because
    // a pattern said so, four modules and two subsystems away.
    expect(nodesOf(context, FakeOscillator).length).toBeGreaterThan(0);
    expect(engine.notes.deliveredCount).toBeGreaterThan(0);
    expect(engine.notes.droppedCount).toBe(0);
  });

  it("plays the percussion kit from the pattern", () => {
    // The same path, the other kind of instrument. This is the one that was
    // silent for a whole session while every layer tested clean.
    const { runtime, engine, context, run } = stack(patchWith("m.percussion", {
      // The kit's own id, and the note the pattern actually plays — see the
      // test below for why those two are not the same by default.
      inst: {
        slots: [{
          note: 60, assetId: syntheticAssetId("kick"), chokeGroup: 0, gain: 1,
        }] as unknown as JsonValue,
      },
    }));
    runtime.start();
    run(2.2);

    expect(engine.notes.deliveredCount).toBeGreaterThan(0);
    expect(engine.notes.droppedCount).toBe(0);
    expect(nodesOf(context, FakeBufferSource).length).toBeGreaterThan(0);
  });

  it("explains why a fresh Percussion in the starter chain is silent", () => {
    // Not a bug in either module, and worth pinning down because it looks
    // exactly like one: the kit maps the General MIDI drum notes, and the
    // Note Editor's default pattern plays from middle C up. Every note is
    // delivered, every note misses every slot, and nothing sounds.
    const slots = readPercussionSlots(
      createNode("m.percussion", "p", { x: 0, y: 0 }).parameters.slots,
    );
    const mapped = new Set(slots.filter((slot) => slot.assetId !== "").map((slot) => slot.note));
    const pattern = patternView(
      new ParameterBag(createNode("m.note-editor", "e", { x: 0, y: 0 }).parameters),
    );
    const played = new Set(pattern.steps.flat());

    expect(mapped.size).toBeGreaterThan(0);
    expect(played.size).toBeGreaterThan(0);
    expect([...played].filter((note) => mapped.has(note))).toEqual([]);
  });

  it("stops making voices when the transport stops", () => {
    const { runtime, engine, context, run } = stack(patchWith("m.synth"));
    runtime.start();
    run(1.2);
    const sounding = nodesOf(context, FakeOscillator).length;
    expect(sounding).toBeGreaterThan(0);

    runtime.stop();
    run(1.2);
    expect(nodesOf(context, FakeOscillator).length).toBe(sounding);
    expect(engine.playerVoices("inst")).toBe(0);
  });

  it("delivers every note to the instrument, dropping none", () => {
    // A dropped note means the adapter could not find the audio node the event
    // named — the failure that leaves a patch looking right and sounding empty.
    const { runtime, engine, run } = stack(patchWith("m.synth"));
    runtime.start();
    run(3);
    expect(engine.notes.droppedCount).toBe(0);
    expect(engine.notes.deliveredCount).toBeGreaterThan(2);
  });

  it("routes the instrument's audio into the master chain", () => {
    // Sounding is not the same as audible: the output has to reach the master.
    const { runtime, engine, run } = stack(patchWith("m.synth"));
    runtime.start();
    run(1);
    expect(Object.keys(engine.currentPlan.nodes).sort()).toEqual(["inst", "out"]);
  });

  it("keeps playing after the graph is rebuilt underneath it", () => {
    // Editing a knob mid-performance recompiles the audio plan. The note
    // adapter looks its target up by identity, so a rebuilt node has to be
    // found again rather than leaving every later note orphaned.
    const graph = patchWith("m.synth");
    const { runtime, engine, run } = stack(graph);
    runtime.start();
    run(1.2);
    const delivered = engine.notes.deliveredCount;

    graph.nodes.inst = {
      ...graph.nodes.inst,
      parameters: { ...graph.nodes.inst.parameters, "osc1-wave": "square" },
    };
    engine.update(graph);
    run(1.2);

    expect(engine.notes.deliveredCount).toBeGreaterThan(delivered);
    expect(engine.notes.droppedCount).toBe(0);
  });
});
