import { describe, expect, it, vi } from "vitest";
import { isNotePlayer } from "../players";
import { RackNotePlayer } from "./rackNotePlayer";

const sink = () => ({ noteOn: vi.fn(), noteOff: vi.fn(), allNotesOff: vi.fn() });

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

  it("forwards note on with its velocity", () => {
    const rack = sink();
    new RackNotePlayer("n1", rack).noteOn(60, 0.8, 12.5);
    expect(rack.noteOn).toHaveBeenCalledWith(60, 0.8, 0);
  });

  it("forwards the microtonal remainder a scale quantiser produced", () => {
    // The one part of the event a MIDI note number cannot carry. Dropping it
    // here would make every scale in the tuning library sound like 12-TET
    // while the quantiser upstream reported that it had worked.
    const rack = sink();
    new RackNotePlayer("n1", rack).noteOn(60, 0.8, 12.5, -33.4);
    expect(rack.noteOn).toHaveBeenCalledWith(60, 0.8, -33.4);
  });

  it("treats an absent detune as in tune", () => {
    // Most callers have no tuning system and pass three arguments.
    const rack = sink();
    new RackNotePlayer("n1", rack).noteOn(60, 0.8, 12.5);
    expect(rack.noteOn).toHaveBeenCalledWith(60, 0.8, 0);
  });

  it("forwards note off", () => {
    const rack = sink();
    new RackNotePlayer("n1", rack).noteOff(60, 12.5);
    expect(rack.noteOff).toHaveBeenCalledWith(60);
  });

  it("silences by sending all-notes-off", () => {
    const rack = sink();
    new RackNotePlayer("n1", rack).silence(12.5);
    expect(rack.allNotesOff).toHaveBeenCalled();
  });

  it("drops the scheduled time, because the rack protocol has nowhere to put it", () => {
    // Documented rather than worked around: `RackMessage` carries no
    // timestamp, so a note sounds when its message is handled rather than at
    // `atSec`. Sample-accurate scheduling needs a protocol change, and
    // pretending otherwise here would hide that.
    const rack = sink();
    const player = new RackNotePlayer("n1", rack);
    player.noteOn(60, 1, 999);
    player.noteOn(60, 1, 0);
    expect(rack.noteOn).toHaveBeenNthCalledWith(1, 60, 1, 0);
    expect(rack.noteOn).toHaveBeenNthCalledWith(2, 60, 1, 0);
  });
});
