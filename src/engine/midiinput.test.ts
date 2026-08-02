import { describe, expect, it } from "vitest";
import {
  applyRecordedNotes,
  decodeMidiMessage,
  mapAssignedInputChannel,
  routeMidiNote,
  type MidiInputVoice,
} from "./midiinput";

describe("live MIDI input", () => {
  const voices: MidiInputVoice[] = [
    { sourceChannel: "all", use: "record", echo: true },
    { sourceChannel: 2, use: "record", echo: false },
    { sourceChannel: 1, use: "disabled", echo: true },
    { sourceChannel: 1, use: "keyboard-transpose", echo: false },
  ];

  it("decodes note, controller, and sustain messages including zero-velocity note-off", () => {
    expect(decodeMidiMessage([0x91, 64, 100])).toEqual({ type: "note-on", channel: 2, note: 64, velocity: 100 });
    expect(decodeMidiMessage([0x91, 64, 0])).toEqual({ type: "note-off", channel: 2, note: 64, velocity: 0 });
    expect(decodeMidiMessage([0xb2, 64, 127])).toEqual({ type: "control", channel: 3, controller: 64, value: 127 });
    expect(decodeMidiMessage([0x90, 60])).toBeNull();
    expect(decodeMidiMessage([0xe0, 0, 64])).toBeNull();
  });

  it("filters each voice by source channel and ignores disabled voices", () => {
    expect(routeMidiNote(voices, 1)).toEqual([0, 3]);
    expect(routeMidiNote(voices, 2)).toEqual([0, 1]);
  });

  it("implements insert, replace, and overdub at the edit counter", () => {
    const steps = [{ pitches: [60] }, { pitches: [62] }];
    expect(applyRecordedNotes(steps, [64], 1, "insert", 8)).toEqual([
      { pitches: [60] }, { pitches: [64] }, { pitches: [62] },
    ]);
    expect(applyRecordedNotes(steps, [64], 1, "replace", 8)).toEqual([
      { pitches: [60] }, { pitches: [64] },
    ]);
    expect(applyRecordedNotes(steps, [64, 62], 1, "overdub", 8)).toEqual([
      { pitches: [60] }, { pitches: [62, 64] },
    ]);
  });

  it("maps a physical device/channel pair to an internal M Input channel", () => {
    const rows = Array.from({ length: 16 }, (_, i) => ({ deviceId: null as string | null, channel: i + 1 }));
    rows[4] = { deviceId: "kbd", channel: 2 };
    expect(mapAssignedInputChannel(rows, "kbd", 2)).toBe(5);
    expect(mapAssignedInputChannel(rows, "other", 2)).toBeNull();
    expect(mapAssignedInputChannel(
      Array.from({ length: 16 }, (_, i) => ({ deviceId: null, channel: i + 1 })),
      "kbd",
      7,
    )).toBe(7);
  });

  it("overdubs beyond the current end and respects a full insert buffer", () => {
    expect(applyRecordedNotes([], [67], 4, "overdub", 8)).toEqual([
      { pitches: [67] },
    ]);
    expect(applyRecordedNotes([{ pitches: [60] }], [62], 0, "insert", 1)).toEqual([
      { pitches: [60] },
    ]);
  });
});
