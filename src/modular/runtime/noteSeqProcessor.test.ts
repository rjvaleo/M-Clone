import { describe, expect, it } from "vitest";
import { MessageBus, type StreamMessage } from "./messages";
import { ParameterBag, type ProcessWindow } from "./processors";
import { MNoteSeqProcessor } from "./mlabProcessors";
import { PPQN, TempoMap } from "./time";
import recorded from "../../engine/__fixtures__/plannerParity.json";
import type { PlannedNote } from "../../engine/planner";
import type { CyclicStep } from "../../engine/types";
import { distortClockTicks } from "../../engine/timemap";
import { defaultCells, defaultCellLengths } from "../mlab/noteSeq";
import { warpToTimeMap } from "../mlab/warpSteps";

const window = (startTick: number, endTick: number): ProcessWindow => ({
  startTick, endTick, tempo: new TempoMap(120, 0),
});

const collector = (bus: MessageBus, nodeId: string, portId: string) => {
  bus.connect(nodeId, portId, "collector", portId);
  return (): StreamMessage[] => {
    const { items, count } = bus.read("collector", portId);
    return items.slice(0, count).map((m) => ({ ...m }));
  };
};

type Fed = Partial<StreamMessage> & { port: string };

/** One NoteSeq, run window by window; `feeds` arrive on its inputs in the window they fall in. */
const noteSeq = (values: Record<string, unknown> = {}, reference?: Record<string, unknown>) => {
  const bus = new MessageBus();
  const parameters = new ParameterBag(values as never);
  const warp = reference ? new ParameterBag(reference as never) : undefined;
  const processor = new MNoteSeqProcessor({
    nodeId: "ns", bus, parameters, budget: 8192, seed: 7,
    reference: (port) => (port === "warp-in" ? () => warp : () => undefined),
  });
  const notes = collector(bus, "ns", "notes-out");
  const ports = ["sync-in", "trig-in", "interval-in", "velocity-in"];
  for (const port of ports) bus.connect("up", `up-${port}`, "ns", port);
  const run = (end: number, feeds: Fed[] = [], size = 240) => {
    const out: StreamMessage[] = [];
    for (let start = 0; start < end; start += size) {
      bus.beginNode("up", 1024);
      for (const fed of feeds.filter((f) => (f.atTick ?? 0) >= start && (f.atTick ?? 0) < start + size)) {
        const message = bus.acquire()!;
        const { port, ...fields } = fed;
        Object.assign(message, fields);
        bus.publish(`up-${port}`, message);
      }
      bus.beginNode("ns", 8192);
      processor.process(window(start, start + size));
      out.push(...notes());
      bus.endWindow();
    }
    return out.filter((m) => m.kind === "note-event");
  };
  return { processor, run, parameters };
};

/** M's default step: 1/8 at Rhythm level 2 (×1.5) is 720 ticks. */
const STEP = 720;
const RIFF = [60, 62, 64, 65, 67, 69, 71, 72];
const pitches = (notes: StreamMessage[]) => notes.map((n) => n.note);

const cellsWith = (kind: "accent" | "legato" | "rhythm", cells: CyclicStep[]) => {
  const all = defaultCells();
  all[kind][0] = [...cells, ...Array(16 - cells.length).fill(2)];
  const lengths = defaultCellLengths();
  lengths[kind][0] = cells.length;
  return { cells: all, "cycle-lengths": lengths };
};

describe("M NoteSeq plays M", () => {
  it("plays M's default document exactly as M Clone's own planner does", () => {
    const ticks = 8 * 2 * PPQN;
    const expected = ((recorded as Record<string, { notes: PlannedNote[] }>).plain.notes)
      .filter((note) => note.voice === 0 && note.atTick! < ticks - PPQN);
    expect(expected.length).toBeGreaterThan(15);
    const ons = noteSeq().run(ticks).filter((n) => n.atTick < ticks - PPQN);
    expect(ons.map((n) => [n.atTick, n.note, n.velocity, n.channel, n.durationTicks]))
      .toEqual(expected.map((n) => [n.atTick, n.note, n.velocity, n.channel, n.durationTicks]));
  });

  it("tags every note with its voice and sends on its channel", () => {
    const notes = noteSeq({ voice: 3, channel: 5 }).run(STEP * 2);
    expect(notes.every((n) => n.voice === 2 && n.channel === 5)).toBe(true);
  });

  it("a Rhythm cycle of its own length phases against the pattern", () => {
    const notes = noteSeq(cellsWith("rhythm", [1, 3, 1])).run(8000);
    // Level 1 = ×1, level 3 = ×2 at M's defaults: 480, 960, 480, ...
    expect(notes.slice(0, 5).map((n) => n.atTick)).toEqual([0, 480, 1440, 1920, 2400]);
  });
});

describe("Numerology's sequencer rows on M's pattern", () => {
  it("Skip removes a step from the sequence", () => {
    const skip = [false, true, false, true];
    expect(pitches(noteSeq({ skip }).run(STEP * 6))).toEqual([60, 64, 67, 69, 71, 72]);
  });

  it("Mute silences a step but keeps its time", () => {
    const notes = noteSeq({ mute: [false, true] }).run(STEP * 3);
    expect(notes.map((n) => [n.atTick, n.note])).toEqual([[0, 60], [STEP * 2, 64]]);
  });

  it("the start marker begins the sequence later", () => {
    expect(pitches(noteSeq({ start: 5 }).run(STEP * 4))).toEqual([69, 71, 72, 69]);
  });

  it("Dir: Rev and Alt1", () => {
    expect(pitches(noteSeq({ dir: "rev" }).run(STEP * 3))).toEqual([72, 71, 69]);
    const alt = pitches(noteSeq({ dir: "alt1" }).run(STEP * 10));
    expect(alt).toEqual([60, 62, 64, 65, 67, 69, 71, 72, 71, 69]);
  });

  it("Random Jump sends the sequence somewhere random, still inside it", () => {
    const notes = pitches(noteSeq({ "rnd-jump": Array(8).fill(1) }).run(STEP * 24));
    expect(notes).not.toEqual(Array.from({ length: 24 }, (_, i) => RIFF[i % 8]));
    expect(notes.every((n) => RIFF.includes(n!))).toBe(true);
  });

  it("the Velocity lane offsets each step", () => {
    const flat = noteSeq().run(STEP);
    const louder = noteSeq({ velocity: [0.5] }).run(STEP);
    expect(louder[0].velocity).toBeGreaterThan(flat[0].velocity);
  });

  it("Octave and Interval In move the pitch", () => {
    expect(pitches(noteSeq({ octave: 1 }).run(STEP))).toEqual([72]);
    expect(pitches(noteSeq().run(STEP, [{ port: "interval-in", kind: "control", atTick: 0, controlValue: 7 }]))).toEqual([67]);
  });
});

describe("M's randomness in the NoteSeq", () => {
  it("a cell range picks a random accent inside it each pass", () => {
    const notes = noteSeq(cellsWith("accent", [{ min: 1, max: 4 }])).run(STEP * 40);
    const velocities = new Set(notes.map((n) => n.velocity));
    expect(velocities.size).toBeGreaterThan(2);
  });

  it("all Scram plays the scrambled list, in its order", () => {
    const scrambled = [[72], [60], [69], [62], [71], [64], [67], [65]];
    const patterns = Array.from({ length: 6 }, (_, g) => g === 0
      ? { steps: RIFF.map((p) => [p]), scrambled, length: 8 }
      : { steps: Array.from({ length: 16 }, () => []), scrambled: Array.from({ length: 16 }, () => []), length: 16 });
    const notes = noteSeq({ patterns, "note-order": { original: 0, cyclic: 100, utterly: 0 } }).run(STEP * 8);
    expect(pitches(notes)).toEqual(scrambled.map((s) => s[0]));
  });

  it("all Rand plays the pattern's notes in no fixed order", () => {
    const notes = pitches(noteSeq({ "note-order": { original: 0, cyclic: 0, utterly: 100 } }).run(STEP * 24));
    expect(notes.every((n) => RIFF.includes(n!))).toBe(true);
    expect(notes).not.toEqual(Array.from({ length: 24 }, (_, i) => RIFF[i % 8]));
  });

  it("Density thins the notes out", () => {
    const all = noteSeq().run(STEP * 40).length;
    const thin = noteSeq({ density: 0.3 }).run(STEP * 40).length;
    expect(thin).toBeLessThan(all);
    expect(thin).toBeGreaterThan(0);
  });
});

describe("Run Mode, Sync and Warp In", () => {
  it("Manual with Play off is silent and waits", () => {
    expect(noteSeq({ "run-mode": "manual", play: false }).run(STEP * 4)).toHaveLength(0);
  });

  it("CV Trig: Step plays one step per gate on", () => {
    const gate = (atTick: number, on: number): Fed => ({ port: "trig-in", kind: "control", atTick, controlValue: on });
    const notes = noteSeq({ "run-mode": "cv-step" }).run(4000, [gate(100, 1), gate(200, 0), gate(1700, 1), gate(1800, 0), gate(3000, 1)]);
    expect(notes.map((n) => [n.atTick, n.note])).toEqual([[100, 60], [1700, 62], [3000, 64]]);
  });

  it("CV Trig: Gated plays only while the gate is open", () => {
    const notes = noteSeq({ "run-mode": "cv-gated" }).run(STEP * 6,
      [{ port: "trig-in", kind: "control", atTick: STEP * 2, controlValue: 1 }]);
    expect(notes[0].atTick).toBe(STEP * 2);
    expect(notes[0].note).toBe(60);
  });

  it("⏮ resets it from the face, and its status counts the bars for Auto Evolve", () => {
    const { processor, run } = noteSeq();
    run(STEP * 2);
    expect(processor.command("reset")).toBe(true);
    expect(processor.command("nonsense")).toBe(false);
    expect(processor.status().bar).toBe("0");
    run(PPQN * 9);
    expect(Number(processor.status().bar)).toBeGreaterThanOrEqual(1);
  });

  it("Sync In restarts the sequence", () => {
    const notes = noteSeq().run(STEP * 5, [{ port: "sync-in", kind: "reset", atTick: STEP * 3 }]);
    expect(pitches(notes)).toEqual([60, 62, 64, 60, 62]);
  });

  it("H.Sync restarts it every so many beats", () => {
    const notes = noteSeq({ "h-sync": "2" }).run(PPQN * 4);
    // Two beats is 1920 ticks; steps at 0, 720, 1440 then a restart at 1920.
    expect(notes.map((n) => [n.atTick, n.note])).toEqual([[0, 60], [720, 62], [1440, 64], [1920, 60], [2640, 62], [3360, 64]]);
  });

  it("lands each step on M Time Warp's curve when one is wired in", () => {
    const bank = { offsets: [0, 0.3, -0.2, 0.1], length: 4, denominator: 8 };
    const banks = Array.from({ length: 6 }, (_, i) => (i === 0 ? bank : { offsets: [0], length: 1, denominator: 8 }));
    const notes = noteSeq({}, { banks, position: 0, amount: 1 }).run(4000);
    const map = warpToTimeMap(bank);
    expect(notes.map((n) => n.atTick)).toEqual([0, 720, 1440, 2160, 2880, 3600]
      .map((tick) => Math.round(distortClockTicks(map, tick))).filter((tick) => tick < 4000));
  });
});
