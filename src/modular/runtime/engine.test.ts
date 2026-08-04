import { describe, expect, it } from "vitest";
import { ModularRuntime, RecordingAdapter, patternView } from "./engine";
import { ManualSchedulerDriver } from "./clock";
import { ParameterBag } from "./processors";
import { PPQN } from "./time";
import { compileGraph, type CompiledPlan } from "../compiler/compileGraph";
import { createNode, moduleRegistry } from "../registry/registry";
import { emptyGraph, type Edge, type GraphDocument, type JsonValue } from "../model/graph";

/** A clock the test moves by hand, standing in for AudioContext time. */
class FakeClock {
  seconds = 0;
  nowSec(): number {
    return this.seconds;
  }
}

const EDGES: [string, string, string, string][] = [
  ["transport", "transport-out", "tb", "transport-in"],
  ["transport", "reset-out", "tb", "reset-in"],
  ["tb", "clock-out", "ph", "clock-in"],
  ["ph", "clock-out", "no", "clock-in"],
  ["ed", "pattern-out", "no", "pattern-in"],
  ["no", "steps-out", "sn", "steps-in"],
  ["sn", "notes-out", "nd", "notes-in"],
  ["nd", "notes-out", "mo", "notes-in"],
];

/** Transport -> Time Base -> Phase -> Note Order -> Step Notes -> Density -> MIDI. */
const chainGraph = (overrides: Record<string, Record<string, JsonValue>> = {}): GraphDocument => {
  const graph = emptyGraph();
  const nodes: [string, string][] = [
    ["transport", "m.transport-clock"],
    ["tb", "m.time-base"],
    ["ph", "m.phase"],
    ["ed", "m.note-editor"],
    ["no", "m.note-order"],
    ["sn", "m.step-to-notes"],
    ["nd", "m.note-density"],
    ["mo", "m.midi-output"],
  ];
  for (const [id, type] of nodes) {
    graph.nodes[id] = createNode(type, id, { x: 0, y: 0 }, overrides[id] ?? {});
  }
  for (const [from, fromPort, to, toPort] of EDGES) {
    const edge: Edge = {
      // Ports are part of the id: transport feeds Time Base twice, and a
      // pair-only id would silently drop one of the two connections.
      id: `${from}.${fromPort}-${to}.${toPort}`,
      from: { nodeId: from, portId: fromPort },
      to: { nodeId: to, portId: toPort },
      enabled: true,
    };
    graph.edges[edge.id] = edge;
  }
  return graph;
};

/** The mix and density settings that make a trace exactly predictable. */
const DETERMINISTIC = {
  no: { original: 100, cyclic: 0, utterly: 0 },
  nd: { density: 100 },
};

type Harness = {
  runtime: ModularRuntime;
  clock: FakeClock;
  driver: ManualSchedulerDriver;
  recorder: RecordingAdapter;
  graph: GraphDocument;
  plan: CompiledPlan;
};

const harness = (
  overrides: Record<string, Record<string, JsonValue>> = DETERMINISTIC,
  options: { wakeIntervalMs?: number; lookaheadSec?: number; seed?: number } = {},
): Harness => {
  const graph = chainGraph(overrides);
  const compiled = compileGraph(graph, moduleRegistry, { seed: options.seed ?? 7 });
  if (!compiled.ok) throw new Error(compiled.diagnostics.map((item) => item.message).join("; "));
  const clock = new FakeClock();
  const driver = new ManualSchedulerDriver();
  const lookahead = options.lookaheadSec ?? 0.12;
  const runtime = new ModularRuntime({
    registry: moduleRegistry,
    driver,
    clock,
    seed: options.seed ?? 7,
    tempoBpm: 120,
    wakeIntervalMs: options.wakeIntervalMs ?? 25,
    // Pinned so a test's window size is the thing under test, not the
    // adaptive policy reacting to the fake clock.
    scheduling: {
      baseLookaheadSec: lookahead,
      minLookaheadSec: lookahead,
      maxLookaheadSec: lookahead,
    },
  });
  const recorder = new RecordingAdapter();
  runtime.build(graph, compiled.plan);
  runtime.addAdapter(recorder);
  return { runtime, clock, driver, recorder, graph, plan: compiled.plan };
};

/** Advance the fake clock in wake-sized steps, delivering a window each time. */
const run = (harnessed: Harness, seconds: number, stepMs = 25): void => {
  const steps = Math.round((seconds * 1000) / stepMs);
  for (let i = 0; i < steps; i++) {
    harnessed.clock.seconds += stepMs / 1000;
    harnessed.driver.fire();
  }
};

const noteOns = (recorder: RecordingAdapter) =>
  recorder.events.filter((event) => event.type === "note-on");

const traceBefore = (recorder: RecordingAdapter, tickLimit: number) =>
  recorder.events
    .filter((event) => event.atTick < tickLimit)
    .map((event) => `${event.atTick} ${event.type} ${event.channel} ${event.note} ${event.velocity}`);

describe("Clock-to-note vertical slice", () => {
  it("plays the default pattern through the whole chain", () => {
    const rig = harness();
    rig.runtime.start();
    run(rig, 2.2);

    // The default Note Editor pattern has notes on every fourth step, and a
    // 1/16 time base makes each step 240 ticks — so a note every 960 ticks.
    expect(noteOns(rig.recorder).map((event) => event.atTick)).toEqual([0, 960, 1920, 2880, 3840]);
    expect(noteOns(rig.recorder).map((event) => event.note)).toEqual([60, 62, 64, 66, 60]);
    expect(noteOns(rig.recorder).every((event) => event.channel === 1)).toBe(true);
    expect(noteOns(rig.recorder).every((event) => event.velocity === 100)).toBe(true);
  });

  it("releases every note it attacks", () => {
    const rig = harness();
    rig.runtime.start();
    run(rig, 2.2);
    const attacks = noteOns(rig.recorder);
    const releases = rig.recorder.events.filter((event) => event.type === "note-off");
    // Each release pairs with its attack and lands a 90% gate later.
    for (const attack of attacks) {
      const release = releases.find((event) => event.noteId === attack.noteId);
      expect(release, `no release for note at ${attack.atTick}`).toBeDefined();
      expect(release?.atTick).toBe(attack.atTick + Math.round(240 * 0.9));
    }
  });

  it("converts ticks to seconds through the tempo map", () => {
    const rig = harness();
    rig.runtime.start();
    run(rig, 2.2);
    // 960 ticks is one quarter note; at 120 BPM that is half a second after
    // the start lead.
    const second = noteOns(rig.recorder)[1];
    expect(second.atSec).toBeCloseTo(0.06 + 0.5, 9);
  });

  it("produces an identical trace however the timeline is split into windows", () => {
    const spans = [
      { wakeIntervalMs: 5, lookaheadSec: 0.02 },
      { wakeIntervalMs: 25, lookaheadSec: 0.12 },
      { wakeIntervalMs: 100, lookaheadSec: 0.5 },
    ];
    const traces = spans.map((span) => {
      const rig = harness(DETERMINISTIC, span);
      rig.runtime.start();
      run(rig, 4, span.wakeIntervalMs);
      return traceBefore(rig.recorder, 5000);
    });

    // And the whole span planned in a single enormous window.
    const whole = harness(DETERMINISTIC, { wakeIntervalMs: 25, lookaheadSec: 4 });
    whole.runtime.start();
    whole.clock.seconds += 0.025;
    whole.driver.fire();
    traces.push(traceBefore(whole.recorder, 5000));

    expect(traces[0]).not.toHaveLength(0);
    for (const trace of traces) expect(trace).toEqual(traces[0]);
  });

  it("stays window-independent with the full generative mix engaged", () => {
    // Original/Cyclic/Utterly and a probability gate all draw randomly; none
    // of them may depend on where a window boundary fell.
    const generative = { nd: { density: 55 } };
    const fine = harness(generative, { wakeIntervalMs: 5, lookaheadSec: 0.02 });
    fine.runtime.start();
    run(fine, 4, 5);

    const coarse = harness(generative, { wakeIntervalMs: 100, lookaheadSec: 0.5 });
    coarse.runtime.start();
    run(coarse, 4, 100);

    const trace = traceBefore(fine.recorder, 5000);
    expect(trace.length).toBeGreaterThan(2);
    expect(traceBefore(coarse.recorder, 5000)).toEqual(trace);
  });

  it("gives the same performance for the same seed and a different one otherwise", () => {
    const first = harness(DETERMINISTIC, { seed: 11 });
    first.runtime.start();
    run(first, 3);

    const same = harness(DETERMINISTIC, { seed: 11 });
    same.runtime.start();
    run(same, 3);
    expect(traceBefore(same.recorder, 6000)).toEqual(traceBefore(first.recorder, 6000));

    const generative = harness({ nd: { density: 50 } }, { seed: 11 });
    generative.runtime.start();
    run(generative, 3);
    const other = harness({ nd: { density: 50 } }, { seed: 12 });
    other.runtime.start();
    run(other, 3);
    expect(traceBefore(other.recorder, 6000))
      .not.toEqual(traceBefore(generative.recorder, 6000));
  });
});

describe("Runtime transport control", () => {
  it("reports what it is running", () => {
    const rig = harness();
    expect(rig.runtime.isRunning).toBe(false);
    expect(rig.runtime.generation).toBe(1);
    rig.runtime.start();
    expect(rig.runtime.isRunning).toBe(true);
    // Starting twice is a no-op rather than a second driver subscription.
    rig.runtime.start();
    run(rig, 0.5);
    expect(rig.runtime.positionTick).toBeGreaterThan(0);
    rig.runtime.stop();
    expect(rig.runtime.isRunning).toBe(false);
  });

  it("keeps musical phase across a pause and resume", () => {
    const rig = harness();
    rig.runtime.start();
    run(rig, 1);
    const beforePause = rig.runtime.positionTick;

    rig.runtime.pause();
    expect(rig.runtime.isRunning).toBe(false);
    expect(rig.recorder.panicCount).toBe(1);
    // Real time passes while paused; musical time must not.
    rig.clock.seconds += 5;
    rig.driver.fire();
    expect(rig.runtime.positionTick).toBe(beforePause);

    rig.runtime.resume();
    run(rig, 1);
    expect(rig.runtime.positionTick).toBeGreaterThan(beforePause);
    // The pattern continues rather than restarting.
    const attacks = noteOns(rig.recorder).map((event) => event.atTick);
    expect(new Set(attacks).size).toBe(attacks.length);
  });

  it("starts from the top when resume is called without a pause", () => {
    const rig = harness();
    rig.runtime.resume();
    expect(rig.runtime.isRunning).toBe(true);
    run(rig, 1);
    expect(noteOns(rig.recorder)[0].atTick).toBe(0);
  });

  it("returns every stream to the top on sync", () => {
    const rig = harness();
    rig.runtime.start();
    run(rig, 1.5);
    const before = noteOns(rig.recorder).length;
    expect(before).toBeGreaterThan(0);

    rig.runtime.sync();
    expect(rig.recorder.panicCount).toBeGreaterThan(0);
    run(rig, 1.5);
    // After a sync the pattern restarts, so the first pitch comes round again.
    const after = noteOns(rig.recorder).slice(before);
    expect(after[0]?.note).toBe(60);
  });

  it("panics on stop and through the adapters", () => {
    const rig = harness();
    rig.runtime.start();
    run(rig, 0.5);
    rig.runtime.stop();
    expect(rig.recorder.panicCount).toBe(1);
    rig.runtime.panic();
    expect(rig.recorder.panicCount).toBe(2);
  });

  it("releases the driver and adapters on dispose", () => {
    const rig = harness();
    rig.runtime.start();
    rig.runtime.dispose();
    expect(rig.driver.running).toBe(false);
    expect(rig.runtime.isRunning).toBe(false);
  });

  it("does nothing before a plan is built", () => {
    const clock = new FakeClock();
    const driver = new ManualSchedulerDriver();
    const runtime = new ModularRuntime({ registry: moduleRegistry, driver, clock });
    expect(() => runtime.tick()).not.toThrow();
    expect(runtime.generation).toBe(0);
  });

  it("exposes lossy node-face status without affecting scheduling", () => {
    const rig = harness();
    expect(rig.runtime.nodeStatus("transport").position).toBe("Stopped · 1.1");
    expect(rig.runtime.nodeStatus("nd").activity).toBe("0 accepted · 0 rejected");
    rig.runtime.start();
    run(rig, 0.6);
    expect(rig.runtime.nodeStatus("transport").position).toMatch(/^Playing · /);
    expect(rig.runtime.nodeStatus("no").cursor).toMatch(/^Step /);
    expect(rig.runtime.nodeStatus("nd").activity).toMatch(/^\d+ accepted · \d+ rejected$/);
    expect(rig.runtime.nodeStatus("missing")).toEqual({});
  });

  it("rescrambles only a Note Order", () => {
    const rig = harness();
    expect(rig.runtime.rescramble("no")).toBe(true);
    expect(rig.runtime.rescramble("tb")).toBe(false);
    expect(rig.runtime.rescramble("missing")).toBe(false);
  });
});

describe("Stall recovery", () => {
  it("slides the tempo map forward instead of replaying the gap", () => {
    const rig = harness();
    rig.runtime.start();
    run(rig, 0.5);
    const beforeStall = noteOns(rig.recorder).length;

    // The tab froze for two seconds.
    rig.clock.seconds += 2;
    rig.driver.fire();

    const diagnostics = rig.runtime.diagnostics();
    expect(diagnostics.recoveries).toBe(1);
    expect(diagnostics.maxWakeLatenessSec).toBeGreaterThan(1.9);
    // Nothing from the missed two seconds is replayed as a burst.
    expect(noteOns(rig.recorder).length - beforeStall).toBeLessThan(4);
    expect(rig.recorder.panicCount).toBeGreaterThan(0);
  });

  it("keeps playing in phase after recovering", () => {
    const rig = harness();
    rig.runtime.start();
    run(rig, 0.5);
    rig.clock.seconds += 2;
    rig.driver.fire();
    const afterRecovery = noteOns(rig.recorder).length;

    run(rig, 2);
    const attacks = noteOns(rig.recorder).slice(afterRecovery);
    expect(attacks.length).toBeGreaterThan(1);
    // Still exactly on the 960-tick grid the pattern implies.
    for (const attack of attacks) expect(attack.atTick % 960).toBe(0);
  });

  it("drops a stale attack rather than firing it late", () => {
    // A note that missed its moment by more than the grace window is noise: it
    // would land in a bunch with whatever is due now. Releases are kept even
    // when late, because a stale release still repairs a stuck note.
    // A fast time base, so the stalled span certainly contains attacks.
    const rig = harness({ ...DETERMINISTIC, tb: { numerator: 1, denominator: 64 } });
    rig.runtime.start();
    run(rig, 0.5);
    const before = noteOns(rig.recorder).length;

    // Stall long enough that the events already scheduled are well past due,
    // but not so long that the monitor calls it a stall and re-anchors.
    rig.clock.seconds += 0.39;
    rig.driver.fire();

    expect(rig.runtime.diagnostics().droppedEvents).toBeGreaterThan(0);
    // What did get through is current: nothing arrived more than the grace
    // window behind the clock.
    for (const attack of noteOns(rig.recorder).slice(before)) {
      expect(attack.atSec).toBeGreaterThanOrEqual(rig.clock.seconds - 0.02);
    }
    // And the releases for notes already sounding were kept, late or not: a
    // stale release still repairs a device.
    expect(rig.recorder.events.some((event) => event.type === "note-off")).toBe(true);
  });
});

describe("Live parameter edits", () => {
  it("applies an immediate edit at the next window", () => {
    const rig = harness();
    rig.runtime.start();
    run(rig, 0.5);
    rig.runtime.queueParameter("nd", "density", 0, "immediate");
    const before = noteOns(rig.recorder).length;
    run(rig, 2);
    // Closing the gate stops new notes.
    expect(noteOns(rig.recorder).length).toBe(before);
    expect(rig.runtime.parameterValue("nd", "density")).toBe(0);
  });

  it("holds a step-locked edit until a step boundary", () => {
    const rig = harness();
    rig.runtime.start();
    run(rig, 0.1);
    rig.runtime.queueParameter("tb", "numerator", 2, "step-end");
    run(rig, 1);
    expect(rig.runtime.parameterValue("tb", "numerator")).toBe(2);
  });

  it("coalesces a drag into the value the user let go on", () => {
    const rig = harness();
    rig.runtime.start();
    run(rig, 0.2);
    for (let i = 0; i <= 100; i++) rig.runtime.queueParameter("sn", "velocity", i, "immediate");
    run(rig, 1);
    expect(rig.runtime.parameterValue("sn", "velocity")).toBe(100);
  });

  it("reports an unknown parameter target as undefined", () => {
    const rig = harness();
    expect(rig.runtime.parameterValue("missing", "density")).toBeUndefined();
    expect(() => rig.runtime.queueParameter("missing", "density", 1)).not.toThrow();
  });
});

describe("Telemetry and diagnostics", () => {
  it("buffers note telemetry for the UI to drain", () => {
    const rig = harness();
    rig.runtime.start();
    run(rig, 2.2);
    const entries = rig.runtime.drainTelemetry();
    expect(entries.map((entry) => entry.atTick)).toEqual([0, 960, 1920, 2880, 3840]);
    expect(entries[0]).toMatchObject({ kind: "note", nodeId: "mo", note: 60, channel: 1 });
    // Draining empties the ring.
    expect(rig.runtime.drainTelemetry()).toEqual([]);
  });

  it("never lets an undrained UI affect the scheduler", () => {
    const rig = harness();
    rig.runtime.start();
    run(rig, 30);
    // Thirty seconds without a single drain, and the runtime is still fine.
    expect(rig.runtime.drainTelemetry().length).toBeLessThanOrEqual(2048);
    expect(rig.runtime.diagnostics().droppedWindows).toBe(0);
  });

  it("stops allocating once playback settles", () => {
    const rig = harness();
    rig.runtime.start();
    run(rig, 2);
    const settled = rig.runtime.poolStats();
    run(rig, 8);
    // Pools reached their high-water mark and then stopped growing, which is
    // the whole point of the pooled hot path.
    expect(rig.runtime.poolStats()).toEqual(settled);
  });
});

describe("Graph shape handling", () => {
  it("plays nothing when the pattern has no output length", () => {
    const rig = harness({ ...DETERMINISTIC, ed: { "output-length": 0 } });
    rig.runtime.start();
    run(rig, 2);
    expect(noteOns(rig.recorder)).toHaveLength(0);
  });

  it("silences a stream whose time base is set to step advance", () => {
    const rig = harness({ ...DETERMINISTIC, tb: { denominator: 0 } });
    rig.runtime.start();
    run(rig, 2);
    expect(noteOns(rig.recorder)).toHaveLength(0);
  });

  it("offsets a stream by its phase without changing what it plays", () => {
    const straight = harness(DETERMINISTIC);
    straight.runtime.start();
    run(straight, 2.5);

    const offset = harness({ ...DETERMINISTIC, ph: { "offset-ticks": 480 } });
    offset.runtime.start();
    run(offset, 2.5);

    const straightNotes = noteOns(straight.recorder);
    const offsetNotes = noteOns(offset.recorder);
    expect(offsetNotes[0].atTick).toBe(straightNotes[0].atTick + 480);
    expect(offsetNotes.slice(0, 3).map((event) => event.note))
      .toEqual(straightNotes.slice(0, 3).map((event) => event.note));
  });

  it("keeps a Note Editor in the document without trying to run it", () => {
    const rig = harness();
    // The editor has no processor, but its pattern still reaches Note Order.
    expect(rig.plan.order).toContain("ed");
    rig.runtime.start();
    run(rig, 1.2);
    expect(noteOns(rig.recorder).length).toBeGreaterThan(0);
  });
});

describe("Pattern view", () => {
  it("reads the active position and output length", () => {
    const bag = new ParameterBag({
      "preset-values": [[[60], [62]], [[70], [72]]] as never,
      "active-position": 1,
      "output-length": 2,
    });
    expect(patternView(bag)).toEqual({ steps: [[70], [72]], outputLength: 2 });
  });

  it("clamps an out-of-range position", () => {
    const bag = new ParameterBag({
      "preset-values": [[[60]]] as never,
      "active-position": 7,
    });
    expect(patternView(bag).steps).toEqual([[60]]);
  });

  it("survives missing or malformed pattern storage", () => {
    expect(patternView(new ParameterBag({})).outputLength).toBe(0);
    expect(patternView(new ParameterBag({ "preset-values": [] as never })).steps).toEqual([]);
    expect(
      patternView(new ParameterBag({ "preset-values": ["nonsense"] as never })).steps,
    ).toEqual([]);
  });
});

describe("Recording adapter", () => {
  it("copies events, because the runtime recycles them immediately", () => {
    const adapter = new RecordingAdapter("test");
    const pooled = {
      type: "note-on" as const, atTick: 10, atSec: 1, sequence: 0, portId: "mo",
      channel: 1, note: 60, velocity: 90, program: 0, controller: 0, value: 0, noteId: 3,
    };
    adapter.send([pooled], 1);
    pooled.note = 99;
    expect(adapter.events[0].note).toBe(60);
    expect(adapter.id).toBe("test");
    expect(adapter.trace()).toEqual(["10 note-on 1 60 90"]);
    adapter.clear();
    expect(adapter.events).toHaveLength(0);
  });

  it("sends only the live portion of a reused buffer", () => {
    const adapter = new RecordingAdapter();
    const event = {
      type: "note-on" as const, atTick: 0, atSec: 0, sequence: 0, portId: "mo",
      channel: 1, note: 60, velocity: 90, program: 0, controller: 0, value: 0, noteId: 0,
    };
    adapter.send([event, event, event], 2);
    expect(adapter.events).toHaveLength(2);
  });
});

describe("Musical resolution", () => {
  it("keeps a quarter note at the declared resolution", () => {
    expect(PPQN).toBe(960);
  });
});
