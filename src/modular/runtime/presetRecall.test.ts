import { describe, expect, it } from "vitest";
import { MessageBus, type StreamMessage } from "./messages";
import {
  LegatoProcessor,
  ParameterBag,
  PlayEnableProcessor,
  TranspositionProcessor,
  VelocityRangeProcessor,
  type ProcessWindow,
} from "./processors";
import { TempoMap } from "./time";

/**
 * Recalling a preset from a cable rather than from the face.
 *
 * `position-in` is how a conductor moves a whole patch between stored ideas at
 * once, so every Variable has to answer it the same way: take the index, clamp
 * it into the bank, apply only the fields the slot actually stores, and leave
 * the rest of the module alone. A slot that stores nothing must not wipe the
 * live values — that is the difference between recalling a preset and clearing
 * the module.
 */

const window = (startTick = 0, endTick = 960): ProcessWindow => ({
  startTick, endTick, tempo: new TempoMap(120, 0),
});

/** Deliver one control value into a node's `position-in`. */
const sendPosition = (bus: MessageBus, nodeId: string, controlValue: number) => {
  bus.connect("conductor", "index-out", nodeId, "position-in");
  bus.beginNode("conductor", 8);
  const message = bus.acquire() as StreamMessage;
  Object.assign(message, { kind: "control", atTick: 0, controlValue });
  bus.publish("index-out", message);
};

/** Deliver something that is not a control value at all. */
const sendNonControl = (bus: MessageBus, nodeId: string) => {
  bus.connect("conductor", "index-out", nodeId, "position-in");
  bus.beginNode("conductor", 8);
  const message = bus.acquire() as StreamMessage;
  Object.assign(message, { kind: "reset", atTick: 0 });
  bus.publish("index-out", message);
};

const run = (processor: { nodeId: string; process: (w: ProcessWindow) => void }, bus: MessageBus) => {
  bus.beginNode(processor.nodeId, 64);
  processor.process(window());
  bus.endWindow();
};

describe("Velocity Range recall", () => {
  const make = (values: Record<string, unknown>) => {
    const bus = new MessageBus();
    const parameters = new ParameterBag(values as never);
    const processor = new VelocityRangeProcessor({
      nodeId: "vr", bus, parameters, budget: 64, seed: 1,
    });
    return { bus, parameters, processor };
  };

  it("takes low, high and accent from the slot", () => {
    const { bus, parameters, processor } = make({
      low: 40, high: 100, "accent-level": 2, "active-position": 0,
      "preset-values": [{ low: 10, high: 20, accent: 4 }, { low: 60, high: 90, accent: 1 }],
    });
    sendPosition(bus, "vr", 1);
    run(processor, bus);
    expect(parameters.number("low", 0)).toBe(60);
    expect(parameters.number("high", 0)).toBe(90);
    expect(parameters.number("accent-level", 0)).toBe(1);
    expect(parameters.number("active-position", -1)).toBe(1);
  });

  it("keeps the live value for anything the slot does not store", () => {
    const { bus, parameters, processor } = make({
      low: 40, high: 100, "accent-level": 2, "active-position": 0,
      "preset-values": [{}, { low: 60 }],
    });
    sendPosition(bus, "vr", 1);
    run(processor, bus);
    expect(parameters.number("low", 0)).toBe(60);
    expect(parameters.number("high", 0)).toBe(100);
    expect(parameters.number("accent-level", 0)).toBe(2);
  });

  it("clamps an index past the end of the bank", () => {
    const { bus, parameters, processor } = make({
      low: 40, high: 100, "accent-level": 2, "active-position": 0,
      "preset-values": [{ low: 1 }, { low: 2 }],
    });
    sendPosition(bus, "vr", 99);
    run(processor, bus);
    expect(parameters.number("active-position", -1)).toBe(1);
  });

  it("ignores a value that is not a number", () => {
    const { bus, parameters, processor } = make({
      low: 40, high: 100, "accent-level": 2, "active-position": 0,
      "preset-values": [{ low: "loud", high: Number.NaN, accent: null }],
    });
    sendPosition(bus, "vr", 0);
    run(processor, bus);
    expect(parameters.number("low", 0)).toBe(40);
    expect(parameters.number("high", 0)).toBe(100);
  });

  it("does nothing without a bank, or on a message that is not a control", () => {
    const empty = make({ low: 40, "active-position": 3, "preset-values": [] });
    sendPosition(empty.bus, "vr", 1);
    run(empty.processor, empty.bus);
    expect(empty.parameters.number("active-position", -1)).toBe(3);

    const notControl = make({
      low: 40, "active-position": 3, "preset-values": [{ low: 9 }, { low: 8 }],
    });
    sendNonControl(notControl.bus, "vr");
    run(notControl.processor, notControl.bus);
    expect(notControl.parameters.number("active-position", -1)).toBe(3);
    expect(notControl.parameters.number("low", 0)).toBe(40);
  });
});

describe("Legato recall", () => {
  const make = (values: Record<string, unknown>) => {
    const bus = new MessageBus();
    const parameters = new ParameterBag(values as never);
    return {
      bus, parameters,
      processor: new LegatoProcessor({ nodeId: "lg", bus, parameters, budget: 64, seed: 1 }),
    };
  };

  it("takes the base multiplier and level from the slot", () => {
    const { bus, parameters, processor } = make({
      "base-multiplier": 100, "legato-level": 2, "active-position": 0,
      "preset-values": [{}, { base: 150, level: 4 }],
    });
    sendPosition(bus, "lg", 1);
    run(processor, bus);
    expect(parameters.number("base-multiplier", 0)).toBe(150);
    expect(parameters.number("legato-level", 0)).toBe(4);
  });

  it("leaves the module alone for an empty bank or a non-control", () => {
    const empty = make({ "base-multiplier": 100, "active-position": 2, "preset-values": [] });
    sendPosition(empty.bus, "lg", 0);
    run(empty.processor, empty.bus);
    expect(empty.parameters.number("active-position", -1)).toBe(2);

    const notControl = make({
      "base-multiplier": 100, "active-position": 2, "preset-values": [{ base: 50 }],
    });
    sendNonControl(notControl.bus, "lg");
    run(notControl.processor, notControl.bus);
    expect(notControl.parameters.number("base-multiplier", 0)).toBe(100);
  });
});

describe("Play Enable recall", () => {
  const make = (values: Record<string, unknown>) => {
    const bus = new MessageBus();
    const parameters = new ParameterBag(values as never);
    return {
      bus, parameters,
      processor: new PlayEnableProcessor({ nodeId: "pe", bus, parameters, budget: 64, seed: 1 }),
    };
  };

  it("takes the gate from the slot", () => {
    const { bus, parameters, processor } = make({
      "play-enabled": true, "active-position": 0, "preset-values": [true, false],
    });
    sendPosition(bus, "pe", 1);
    run(processor, bus);
    expect(parameters.raw("play-enabled")).toBe(false);
    expect(parameters.number("active-position", -1)).toBe(1);
  });

  it("ignores a slot holding something that is not a gate", () => {
    const { bus, parameters, processor } = make({
      "play-enabled": true, "active-position": 0, "preset-values": ["yes", null],
    });
    sendPosition(bus, "pe", 0);
    run(processor, bus);
    expect(parameters.raw("play-enabled")).toBe(true);
  });

  it("leaves the module alone for an empty bank or a non-control", () => {
    const empty = make({ "play-enabled": true, "active-position": 5, "preset-values": [] });
    sendPosition(empty.bus, "pe", 0);
    run(empty.processor, empty.bus);
    expect(empty.parameters.number("active-position", -1)).toBe(5);

    const notControl = make({ "play-enabled": true, "active-position": 5, "preset-values": [false] });
    sendNonControl(notControl.bus, "pe");
    run(notControl.processor, notControl.bus);
    expect(notControl.parameters.raw("play-enabled")).toBe(true);
  });
});

describe("Transposition recall", () => {
  const make = (values: Record<string, unknown>) => {
    const bus = new MessageBus();
    const parameters = new ParameterBag(values as never);
    return {
      bus, parameters,
      processor: new TranspositionProcessor({ nodeId: "tr", bus, parameters, budget: 64, seed: 1 }),
    };
  };

  const defaults = {
    mode: "semitone", semitones: 0, degrees: 0, "scale-root": 0, "scale-mode": "major",
    "active-position": 0,
  };

  it("takes every field the slot stores", () => {
    const { bus, parameters, processor } = make({
      ...defaults,
      "preset-values": [{}, {
        mode: "scale-degree", semitones: 5, degrees: 2, root: 7, scale: "minor",
      }],
    });
    sendPosition(bus, "tr", 1);
    run(processor, bus);
    expect(parameters.raw("mode")).toBe("scale-degree");
    expect(parameters.number("semitones", -1)).toBe(5);
    expect(parameters.number("degrees", -1)).toBe(2);
    expect(parameters.number("scale-root", -1)).toBe(7);
    expect(parameters.raw("scale-mode")).toBe("minor");
  });

  it("refuses a mode or scale it does not recognise", () => {
    const { bus, parameters, processor } = make({
      ...defaults,
      "preset-values": [{ mode: "sideways", scale: "phrygian", semitones: "up", degrees: null, root: Number.NaN }],
    });
    sendPosition(bus, "tr", 0);
    run(processor, bus);
    expect(parameters.raw("mode")).toBe("semitone");
    expect(parameters.raw("scale-mode")).toBe("major");
    expect(parameters.number("semitones", -1)).toBe(0);
  });

  it("leaves the module alone for an empty bank or a non-control", () => {
    const empty = make({ ...defaults, "active-position": 4, "preset-values": [] });
    sendPosition(empty.bus, "tr", 0);
    run(empty.processor, empty.bus);
    expect(empty.parameters.number("active-position", -1)).toBe(4);

    const notControl = make({ ...defaults, "active-position": 4, "preset-values": [{ semitones: 9 }] });
    sendNonControl(notControl.bus, "tr");
    run(notControl.processor, notControl.bus);
    expect(notControl.parameters.number("semitones", -1)).toBe(0);
  });
});
