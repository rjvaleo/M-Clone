import { describe, expect, it } from "vitest";
import { EventPool, type RuntimeEvent } from "./eventqueue";
import { MessageBus, type StreamMessage } from "./messages";
import {
  CyclicAccentProcessor,
  CyclicLegatoProcessor,
  CyclicRhythmProcessor,
  LegatoProcessor,
  MidiOutputProcessor,
  NoteDensityProcessor,
  NoteOrderProcessor,
  ParameterBag,
  PhaseProcessor,
  PlayEnableProcessor,
  StepToNotesProcessor,
  TimeBaseProcessor,
  TranspositionProcessor,
  ScaleContextProcessor,
  ScaleQuantizerProcessor,
  ChordQuantizerProcessor,
  TransportProcessor,
  VelocityRangeProcessor,
  type PatternView,
  type ProcessWindow,
  type ScheduledEventSink,
} from "./processors";
import { PPQN, TempoMap } from "./time";

const window = (startTick: number, endTick: number): ProcessWindow => ({
  startTick,
  endTick,
  tempo: new TempoMap(120, 0),
});

/** Wire one processor's output port into a collector we can read back. */
const collector = (bus: MessageBus, nodeId: string, portId: string) => {
  bus.connect(nodeId, portId, "collector", portId);
  return (): StreamMessage[] => {
    const { items, count } = bus.read("collector", portId);
    return items.slice(0, count);
  };
};

/**
 * Deliver messages into a node's input port as if an upstream node emitted
 * them. Each target port gets its own upstream port, so feeding a reset does
 * not also deliver it to a clock input wired earlier in the same test.
 */
const feed = (
  bus: MessageBus,
  toNodeId: string,
  toPortId: string,
  messages: Partial<StreamMessage>[],
) => {
  const outPort = `out-${toNodeId}-${toPortId}`;
  bus.connect("upstream", outPort, toNodeId, toPortId);
  bus.beginNode("upstream", 1024);
  for (const fields of messages) {
    const message = bus.acquire();
    if (!message) return;
    Object.assign(message, fields);
    bus.publish(outPort, message);
  }
};

const build = (nodeId: string, bus: MessageBus, values: Record<string, unknown>) => ({
  nodeId,
  bus,
  parameters: new ParameterBag(values as never),
  budget: 1024,
  seed: 7,
});

describe("Transport processor", () => {
  it("sends nothing until a sync is requested", () => {
    const bus = new MessageBus();
    const read = collector(bus, "t", "reset-out");
    const transport = new TransportProcessor(build("t", bus, {}));
    bus.beginNode("t", 16);
    transport.process(window(0, 480));
    expect(read()).toHaveLength(0);

    transport.requestReset(240);
    bus.beginNode("t", 16);
    transport.process(window(0, 480));
    const messages = read();
    expect(messages).toHaveLength(1);
    expect(messages[0].kind).toBe("reset");
    expect(messages[0].atTick).toBe(240);
  });

  it("delivers a sync only once", () => {
    const bus = new MessageBus();
    const read = collector(bus, "t", "reset-out");
    const transport = new TransportProcessor(build("t", bus, {}));
    transport.requestReset(0);
    bus.beginNode("t", 16);
    transport.process(window(0, 480));
    bus.endWindow();
    bus.beginNode("t", 16);
    transport.process(window(480, 960));
    expect(read()).toHaveLength(0);
  });

  it("never delivers a sync before the window it lands in", () => {
    const bus = new MessageBus();
    const read = collector(bus, "t", "reset-out");
    const transport = new TransportProcessor(build("t", bus, {}));
    transport.requestReset(10);
    bus.beginNode("t", 16);
    transport.process(window(480, 960));
    expect(read()[0].atTick).toBe(480);
  });
});

describe("Time Base processor", () => {
  const timeBase = (values: Record<string, unknown> = {}) => {
    const bus = new MessageBus();
    const read = collector(bus, "tb", "clock-out");
    const processor = new TimeBaseProcessor(
      build("tb", bus, { numerator: 1, denominator: 16, ...values }),
    );
    return { bus, read, processor };
  };

  it("pulses on the absolute tick grid", () => {
    const { bus, read, processor } = timeBase();
    bus.beginNode("tb", 64);
    processor.process(window(0, 1000));
    expect(read().map((message) => message.atTick)).toEqual([0, 240, 480, 720, 960]);
    expect(read()[0].durationTicks).toBe(240);
  });

  it("continues the same grid across window boundaries", () => {
    const { bus, read, processor } = timeBase();
    bus.beginNode("tb", 64);
    processor.process(window(0, 500));
    expect(read().map((message) => message.atTick)).toEqual([0, 240, 480]);
    bus.endWindow();
    bus.beginNode("tb", 64);
    processor.process(window(500, 1000));
    expect(read().map((message) => message.atTick)).toEqual([720, 960]);
  });

  it("honours the time base ratio", () => {
    const { bus, read, processor } = timeBase({ numerator: 3, denominator: 8 });
    bus.beginNode("tb", 64);
    processor.process(window(0, 3000));
    expect(read().map((message) => message.atTick)).toEqual([0, 1440, 2880]);
  });

  it("advances only from Step Advance when the denominator is zero", () => {
    const { bus, read, processor } = timeBase({ denominator: 0 });
    bus.beginNode("tb", 64);
    processor.process(window(0, 10_000));
    expect(read()).toHaveLength(0);
  });

  it("jumps forward after a stall instead of firing a burst", () => {
    const { bus, read, processor } = timeBase();
    bus.beginNode("tb", 64);
    // A window that begins long after the last pulse must not replay the gap.
    processor.process(window(100_000, 100_100));
    expect(read().map((message) => message.atTick)).toEqual([100_080]);
  });

  it("realigns the grid on reset", () => {
    const { bus, read, processor } = timeBase();
    feed(bus, "tb", "reset-in", [{ kind: "reset", atTick: 100 }]);
    bus.beginNode("tb", 64);
    processor.process(window(0, 700));
    expect(read().map((message) => message.atTick)).toEqual([100, 340, 580]);
  });

  it("stops emitting when it exhausts its budget", () => {
    const { bus, read, processor } = timeBase();
    bus.beginNode("tb", 3);
    processor.process(window(0, 100_000));
    expect(read()).toHaveLength(3);
    expect(bus.overrunCount).toBe(1);
  });

  it("resets to a musical position on demand", () => {
    const { bus, read, processor } = timeBase();
    processor.reset(480);
    bus.beginNode("tb", 8);
    processor.process(window(0, 1000));
    expect(read().map((message) => message.atTick)).toEqual([480, 720, 960]);
  });
});

describe("Phase processor", () => {
  const phase = (offset: number) => {
    const bus = new MessageBus();
    const read = collector(bus, "ph", "clock-out");
    const processor = new PhaseProcessor(build("ph", bus, { "offset-ticks": offset }));
    return { bus, read, processor };
  };

  it("passes pulses through unchanged at zero offset", () => {
    const { bus, read, processor } = phase(0);
    feed(bus, "ph", "clock-in", [
      { kind: "step-clock", atTick: 0, durationTicks: 240 },
      { kind: "step-clock", atTick: 240, durationTicks: 240 },
    ]);
    bus.beginNode("ph", 16);
    processor.process(window(0, 480));
    expect(read().map((message) => message.atTick)).toEqual([0, 240]);
  });

  it("holds a delayed pulse for the window it actually lands in", () => {
    const { bus, read, processor } = phase(480);
    feed(bus, "ph", "clock-in", [{ kind: "step-clock", atTick: 0, durationTicks: 240 }]);
    bus.beginNode("ph", 16);
    processor.process(window(0, 240));
    expect(read()).toHaveLength(0);
    expect(processor.pendingCount).toBe(1);

    bus.endWindow();
    bus.beginNode("ph", 16);
    processor.process(window(240, 600));
    const delivered = read();
    expect(delivered.map((message) => message.atTick)).toEqual([480]);
    expect(delivered[0].durationTicks).toBe(240);
    expect(processor.pendingCount).toBe(0);
  });

  it("delivers a held pulse at its own tick, never clamped to the window", () => {
    const { bus, read, processor } = phase(100);
    feed(bus, "ph", "clock-in", [{ kind: "step-clock", atTick: 0, durationTicks: 240 }]);
    bus.beginNode("ph", 16);
    processor.process(window(0, 50));
    bus.endWindow();
    bus.beginNode("ph", 16);
    processor.process(window(50, 500));
    // 100, not 50: where the boundary fell must not change the music.
    expect(read().map((message) => message.atTick)).toEqual([100]);
  });

  it("keeps held pulses in musical order", () => {
    const { bus, read, processor } = phase(10);
    feed(bus, "ph", "clock-in", [
      { kind: "step-clock", atTick: 500, durationTicks: 240 },
      { kind: "step-clock", atTick: 100, durationTicks: 240 },
    ]);
    bus.beginNode("ph", 16);
    processor.process(window(0, 1000));
    expect(read().map((message) => message.atTick)).toEqual([110, 510]);
  });

  it("drops pending pulses on reset", () => {
    const { bus, read, processor } = phase(480);
    feed(bus, "ph", "clock-in", [{ kind: "step-clock", atTick: 0, durationTicks: 240 }]);
    bus.beginNode("ph", 16);
    processor.process(window(0, 100));
    expect(processor.pendingCount).toBe(1);

    bus.endWindow();
    feed(bus, "ph", "reset-in", [{ kind: "reset", atTick: 100 }]);
    bus.beginNode("ph", 16);
    processor.process(window(100, 2000));
    expect(read()).toHaveLength(0);
    processor.reset(0);
    expect(processor.pendingCount).toBe(0);
  });
});

describe("Note Order processor", () => {
  const pattern: PatternView = {
    steps: [[60], [62], [64], [66]],
    outputLength: 4,
  };

  const noteOrder = (mix: Record<string, number>, view: PatternView = pattern) => {
    const bus = new MessageBus();
    const read = collector(bus, "no", "steps-out");
    const processor = new NoteOrderProcessor({
      ...build("no", bus, mix),
      pattern: () => view,
    });
    return { bus, read, processor };
  };

  const pulses = (count: number) =>
    Array.from({ length: count }, (_, i) => ({
      kind: "step-clock" as const,
      atTick: i * 240,
      durationTicks: 240,
    }));

  it("walks the pattern in order when the mix is all Original", () => {
    const { bus, read, processor } = noteOrder({ original: 100, cyclic: 0, utterly: 0 });
    feed(bus, "no", "clock-in", pulses(6));
    bus.beginNode("no", 64);
    processor.process(window(0, 1440));
    expect(read().map((message) => message.stepIndex)).toEqual([0, 1, 2, 3, 0, 1]);
    expect(read()[0].pitches).toEqual([60]);
    expect(read()[0].durationTicks).toBe(240);
  });

  it("walks a stable scramble when the mix is all Cyclic", () => {
    const first = noteOrder({ original: 0, cyclic: 100, utterly: 0 });
    feed(first.bus, "no", "clock-in", pulses(4));
    first.bus.beginNode("no", 64);
    first.processor.process(window(0, 960));
    const order = first.read().map((message) => message.stepIndex);
    // A permutation of the pattern, not a repeat of one step.
    expect([...order].sort()).toEqual([0, 1, 2, 3]);

    const second = noteOrder({ original: 0, cyclic: 100, utterly: 0 });
    feed(second.bus, "no", "clock-in", pulses(4));
    second.bus.beginNode("no", 64);
    second.processor.process(window(0, 960));
    expect(second.read().map((message) => message.stepIndex)).toEqual(order);
  });

  it("produces new Cyclic material on ReScramble", () => {
    const attempts = Array.from({ length: 6 }, () => {
      const { bus, read, processor } = noteOrder({ original: 0, cyclic: 100, utterly: 0 });
      processor.rescramble();
      feed(bus, "no", "clock-in", pulses(4));
      bus.beginNode("no", 64);
      processor.process(window(0, 960));
      return read().map((message) => message.stepIndex).join(",");
    });
    // Same generation, same material.
    expect(new Set(attempts).size).toBe(1);

    const { bus, read, processor } = noteOrder({ original: 0, cyclic: 100, utterly: 0 });
    feed(bus, "no", "clock-in", pulses(4));
    bus.beginNode("no", 64);
    processor.process(window(0, 960));
    const before = read().map((message) => message.stepIndex).join(",");
    expect(attempts[0]).not.toBe(before);
  });

  it("never repeats a step immediately when the mix is all Utterly", () => {
    const { bus, read, processor } = noteOrder({ original: 0, cyclic: 0, utterly: 100 });
    feed(bus, "no", "clock-in", pulses(60));
    bus.beginNode("no", 128);
    processor.process(window(0, 60 * 240));
    const indexes = read().map((message) => message.stepIndex);
    expect(indexes).toHaveLength(60);
    for (let i = 1; i < indexes.length; i++) expect(indexes[i]).not.toBe(indexes[i - 1]);
    for (const index of indexes) {
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(4);
    }
  });

  it("falls back to Original rather than stopping when every weight is zero", () => {
    const { bus, read, processor } = noteOrder({ original: 0, cyclic: 0, utterly: 0 });
    feed(bus, "no", "clock-in", pulses(4));
    bus.beginNode("no", 64);
    processor.process(window(0, 960));
    expect(read().map((message) => message.stepIndex)).toEqual([0, 1, 2, 3]);
  });

  it("emits nothing without pattern material or without a clock", () => {
    const empty = noteOrder({ original: 100, cyclic: 0, utterly: 0 }, { steps: [], outputLength: 0 });
    feed(empty.bus, "no", "clock-in", pulses(4));
    empty.bus.beginNode("no", 64);
    empty.processor.process(window(0, 960));
    expect(empty.read()).toHaveLength(0);

    const idle = noteOrder({ original: 100, cyclic: 0, utterly: 0 });
    idle.bus.beginNode("no", 64);
    idle.processor.process(window(0, 960));
    expect(idle.read()).toHaveLength(0);
  });

  it("respects an output length shorter than the stored pattern", () => {
    const { bus, read, processor } = noteOrder(
      { original: 100, cyclic: 0, utterly: 0 },
      { steps: [[60], [62], [64], [66]], outputLength: 2 },
    );
    feed(bus, "no", "clock-in", pulses(5));
    bus.beginNode("no", 64);
    processor.process(window(0, 1200));
    expect(read().map((message) => message.stepIndex)).toEqual([0, 1, 0, 1, 0]);
  });

  it("returns to the top of the pattern on reset", () => {
    const { bus, read, processor } = noteOrder({ original: 100, cyclic: 0, utterly: 0 });
    feed(bus, "no", "clock-in", pulses(3));
    bus.beginNode("no", 64);
    processor.process(window(0, 720));
    bus.endWindow();

    feed(bus, "no", "reset-in", [{ kind: "reset", atTick: 720 }]);
    feed(bus, "no", "clock-in", pulses(2));
    bus.beginNode("no", 64);
    processor.process(window(720, 1200));
    expect(read().map((message) => message.stepIndex)).toEqual([0, 1]);
    processor.reset(0);
  });

  it("handles a single-step pattern without dividing by zero", () => {
    const { bus, read, processor } = noteOrder(
      { original: 0, cyclic: 0, utterly: 100 },
      { steps: [[60]], outputLength: 1 },
    );
    feed(bus, "no", "clock-in", pulses(5));
    bus.beginNode("no", 64);
    processor.process(window(0, 1200));
    expect(read().map((message) => message.stepIndex)).toEqual([0, 0, 0, 0, 0]);
  });
});

describe("Cyclic processors", () => {
  const pulses = (count: number, stepTicks = 240) =>
    Array.from({ length: count }, (_, i) => ({
      kind: "step-clock" as const,
      atTick: i * stepTicks,
      durationTicks: stepTicks,
    }));

  it("emits accent control values from its active preset", () => {
    const bus = new MessageBus();
    const read = collector(bus, "ca", "accent-out");
    const processor = new CyclicAccentProcessor(build("ca", bus, {
      "preset-values": [
        [0, 1, 2, 3, 4, 0, 1, 2, 3, 4, 0, 1, 2, 3, 4, 0],
      ],
      "active-position": 0,
    }));
    feed(bus, "ca", "clock-in", pulses(5));
    bus.beginNode("ca", 64);
    processor.process(window(0, 1200));
    const values = read().map((message) => message.controlValue);
    expect(values).toEqual([0, 1, 2, 3, 4]);
    expect(read().every((message) => message.kind === "control")).toBe(true);
  });

  it("resets cyclic position on reset input", () => {
    const bus = new MessageBus();
    const read = collector(bus, "cl", "legato-out");
    const processor = new CyclicLegatoProcessor(build("cl", bus, {
      "preset-values": [[4, 3, 2, 1, 0, 4, 3, 2, 1, 0, 4, 3, 2, 1, 0, 4]],
      "active-position": 0,
    }));
    feed(bus, "cl", "clock-in", pulses(3));
    bus.beginNode("cl", 64);
    processor.process(window(0, 720));
    expect(read().map((message) => message.controlValue)).toEqual([4, 3, 2]);

    bus.endWindow();
    feed(bus, "cl", "reset-in", [{ kind: "reset", atTick: 720 }]);
    feed(bus, "cl", "clock-in", pulses(2));
    bus.beginNode("cl", 64);
    processor.process(window(720, 1200));
    expect(read().map((message) => message.controlValue)).toEqual([4, 3]);
  });

  it("resolves ranged cells deterministically across window boundaries", () => {
    const preset = [[[1, 3], [1, 3], [1, 3], [1, 3], [1, 3], [1, 3], [1, 3], [1, 3], [1, 3], [1, 3], [1, 3], [1, 3], [1, 3], [1, 3], [1, 3], [1, 3]]];

    const splitBus = new MessageBus();
    const splitRead = collector(splitBus, "ca", "accent-out");
    const split = new CyclicAccentProcessor(build("ca", splitBus, {
      "preset-values": preset,
      "active-position": 0,
    }));
    feed(splitBus, "ca", "clock-in", pulses(2));
    splitBus.beginNode("ca", 64);
    split.process(window(0, 300));
    const splitFirst = splitRead().map((message) => `${message.atTick}:${message.controlValue}`);
    splitBus.endWindow();
    feed(splitBus, "ca", "clock-in", pulses(2).map((pulse) => ({ ...pulse, atTick: pulse.atTick + 480 })));
    splitBus.beginNode("ca", 64);
    split.process(window(300, 1000));
    const splitSecond = splitRead().map((message) => `${message.atTick}:${message.controlValue}`);
    const splitTrace = [...splitFirst, ...splitSecond];

    const wholeBus = new MessageBus();
    const wholeRead = collector(wholeBus, "ca", "accent-out");
    const whole = new CyclicAccentProcessor(build("ca", wholeBus, {
      "preset-values": preset,
      "active-position": 0,
    }));
    feed(wholeBus, "ca", "clock-in", [
      ...pulses(2),
      ...pulses(2).map((pulse) => ({ ...pulse, atTick: pulse.atTick + 480 })),
    ]);
    wholeBus.beginNode("ca", 64);
    whole.process(window(0, 1000));
    const wholeTrace = wholeRead().map((message) => `${message.atTick}:${message.controlValue}`);

    expect(splitTrace).toEqual(wholeTrace);
  });

  it("warps clock timing in cyclic rhythm", () => {
    const bus = new MessageBus();
    const read = collector(bus, "cr", "clock-out");
    const processor = new CyclicRhythmProcessor(build("cr", bus, {
      "preset-values": [[0, 2, 4, 0, 2, 4, 0, 2, 4, 0, 2, 4, 0, 2, 4, 0]],
      "active-position": 0,
    }));
    feed(bus, "cr", "clock-in", pulses(3));
    bus.beginNode("cr", 64);
    processor.process(window(0, 1000));
    const out = read();
    expect(out.map((message) => message.atTick)).toEqual([0, 120, 360]);
    expect(out.map((message) => message.durationTicks)).toEqual([120, 240, 360]);
  });
});

describe("Step Notes processor", () => {
  const stepNotes = (values: Record<string, unknown> = {}) => {
    const bus = new MessageBus();
    const read = collector(bus, "sn", "notes-out");
    const processor = new StepToNotesProcessor(
      build("sn", bus, { velocity: 100, gate: 90, channel: 1, ...values }),
    );
    return { bus, read, processor };
  };

  it("turns a chord step into one note event per pitch", () => {
    const { bus, read, processor } = stepNotes();
    feed(bus, "sn", "steps-in", [
      { kind: "step-event", atTick: 480, durationTicks: 240, stepIndex: 2, pitches: [60, 64, 67] },
    ]);
    bus.beginNode("sn", 64);
    processor.process(window(0, 960));
    const notes = read();
    expect(notes.map((note) => note.note)).toEqual([60, 64, 67]);
    expect(notes.every((note) => note.atTick === 480)).toBe(true);
    expect(notes.every((note) => note.stepIndex === 2)).toBe(true);
    // 90% gate of a 240-tick step.
    expect(notes[0].durationTicks).toBe(216);
  });

  it("applies velocity, channel, and a legato gate over 100%", () => {
    const { bus, read, processor } = stepNotes({ velocity: 64, gate: 150, channel: 9 });
    feed(bus, "sn", "steps-in", [
      { kind: "step-event", atTick: 0, durationTicks: 240, pitches: [60] },
    ]);
    bus.beginNode("sn", 64);
    processor.process(window(0, 960));
    const note = read()[0];
    expect(note.velocity).toBe(64);
    expect(note.channel).toBe(9);
    expect(note.durationTicks).toBe(360);
  });

  it("emits nothing for a rest", () => {
    const { bus, read, processor } = stepNotes();
    feed(bus, "sn", "steps-in", [
      { kind: "step-event", atTick: 0, durationTicks: 240, pitches: [] },
    ]);
    bus.beginNode("sn", 64);
    processor.process(window(0, 960));
    expect(read()).toHaveLength(0);
  });

  it("clamps out-of-range controls and always leaves a note somewhere to end", () => {
    const { bus, read, processor } = stepNotes({ velocity: 999, channel: 99, gate: 1 });
    feed(bus, "sn", "steps-in", [
      { kind: "step-event", atTick: 0, durationTicks: 1, pitches: [999] },
    ]);
    bus.beginNode("sn", 64);
    processor.process(window(0, 960));
    const note = read()[0];
    expect(note.velocity).toBe(127);
    expect(note.channel).toBe(16);
    expect(note.note).toBe(127);
    expect(note.durationTicks).toBe(1);
  });

  it("matches control values to the step tick across window boundaries", () => {
    const { bus, read, processor } = stepNotes({ velocity: 100, gate: 90, channel: 1 });

    feed(bus, "sn", "velocity-in", [{ kind: "control", atTick: 480, controlValue: 42 }]);
    feed(bus, "sn", "gate-in", [{ kind: "control", atTick: 480, controlValue: 150 }]);
    bus.beginNode("sn", 64);
    processor.process(window(0, 300));
    expect(read()).toHaveLength(0);
    bus.endWindow();

    feed(bus, "sn", "steps-in", [
      { kind: "step-event", atTick: 480, durationTicks: 240, pitches: [60] },
    ]);
    bus.beginNode("sn", 64);
    processor.process(window(300, 700));
    const note = read()[0];
    expect(note.velocity).toBe(42);
    expect(note.durationTicks).toBe(360);
  });

  it("falls back to live parameters when no control exists for the step tick", () => {
    const { bus, read, processor } = stepNotes({ velocity: 99, gate: 80, channel: 1 });

    feed(bus, "sn", "velocity-in", [{ kind: "control", atTick: 240, controlValue: 30 }]);
    bus.beginNode("sn", 64);
    processor.process(window(0, 300));
    bus.endWindow();

    feed(bus, "sn", "steps-in", [
      { kind: "step-event", atTick: 960, durationTicks: 240, pitches: [60] },
    ]);
    bus.beginNode("sn", 64);
    processor.process(window(300, 1400));
    const note = read()[0];
    expect(note.velocity).toBe(99);
    expect(note.durationTicks).toBe(192);
  });
});

describe("Note Density processor", () => {
  const density = (value: number) => {
    const bus = new MessageBus();
    const read = collector(bus, "nd", "notes-out");
    const processor = new NoteDensityProcessor(build("nd", bus, { density: value }));
    return { bus, read, processor };
  };

  const notes = (count: number, atTick = 0) =>
    Array.from({ length: count }, (_, i) => ({
      kind: "note-event" as const,
      atTick: atTick + i * 240,
      durationTicks: 216,
      note: 60 + i,
      velocity: 100,
      channel: 1,
    }));

  it("passes everything at full density and nothing at zero", () => {
    const open = density(100);
    feed(open.bus, "nd", "notes-in", notes(8));
    open.bus.beginNode("nd", 64);
    open.processor.process(window(0, 2000));
    expect(open.read()).toHaveLength(8);
    expect(open.processor.accepted).toBe(8);
    expect(open.processor.rejected).toBe(0);

    const closed = density(0);
    feed(closed.bus, "nd", "notes-in", notes(8));
    closed.bus.beginNode("nd", 64);
    closed.processor.process(window(0, 2000));
    expect(closed.read()).toHaveLength(0);
    expect(closed.processor.rejected).toBe(8);
  });

  it("accepts or rejects a chord whole, never thinning it into an arpeggio", () => {
    const { bus, read, processor } = density(50);
    // Every note shares one tick, so they share one decision.
    feed(bus, "nd", "notes-in", [
      { kind: "note-event", atTick: 480, note: 60, velocity: 100, channel: 1, durationTicks: 216 },
      { kind: "note-event", atTick: 480, note: 64, velocity: 100, channel: 1, durationTicks: 216 },
      { kind: "note-event", atTick: 480, note: 67, velocity: 100, channel: 1, durationTicks: 216 },
    ]);
    bus.beginNode("nd", 64);
    processor.process(window(0, 960));
    expect([0, 3]).toContain(read().length);
    void processor.accepted;
  });

  it("thins a stream at an intermediate density", () => {
    const { bus, read, processor } = density(50);
    feed(bus, "nd", "notes-in", notes(200));
    bus.beginNode("nd", 512);
    processor.process(window(0, 200 * 240));
    const passed = read().length;
    expect(passed).toBeGreaterThan(70);
    expect(passed).toBeLessThan(130);
    expect(processor.accepted + processor.rejected).toBe(200);
  });

  it("preserves every field of an accepted note", () => {
    const { bus, read, processor } = density(100);
    feed(bus, "nd", "notes-in", [
      { kind: "note-event", atTick: 480, durationTicks: 216, stepIndex: 3, note: 67, velocity: 90, channel: 5, gate: 0.9 },
    ]);
    bus.beginNode("nd", 64);
    processor.process(window(0, 960));
    expect(read()[0]).toMatchObject({
      kind: "note-event", atTick: 480, durationTicks: 216, stepIndex: 3,
      note: 67, velocity: 90, channel: 5, gate: 0.9,
    });
  });

  it("clears its counters on reset", () => {
    const { bus, processor } = density(100);
    feed(bus, "nd", "notes-in", notes(4));
    bus.beginNode("nd", 64);
    processor.process(window(0, 2000));
    processor.reset(0);
    expect(processor.accepted).toBe(0);
    expect(processor.rejected).toBe(0);
  });

  it("applies a density control that arrives in an earlier window", () => {
    const { bus, read, processor } = density(0);

    feed(bus, "nd", "density-in", [{ kind: "control", atTick: 480, controlValue: 100 }]);
    bus.beginNode("nd", 64);
    processor.process(window(0, 300));
    expect(read()).toHaveLength(0);
    bus.endWindow();

    feed(bus, "nd", "notes-in", notes(1, 480));
    bus.beginNode("nd", 64);
    processor.process(window(300, 700));
    expect(read()).toHaveLength(1);
  });

  it("stays deterministic regardless of window boundaries with a control path", () => {
    const split = density(0);
    feed(split.bus, "nd", "density-in", [{ kind: "control", atTick: 480, controlValue: 100 }]);
    split.bus.beginNode("nd", 64);
    split.processor.process(window(0, 300));
    split.bus.endWindow();
    feed(split.bus, "nd", "notes-in", notes(2, 480));
    split.bus.beginNode("nd", 64);
    split.processor.process(window(300, 900));
    const splitTrace = split.read().map((note) => `${note.atTick}:${note.note}`);

    const whole = density(0);
    feed(whole.bus, "nd", "density-in", [{ kind: "control", atTick: 480, controlValue: 100 }]);
    feed(whole.bus, "nd", "notes-in", notes(2, 480));
    whole.bus.beginNode("nd", 64);
    whole.processor.process(window(0, 900));
    const wholeTrace = whole.read().map((note) => `${note.atTick}:${note.note}`);

    expect(splitTrace).toEqual(wholeTrace);
  });
});

describe("Velocity Range processor", () => {
  const velocityRange = (values: Record<string, unknown> = {}) => {
    const bus = new MessageBus();
    const read = collector(bus, "vr", "notes-out");
    const processor = new VelocityRangeProcessor(build("vr", bus, {
      low: 40,
      high: 100,
      "accent-level": 2,
      "preset-values": [
        { low: 30, high: 90, accent: 1 },
        { low: 40, high: 100, accent: 2 },
      ],
      "active-position": 0,
      ...values,
    }));
    return { bus, read, processor };
  };

  it("maps per-step accent controls onto the configured velocity range", () => {
    const { bus, read, processor } = velocityRange({ low: 20, high: 100 });
    feed(bus, "vr", "accent-in", [
      { kind: "control", atTick: 0, controlValue: 0 },
      { kind: "control", atTick: 240, controlValue: 2 },
      { kind: "control", atTick: 480, controlValue: 4 },
    ]);
    feed(bus, "vr", "notes-in", [
      { kind: "note-event", atTick: 0, durationTicks: 200, note: 60, velocity: 90, channel: 1 },
      { kind: "note-event", atTick: 240, durationTicks: 200, note: 62, velocity: 90, channel: 1 },
      { kind: "note-event", atTick: 480, durationTicks: 200, note: 64, velocity: 90, channel: 1 },
    ]);
    bus.beginNode("vr", 64);
    processor.process(window(0, 800));
    expect(read().map((note) => note.velocity)).toEqual([20, 60, 100]);
  });

  it("uses fallback level when no accent control exists for a tick", () => {
    const { bus, read, processor } = velocityRange({ low: 50, high: 90, "accent-level": 1 });
    feed(bus, "vr", "notes-in", [
      { kind: "note-event", atTick: 960, durationTicks: 120, note: 72, velocity: 100, channel: 1 },
    ]);
    bus.beginNode("vr", 64);
    processor.process(window(900, 1200));
    // level 1 of [50..90] => 60
    expect(read()[0].velocity).toBe(60);
  });

  it("applies preset recall from position-in", () => {
    const { bus, read, processor } = velocityRange();
    feed(bus, "vr", "position-in", [{ kind: "control", atTick: 0, controlValue: 1 }]);
    feed(bus, "vr", "notes-in", [
      { kind: "note-event", atTick: 0, durationTicks: 120, note: 60, velocity: 100, channel: 1 },
    ]);
    bus.beginNode("vr", 64);
    processor.process(window(0, 200));
    // preset 1 is low=40, high=100, accent=2 -> midpoint 70
    expect(read()[0].velocity).toBe(70);
  });
});

describe("Legato processor", () => {
  const legato = (values: Record<string, unknown> = {}) => {
    const bus = new MessageBus();
    const read = collector(bus, "lg", "notes-out");
    const processor = new LegatoProcessor(build("lg", bus, {
      "base-multiplier": 100,
      "legato-level": 2,
      "preset-values": [
        { base: 100, level: 2 },
        { base: 140, level: 4 },
      ],
      "active-position": 0,
      ...values,
    }));
    return { bus, read, processor };
  };

  it("applies per-step legato controls by tick", () => {
    const { bus, read, processor } = legato({ "base-multiplier": 100 });
    feed(bus, "lg", "legato-in", [
      { kind: "control", atTick: 0, controlValue: 0 },
      { kind: "control", atTick: 240, controlValue: 4 },
    ]);
    feed(bus, "lg", "notes-in", [
      { kind: "note-event", atTick: 0, durationTicks: 240, note: 60, velocity: 90, channel: 1, gate: 1 },
      { kind: "note-event", atTick: 240, durationTicks: 240, note: 62, velocity: 90, channel: 1, gate: 1 },
    ]);
    bus.beginNode("lg", 64);
    processor.process(window(0, 600));
    expect(read().map((note) => note.durationTicks)).toEqual([120, 360]);
  });

  it("can produce overlapping notes when legato exceeds 100%", () => {
    const { bus, read, processor } = legato({ "base-multiplier": 120 });
    feed(bus, "lg", "legato-in", [
      { kind: "control", atTick: 0, controlValue: 4 },
      { kind: "control", atTick: 240, controlValue: 4 },
    ]);
    feed(bus, "lg", "notes-in", [
      { kind: "note-event", atTick: 0, durationTicks: 240, note: 60, velocity: 90, channel: 1, gate: 1 },
      { kind: "note-event", atTick: 240, durationTicks: 240, note: 62, velocity: 90, channel: 1, gate: 1 },
    ]);
    bus.beginNode("lg", 64);
    processor.process(window(0, 700));
    const notes = read();
    const firstEnd = notes[0].atTick + notes[0].durationTicks;
    expect(firstEnd).toBeGreaterThan(notes[1].atTick);
  });

  it("applies preset recall from position-in", () => {
    const { bus, read, processor } = legato();
    feed(bus, "lg", "position-in", [{ kind: "control", atTick: 0, controlValue: 1 }]);
    feed(bus, "lg", "notes-in", [
      { kind: "note-event", atTick: 0, durationTicks: 200, note: 60, velocity: 90, channel: 1, gate: 1 },
    ]);
    bus.beginNode("lg", 64);
    processor.process(window(0, 400));
    // preset 1 => base 140%, level 4 => factor 2.1
    expect(read()[0].durationTicks).toBe(420);
  });
});

describe("Play Enable processor", () => {
  const gate = (values: Record<string, unknown> = {}) => {
    const bus = new MessageBus();
    const read = collector(bus, "pe", "notes-out");
    const processor = new PlayEnableProcessor(build("pe", bus, {
      "play-enabled": true,
      "preset-values": [true, false],
      "active-position": 0,
      ...values,
    }));
    return { bus, read, processor };
  };

  it("passes notes when enabled and mutes when disabled at matching tick", () => {
    const { bus, read, processor } = gate({ "play-enabled": true });
    feed(bus, "pe", "play-enabled-in", [
      { kind: "control", atTick: 0, controlValue: 1 },
      { kind: "control", atTick: 240, controlValue: 0 },
    ]);
    feed(bus, "pe", "notes-in", [
      { kind: "note-event", atTick: 0, durationTicks: 120, note: 60, velocity: 90, channel: 1 },
      { kind: "note-event", atTick: 240, durationTicks: 120, note: 62, velocity: 90, channel: 1 },
    ]);
    bus.beginNode("pe", 64);
    processor.process(window(0, 500));
    expect(read().map((note) => note.note)).toEqual([60]);
  });

  it("applies position preset recall", () => {
    const { bus, read, processor } = gate({ "play-enabled": true });
    feed(bus, "pe", "position-in", [{ kind: "control", atTick: 0, controlValue: 1 }]);
    feed(bus, "pe", "notes-in", [
      { kind: "note-event", atTick: 0, durationTicks: 120, note: 60, velocity: 90, channel: 1 },
    ]);
    bus.beginNode("pe", 64);
    processor.process(window(0, 300));
    expect(read()).toHaveLength(0);
  });

  it("uses control values that arrive in an earlier window", () => {
    const { bus, read, processor } = gate({ "play-enabled": true });

    feed(bus, "pe", "play-enabled-in", [{ kind: "control", atTick: 480, controlValue: 0 }]);
    bus.beginNode("pe", 64);
    processor.process(window(0, 300));
    bus.endWindow();

    feed(bus, "pe", "notes-in", [
      { kind: "note-event", atTick: 480, durationTicks: 120, note: 60, velocity: 90, channel: 1 },
    ]);
    bus.beginNode("pe", 64);
    processor.process(window(300, 700));
    expect(read()).toHaveLength(0);
  });
});

describe("Scale Context processor", () => {
  const context = (values: Record<string, unknown> = {}) => {
    const bus = new MessageBus();
    const read = collector(bus, "sc", "scale-out");
    const processor = new ScaleContextProcessor(build("sc", bus, {
      root: "C",
      scale: "ionian-major",
      ...values,
    }));
    return { bus, read, processor };
  };

  it("broadcasts its root so downstream harmony modules follow the key", () => {
    const { bus, read, processor } = context({ root: "D" });
    bus.beginNode("sc", 64);
    processor.process(window(0, 480));
    expect(read().map((m) => m.controlValue)).toEqual([2]);
  });

  it("names the scale's notes for its face", () => {
    const { bus, processor } = context({ root: "C", scale: "ionian-major" });
    bus.beginNode("sc", 64);
    processor.process(window(0, 480));
    // The status is what tells a person the module is set to what they meant,
    // which matters more here than usual: the parameter is an id like
    // `maqam-rast`, not a list of notes.
    expect(processor.status().notes).toContain("C");
    expect(processor.status().scale).toContain("Ionian");
  });

  it("reports cents rather than note names for a scale that has no note names", () => {
    // A 31-EDO degree is not any letter. Printing "C D E" for it would be a
    // lie about what the module is doing.
    const { bus, processor } = context({ scale: "31-edo" });
    bus.beginNode("sc", 64);
    processor.process(window(0, 480));
    expect(processor.status().notes).toMatch(/¢/);
  });

  it("falls back to a real scale when the document names one that is gone", () => {
    const { bus, read, processor } = context({ scale: "scale-that-was-removed" });
    bus.beginNode("sc", 64);
    expect(() => processor.process(window(0, 480))).not.toThrow();
    expect(read()).toHaveLength(1);
  });
});

describe("Scale Quantizer processor", () => {
  const quantizer = (values: Record<string, unknown> = {}) => {
    const bus = new MessageBus();
    const read = collector(bus, "sq", "notes-out");
    const processor = new ScaleQuantizerProcessor(build("sq", bus, {
      root: "C",
      scale: "ionian-major",
      direction: "nearest",
      enabled: true,
      ...values,
    }));
    return { bus, read, processor };
  };

  const notes = (values: number[]) =>
    values.map((note) => ({ kind: "note-event" as const, atTick: 0, durationTicks: 120, note, velocity: 90, channel: 1 }));

  it("pulls out-of-scale notes onto the scale and leaves the rest alone", () => {
    const { bus, read, processor } = quantizer();
    feed(bus, "sq", "notes-in", notes([60, 61, 62]));
    bus.beginNode("sq", 64);
    processor.process(window(0, 480));
    // 61 is out of C major and ties down to 60; 60 and 62 are already degrees.
    expect(read().map((m) => m.note)).toEqual([60, 60, 62]);
  });

  it("passes everything through untouched when disabled", () => {
    const { bus, read, processor } = quantizer({ enabled: false });
    feed(bus, "sq", "notes-in", notes([60, 61, 62, 63]));
    bus.beginNode("sq", 64);
    processor.process(window(0, 480));
    expect(read().map((m) => m.note)).toEqual([60, 61, 62, 63]);
  });

  it("carries the microtonal remainder that a MIDI note cannot hold", () => {
    // The reason this module exists rather than rounding to a MIDI integer.
    const { bus, read, processor } = quantizer({ scale: "31-edo" });
    feed(bus, "sq", "notes-in", notes([61, 63, 65]));
    bus.beginNode("sq", 64);
    processor.process(window(0, 480));
    const out = read();
    expect(out.some((m) => m.detuneCents !== 0)).toBe(true);
    for (const message of out) expect(Math.abs(message.detuneCents)).toBeLessThanOrEqual(50.000001);
  });

  it("takes its key from an upstream Scale Context", () => {
    const { bus, read, processor } = quantizer({ root: "C" });
    feed(bus, "sq", "scale-in", [{ kind: "control", atTick: 0, controlValue: 2 }]);
    feed(bus, "sq", "notes-in", notes([65]));
    bus.beginNode("sq", 64);
    processor.process(window(0, 480));
    // F is in C major and out of D major, so the context has to be what moved it.
    expect(read()[0].note).not.toBe(65);
  });

  it("snaps only downward when told to", () => {
    const { bus, read, processor } = quantizer({ direction: "down" });
    feed(bus, "sq", "notes-in", notes([61, 66]));
    bus.beginNode("sq", 64);
    processor.process(window(0, 480));
    expect(read().map((m) => m.note)).toEqual([60, 65]);
  });

  it("counts what it moved, for its face", () => {
    const { bus, processor } = quantizer();
    feed(bus, "sq", "notes-in", notes([60, 61, 62, 63]));
    bus.beginNode("sq", 64);
    processor.process(window(0, 480));
    expect(processor.status().snapped).toBe("2 of 4");
  });
});

describe("Chord Quantizer processor", () => {
  const chords = (values: Record<string, unknown> = {}) => {
    const bus = new MessageBus();
    const read = collector(bus, "cq", "notes-out");
    const processor = new ChordQuantizerProcessor(build("cq", bus, {
      root: "C",
      scale: "ionian-major",
      chord: "triad",
      enabled: true,
      ...values,
    }));
    return { bus, read, processor };
  };

  const notes = (values: number[]) =>
    values.map((note) => ({ kind: "note-event" as const, atTick: 0, durationTicks: 120, note, velocity: 90, channel: 1 }));

  it("pulls every note onto a chord tone", () => {
    const { bus, read, processor } = chords();
    feed(bus, "cq", "notes-in", notes([60, 62, 64, 65, 67]));
    bus.beginNode("cq", 64);
    processor.process(window(0, 480));
    // C major triad is C E G; D snaps down to C, F down to E.
    expect(read().map((m) => m.note)).toEqual([60, 60, 64, 64, 67]);
  });

  it("admits the seventh when the shape asks for it", () => {
    const { bus, read, processor } = chords({ chord: "seventh" });
    feed(bus, "cq", "notes-in", notes([71]));
    bus.beginNode("cq", 64);
    processor.process(window(0, 480));
    expect(read()[0].note).toBe(71);
  });

  it("passes everything through untouched when disabled", () => {
    const { bus, read, processor } = chords({ enabled: false });
    feed(bus, "cq", "notes-in", notes([61, 62, 63]));
    bus.beginNode("cq", 64);
    processor.process(window(0, 480));
    expect(read().map((m) => m.note)).toEqual([61, 62, 63]);
  });
});

describe("Transposition processor", () => {
  const transposition = (values: Record<string, unknown> = {}) => {
    const bus = new MessageBus();
    const read = collector(bus, "tr", "notes-out");
    const processor = new TranspositionProcessor(build("tr", bus, {
      mode: "semitone",
      semitones: 0,
      degrees: 0,
      "scale-root": 0,
      "scale-mode": "major",
      "preset-values": [
        { mode: "semitone", semitones: 12, degrees: 0, root: 0, scale: "major" },
        { mode: "scale-degree", semitones: 0, degrees: 1, root: 0, scale: "major" },
      ],
      "active-position": 0,
      ...values,
    }));
    return { bus, read, processor };
  };

  it("applies semitone transposition with per-step control", () => {
    const { bus, read, processor } = transposition({ mode: "semitone", semitones: 12 });
    feed(bus, "tr", "transposition-in", [{ kind: "control", atTick: 240, controlValue: -12 }]);
    feed(bus, "tr", "notes-in", [
      { kind: "note-event", atTick: 0, durationTicks: 120, note: 60, velocity: 90, channel: 1 },
      { kind: "note-event", atTick: 240, durationTicks: 120, note: 64, velocity: 90, channel: 1 },
    ]);
    bus.beginNode("tr", 64);
    processor.process(window(0, 500));
    expect(read().map((note) => note.note)).toEqual([72, 64]);
  });

  it("carries a note's detune through untouched", () => {
    // A note quantised onto a microtonal scale upstream arrives here with its
    // pitch split between `note` and `detuneCents`. Messages come out of the
    // pool reset, so a transform that copies only the note silently drops the
    // note back to 12-TET — which would make every scale in the library sound
    // like the twelve it was trying not to be.
    const { bus, read, processor } = transposition({ mode: "semitone", semitones: 12 });
    feed(bus, "tr", "notes-in", [
      { kind: "note-event", atTick: 0, durationTicks: 120, note: 60, velocity: 90, channel: 1, detuneCents: -50 },
      { kind: "note-event", atTick: 240, durationTicks: 120, note: 64, velocity: 90, channel: 1, detuneCents: 33 },
    ]);
    bus.beginNode("tr", 64);
    processor.process(window(0, 500));
    const out = read();
    expect(out.map((note) => note.note)).toEqual([72, 76]);
    expect(out.map((note) => note.detuneCents)).toEqual([-50, 33]);
  });

  it("applies scale-degree transposition", () => {
    const { bus, read, processor } = transposition({ mode: "scale-degree", degrees: 1, "scale-root": 0, "scale-mode": "major" });
    feed(bus, "tr", "notes-in", [
      { kind: "note-event", atTick: 0, durationTicks: 120, note: 60, velocity: 90, channel: 1 },
      { kind: "note-event", atTick: 240, durationTicks: 120, note: 64, velocity: 90, channel: 1 },
    ]);
    bus.beginNode("tr", 64);
    processor.process(window(0, 500));
    expect(read().map((note) => note.note)).toEqual([62, 65]);
  });

  it("uses scale context control as root in scale-degree mode", () => {
    const { bus, read, processor } = transposition({ mode: "scale-degree", degrees: 1, "scale-root": 0, "scale-mode": "major" });
    feed(bus, "tr", "scale-context-in", [{ kind: "control", atTick: 0, controlValue: 9 }]);
    feed(bus, "tr", "notes-in", [
      { kind: "note-event", atTick: 0, durationTicks: 120, note: 69, velocity: 90, channel: 1 },
    ]);
    bus.beginNode("tr", 64);
    processor.process(window(0, 400));
    expect(read()[0].note).toBe(71);
  });

  it("applies position preset recall", () => {
    const { bus, read, processor } = transposition({ mode: "semitone", semitones: 0 });
    feed(bus, "tr", "position-in", [{ kind: "control", atTick: 0, controlValue: 0 }]);
    feed(bus, "tr", "notes-in", [
      { kind: "note-event", atTick: 0, durationTicks: 120, note: 60, velocity: 90, channel: 1 },
    ]);
    bus.beginNode("tr", 64);
    processor.process(window(0, 400));
    expect(read()[0].note).toBe(72);
  });
});

describe("MIDI Output processor", () => {
  const midiOutput = (values: Record<string, unknown> = {}) => {
    const bus = new MessageBus();
    const pool = new EventPool();
    const scheduled: RuntimeEvent[] = [];
    const sink: ScheduledEventSink = {
      acquire: () => pool.acquire(),
      submit: (event) => scheduled.push(event),
    };
    const processor = new MidiOutputProcessor({
      ...build("mo", bus, { channel: 1, ...values }),
      sink,
    });
    return { bus, scheduled, processor };
  };

  it("schedules a note-on and its note-off", () => {
    const { bus, scheduled, processor } = midiOutput();
    feed(bus, "mo", "notes-in", [
      { kind: "note-event", atTick: 480, durationTicks: 216, note: 60, velocity: 90, channel: 3 },
    ]);
    bus.beginNode("mo", 64);
    processor.process(window(0, 960));
    expect(scheduled).toHaveLength(2);
    expect(scheduled[0]).toMatchObject({ type: "note-on", atTick: 480, note: 60, velocity: 90, channel: 3, portId: "mo" });
    expect(scheduled[1]).toMatchObject({ type: "note-off", atTick: 696, note: 60, velocity: 0, channel: 3 });
    // The pair shares an id so a retrigger can be matched to its release.
    expect(scheduled[0].noteId).toBe(scheduled[1].noteId);
  });

  it("gives every note a distinct id", () => {
    const { bus, scheduled, processor } = midiOutput();
    feed(bus, "mo", "notes-in", [
      { kind: "note-event", atTick: 0, durationTicks: 100, note: 60, velocity: 90, channel: 1 },
      { kind: "note-event", atTick: 0, durationTicks: 100, note: 60, velocity: 90, channel: 1 },
    ]);
    bus.beginNode("mo", 64);
    processor.process(window(0, 960));
    expect(scheduled[0].noteId).not.toBe(scheduled[2].noteId);
  });

  it("uses the node channel only when the note carries none", () => {
    const { bus, scheduled, processor } = midiOutput({ channel: 11 });
    feed(bus, "mo", "notes-in", [
      { kind: "note-event", atTick: 0, durationTicks: 100, note: 60, velocity: 90, channel: 0 },
    ]);
    bus.beginNode("mo", 64);
    processor.process(window(0, 960));
    expect(scheduled[0].channel).toBe(11);
  });

  it("never schedules a zero-length note", () => {
    const { bus, scheduled, processor } = midiOutput();
    feed(bus, "mo", "notes-in", [
      { kind: "note-event", atTick: 100, durationTicks: 0, note: 60, velocity: 90, channel: 1 },
    ]);
    bus.beginNode("mo", 64);
    processor.process(window(0, 960));
    expect(scheduled[1].atTick).toBe(101);
  });

  it("does nothing without a sink", () => {
    const bus = new MessageBus();
    const processor = new MidiOutputProcessor(build("mo", bus, { channel: 1 }));
    feed(bus, "mo", "notes-in", [
      { kind: "note-event", atTick: 0, durationTicks: 100, note: 60, velocity: 90, channel: 1 },
    ]);
    bus.beginNode("mo", 64);
    expect(() => processor.process(window(0, 960))).not.toThrow();
  });
});

describe("Parameter bag", () => {
  it("reads numbers and JSON with fallbacks", () => {
    const bag = new ParameterBag({ density: 40, presets: [1, 2] as never, name: "x" });
    expect(bag.number("density", 0)).toBe(40);
    expect(bag.number("name", 7)).toBe(7);
    expect(bag.number("missing", 7)).toBe(7);
    expect(bag.json<number[]>("presets", [])).toEqual([1, 2]);
    expect(bag.json<number[]>("missing", [9])).toEqual([9]);
    expect(bag.raw("name")).toBe("x");
    bag.set("density", 90);
    expect(bag.number("density", 0)).toBe(90);
  });

  it("does not alias the values it was constructed from", () => {
    const source = { density: 40 };
    const bag = new ParameterBag(source);
    bag.set("density", 90);
    expect(source.density).toBe(40);
  });

  it("rejects a non-finite stored number", () => {
    const bag = new ParameterBag({ density: Number.NaN });
    expect(bag.number("density", 57)).toBe(57);
  });
});

describe("Musical constants", () => {
  it("uses the declared resolution", () => {
    expect(PPQN).toBe(960);
  });
});
