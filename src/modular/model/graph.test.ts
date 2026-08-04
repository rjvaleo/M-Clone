import { describe, expect, it } from "vitest";
import { compatibleSignals, emptyGraph, signalTypeKey } from "./graph";

/**
 * The signal key is what makes patching safe: two ports connect when their keys
 * match, so anything the key leaves out is a connection nobody meant to allow.
 */
describe("Signal identity", () => {
  it("distinguishes signals of the same kind that carry different things", () => {
    expect(signalTypeKey({ kind: "control", value: "number" }))
      .not.toBe(signalTypeKey({ kind: "control", value: "index" }));
    expect(signalTypeKey({ kind: "audio", channels: 1 }))
      .not.toBe(signalTypeKey({ kind: "audio", channels: 2 }));
    expect(signalTypeKey({ kind: "telemetry", schema: "cursor" }))
      .not.toBe(signalTypeKey({ kind: "telemetry", schema: "density" }));
  });

  it("carries the qualifier for kinds that currently have only one", () => {
    // Transport resolution and MIDI protocol are single-valued today, so there
    // is nothing to collide with yet. The key still names them, which is what
    // will keep a second resolution or UMP from silently patching into the
    // first one the day either is added.
    expect(signalTypeKey({ kind: "transport", resolution: 960 })).toBe("transport:960");
    expect(signalTypeKey({ kind: "midi", protocol: "midi1" })).toBe("midi:midi1");
  });

  it("treats an unstated control polarity as unipolar", () => {
    expect(signalTypeKey({ kind: "control", value: "number" }))
      .toBe(signalTypeKey({ kind: "control", value: "number", polarity: "uni" }));
    expect(compatibleSignals(
      { kind: "control", value: "number" },
      { kind: "control", value: "number", polarity: "bi" },
    )).toBe(false);
  });

  it("keys a kind with nothing to qualify it by the kind alone", () => {
    expect(signalTypeKey({ kind: "step-clock" })).toBe("step-clock");
    expect(signalTypeKey({ kind: "note-event" })).toBe("note-event");
    expect(signalTypeKey({ kind: "reset" })).toBe("reset");
    expect(signalTypeKey({ kind: "pattern-data" })).toBe("pattern-data");
    expect(signalTypeKey({ kind: "step-event" })).toBe("step-event");
  });

  it("connects only signals that are the same thing", () => {
    expect(compatibleSignals({ kind: "note-event" }, { kind: "note-event" })).toBe(true);
    expect(compatibleSignals({ kind: "note-event" }, { kind: "step-event" })).toBe(false);
    expect(compatibleSignals(
      { kind: "telemetry", schema: "cursor" },
      { kind: "telemetry", schema: "cursor" },
    )).toBe(true);
  });
});

describe("An empty graph", () => {
  it("is a fresh object every time, so two documents never share state", () => {
    const first = emptyGraph();
    const second = emptyGraph();
    expect(first).toEqual({ nodes: {}, edges: {} });
    first.edges.e = {
      id: "e",
      from: { nodeId: "a", portId: "out" },
      to: { nodeId: "b", portId: "in" },
      enabled: true,
    };
    expect(Object.keys(second.edges)).toEqual([]);
  });
});
