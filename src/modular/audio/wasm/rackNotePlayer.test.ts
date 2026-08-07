import { describe, expect, it, vi } from "vitest";
import { isNotePlayer } from "../players";
import { RackNotePlayer } from "./rackNotePlayer";

const sink = () => ({ schedule: vi.fn() });

describe("RackNotePlayer", () => {
  it("is accepted by the note adapter's duck test", () => {
    // The adapter finds players through `isNotePlayer`, so this shim has to
    // pass the same check a Web Audio player does — otherwise every note is
    // counted as dropped and nothing sounds.
    expect(isNotePlayer(new RackNotePlayer("n1", sink()))).toBe(true);
  });

  it("keeps the node id it was built for", () => {
    expect(new RackNotePlayer("n1", sink()).nodeId).toBe("n1");
  });

  it("schedules note on for the moment the score asked for", () => {
    const rack = sink();
    new RackNotePlayer("n1", rack).noteOn(60, 0.8, 12.5);
    expect(rack.schedule).toHaveBeenCalledWith("n1", 12.5, [
      { type: "note-on", note: 60, velocity: 0.8, detuneCents: 0 },
    ]);
  });

  it("carries the microtonal remainder a scale quantiser produced", () => {
    // The one part of the event a MIDI note number cannot hold. Dropping it
    // would make every scale in the tuning library sound like 12-TET while the
    // quantiser upstream reported that it had worked.
    const rack = sink();
    new RackNotePlayer("n1", rack).noteOn(60, 0.8, 12.5, -33.4);
    expect(rack.schedule).toHaveBeenCalledWith("n1", 12.5, [
      { type: "note-on", note: 60, velocity: 0.8, detuneCents: -33.4 },
    ]);
  });

  it("schedules note off for its own moment", () => {
    const rack = sink();
    new RackNotePlayer("n1", rack).noteOff(60, 12.5);
    expect(rack.schedule).toHaveBeenCalledWith("n1", 12.5, [{ type: "note-off", note: 60 }]);
  });

  it("schedules silence rather than taking effect immediately", () => {
    const rack = sink();
    new RackNotePlayer("n1", rack).silence(12.5);
    expect(rack.schedule).toHaveBeenCalledWith("n1", 12.5, [{ type: "all-notes-off" }]);
  });

  it("keeps two notes apart when they were asked for at different times", () => {
    // The regression this file used to document as a limitation: both notes
    // used to be sent bare, so both sounded whenever their messages happened
    // to be handled, and the gap between them was whatever the main thread's
    // scheduling made it.
    const rack = sink();
    const player = new RackNotePlayer("n1", rack);
    player.noteOn(60, 1, 1.0);
    player.noteOn(62, 1, 1.5);
    expect(rack.schedule.mock.calls[0][1]).toBe(1.0);
    expect(rack.schedule.mock.calls[1][1]).toBe(1.5);
  });
});
