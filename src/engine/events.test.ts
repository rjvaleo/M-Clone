import { describe, expect, it } from "vitest";
import { compareEngineEvents, NoteLifecycle, type NoteOnEvent } from "./events";

const note = (startSec: number, durationSec: number, voice = 0) => ({
  voice, note: 60, velocity: 100, channel: 1, startSec, durationSec,
});

describe("explicit engine event lifecycle", () => {
  it("uses sequence as the final deterministic ordering tie-breaker", () => {
    const base: NoteOnEvent = {
      type: "note-on", atSec: 1, atTick: 960, sequence: 2,
      destination: "midi", voice: 0, channel: 1, noteId: 1,
      note: 60, velocity: 100,
    };
    expect(compareEngineEvents(base, { ...base, sequence: 5 })).toBeLessThan(0);
  });

  it("keeps future note-offs pending until their scheduling window", () => {
    const lifecycle = new NoteLifecycle();
    lifecycle.ingest([note(1, 2)], ["midi"]);
    expect(lifecycle.drainBefore(1.5).map((event) => event.type)).toEqual(["note-on"]);
    expect(lifecycle.drainBefore(3.1).map((event) => event.type)).toEqual(["note-off"]);
  });

  it("releases an old owner before a same-pitch retrigger and removes its stale off", () => {
    const lifecycle = new NoteLifecycle();
    lifecycle.ingest([note(1, 3)], ["midi"]);
    lifecycle.drainBefore(2);
    lifecycle.ingest([note(2, 1, 1)], ["midi"]);
    const events = lifecycle.drainBefore(5);
    expect(events.map((event) => [event.atSec, event.type])).toEqual([
      [2, "note-off"], [2, "note-on"], [3, "note-off"],
    ]);
    expect(events.filter((event) => event.atSec === 4)).toEqual([]);
  });

  it("creates independent destination lifecycles", () => {
    const lifecycle = new NoteLifecycle();
    lifecycle.ingest([note(1, 1)], ["midi", "synth"]);
    const events = lifecycle.drainBefore(3);
    expect(events.filter((event) => event.destination === "midi")).toHaveLength(2);
    expect(events.filter((event) => event.destination === "synth")).toHaveLength(2);
  });

  it("orders program changes and note-offs before note-ons at equal times", () => {
    const lifecycle = new NoteLifecycle();
    lifecycle.addProgramChanges(1, 0, [{ voice: 0, channel: 1, program: 42 }]);
    lifecycle.ingest([note(1, 0)], ["midi"]);
    expect(lifecycle.drainBefore(2).map((event) => event.type)).toEqual([
      "program-change", "note-off", "note-on",
    ]);
  });

  it("reset discards pending events and ownership", () => {
    const lifecycle = new NoteLifecycle();
    lifecycle.ingest([note(1, 10)], ["midi"]);
    lifecycle.reset();
    expect(lifecycle.drainBefore(Infinity)).toEqual([]);
  });
});
