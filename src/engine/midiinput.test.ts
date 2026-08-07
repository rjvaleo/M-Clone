import { describe, expect, it } from "vitest";
import {
  applyRecordedNotes,
  decodeMidiMessage,
  isChannelMessage,
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

describe("system realtime and position messages", () => {
  // These are how a clock source drives a follower. They are one byte long,
  // except Song Position Pointer, so the decoder cannot assume three.
  it("decodes a clock pulse", () => {
    expect(decodeMidiMessage([0xf8])).toEqual({ type: "clock" });
  });

  it("decodes start, continue and stop", () => {
    expect(decodeMidiMessage([0xfa])).toEqual({ type: "start" });
    expect(decodeMidiMessage([0xfb])).toEqual({ type: "continue" });
    expect(decodeMidiMessage([0xfc])).toEqual({ type: "stop" });
  });

  it("decodes a Song Position Pointer from its two seven-bit halves", () => {
    // 14 bits, least significant first: 0x0a | (0x01 << 7) = 138 sixteenths.
    expect(decodeMidiMessage([0xf2, 0x0a, 0x01]))
      .toEqual({ type: "song-position", sixteenths: 138 });
    expect(decodeMidiMessage([0xf2, 0x00, 0x00]))
      .toEqual({ type: "song-position", sixteenths: 0 });
    expect(decodeMidiMessage([0xf2, 0x7f, 0x7f]))
      .toEqual({ type: "song-position", sixteenths: 16383 });
  });

  it("refuses a truncated Song Position Pointer", () => {
    // Unlike the realtime bytes, SPP carries two data bytes. A cut-short one
    // must not be read as position zero.
    expect(decodeMidiMessage([0xf2])).toBeNull();
    expect(decodeMidiMessage([0xf2, 0x0a])).toBeNull();
  });

  it("ignores realtime messages it has no use for", () => {
    // Active Sensing arrives constantly from some hardware; treating it as
    // anything would be worse than dropping it.
    expect(decodeMidiMessage([0xfe])).toBeNull();
    expect(decodeMidiMessage([0xff])).toBeNull();
  });

  it("still refuses a truncated channel message", () => {
    expect(decodeMidiMessage([0x90, 60])).toBeNull();
    expect(decodeMidiMessage([])).toBeNull();
  });
})

describe("telling channel messages from system ones", () => {
  it("accepts the messages that can be routed to a Voice", () => {
    expect(isChannelMessage({ type: "note-on", channel: 1, note: 60, velocity: 100 })).toBe(true);
    expect(isChannelMessage({ type: "note-off", channel: 1, note: 60, velocity: 0 })).toBe(true);
    expect(isChannelMessage({ type: "control", channel: 1, controller: 7, value: 90 })).toBe(true);
  });

  it("rejects the ones that carry no channel", () => {
    expect(isChannelMessage({ type: "clock" })).toBe(false);
    expect(isChannelMessage({ type: "start" })).toBe(false);
    expect(isChannelMessage({ type: "continue" })).toBe(false);
    expect(isChannelMessage({ type: "stop" })).toBe(false);
    expect(isChannelMessage({ type: "song-position", sixteenths: 4 })).toBe(false);
  });
})
