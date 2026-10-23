import { describe, expect, it } from "vitest";
import { ModularRuntime, RecordingAdapter } from "./engine";
import { ManualSchedulerDriver } from "./clock";
import { compileGraph } from "../compiler/compileGraph";
import { createNode, moduleRegistry } from "../registry/registry";
import { emptyGraph, type GraphDocument, type JsonValue } from "../model/graph";
import recorded from "../../engine/__fixtures__/plannerParity.json";
import type { PlannedNote } from "../../engine/planner";
import { distortClockTicks, type TimeMap } from "../../engine/timemap";
import { warpToTimeMap } from "../mlab/warpSteps";

class FakeClock {
  seconds = 0;
  nowSec(): number {
    return this.seconds;
  }
}

type Wire = [string, string, string, string];

const graphOf = (nodes: [string, string, Record<string, JsonValue>?][], wires: Wire[]): GraphDocument => {
  const graph = emptyGraph();
  for (const [id, type, values] of nodes) graph.nodes[id] = createNode(type, id, { x: 0, y: 0 }, values ?? {});
  for (const [from, fromPort, to, toPort] of wires) {
    const id = `${from}.${fromPort}-${to}.${toPort}`;
    graph.edges[id] = { id, from: { nodeId: from, portId: fromPort }, to: { nodeId: to, portId: toPort }, enabled: true };
  }
  return graph;
};

const play = (graph: GraphDocument, seconds: number) => {
  const compiled = compileGraph(graph, moduleRegistry, { seed: 7 });
  if (!compiled.ok) throw new Error(compiled.diagnostics.map((d) => d.message).join("; "));
  const clock = new FakeClock();
  const driver = new ManualSchedulerDriver();
  const runtime = new ModularRuntime({
    registry: moduleRegistry, driver, clock, seed: 7, tempoBpm: 120, wakeIntervalMs: 25,
    scheduling: { baseLookaheadSec: 0.12, minLookaheadSec: 0.12, maxLookaheadSec: 0.12 },
  });
  const recorder = new RecordingAdapter();
  runtime.build(graph, compiled.plan);
  runtime.addAdapter(recorder);
  runtime.start();
  for (let i = 0; i < Math.round(seconds * 40); i++) {
    clock.seconds += 0.025;
    driver.fire();
  }
  runtime.stop();
  return recorder.events;
};

/** M Clock → M NoteSeq → M Orchestra → MIDI Out, as a Numerology stack is wired. */
const mChain = (noteSeq: Record<string, JsonValue> = {}) => graphOf(
  [["ck", "m.lab-clock"], ["ns", "m.lab-noteseq", noteSeq], ["or", "m.lab-orchestra"], ["out", "m.midi-output"]],
  [
    ["ck", "transport-out", "ns", "clock-in"],
    ["ck", "sync-out", "ns", "sync-in"],
    ["ns", "notes-out", "or", "notes-in"],
    ["or", "channel-1-out", "out", "notes-in"],
    ["or", "channel-2-out", "out", "notes-in"],
  ],
);

describe("the M modules on the runtime", () => {
  it("play M's default document exactly as M Clone's own planner does", () => {
    // With M's defaults nothing is left to chance: neutral cycles, Original
    // order, full density. So the canvas must match the classic engine note for
    // note. The reference is the planner's own recorded output.
    const events = play(mChain(), 8);
    const ticks = 8 * 2 * 960; // eight seconds at 120 BPM
    const expected = ((recorded as Record<string, { notes: PlannedNote[] }>).plain.notes)
      .filter((note) => note.voice === 0 && note.atTick! < ticks - 960);
    expect(expected.length).toBeGreaterThan(15);
    const ons = events.filter((e) => e.type === "note-on" && e.atTick < ticks - 960);
    expect(ons.map((e) => [e.atTick, e.note, e.velocity, e.channel]))
      .toEqual(expected.map((n) => [n.atTick, n.note, n.velocity, n.channel]));
    for (const on of ons) {
      const off = events.find((e) => e.type === "note-off" && e.noteId === on.noteId);
      const reference = expected.find((n) => n.atTick === on.atTick && n.note === on.note)!;
      expect(off!.atTick - on.atTick).toBe(reference.durationTicks);
    }
  });

  it("plays one NoteSeq per voice, each on its own channel", () => {
    const graph = mChain();
    graph.nodes.ns2 = createNode("m.lab-noteseq", "ns2", { x: 0, y: 0 }, { voice: 2, channel: 2 });
    for (const [from, fromPort, to, toPort] of [["ck", "transport-out", "ns2", "clock-in"], ["ns2", "notes-out", "or", "notes-in"]]) {
      const id = `${from}.${fromPort}-${to}.${toPort}`;
      graph.edges[id] = { id, from: { nodeId: from, portId: fromPort }, to: { nodeId: to, portId: toPort }, enabled: true };
    }
    const channels = new Set(play(graph, 2).filter((e) => e.type === "note-on").map((e) => e.channel));
    expect([...channels].sort()).toEqual([1, 2]);
  });

  it("lands each step on M Time Warp's curve when it is wired into Warp In", () => {
    const bank = { offsets: [0, 0.3, -0.2, 0.1], length: 4, denominator: 8 };
    const banks = Array.from({ length: 6 }, (_, i) => (i === 0 ? bank : { offsets: [0], length: 1, denominator: 8 }));
    const graph = mChain();
    graph.nodes.tw = createNode("m.lab-time-warp", "tw", { x: 0, y: 0 }, { banks } as never);
    graph.edges.w = { id: "w", from: { nodeId: "tw", portId: "warp-out" }, to: { nodeId: "ns", portId: "warp-in" }, enabled: true };
    const ons = play(graph, 3).filter((e) => e.type === "note-on" && e.atTick < 4000);
    const map: TimeMap = warpToTimeMap(bank);
    expect(ons.map((e) => e.atTick)).toEqual([0, 720, 1440, 2160, 2880, 3600]
      .map((tick) => Math.round(distortClockTicks(map, tick))).filter((tick) => tick < 4000));
  });

  it("a bypassed module plays nothing", () => {
    const graph = mChain();
    graph.nodes.ns.enabled = false;
    expect(() => play(graph, 1)).toThrow();
  });
});
