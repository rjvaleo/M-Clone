import { describe, it, expect } from "vitest";
import { planWindow, makeCursors, type VoiceCursor } from "./planner";
import { Rng } from "./rng";
import type { ProjectState, VoiceState, Pattern } from "./types";

function pattern(id: string, steps: number[][], outputLength?: number): Pattern {
  return {
    id,
    steps: steps.map((pitches) => ({ pitches })),
    outputLength: outputLength ?? steps.length,
  };
}

function voice(over: Partial<VoiceState> = {}): VoiceState {
  return {
    patternIndex: 0,
    playEnabled: true,
    transposition: 0,
    noteOrder: "original",
    density: 1,
    velocity: 100,
    timeBaseNumerator: 1,
    timeBaseDenominator: 4, // quarter notes
    legato: 0.9,
    channel: 1,
    program: 0,
    ...over,
  };
}

function project(patterns: Pattern[], voices: VoiceState[], over: Partial<ProjectState> = {}): ProjectState {
  return {
    tempo: 120,
    patterns,
    voices,
    root: 0,
    scale: "chromatic",
    scaleSnap: false,
    seed: 1,
    ...over,
  };
}

describe("planWindow — basic playback", () => {
  it("emits pattern notes at the right times", () => {
    const st = project([pattern("p", [[60], [64]])], [voice()]);
    const cursors = makeCursors(st, 0);
    const { notes } = planWindow(st, cursors, new Rng(1), 0, 1.0);
    expect(notes).toHaveLength(2);
    expect(notes[0]).toMatchObject({ note: 60, startSec: 0, channel: 1, velocity: 100 });
    expect(notes[1]).toMatchObject({ note: 64 });
    expect(notes[1].startSec).toBeCloseTo(0.5, 9);
    expect(notes[0].durationSec).toBeCloseTo(0.45, 9); // 0.5 * legato 0.9
  });

  it("applies per-voice transposition", () => {
    const st = project([pattern("p", [[60]])], [voice({ transposition: 12 })]);
    const { notes } = planWindow(st, makeCursors(st, 0), new Rng(1), 0, 0.5);
    expect(notes[0].note).toBe(72);
  });

  it("plays chords (multiple pitches per step)", () => {
    const st = project([pattern("p", [[60, 64, 67]])], [voice()]);
    const { notes } = planWindow(st, makeCursors(st, 0), new Rng(1), 0, 0.5);
    expect(notes.map((n) => n.note).sort((a, b) => a - b)).toEqual([60, 64, 67]);
  });

  it("skips rests (empty steps)", () => {
    const st = project([pattern("p", [[60], []])], [voice()]);
    const { notes } = planWindow(st, makeCursors(st, 0), new Rng(1), 0, 1.0);
    expect(notes).toHaveLength(1);
    expect(notes[0].note).toBe(60);
  });
});

describe("planWindow — density and enable", () => {
  it("emits nothing at density 0 but still advances the clock", () => {
    const st = project([pattern("p", [[60], [64]])], [voice({ density: 0 })]);
    const cursors = makeCursors(st, 0);
    const { notes, cursors: next } = planWindow(st, cursors, new Rng(1), 0, 1.0);
    expect(notes).toHaveLength(0);
    expect(next[0].nextTimeSec).toBeCloseTo(1.0, 9);
  });

  it("emits nothing for a disabled voice", () => {
    const st = project([pattern("p", [[60]])], [voice({ playEnabled: false })]);
    const { notes } = planWindow(st, makeCursors(st, 0), new Rng(1), 0, 1.0);
    expect(notes).toHaveLength(0);
  });

  it("keeps a disabled voice in tempo (advances its clock)", () => {
    const st = project([pattern("p", [[60]])], [voice({ playEnabled: false })]);
    const cursors = makeCursors(st, 0);
    const { cursors: next } = planWindow(st, cursors, new Rng(1), 0, 1.0);
    expect(next[0].nextTimeSec).toBeGreaterThanOrEqual(1.0);
  });
});

describe("planWindow — scale snapping", () => {
  it("snaps transposed notes into the key when enabled", () => {
    // C major, transpose +1 -> C# should snap to C (60)
    const st = project([pattern("p", [[60]])], [voice({ transposition: 1 })], {
      scale: "major",
      root: 0,
      scaleSnap: true,
    });
    const { notes } = planWindow(st, makeCursors(st, 0), new Rng(1), 0, 0.5);
    expect(notes[0].note).toBe(60);
  });
  it("leaves notes untouched when snapping is off", () => {
    const st = project([pattern("p", [[60]])], [voice({ transposition: 1 })], {
      scale: "major",
      scaleSnap: false,
    });
    const { notes } = planWindow(st, makeCursors(st, 0), new Rng(1), 0, 0.5);
    expect(notes[0].note).toBe(61);
  });
});

describe("planWindow — windowing continuity", () => {
  it("continues where the previous window left off", () => {
    const st = project([pattern("p", [[60], [64], [67], [72]])], [voice()]);
    let cursors = makeCursors(st, 0);
    const first = planWindow(st, cursors, new Rng(1), 0, 1.0);
    cursors = first.cursors;
    const second = planWindow(st, cursors, new Rng(1), 1.0, 2.0);
    expect(first.notes.map((n) => n.note)).toEqual([60, 64]);
    expect(second.notes.map((n) => n.note)).toEqual([67, 72]);
  });
});

describe("planWindow — edge cases", () => {
  it("does not loop forever on a zero-length pattern", () => {
    const st = project([pattern("p", [[60]], 0)], [voice()]);
    const cursors = makeCursors(st, 0);
    const { notes, cursors: next } = planWindow(st, cursors, new Rng(1), 0, 5.0);
    expect(notes).toHaveLength(0);
    expect(next[0].nextTimeSec).toBeGreaterThanOrEqual(5.0);
  });

  it("respects outputLength shorter than the pattern", () => {
    const st = project([pattern("p", [[60], [64], [67]], 2)], [voice()]);
    const { notes } = planWindow(st, makeCursors(st, 0), new Rng(1), 0, 1.5);
    // only first two steps cycle: 60, 64, 60
    expect(notes.map((n) => n.note)).toEqual([60, 64, 60]);
  });

  it("handles multiple voices independently", () => {
    const st = project(
      [pattern("a", [[60]]), pattern("b", [[48]])],
      [voice({ patternIndex: 0, channel: 1 }), voice({ patternIndex: 1, channel: 2 })],
    );
    const { notes } = planWindow(st, makeCursors(st, 0), new Rng(1), 0, 0.5);
    const byChannel = Object.fromEntries(notes.map((n) => [n.channel, n.note]));
    expect(byChannel).toEqual({ 1: 60, 2: 48 });
  });

  it("clamps notes to the MIDI range", () => {
    const st = project([pattern("p", [[120]])], [voice({ transposition: 24 })]);
    const { notes } = planWindow(st, makeCursors(st, 0), new Rng(1), 0, 0.5);
    expect(notes[0].note).toBe(127);
  });
});

describe("makeCursors", () => {
  it("creates one cursor per voice starting at the given time", () => {
    const st = project([pattern("p", [[60]])], [voice(), voice()]);
    const cursors: VoiceCursor[] = makeCursors(st, 2.5);
    expect(cursors).toHaveLength(2);
    expect(cursors[0].nextTimeSec).toBe(2.5);
    expect(cursors[0].order).toEqual({ pos: 0, last: -1 });
  });
});
