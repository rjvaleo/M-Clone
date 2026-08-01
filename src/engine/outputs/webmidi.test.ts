import { describe, expect, it, vi } from "vitest";
import { MidiSink } from "./webmidi";

function output() {
  const calls: Array<{ data: number[]; at?: number }> = [];
  let clears = 0;
  return {
    port: {
      send(data: number[] | Uint8Array, at?: number) {
        calls.push({ data: Array.from(data), at });
      },
      clear() { clears += 1; },
    } as unknown as MIDIOutput,
    calls,
    clearCount: () => clears,
  };
}

describe("Web MIDI output", () => {
  it("uses one clock anchor for an entire synchronized batch", () => {
    const getOutputTimestamp = vi.fn(() => ({ contextTime: 2, performanceTime: 10_000 }));
    const sink = new MidiSink(
      { currentTime: 99, getOutputTimestamp } as unknown as AudioContext,
    );
    const target = output();
    sink.setOutput(target.port);
    target.calls.length = 0;

    sink.scheduleBatch([
      { type: "note-on", destination: "midi", voice: 0, noteId: 1,
        note: 60, velocity: 100, channel: 1, atSec: 2.5, atTick: 0, sequence: 0 },
      { type: "note-off", destination: "midi", voice: 0, noteId: 1,
        note: 60, velocity: 0, channel: 1, atSec: 2.75, atTick: 480, sequence: 1 },
      { type: "note-on", destination: "midi", voice: 1, noteId: 2,
        note: 64, velocity: 90, channel: 16, atSec: 2.5, atTick: 0, sequence: 2 },
      { type: "note-off", destination: "midi", voice: 1, noteId: 2,
        note: 64, velocity: 0, channel: 16, atSec: 3, atTick: 960, sequence: 3 },
    ]);

    expect(getOutputTimestamp).toHaveBeenCalledTimes(1);
    expect(target.calls.map((call) => call.at)).toEqual([10_500, 10_750, 10_500, 11_000]);
    expect(target.calls[0].data).toEqual([0x90, 60, 100]);
    expect(target.calls[2].data).toEqual([0x9f, 64, 90]);
  });

  it("clears queued events before panicking and changing ports", () => {
    const sink = new MidiSink({ currentTime: 0 } as unknown as AudioContext);
    const first = output();
    const second = output();
    sink.setOutput(first.port);
    first.calls.length = 0;

    sink.setOutput(second.port);

    expect(first.clearCount()).toBe(1);
    expect(first.calls).toHaveLength(16);
    expect(first.calls.every((call) => call.data[1] === 123)).toBe(true);
    expect(second.calls).toHaveLength(0);
  });

  it("cancels queued output independently of panic", () => {
    const sink = new MidiSink({ currentTime: 0 } as unknown as AudioContext);
    const target = output();
    sink.setOutput(target.port);
    target.calls.length = 0;
    sink.cancelScheduled();
    expect(target.clearCount()).toBe(1);
    expect(target.calls).toEqual([]);
  });
});
