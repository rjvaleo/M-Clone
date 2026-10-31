import { describe, expect, it } from "vitest";
import { MessageBus, type StreamMessage } from "./messages";
import { ParameterBag, type ProcessWindow } from "./processors";
import { MConductorProcessor, MOrchestraProcessor } from "./mlabProcessors";
import { PPQN, TempoMap } from "./time";

const window = (startTick: number, endTick: number): ProcessWindow => ({
  startTick, endTick, tempo: new TempoMap(120, 0),
});

const collector = (bus: MessageBus, nodeId: string, portId: string) => {
  bus.connect(nodeId, portId, "collector", portId);
  return (): StreamMessage[] => {
    const { items, count } = bus.read("collector", portId);
    return items.slice(0, count).map((m) => ({ ...m }));
  };
};

const feed = (bus: MessageBus, toNodeId: string, toPortId: string, messages: Partial<StreamMessage>[]) => {
  const outPort = `out-${toNodeId}-${toPortId}`;
  bus.connect("upstream", outPort, toNodeId, toPortId);
  bus.beginNode("upstream", 1024);
  for (const fields of messages) {
    const message = bus.acquire()!;
    Object.assign(message, fields);
    bus.publish(outPort, message);
  }
};

/** M Orchestra fed notes in one window; the result is what each of its 16 channel outputs sent. */
const orchestra = (values: Record<string, unknown>, bus = new MessageBus()) => {
  const processor = new MOrchestraProcessor({
    nodeId: "or", bus, parameters: new ParameterBag(values as never), budget: 1024, seed: 7,
  });
  const outs = Array.from({ length: 16 }, (_, i) => collector(bus, "or", `channel-${i + 1}-out`));
  const run = (notes: Partial<StreamMessage>[], at = 0) => {
    feed(bus, "or", "notes-in", notes.map((note) => ({ kind: "note-event", atTick: at, note: 60, velocity: 100, ...note })));
    bus.beginNode("or", 1024);
    processor.process(window(at, at + PPQN));
    const out = outs.map((read) => read());
    bus.endWindow();
    return out;
  };
  return { processor, run };
};

describe("M Orchestra: each voice onto its channels", () => {
  it("sends voice n to channel n by default", () => {
    const { run } = orchestra({});
    const out = run([{ voice: 0 }, { voice: 2 }]);
    expect(out[0].map((m) => [m.channel, m.voice])).toEqual([[1, 0]]);
    expect(out[2].map((m) => [m.channel, m.voice])).toEqual([[3, 2]]);
  });

  it("copies a voice onto every channel in its orchestration, at the active position", () => {
    const orchestration = Array.from({ length: 6 }, () => Array.from({ length: 8 }, (_, v) => [v + 1]));
    orchestration[1][0] = [4, 9];
    const { run } = orchestra({ orchestration, position: 1 });
    const out = run([{ voice: 0, note: 64 }]);
    expect(out[3].map((m) => [m.channel, m.note])).toEqual([[4, 64]]);
    expect(out[8].map((m) => [m.channel, m.note])).toEqual([[9, 64]]);
    expect(out[0]).toEqual([]);
  });

  it("an M button mutes its channel, as on a MatrixSeq row", () => {
    const muted = Array(16).fill(false);
    muted[0] = true;
    const out = orchestra({ muted }).run([{ voice: 0 }, { voice: 1 }]);
    expect(out[0]).toEqual([]);
    expect(out[1]).toHaveLength(1);
  });

  it("sends each channel's Sound Choice on start, and again only when it changes", () => {
    const programs = Array.from({ length: 6 }, () => Array.from({ length: 16 }, () => null as number | null));
    programs[0][0] = 5;
    programs[1][0] = 9;
    const values = { programs, "sound-position": 0 } as Record<string, unknown>;
    const bus = new MessageBus();
    const { processor, run } = orchestra(values, bus);
    const first = run([]);
    expect(first[0].map((m) => [m.kind, m.controlValue, m.channel])).toEqual([["program-change", 5, 1]]);
    expect(run([], PPQN)[0]).toEqual([]);
    (processor as unknown as { parameters: ParameterBag }).parameters.set("sound-position", 1);
    expect(run([], 2 * PPQN)[0].map((m) => m.controlValue)).toEqual([9]);
  });
});

describe("MIDI Out: program changes", () => {
  it("schedules a program change it is sent, and no note", async () => {
    const { MidiOutputProcessor } = await import("./processors");
    const { EventPool } = await import("./eventqueue");
    const pool = new EventPool(16);
    const submitted: { type: string; program: number; channel: number }[] = [];
    const bus = new MessageBus();
    const sink = { acquire: () => pool.acquire(), submit: (e: { type: string; program: number; channel: number }) => submitted.push({ ...e }) };
    const out = new MidiOutputProcessor({ nodeId: "mo", bus, parameters: new ParameterBag({}), budget: 16, seed: 1, sink: sink as never });
    feed(bus, "mo", "notes-in", [{ kind: "program-change", controlValue: 12, channel: 3, atTick: 0 }]);
    bus.beginNode("mo", 16);
    out.process(window(0, PPQN));
    expect(submitted.map((e) => [e.type, e.program, e.channel])).toEqual([["program-change", 12, 3]]);
  });
});

const clock = (values: Record<string, unknown> = {}) => {
  const bus = new MessageBus();
  const processor = new MConductorProcessor({
    nodeId: "ck", bus, parameters: new ParameterBag(values as never), budget: 256, seed: 7,
  });
  const outs = { sync: collector(bus, "ck", "sync-out"), run: collector(bus, "ck", "run-out") };
  const tempo = new TempoMap(120, 0);
  const run = (start: number, end: number) => {
    bus.beginNode("ck", 256);
    processor.process({ startTick: start, endTick: end, tempo });
    const out = { sync: outs.sync(), run: outs.run() };
    bus.endWindow();
    return out;
  };
  return { processor, run, tempo, parameters: (processor as unknown as { parameters: ParameterBag }).parameters };
};

describe("M Conductor's transport: tempo, Sync and Tap Conduct, as M's Conducting window", () => {
  it("plays the whole canvas at its tempo", () => {
    const { run, tempo, parameters } = clock({ tempo: 90 });
    run(0, 100);
    expect(tempo.bpmAt(0)).toBe(90);
    parameters.set("tempo", 140);
    run(100, 200);
    expect(tempo.bpmAt(100)).toBe(140);
  });

  it("sends Sync at once, or on the next beat or bar of its Bar Length", () => {
    for (const [quantize, bar, expected] of [["now", 4, 100], ["beat", 4, PPQN], ["bar", 4, 4 * PPQN], ["bar", 3, 3 * PPQN]] as const) {
      const { processor, run } = clock({ "sync-quantize": quantize, "bar-length": bar });
      run(0, 100);
      expect(processor.command("sync")).toBe(true);
      const sent = [run(100, 200), run(200, 5 * PPQN)].flatMap((out) => out.sync);
      expect(sent.map((m) => [m.kind, m.atTick])).toEqual([["reset", expected]]);
    }
  });

  it("reports the bar, beat and sixteenth for its readouts", () => {
    const { processor, run } = clock({ "bar-length": 3 });
    run(0, 3 * PPQN + PPQN + 2 * (PPQN / 4));
    run(3 * PPQN + PPQN + 2 * (PPQN / 4), 3 * PPQN + PPQN + 3 * (PPQN / 4));
    expect(processor.status()).toMatchObject({ bar: "2", beat: "2", sixteenth: "3" });
  });

  it("keeps the music running when Tap Conduct is off", () => {
    const { run } = clock();
    expect(run(0, 100).run.map((m) => m.controlValue)).toEqual([1]);
    expect(run(100, 200).run).toEqual([]);
  });

  it("under Held Tap Conduct, waits, then lets one beat play per tap", () => {
    const { processor, run } = clock({ "tap-conduct": "held" });
    expect(run(0, 100).run.map((m) => m.controlValue)).toEqual([0]);
    processor.command("tap");
    const tapped = [run(500, 600), run(600, 3000)].flatMap((out) => out.run);
    expect(tapped.map((m) => [m.controlValue, m.atTick])).toEqual([[1, 500], [0, 500 + PPQN]]);
  });
});

const conductor = (values: Record<string, unknown> = {}) => {
  const bus = new MessageBus();
  const processor = new MConductorProcessor({
    nodeId: "co", bus, parameters: new ParameterBag(values as never), budget: 256, seed: 7,
  });
  const ports = ["x1-out", "y1-out", "x2-out", "y2-out", "x3-out", "y3-out"] as const;
  const outs = Object.fromEntries(ports.map((port) => [port, collector(bus, "co", port)])) as Record<string, () => StreamMessage[]>;
  const run = (start: number, end: number) => {
    bus.beginNode("co", 256);
    processor.process(window(start, end));
    const out = Object.fromEntries(ports.map((port: string) => [port, outs[port]().map((m) => m.controlValue)])) as Record<string, number[]>;
    bus.endWindow();
    return out;
  };
  return { run, parameters: (processor as unknown as { parameters: ParameterBag }).parameters };
};

describe("M Conductor's pads: the baton and two more", () => {
  const pads = (x: number, y: number, glide = 0) => [{ x, y, glide }, { x: 0, y: 0, glide: 0 }, { x: 0.5, y: -0.5, glide: 0 }];

  it("sends each pad's X and Y when they move, -1 to +1 as Triple XY does", () => {
    const { run, parameters } = conductor({ pads: pads(0.25, -0.75) });
    const first = run(0, 100);
    expect([first["x1-out"], first["y1-out"], first["x3-out"], first["y3-out"]]).toEqual([[0.25], [-0.75], [0.5], [-0.5]]);
    expect(run(100, 200)["x1-out"]).toEqual([]);
    parameters.set("pads", pads(1, -0.75) as never);
    expect(run(200, 300)["x1-out"]).toEqual([1]);
  });

  it("glides from where it is toward the target", () => {
    const { run, parameters } = conductor({ pads: pads(0, 0, 1) });
    run(0, 100);
    parameters.set("pads", pads(1, 0, 1) as never);
    const glided = run(100, 580)["x1-out"][0];
    expect(glided).toBeGreaterThan(0);
    expect(glided).toBeLessThan(1);
  });
});

/** A processor run once in a window where the bus allows it only `budget` messages. */
const starved = <P extends { process(window: ProcessWindow): void }>(make: (bus: MessageBus) => P, ports: string[], nodeId: string) => {
  const bus = new MessageBus();
  const processor = make(bus);
  const outs = Object.fromEntries(ports.map((port) => [port, collector(bus, nodeId, port)]));
  const run = (start: number, end: number, budget: number) => {
    bus.beginNode(nodeId, budget);
    processor.process(window(start, end));
    const out = Object.fromEntries(ports.map((port) => [port, outs[port]()]));
    bus.endWindow();
    return out;
  };
  return { bus, processor, run };
};

describe("M Conductor at its edges", () => {
  const make = (values: Record<string, unknown>) => (bus: MessageBus) =>
    new MConductorProcessor({ nodeId: "ck", bus, parameters: new ParameterBag(values as never), budget: 256, seed: 7 });

  it("knows only Sync and Tap", () => {
    const { processor } = clock();
    expect(processor.command("rewind")).toBe(false);
  });

  it("sends Sync at once when no quantize is set", () => {
    const { processor, run } = clock();
    run(0, 100);
    processor.command("sync");
    expect(run(100, 200).sync.map((m) => m.atTick)).toEqual([100]);
  });

  it("says whether it is waiting for a tap", () => {
    const { processor, run } = clock({ "tap-conduct": "held" });
    run(0, 100);
    expect(processor.status().run).toBe("Waiting for a tap");
    processor.command("tap");
    run(100, 200);
    expect(processor.status().run).toBe("Running");
  });

  it("holds Run and Sync back while the bus is spent, and sends them when it is not", () => {
    const { processor, run } = starved(make({ "tap-conduct": "held" }), ["run-out", "sync-out"], "ck");
    processor.command("sync");
    expect(run(0, 100, 0)).toEqual({ "run-out": [], "sync-out": [] });
    // Room for Run only: Sync waits for the next window.
    expect(run(100, 200, 1)["sync-out"]).toEqual([]);
    const later = run(200, 300, 4);
    expect(later["sync-out"].map((m) => [m.kind, m.atTick])).toEqual([["reset", 0]]);
  });

  it("sends the pads it is not given as at rest, and holds a pad back while the bus is spent", () => {
    const pads = ["x1-out", "y1-out", "x2-out", "y2-out", "x3-out", "y3-out"];
    const { run } = starved(make({ pads: [{ x: 0.5, y: -0.5, glide: 0 }] }), pads, "co");
    const value = (out: Record<string, StreamMessage[]>) => pads.map((port) => out[port].map((m) => m.controlValue));
    // Run takes the one message there is room for.
    expect(value(run(0, 100, 1))).toEqual([[], [], [], [], [], []]);
    expect(value(run(100, 200, 16))).toEqual([[0.5], [-0.5], [0], [0], [0], [0]]);
  });
});

describe("M Orchestra at its edges", () => {
  const make = (values: Record<string, unknown>) => (bus: MessageBus) =>
    new MOrchestraProcessor({ nodeId: "or", bus, parameters: new ParameterBag(values as never), budget: 1024, seed: 7 });
  const channels = Array.from({ length: 16 }, (_, i) => `channel-${i + 1}-out`);

  it("passes over what is not a note, and sends a voice it has no orchestration for on its own channel", () => {
    const { bus, run } = starved(make({ orchestration: [] }), channels, "or");
    feed(bus, "or", "notes-in", [
      { kind: "control", atTick: 0, controlValue: 1, voice: 0 },
      { kind: "note-event", atTick: 0, note: 60, voice: 1 },
      { kind: "note-event", atTick: 0, note: 62, voice: 12 },
    ]);
    const out = run(0, PPQN, 64);
    expect(out["channel-2-out"].map((m) => [m.kind, m.note])).toEqual([["note-event", 60]]);
    expect(out["channel-13-out"].map((m) => [m.kind, m.note])).toEqual([["note-event", 62]]);
    expect(out["channel-1-out"]).toEqual([]);
  });

  it("stops copying when the bus is spent", () => {
    const orchestration = [[[1, 2]]];
    const { bus, run } = starved(make({ orchestration }), channels, "or");
    feed(bus, "or", "notes-in", [{ kind: "note-event", atTick: 0, note: 60, voice: 0 }]);
    const out = run(0, PPQN, 1);
    expect([out["channel-1-out"].length, out["channel-2-out"].length]).toEqual([1, 0]);
  });

  it("sends no notes until every Sound Choice has gone ahead of them", () => {
    const programs = [Array.from({ length: 16 }, (_, i) => (i < 2 ? 10 + i : null))];
    const { bus, run } = starved(make({ programs }), channels, "or");
    feed(bus, "or", "notes-in", [{ kind: "note-event", atTick: 0, note: 60, voice: 0 }]);
    const out = run(0, PPQN, 1);
    expect(out["channel-1-out"].map((m) => [m.kind, m.controlValue])).toEqual([["program-change", 10]]);
    expect(out["channel-2-out"]).toEqual([]);
  });
});
