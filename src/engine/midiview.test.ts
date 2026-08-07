import { describe, expect, it } from "vitest";
import { eventsForPlannedNotes, groupMidiViewRows, mergeMidiViewEvents } from "./midiview";

describe("Midi View event conversion", () => {
  it("creates one Note On and one Note Off from the actual planned note", () => {
    expect(eventsForPlannedNotes([{
      voice: 2, note: 61, velocity: 99, channel: 7,
      startSec: 1.25, durationSec: 0.5,
    }], 10)).toEqual([
      {
        id: 10, atSec: 1.25, voice: 2, channel: 7, type: "note-on",
        note: 61, noteName: "C#4", velocity: 99, durationSec: 0.5,
      },
      {
        id: 11, atSec: 1.75, voice: 2, channel: 7, type: "note-off",
        note: 61, noteName: "C#4", velocity: 0, durationSec: 0,
      },
    ]);
  });

  it("keeps simultaneous stream events stable and orders future note-offs by time", () => {
    const events = eventsForPlannedNotes([
      { voice: 0, note: 60, velocity: 80, channel: 1, startSec: 2, durationSec: 1 },
      { voice: 1, note: 67, velocity: 90, channel: 2, startSec: 2.5, durationSec: 0.1 },
    ], 0);
    expect(events.map((event) => [event.atSec, event.voice, event.type])).toEqual([
      [2, 0, "note-on"], [2.5, 1, "note-on"], [2.6, 1, "note-off"], [3, 0, "note-off"],
    ]);
  });

  it("merges, sorts, and bounds the tracker history", () => {
    const old = eventsForPlannedNotes([
      { voice: 0, note: 60, velocity: 80, channel: 1, startSec: 1, durationSec: 0.1 },
    ], 0);
    const newer = eventsForPlannedNotes([
      { voice: 1, note: 62, velocity: 90, channel: 2, startSec: 2, durationSec: 0.1 },
      { voice: 2, note: 64, velocity: 100, channel: 3, startSec: 3, durationSec: 0.1 },
    ], 2);
    expect(mergeMidiViewEvents(old, newer, 3).map((event) => event.id)).toEqual([3, 4, 5]);
  });

  it("uses ids to stabilize equal timestamps and accepts the default/zero bounds", () => {
    const simultaneous = eventsForPlannedNotes([
      { voice: 0, note: 60, velocity: 80, channel: 1, startSec: 1, durationSec: 0 },
      { voice: 1, note: 62, velocity: 90, channel: 2, startSec: 1, durationSec: 0 },
    ], 4);
    expect(simultaneous.map((event) => event.id)).toEqual([4, 5, 6, 7]);
    expect(mergeMidiViewEvents([], simultaneous)).toHaveLength(4);
    expect(mergeMidiViewEvents(simultaneous, [], -1)).toEqual([]);
  });

  it("groups simultaneous messages into one absolute-time tracker row", () => {
    const events = eventsForPlannedNotes([
      { voice: 0, note: 60, velocity: 80, channel: 1, startSec: 4, durationSec: 1 },
      { voice: 1, note: 64, velocity: 90, channel: 2, startSec: 4, durationSec: 0.5 },
      { voice: 0, note: 67, velocity: 70, channel: 1, startSec: 4, durationSec: 0.25 },
    ], 0);
    const rows = groupMidiViewRows(events);
    expect(rows.map((row) => row.atSec)).toEqual([4, 4.25, 4.5, 5]);
    expect(rows[0].streams[0].map((event) => event.noteName)).toEqual(["C4", "G4"]);
    expect(rows[0].streams[1].map((event) => event.noteName)).toEqual(["E4"]);
    expect(rows[0].streams[2]).toEqual([]);
  });

});

describe("transport messages in the readout", () => {
  const mark = (id: number, atSec: number, type: "start" | "stop" | "continue",
    direction: "out" | "in") => ({ id, atSec, type, direction });

  it("gives a transport message its own row when no notes share the time", () => {
    const rows = groupMidiViewRows([], [mark(1, 2, "start", "out")]);
    expect(rows).toHaveLength(1);
    expect(rows[0].atSec).toBe(2);
    expect(rows[0].transport).toEqual([mark(1, 2, "start", "out")]);
    expect(rows[0].streams).toEqual([[], [], [], []]);
  });

  it("shares a row with notes at the same instant", () => {
    // A Start and the first note of the run land together; two rows for one
    // moment would read as two moments.
    const note = {
      id: 9, atSec: 2, voice: 1, channel: 2, type: "note-on" as const,
      note: 60, noteName: "C4", velocity: 100, durationSec: 0.25,
    };
    const rows = groupMidiViewRows([note], [mark(1, 2, "start", "out")]);
    expect(rows).toHaveLength(1);
    expect(rows[0].streams[1]).toEqual([note]);
    expect(rows[0].transport).toHaveLength(1);
  });

  it("keeps rows in time order however the two lists interleave", () => {
    const rows = groupMidiViewRows([], [
      mark(2, 5, "stop", "out"),
      mark(1, 1, "start", "out"),
    ]);
    expect(rows.map((row) => row.atSec)).toEqual([1, 5]);
  });

  it("records which way the message went", () => {
    // The same readout shows what M sent and what it was told, so a row that
    // does not say which is worse than no row.
    const rows = groupMidiViewRows([], [mark(1, 0, "start", "in")]);
    expect(rows[0].transport[0].direction).toBe("in");
  });

  it("leaves the transport list empty on rows that have none", () => {
    const note = {
      id: 1, atSec: 0, voice: 0, channel: 1, type: "note-on" as const,
      note: 60, noteName: "C4", velocity: 100, durationSec: 0.1,
    };
    expect(groupMidiViewRows([note])[0].transport).toEqual([]);
  });
})
