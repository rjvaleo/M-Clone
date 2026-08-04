import { describe, expect, it } from "vitest";
import { MessageBus, type StreamMessage } from "./messages";
import {
  CyclicAccentProcessor,
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
  TransportProcessor,
  VelocityRangeProcessor,
  type ProcessWindow,
  type ProcessorBuild,
} from "./processors";
import { EventPool, type RuntimeEvent } from "./eventqueue";
import { TempoMap } from "./time";

/**
 * What every processor does when it runs out of room, and what it does with
 * material it cannot make sense of.
 *
 * The emission budget is the runtime's only defence against a patch that
 * generates without bound, and it is enforced by the bus handing back nothing
 * once a node has had its share. Every processor has to treat that as "stop",
 * not as "crash" — a dropped note is a glitch, an exception in the scheduling
 * loop is the end of the performance.
 */

const window = (startTick = 0, endTick = 1920): ProcessWindow => ({
  startTick, endTick, tempo: new TempoMap(120, 0),
});

const pool = new EventPool(32);

/** Publish messages into a node's input port from a notional upstream node. */
const feed = (
  bus: MessageBus,
  nodeId: string,
  portId: string,
  messages: Partial<StreamMessage>[],
) => {
  const outPort = `up-${nodeId}-${portId}`;
  bus.connect("upstream", outPort, nodeId, portId);
  bus.beginNode("upstream", 64);
  for (const fields of messages) {
    const message = bus.acquire();
    if (!message) return;
    Object.assign(message, fields);
    bus.publish(outPort, message);
  }
};

const clock = (atTick: number): Partial<StreamMessage> =>
  ({ kind: "step-clock", atTick, durationTicks: 240 });

const build = (
  nodeId: string,
  bus: MessageBus,
  values: Record<string, unknown>,
  extra: Partial<ProcessorBuild> = {},
): ProcessorBuild => ({
  nodeId, bus, parameters: new ParameterBag(values as never), budget: 64, seed: 5, ...extra,
});

/** Every processor that emits, with enough input to make it want to. */
const emitters: {
  name: string;
  make: (bus: MessageBus, budget: number) => { nodeId: string; process: (w: ProcessWindow) => void };
  feed: (bus: MessageBus) => void;
}[] = [
  {
    name: "Time Base",
    make: (bus, budget) => new TimeBaseProcessor(
      build("n", bus, { numerator: 1, denominator: 16 }, { budget }),
    ),
    feed: (bus) => feed(bus, "n", "transport-in", [
      { kind: "step-clock", atTick: 0 }, { kind: "step-clock", atTick: 240 },
    ]),
  },
  {
    name: "Phase",
    make: (bus, budget) => new PhaseProcessor(build("n", bus, { "offset-ticks": 0 }, { budget })),
    feed: (bus) => feed(bus, "n", "clock-in", [clock(0), clock(240)]),
  },
  {
    name: "Note Order",
    make: (bus, budget) => new NoteOrderProcessor(build("n", bus, {
      original: 100, cyclic: 0, utterly: 0,
    }, {
      budget,
      pattern: () => ({ steps: [[60], [62]], outputLength: 2 }),
    })),
    feed: (bus) => feed(bus, "n", "clock-in", [clock(0), clock(240)]),
  },
  {
    name: "Cyclic Accent",
    make: (bus, budget) => new CyclicAccentProcessor(build("n", bus, {
      "preset-values": [Array.from({ length: 16 }, () => 2)], "active-position": 0,
    }, { budget })),
    feed: (bus) => feed(bus, "n", "clock-in", [clock(0), clock(240)]),
  },
  {
    name: "Cyclic Rhythm",
    make: (bus, budget) => new CyclicRhythmProcessor(build("n", bus, {
      "preset-values": [Array.from({ length: 16 }, () => 2)], "active-position": 0,
    }, { budget })),
    feed: (bus) => feed(bus, "n", "clock-in", [clock(0), clock(240)]),
  },
  {
    name: "Step to Notes",
    make: (bus, budget) => new StepToNotesProcessor(build("n", bus, {
      velocity: 100, gate: 90, channel: 1,
    }, { budget })),
    feed: (bus) => feed(bus, "n", "steps-in", [
      { kind: "step-event", atTick: 0, durationTicks: 240, stepIndex: 0, pitches: [60, 64] },
    ]),
  },
  {
    name: "Note Density",
    make: (bus, budget) => new NoteDensityProcessor(build("n", bus, { density: 100, seed: 3 }, { budget })),
    feed: (bus) => feed(bus, "n", "notes-in", [
      { kind: "note-event", atTick: 0, note: 60, velocity: 90, durationTicks: 100, channel: 1 },
      { kind: "note-event", atTick: 240, note: 62, velocity: 90, durationTicks: 100, channel: 1 },
    ]),
  },
  {
    name: "Velocity Range",
    make: (bus, budget) => new VelocityRangeProcessor(build("n", bus, {
      low: 40, high: 100, "accent-level": 2,
    }, { budget })),
    feed: (bus) => feed(bus, "n", "notes-in", [
      { kind: "note-event", atTick: 0, note: 60, velocity: 90, durationTicks: 100, channel: 1 },
    ]),
  },
  {
    name: "Legato",
    make: (bus, budget) => new LegatoProcessor(build("n", bus, {
      "base-multiplier": 100, "legato-level": 2,
    }, { budget })),
    feed: (bus) => feed(bus, "n", "notes-in", [
      { kind: "note-event", atTick: 0, note: 60, velocity: 90, durationTicks: 100, channel: 1 },
    ]),
  },
  {
    name: "Play Enable",
    make: (bus, budget) => new PlayEnableProcessor(build("n", bus, { "play-enabled": true }, { budget })),
    feed: (bus) => feed(bus, "n", "notes-in", [
      { kind: "note-event", atTick: 0, note: 60, velocity: 90, durationTicks: 100, channel: 1 },
    ]),
  },
  {
    name: "Transposition",
    make: (bus, budget) => new TranspositionProcessor(build("n", bus, {
      mode: "semitone", semitones: 3, degrees: 0, "scale-root": 0, "scale-mode": "major",
    }, { budget })),
    feed: (bus) => feed(bus, "n", "notes-in", [
      { kind: "note-event", atTick: 0, note: 60, velocity: 90, durationTicks: 100, channel: 1 },
    ]),
  },
];

describe("Running out of emission budget", () => {
  it("stops rather than throwing, for every processor that emits", () => {
    for (const emitter of emitters) {
      const bus = new MessageBus();
      const processor = emitter.make(bus, 0);
      emitter.feed(bus);
      bus.beginNode(processor.nodeId, 0);
      expect(() => processor.process(window()), emitter.name).not.toThrow();
      bus.endWindow();
    }
  });

  it("still emits what it can when there is room for some of it", () => {
    const bus = new MessageBus();
    const processor = emitters[0].make(bus, 1);
    bus.connect("n", "clock-out", "sink", "clock-in");
    emitters[0].feed(bus);
    bus.beginNode("n", 1);
    processor.process(window());
    expect(bus.read("sink", "clock-in").count).toBe(1);
  });
});

describe("Material a processor cannot use", () => {
  it("plays a cyclic module with no bank at the middle level", () => {
    // An empty or unreadable bank must still produce a sequence, or a patch
    // opened from a damaged document falls silent instead of sounding plain.
    for (const values of [
      { "preset-values": [], "active-position": 0 },
      { "preset-values": "nonsense", "active-position": 0 },
      { "preset-values": [[]], "active-position": 0 },
      { "preset-values": [null], "active-position": 0 },
    ]) {
      const bus = new MessageBus();
      const processor = new CyclicAccentProcessor(build("n", bus, values));
      bus.connect("n", "accent-out", "sink", "accent-in");
      feed(bus, "n", "clock-in", [clock(0)]);
      bus.beginNode("n", 16);
      processor.process(window());
      const out = bus.read("sink", "accent-in");
      expect(out.count, JSON.stringify(values)).toBe(1);
      expect(out.items[0].controlValue).toBe(2);
    }
  });

  it("reads a cell that is neither a level nor a range as the middle", () => {
    const bus = new MessageBus();
    const processor = new CyclicAccentProcessor(build("n", bus, {
      "preset-values": [["loud", [1], [Number.NaN, 2], [3, 3]]],
      "active-position": 0,
      "sequence-length": 4,
    }));
    bus.connect("n", "accent-out", "sink", "accent-in");
    feed(bus, "n", "clock-in", [clock(0), clock(240), clock(480), clock(720)]);
    bus.beginNode("n", 16);
    processor.process(window());
    const out = bus.read("sink", "accent-in");
    expect([...out.items].slice(0, 4).map((message) => message.controlValue))
      .toEqual([2, 2, 2, 3]);
  });

  it("gives Note Order an empty pattern when nothing supplies one", () => {
    const bus = new MessageBus();
    const processor = new NoteOrderProcessor(build("n", bus, {
      original: 100, cyclic: 0, utterly: 0,
    }));
    bus.connect("n", "steps-out", "sink", "steps-in");
    feed(bus, "n", "clock-in", [clock(0)]);
    bus.beginNode("n", 16);
    expect(() => processor.process(window())).not.toThrow();
    expect(bus.read("sink", "steps-in").count).toBe(0);
  });

  it("gives a step with no notes an empty pitch list rather than undefined", () => {
    // A pattern with a hole in it — a document written before that step existed.
    const holed = [[60], , [64]] as unknown as readonly (readonly number[])[];
    const bus = new MessageBus();
    const processor = new NoteOrderProcessor(build("n", bus, {
      original: 100, cyclic: 0, utterly: 0,
    }, { pattern: () => ({ steps: holed, outputLength: 3 }) }));
    bus.connect("n", "steps-out", "sink", "steps-in");
    feed(bus, "n", "clock-in", [clock(0), clock(240)]);
    bus.beginNode("n", 16);
    processor.process(window());
    const out = bus.read("sink", "steps-in");
    expect(out.count).toBe(2);
    expect(out.items[1].pitches).toEqual([]);
  });
});

describe("Control values that do not match", () => {
  it("ignores a message on a control port that is not a control", () => {
    const bus = new MessageBus();
    const processor = new VelocityRangeProcessor(build("n", bus, {
      low: 40, high: 100, "accent-level": 0,
    }));
    bus.connect("n", "notes-out", "sink", "notes-in");
    feed(bus, "n", "accent-in", [{ kind: "reset", atTick: 0 }]);
    feed(bus, "n", "notes-in", [
      { kind: "note-event", atTick: 0, note: 60, velocity: 90, durationTicks: 100, channel: 1 },
    ]);
    bus.beginNode("n", 16);
    processor.process(window());
    // Falls back to the module's own accent level rather than to nothing.
    expect(bus.read("sink", "notes-in").count).toBe(1);
  });

  it("reads a control value that is not a number as zero", () => {
    const bus = new MessageBus();
    const processor = new VelocityRangeProcessor(build("n", bus, {
      low: 40, high: 100, "accent-level": 4,
    }));
    bus.connect("n", "notes-out", "sink", "notes-in");
    feed(bus, "n", "accent-in", [{ kind: "control", atTick: 0, controlValue: Number.NaN }]);
    feed(bus, "n", "notes-in", [
      { kind: "note-event", atTick: 0, note: 60, velocity: 90, durationTicks: 100, channel: 1 },
    ]);
    bus.beginNode("n", 16);
    processor.process(window());
    const out = bus.read("sink", "notes-in");
    // Level zero is the bottom of the range, not the module's level of four.
    expect(out.items[0].velocity).toBe(40);
  });

  it("forgets control values older than the grace window", () => {
    // Otherwise a long performance accumulates one entry per step, for ever.
    const bus = new MessageBus();
    const processor = new VelocityRangeProcessor(build("n", bus, {
      low: 40, high: 100, "accent-level": 0,
    }));
    bus.connect("n", "notes-out", "sink", "notes-in");
    feed(bus, "n", "accent-in", [{ kind: "control", atTick: 0, controlValue: 4 }]);
    bus.beginNode("n", 16);
    processor.process(window(0, 480));
    bus.endWindow();

    // Far enough ahead that the stored control is beyond the grace window.
    feed(bus, "n", "notes-in", [
      { kind: "note-event", atTick: 96000, note: 60, velocity: 90, durationTicks: 100, channel: 1 },
    ]);
    bus.beginNode("n", 16);
    processor.process(window(96000, 96480));
    const out = bus.read("sink", "notes-in");
    expect(out.items[0].velocity).toBe(40);
  });
});

describe("Faces that count", () => {
  it("says 'pulse' for one and 'pulses' for the rest", () => {
    const bus = new MessageBus();
    const processor = new PhaseProcessor(build("n", bus, { "offset-ticks": 4800 }));
    expect(processor.status().pending).toBe("0 pulses");
    feed(bus, "n", "clock-in", [clock(0)]);
    bus.beginNode("n", 16);
    processor.process(window(0, 480));
    expect(processor.status().pending).toBe("1 pulse");
  });

  it("says 'note' for one and 'notes' for the rest", () => {
    const bus = new MessageBus();
    const processor = new StepToNotesProcessor(build("n", bus, {
      velocity: 100, gate: 90, channel: 1,
    }));
    expect(processor.status().rate).toBe("0 notes");
    feed(bus, "n", "steps-in", [
      { kind: "step-event", atTick: 0, durationTicks: 240, stepIndex: 0, pitches: [60] },
    ]);
    bus.beginNode("n", 16);
    processor.process(window());
    expect(processor.status().rate).toBe("1 note");
  });
});

describe("Cyclic Rhythm reset", () => {
  it("takes its next step from where the reset landed", () => {
    const bus = new MessageBus();
    const processor = new CyclicRhythmProcessor(build("n", bus, {
      "preset-values": [Array.from({ length: 16 }, () => 2)], "active-position": 0,
    }));
    bus.connect("n", "clock-out", "sink", "clock-in");
    feed(bus, "n", "reset-in", [{ kind: "reset", atTick: 480 }]);
    feed(bus, "n", "clock-in", [clock(480)]);
    bus.beginNode("n", 16);
    processor.process(window(480, 960));
    const out = bus.read("sink", "clock-in");
    expect(out.count).toBe(1);
    expect(out.items[0].atTick).toBe(480);
  });
});

describe("Scale-degree transposition", () => {
  const transpose = (values: Record<string, unknown>, note: number): number => {
    const bus = new MessageBus();
    const processor = new TranspositionProcessor(build("n", bus, {
      mode: "scale-degree", semitones: 0, degrees: 1, "scale-root": 0, "scale-mode": "major",
      ...values,
    }));
    bus.connect("n", "notes-out", "sink", "notes-in");
    feed(bus, "n", "notes-in", [
      { kind: "note-event", atTick: 0, note, velocity: 90, durationTicks: 100, channel: 1 },
    ]);
    bus.beginNode("n", 16);
    processor.process(window());
    return bus.read("sink", "notes-in").items[0].note;
  };

  it("steps up the major scale", () => {
    // C4 up one degree is D4.
    expect(transpose({}, 60)).toBe(62);
  });

  it("steps up the minor scale, which is a different interval", () => {
    // E♭ rather than E: the third degree of C minor.
    expect(transpose({ "scale-mode": "minor", degrees: 2 }, 60)).toBe(63);
  });

  it("works below the root, where the arithmetic goes negative", () => {
    // A note under the scale root is the case a plain `%` gets wrong.
    expect(transpose({ "scale-root": 60, degrees: 1 }, 55)).toBe(57);
  });
});

describe("Transport under budget", () => {
  it("drops a Sync rather than throwing when there is no room for it", () => {
    const bus = new MessageBus();
    const processor = new TransportProcessor(build("n", bus, {}, { budget: 0 }));
    processor.requestReset(0);
    bus.beginNode("n", 0);
    expect(() => processor.process(window())).not.toThrow();
  });
});

describe("A bank with a hole in it", () => {
  const sparse = (length: number) => Object.assign([] as unknown[], { length });

  it("recalls an empty slot without wiping the module", () => {
    // `[ , , ]` — a bank whose slots were never filled. Reading one back should
    // move the position and change nothing else.
    const cases = [
      {
        name: "Velocity Range",
        values: { low: 40, high: 100, "accent-level": 2 },
        make: (b: ProcessorBuild) => new VelocityRangeProcessor(b),
        held: "low", expected: 40,
      },
      {
        name: "Legato",
        values: { "base-multiplier": 100, "legato-level": 2 },
        make: (b: ProcessorBuild) => new LegatoProcessor(b),
        held: "base-multiplier", expected: 100,
      },
      {
        name: "Transposition",
        values: {
          mode: "semitone", semitones: 7, degrees: 0,
          "scale-root": 0, "scale-mode": "major",
        },
        make: (b: ProcessorBuild) => new TranspositionProcessor(b),
        held: "semitones", expected: 7,
      },
    ];

    for (const entry of cases) {
      const bus = new MessageBus();
      const parameters = new ParameterBag({
        ...entry.values, "active-position": 0, "preset-values": sparse(3),
      } as never);
      const processor = entry.make({
        nodeId: "n", bus, parameters, budget: 64, seed: 5,
      });

      bus.connect("conductor", "index-out", "n", "position-in");
      bus.beginNode("conductor", 8);
      const message = bus.acquire() as StreamMessage;
      Object.assign(message, { kind: "control", atTick: 0, controlValue: 2 });
      bus.publish("index-out", message);

      bus.beginNode("n", 16);
      processor.process(window());
      expect(parameters.number("active-position", -1), entry.name).toBe(2);
      expect(parameters.number(entry.held, -1), entry.name).toBe(entry.expected);
    }
  });
});

describe("Sinks under budget", () => {
  it("stops scheduling rather than throwing when the pool is spent", () => {
    const spent = { acquire: (): RuntimeEvent => pool.acquire(), submit: (): void => {} };
    const bus = new MessageBus();
    const processor = new MidiOutputProcessor(build("n", bus, {
      "device-id": "", channel: 1, "latency-ms": 0, "program-base": "0",
    }, { sink: spent, budget: 0 }));
    feed(bus, "n", "notes-in", [
      { kind: "note-event", atTick: 0, note: 60, velocity: 90, durationTicks: 100, channel: 1 },
    ]);
    bus.beginNode("n", 0);
    expect(() => processor.process(window())).not.toThrow();
  });
});
