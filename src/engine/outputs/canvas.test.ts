import { describe, expect, it, vi } from "vitest";
import type { EngineEvent } from "../events";
import { CanvasSink } from "./canvas";

function note(type: "note-on" | "note-off", over: Partial<EngineEvent> = {}): EngineEvent {
  return {
    type, destination: "canvas", voice: 0, channel: 1, noteId: 1, note: 60,
    velocity: 100, atSec: 1, atTick: 0, sequence: 0, ...over,
  } as EngineEvent;
}

function output() {
  return { send: vi.fn(), panic: vi.fn(), routedVoices: () => new Set<number>() };
}

describe("canvas output", () => {
  it("hands over only canvas notes, once per voice however many channels carry them", () => {
    const target = output();
    const sink = new CanvasSink(target);
    const on = note("note-on");
    const off = note("note-off", { atSec: 2 });
    sink.scheduleBatch([
      on,
      note("note-on", { channel: 2 }),           // same note on a second channel
      note("note-on", { destination: "midi" }),  // not this sink's
      { type: "program-change", destination: "canvas", voice: 0, channel: 1,
        program: 3, atSec: 1, atTick: 0, sequence: 0 },
      off,
    ]);
    expect(target.send).toHaveBeenCalledTimes(1);
    expect(target.send.mock.calls[0]![0]).toEqual([on, off]);
  });

  it("sends nothing when no canvas note is in the batch", () => {
    const target = output();
    new CanvasSink(target).scheduleBatch([note("note-on", { destination: "synth" })]);
    expect(target.send).not.toHaveBeenCalled();
  });

  it("leaves handed-over notes to the module on a stop, and panics through the output", () => {
    const target = output();
    const sink = new CanvasSink(target);
    expect(sink.destination).toBe("canvas");
    sink.cancelScheduled();
    expect(target.panic).not.toHaveBeenCalled();
    sink.panic();
    expect(target.panic).toHaveBeenCalledTimes(1);
  });
});
