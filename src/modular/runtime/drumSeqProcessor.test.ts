import { describe, expect, it } from "vitest";
import { MessageBus, type StreamMessage } from "./messages";
import { PROCESSOR_FACTORIES, ParameterBag, type ProcessWindow } from "./processors";
import { DrumSeqProcessor } from "./drumSeqProcessor";
import { PPQN, TempoMap } from "./time";
import { defaultDrumRows, readDrumRows, type DrumRow } from "../drums/drumSeq";

const window = (startTick: number, endTick: number): ProcessWindow => ({ startTick, endTick, tempo: new TempoMap(120, 0) });

type Fed = { port: string; atTick: number };

/** One Drum Sequencer, run window by window; `feeds` arrive on its inputs in the window they fall in. */
const drumSeq = (values: Record<string, unknown> = {}, budget = 8192, seed = 7) => {
  const bus = new MessageBus();
  const parameters = new ParameterBag(values as never);
  const processor = new DrumSeqProcessor({ nodeId: "ds", bus, parameters, budget, seed });
  bus.connect("ds", "notes-out", "collector", "notes-out");
  bus.connect("up", "up-sync-in", "ds", "sync-in");
  const run = (from: number, to: number, size = 240, feeds: Fed[] = [], between?: (start: number) => void) => {
    const out: StreamMessage[] = [];
    for (let start = from; start < to; start += size) {
      between?.(start);
      const end = Math.min(to, start + size);
      bus.beginNode("up", 1024);
      for (const fed of feeds.filter((f) => f.atTick >= start && f.atTick < end)) {
        const message = bus.acquire()!;
        message.kind = "reset";
        message.atTick = fed.atTick;
        bus.publish(`up-${fed.port}`, message);
      }
      bus.beginNode("ds", budget);
      processor.process(window(start, end));
      const { items, count } = bus.read("collector", "notes-out");
      out.push(...items.slice(0, count).map((m) => ({ ...m })));
      bus.endWindow();
    }
    return out;
  };
  return { processor, parameters, run };
};

const BAR = 4 * PPQN;
const S = PPQN / 4;
const summary = (notes: StreamMessage[]) => notes.map((n) => [n.atTick, n.note, n.velocity]);
const only = (rows: DrumRow[], keep: number[]) => rows.map((row, i) => (keep.includes(i) ? row : { ...row, on: [] }));

describe("the Drum Sequencer's processor", () => {
  it("is what the runtime builds for m.drum-seq", () => {
    const bus = new MessageBus();
    const built = PROCESSOR_FACTORIES["m.drum-seq"]({ nodeId: "x", bus, parameters: new ParameterBag(), budget: 64, seed: 1 });
    expect(built).toBeInstanceOf(DrumSeqProcessor);
  });

  it("plays its default beat on its defaults: sixteenths, kick, snare and hats on note and in time", () => {
    const notes = drumSeq().run(0, BAR);
    expect(notes.every((n) => n.kind === "note-event" && n.durationTicks === S && n.channel === 10 && n.voice === 0)).toBe(true);
    expect(summary(notes)).toEqual([
      [0, 36, 100], [2 * S, 42, 100], [4 * S, 36, 100], [4 * S, 38, 100], [6 * S, 42, 100],
      [8 * S, 36, 100], [10 * S, 42, 100], [12 * S, 36, 100], [12 * S, 38, 100], [14 * S, 42, 100],
    ]);
    expect(notes.map((n) => n.stepIndex)).toEqual([0, 2, 4, 4, 6, 8, 10, 12, 12, 14]);
    expect(notes.every((n) => n.sourceNodeId === "ds")).toBe(true);
  });

  it("sends each step's velocity and the row's note, on the channel set", () => {
    const rows = only(defaultDrumRows(), [0]);
    rows[0] = { ...rows[0], note: 35, vel: [30, 0, 0, 0, 127] };
    const notes = drumSeq({ rows, channel: 3 }).run(0, BAR / 2);
    expect(notes.map((n) => [n.atTick, n.note, n.velocity, n.channel])).toEqual([[0, 35, 30, 3], [4 * S, 35, 127, 3]]);
  });

  it("plays the same however the timeline is cut into windows", () => {
    const rows = readDrumRows([{ on: Array(16).fill(true), prob: Array(16).fill(0.5), flam: [0.5, 0, 0.7], ratchet: [1, 3, 1, 2] }]);
    const values = { rows, swing: 62, tracks: 1 };
    const whole = summary(drumSeq(values).run(0, 4 * BAR, 4 * BAR));
    expect(whole.length).toBeGreaterThan(10);
    for (const size of [1, 97, 240, 1000]) expect(summary(drumSeq(values).run(0, 4 * BAR, size)), `windows of ${size}`).toEqual(whole);
  });

  it("swings every second step late", () => {
    const rows = only(defaultDrumRows(), [2]);
    rows[2] = { ...rows[2], on: [true, true] };
    const notes = drumSeq({ rows, swing: 75, length: 2 }).run(0, BAR / 2);
    expect(notes.map((n) => n.atTick)).toEqual([0, 360, 480, 840, 960, 1320, 1440, 1800]);
  });

  it("follows the rate", () => {
    const rows = only(defaultDrumRows(), [0]);
    rows[0] = { ...rows[0], on: [true, true, true, true] };
    expect(drumSeq({ rows, length: 4, "rate-num": 1, "rate-den": 8 }).run(0, BAR).map((n) => n.atTick)).toEqual([0, 480, 960, 1440, 1920, 2400, 2880, 3360]);
  });

  it("starts again from step 1 when Sync arrives, mid-window", () => {
    const rows = only(defaultDrumRows(), [0]);
    rows[0] = { ...rows[0], on: [true], length: 0 };
    const notes = drumSeq({ rows, length: 16 }).run(0, 2 * BAR, 480, [{ port: "sync-in", atTick: 1000 }]);
    expect(notes.map((n) => n.atTick)).toEqual([0, 1000, 1000 + BAR]);
  });

  it("starts again from step 1 at the next window when its own reset is pressed", () => {
    const rows = only(defaultDrumRows(), [0]);
    rows[0] = { ...rows[0], on: [true] };
    const seq = drumSeq({ rows });
    expect(seq.processor.command("reset")).toBe(true);
    expect(seq.processor.command("other")).toBe(false);
    // Pressed before the window at 1200 runs: the bar starts again there.
    seq.processor.command("reset");
    const notes = seq.run(0, 2 * BAR, 240, [], (start) => { if (start === 1200) seq.processor.command("reset"); });
    expect(notes.map((n) => n.atTick)).toEqual([0, 1200, 1200 + BAR]);
  });

  it("resets to a known position when the runtime asks", () => {
    const rows = only(defaultDrumRows(), [0]);
    rows[0] = { ...rows[0], on: [true] };
    const seq = drumSeq({ rows });
    seq.processor.reset(600);
    expect(seq.run(600, 600 + BAR).map((n) => n.atTick)).toEqual([600]);
  });

  it("stopped, it plays nothing but keeps its place, so it comes back in time", () => {
    const seq = drumSeq();
    const notes = seq.run(0, 2 * BAR, 240, [], (start) => seq.parameters.set("play", start < BAR / 2 || start >= BAR));
    const played = notes.map((n) => n.atTick);
    expect(played.filter((t) => t >= BAR / 2 && t < BAR)).toEqual([]);
    expect(played.filter((t) => t >= BAR)).toEqual(drumSeq().run(0, BAR).map((n) => n.atTick + BAR));
  });

  it("draws its chances from the project seed and its own Seed: the same for the same seeds", () => {
    const rows = readDrumRows([{ on: Array(16).fill(true), prob: Array(16).fill(0.5) }]);
    const ticks = (seed: number, own: number) => drumSeq({ rows, tracks: 1, seed: own }, 8192, seed).run(0, 4 * BAR).map((n) => n.atTick);
    expect(ticks(7, 0)).toEqual(ticks(7, 0));
    expect(ticks(7, 0)).not.toEqual(ticks(7, 1));
    expect(ticks(7, 0)).not.toEqual(ticks(8, 0));
  });

  it("sends a flam's grace note and every ratchet repeat", () => {
    const rows = readDrumRows([{ on: [false, true, true], flam: [0, 1], ratchet: [1, 1, 2], vel: [100, 80, 60] }]);
    const notes = drumSeq({ rows, tracks: 1, "flam-level": 0.5 }).run(0, BAR / 4);
    expect(notes.map((n) => [n.atTick, n.velocity, n.durationTicks])).toEqual([
      [S - S / 2, 40, S / 2], [S, 80, S], [2 * S, 60, S / 2], [2 * S + S / 2, 60, S / 2],
    ]);
  });

  it("stops quietly when the window's message budget runs out", () => {
    const rows = readDrumRows([{ on: Array(16).fill(true), ratchet: Array(16).fill(8) }]);
    const notes = drumSeq({ rows, tracks: 1 }, 5).run(0, BAR, BAR);
    expect(notes).toHaveLength(5);
  });

  it("reports where the pattern and every row are, for the playhead", () => {
    const rows = readDrumRows([{ on: [true], length: 3 }]);
    const seq = drumSeq({ rows, tracks: 2, length: 8 });
    expect(seq.processor.status()).toEqual({ step: "-1", rows: "[]" });
    seq.run(0, 5 * S, S);
    expect(seq.processor.status()).toEqual({ step: "4", rows: "[1,4]" });
    seq.run(5 * S, 10 * S, S);
    expect(seq.processor.status()).toEqual({ step: "1", rows: "[1,1]" });
  });

  it("reports no position while its rate makes no steps", () => {
    const seq = drumSeq({ "rate-den": 0 });
    expect(seq.run(0, BAR)).toEqual([]);
    expect(seq.processor.status()).toEqual({ step: "-1", rows: "[]" });
  });
});
