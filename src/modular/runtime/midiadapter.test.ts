import { describe, expect, it } from "vitest";
import { MidiOutputAdapter, type MidiPort } from "./midiadapter";
import { PresentationClock, type AudioTimingSource } from "./skew";
import type { RuntimeEvent } from "./eventqueue";

class FakePort implements MidiPort {
  readonly id: string;
  readonly sent: { data: number[]; timestamp?: number }[] = [];
  cleared = 0;

  constructor(id: string) {
    this.id = id;
  }

  send(data: readonly number[] | Uint8Array, timestamp?: number): void {
    this.sent.push({ data: [...data], timestamp });
  }

  clear(): void {
    this.cleared += 1;
  }
}

const timing: AudioTimingSource = { currentTime: 0, outputLatency: 0 };

const adapter = (ports: FakePort[], latencyMs = 0) => {
  const clock = new PresentationClock(timing, () => 1_000);
  const midi = new MidiOutputAdapter({ id: "mo", clock, latencyMs });
  midi.setPorts(ports);
  return midi;
};

const event = (overrides: Partial<RuntimeEvent> = {}): RuntimeEvent => ({
  type: "note-on",
  atTick: 0,
  atSec: 0,
  sequence: 0,
  portId: "mo",
  channel: 1,
  note: 60,
  detuneCents: 0,
  velocity: 100,
  program: 0,
  controller: 0,
  value: 0,
  noteId: 0,
  ...overrides,
});

const noteMessages = (port: FakePort) =>
  port.sent.filter((message) => (message.data[0] & 0xf0) === 0x90 || (message.data[0] & 0xf0) === 0x80);

describe("MIDI output adapter", () => {
  it("sends note-on and note-off with a timestamp", () => {
    const port = new FakePort("device");
    const midi = adapter([port]);
    midi.send([event(), event({ type: "note-off", atSec: 0.5, note: 60, velocity: 0 })], 2);
    expect(port.sent[0].data).toEqual([0x90, 60, 100]);
    expect(port.sent[0].timestamp).toBeCloseTo(1_000, 6);
    expect(port.sent[1].data).toEqual([0x80, 60, 0]);
    expect(port.sent[1].timestamp).toBeCloseTo(1_500, 6);
  });

  it("maps a one-based channel onto the wire's zero-based nibble", () => {
    const port = new FakePort("device");
    const midi = adapter([port]);
    midi.send([event({ channel: 16 }), event({ channel: 1 })], 2);
    expect(port.sent[0].data[0]).toBe(0x9f);
    expect(port.sent[1].data[0]).toBe(0x90);
  });

  it("clamps an out-of-range channel rather than corrupting the status byte", () => {
    const port = new FakePort("device");
    const midi = adapter([port]);
    midi.send([event({ channel: 99 }), event({ channel: 0 })], 2);
    expect(port.sent[0].data[0]).toBe(0x9f);
    expect(port.sent[1].data[0]).toBe(0x90);
  });

  it("sends program and control changes", () => {
    const port = new FakePort("device");
    const midi = adapter([port]);
    midi.send([
      event({ type: "program-change", program: 42, channel: 2 }),
      event({ type: "control-change", controller: 7, value: 90, channel: 2 }),
    ], 2);
    expect(port.sent[0].data).toEqual([0xc1, 42]);
    expect(port.sent[1].data).toEqual([0xb1, 7, 90]);
  });

  it("applies the user latency trim on top of a correct alignment", () => {
    const port = new FakePort("device");
    const midi = adapter([port], 20);
    midi.send([event()], 1);
    expect(port.sent[0].timestamp).toBeCloseTo(1_020, 6);
    midi.setLatency(-5);
    port.sent.length = 0;
    midi.send([event()], 1);
    expect(port.sent[0].timestamp).toBeCloseTo(1_000, 6);
  });

  it("ignores events addressed to another MIDI Output node", () => {
    const port = new FakePort("device");
    const midi = adapter([port]);
    midi.send([event({ portId: "other" })], 1);
    expect(port.sent).toHaveLength(0);
  });

  it("only sends the live portion of a reused buffer", () => {
    const port = new FakePort("device");
    const midi = adapter([port]);
    midi.send([event(), event({ note: 64 }), event({ note: 67 })], 1);
    expect(noteMessages(port)).toHaveLength(1);
  });

  it("does nothing without a selected port", () => {
    const midi = adapter([]);
    expect(() => midi.send([event()], 1)).not.toThrow();
    expect(midi.soundingCount).toBe(0);
  });

  it("sends to every selected port", () => {
    const first = new FakePort("a");
    const second = new FakePort("b");
    const midi = adapter([first, second]);
    midi.send([event()], 1);
    expect(first.sent).toHaveLength(1);
    expect(second.sent).toHaveLength(1);
  });
});

describe("Panic and stuck notes", () => {
  it("releases exactly what is sounding, then resets controllers", () => {
    const port = new FakePort("device");
    const midi = adapter([port]);
    midi.send([event({ note: 60 }), event({ note: 64, channel: 3 })], 2);
    expect(midi.soundingCount).toBe(2);

    port.sent.length = 0;
    midi.panic();
    expect(port.cleared).toBe(1);
    // The two sounding notes are released explicitly, not left to CC 123.
    const releases = port.sent.filter((message) => (message.data[0] & 0xf0) === 0x80);
    expect(releases.map((message) => message.data[1]).sort()).toEqual([60, 64]);
    expect(releases.find((message) => message.data[1] === 64)?.data[0]).toBe(0x82);
    // And the controller reset still happens, for anything we cannot know about.
    const allNotesOff = port.sent.filter((message) => message.data[1] === 123);
    expect(allNotesOff).toHaveLength(16);
    expect(midi.soundingCount).toBe(0);
  });

  it("stops tracking a note once it has been released", () => {
    const port = new FakePort("device");
    const midi = adapter([port]);
    midi.send([event({ note: 60 })], 1);
    midi.send([event({ type: "note-off", note: 60, velocity: 0 })], 1);
    expect(midi.soundingCount).toBe(0);
    port.sent.length = 0;
    midi.panic();
    expect(port.sent.filter((message) => (message.data[0] & 0xf0) === 0x80)).toHaveLength(0);
  });

  it("counts overlapping retriggers so none is left held", () => {
    const port = new FakePort("device");
    const midi = adapter([port]);
    midi.send([event({ note: 60 }), event({ note: 60 })], 2);
    midi.send([event({ type: "note-off", note: 60, velocity: 0 })], 1);
    expect(midi.soundingCount).toBe(1);
  });

  it("silences a port that is being removed", () => {
    const port = new FakePort("device");
    const midi = adapter([port]);
    midi.send([event({ note: 60 })], 1);
    port.sent.length = 0;

    // The device is unplugged mid-phrase.
    midi.setPorts([]);
    expect(port.sent.filter((message) => (message.data[0] & 0xf0) === 0x80)).toHaveLength(1);
    expect(midi.soundingCount).toBe(0);
  });

  it("leaves a still-selected port alone when another changes", () => {
    const keep = new FakePort("keep");
    const drop = new FakePort("drop");
    const midi = adapter([keep, drop]);
    midi.send([event({ note: 60 })], 1);
    keep.sent.length = 0;
    drop.sent.length = 0;

    midi.setPorts([keep]);
    expect(keep.sent).toHaveLength(0);
    expect(drop.sent.length).toBeGreaterThan(0);
    // The note on the port that stayed is still tracked.
    expect(midi.soundingCount).toBe(1);
  });

  it("survives a browser without clear()", () => {
    const port = new FakePort("device");
    const withoutClear = {
      id: port.id,
      send: (data: readonly number[] | Uint8Array, timestamp?: number) => port.send(data, timestamp),
    };
    const midi = adapter([]);
    midi.setPorts([withoutClear]);
    midi.send([event({ note: 60 })], 1);
    expect(() => midi.panic()).not.toThrow();
  });

  it("releases everything on dispose", () => {
    const port = new FakePort("device");
    const midi = adapter([port]);
    midi.send([event({ note: 60 })], 1);
    midi.dispose();
    expect(midi.soundingCount).toBe(0);
    port.sent.length = 0;
    midi.send([event()], 1);
    expect(port.sent).toHaveLength(0);
  });
});
