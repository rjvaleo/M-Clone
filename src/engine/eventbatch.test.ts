import { describe, expect, it } from "vitest";
import { decodeEventBatch, encodeEventBatch } from "./eventbatch";
import type { EngineEvent } from "./events";

const events: EngineEvent[] = [
  { type: "note-on", destination: "midi", voice: 0, channel: 1,
    atSec: 1, atTick: 0, sequence: 2, noteId: 4, note: 60, velocity: 100 },
  { type: "program-change", destination: "midi", voice: 0, channel: 1,
    atSec: 1, atTick: 0, sequence: 0, program: 12 },
];

describe("native event-batch boundary", () => {
  it("round-trips a versioned batch in canonical event order", () => {
    const decoded = decodeEventBatch(encodeEventBatch(events, "port-a"));
    expect(decoded).toEqual({
      version: 1,
      destinationId: "port-a",
      events: [events[1], events[0]],
    });
  });

  it("rejects damaged and future batches", () => {
    const bytes = (value: unknown) => new TextEncoder().encode(
      typeof value === "string" ? value : JSON.stringify(value),
    );
    expect(() => decodeEventBatch(bytes("{"))).toThrow(/JSON/i);
    expect(() => decodeEventBatch(bytes(null))).toThrow(/invalid/i);
    expect(() => decodeEventBatch(bytes({}))).toThrow();
    const future = new TextEncoder().encode(JSON.stringify({ version: 2, events: [] }));
    expect(() => decodeEventBatch(future)).toThrow(/version/i);
    for (const payload of [
      { version: 1, destinationId: 4, events: [] },
      { version: 1, destinationId: "a", events: null },
      { version: 1, destinationId: "a", events: [null] },
      { version: 1, destinationId: "a", events: [{ type: "bad" }] },
      { version: 1, destinationId: "a", events: [{ type: "note-on", destination: "bad" }] },
      { version: 1, destinationId: "a", events: [{
        type: "note-on", destination: "midi", atSec: 1, atTick: 0,
        sequence: 0, voice: 0,
      }] },
    ]) expect(() => decodeEventBatch(bytes(payload))).toThrow(/payload/i);
  });
});
