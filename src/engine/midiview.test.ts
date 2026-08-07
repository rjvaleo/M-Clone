import { describe, expect, it } from "vitest";
import {
  beatOfTick,
  eventsForPlannedNotes,
  formatDurationCell,
  groupMidiViewRows,
  mergeMidiViewEvents,
} from "./midiview";
import { PPQN } from "./planner";

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

describe("musical position on the readout", () => {
  const planned = (over = {}) => ({
    voice: 0, note: 60, velocity: 100, channel: 1,
    startSec: 1, durationSec: 0.5, atTick: 1920, durationTicks: 960, ...over,
  });

  it("carries the tick through, so rows can be placed by musical time", () => {
    // Seconds drift against the music the moment the tempo moves; the tick is
    // the position the planner actually decided.
    const [on, off] = eventsForPlannedNotes([planned()], 0);
    expect(on.atTick).toBe(1920);
    expect(off.atTick).toBe(2880);
  });

  it("gives the note-on its length in ticks", () => {
    const [on] = eventsForPlannedNotes([planned()], 0);
    expect(on.durationTicks).toBe(960);
  });

  it("defaults a missing length to zero when the position is known", () => {
    // atTick and durationTicks are independently optional on PlannedNote, so
    // one can arrive without the other.
    const [on, off] = eventsForPlannedNotes(
      [planned({ durationTicks: undefined })], 0,
    );
    expect(on.durationTicks).toBe(0);
    expect(off.atTick).toBe(1920);
  });

  it("survives a note the planner gave no tick", () => {
    // atTick is optional on PlannedNote, so the readout must not assume it.
    const [on] = eventsForPlannedNotes(
      [planned({ atTick: undefined, durationTicks: undefined })], 0,
    );
    expect(on.atTick).toBeUndefined();
    expect(on.atSec).toBe(1);
  });

  it("converts a tick to a beat at 960 PPQN", () => {
    expect(beatOfTick(0)).toBe(0);
    expect(beatOfTick(960)).toBe(1);
    expect(beatOfTick(480)).toBe(0.5);
  });
})

describe("the three-character duration cell", () => {
  it("is always exactly three characters, so columns cannot drift", () => {
    // The whole point of the fixed cell. A readout that sometimes renders two
    // characters and sometimes four stops being a grid.
    for (const beats of [0, 0.01, 0.125, 0.25, 0.5, 0.75, 1, 1.5, 2, 3.75, 9, 9.9, 10, 64, 999]) {
      expect(formatDurationCell(beats * PPQN), `at ${beats} beats`).toHaveLength(3);
    }
  });

  it("shows a whole beat as one point zero", () => {
    expect(formatDurationCell(PPQN)).toBe("1.0");
    expect(formatDurationCell(PPQN * 2)).toBe("2.0");
    expect(formatDurationCell(PPQN * 1.5)).toBe("1.5");
  });

  it("drops the leading zero below a beat, to keep two digits of detail", () => {
    // ".25" carries more than "0.2" in the same three characters.
    expect(formatDurationCell(PPQN * 0.25)).toBe(".25");
    expect(formatDurationCell(PPQN * 0.5)).toBe(".50");
    expect(formatDurationCell(PPQN * 0.125)).toBe(".13");
  });

  it("marks anything ten beats or longer as over", () => {
    // Three characters cannot hold both digits and a decimal, and the exact
    // length of a very long note is not what the readout is for.
    expect(formatDurationCell(PPQN * 10)).toBe("10+");
    expect(formatDurationCell(PPQN * 64)).toBe("10+");
  });

  it("renders a note-off, which has no length, as blank rather than zero", () => {
    // A note-off is an instant. "0.0" would read as a note of no length.
    expect(formatDurationCell(0)).toBe("   ");
  });

  it("never renders a negative length", () => {
    expect(formatDurationCell(-960)).toBe("   ");
  });
})
