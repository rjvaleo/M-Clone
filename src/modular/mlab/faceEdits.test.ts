import { describe, expect, it } from "vitest";
import { defaultOrchestration, defaultPrograms } from "./model";
import { defaultNoteSeqPatterns } from "./noteSeq";
import { fitPitchRows, pitchRows, runPatternCommand, setPatternLength, toggleNote } from "./patternEdit";
import { parseProgram, setProgram, shownProgram, toggleChannel } from "./orchestraEdit";
import { batonFromPad, conductUpdates } from "./conductorPad";
import { defaultVariables, toggleArrow } from "./variables";

const riff = () => defaultNoteSeqPatterns()[0];

describe("pattern editing", () => {
  it("adds and removes a note on a step, keeping chords", () => {
    const once = toggleNote(riff(), 0, 67);
    expect(once.steps[0]).toEqual([...riff().steps[0], 67].sort((a, b) => a - b));
    expect(toggleNote(once, 0, 67).steps[0]).toEqual(riff().steps[0]);
  });

  it("keeps the scrambled copy a permutation of the played steps", () => {
    const edited = toggleNote(riff(), 3, 90);
    const played = edited.steps.slice(0, edited.length).map((s) => JSON.stringify(s)).sort();
    expect(edited.scrambled.slice(0, edited.length).map((s) => JSON.stringify(s)).sort()).toEqual(played);
  });

  it("lengthens a pattern with rests and never below one step", () => {
    expect(setPatternLength(riff(), 20).steps).toHaveLength(20);
    expect(setPatternLength(riff(), 0).length).toBe(1);
  });

  it("runs M's pattern commands on the played steps", () => {
    const pattern = { steps: [[60], [], [64]], scrambled: [[64], [], [60]], length: 3 };
    expect(runPatternCommand(pattern, "reverse").steps).toEqual([[64], [], [60]]);
    expect(runPatternCommand(pattern, "eliminate-rests")).toMatchObject({ steps: [[60], [64]], length: 2 });
    expect(runPatternCommand(pattern, "double").length).toBe(6);
    expect(runPatternCommand(pattern, "transpose-up-octave").steps[0]).toEqual([72]);
    expect(runPatternCommand(pattern, "swap").steps).toEqual([[64], [], [60]]);
    const rescrambled = runPatternCommand(pattern, "rescramble");
    expect(rescrambled.steps).toEqual(pattern.steps);
    expect(rescrambled.scrambled.map((s) => JSON.stringify(s)).sort()).toEqual(pattern.steps.map((s) => JSON.stringify(s)).sort());
  });

  it("shows two octaves around the notes, highest first", () => {
    const rows = pitchRows({ steps: [[60], [64]], scrambled: [], length: 2 });
    expect(rows).toHaveLength(24);
    expect(rows[0]).toBeGreaterThan(rows[23]);
    expect(rows).toContain(60);
    expect(rows).toContain(64);
  });
});

describe("the note grid fits the loop", () => {
  it("shows the played notes' range and two rows either side, highest first", () => {
    const rows = fitPitchRows(riff());
    expect(rows[0]).toBe(74);
    expect(rows[rows.length - 1]).toBe(58);
  });

  it("ignores notes past the end marker, and keeps at least an octave", () => {
    const rows = fitPitchRows({ steps: [[60], [61], [96]], scrambled: [[60], [61], [96]], length: 2 });
    expect(rows.includes(96)).toBe(false);
    expect(rows.length).toBeGreaterThanOrEqual(12);
  });

  it("never grows past two octaves", () => {
    expect(fitPitchRows({ steps: [[30], [90]], scrambled: [[30], [90]], length: 2 }).length).toBe(24);
  });
});

describe("orchestra editing", () => {
  it("adds and removes channels from a voice's orchestration", () => {
    const more = toggleChannel(defaultOrchestration(), 0, 0, 5);
    expect(more[0][0]).toEqual([1, 5]);
    expect(toggleChannel(more, 0, 0, 1)[0][0]).toEqual([5]);
  });

  it("shows and reads programs in the synth's numbering", () => {
    expect(shownProgram(0, "1-128")).toBe("1");
    expect(shownProgram(null, "1-128")).toBe("");
    expect(parseProgram("1", "1-128")).toBe(0);
    expect(parseProgram("", "0-127")).toBeNull();
    expect(setProgram(defaultPrograms(), 1, 3, 12)[1][3]).toBe(12);
  });
});

describe("the Triple XY's baton", () => {
  it("reads pad 1 (-1 to +1, up is positive) as M's baton (0 to 1, top left origin)", () => {
    expect(batonFromPad(-1, 1)).toEqual({ x: 0, y: 0 });
    expect(batonFromPad(1, -1)).toEqual({ x: 1, y: 1 });
    expect(batonFromPad(0, 0)).toEqual({ x: 0.5, y: 0.5 });
  });

  it("moves the pad, the armed variables and the conducted tempo together", () => {
    const variables = toggleArrow(defaultVariables(), "density", "right");
    const pads = [{ x: 0, y: 0, glide: 0 }, { x: 0, y: 0, glide: 0 }, { x: 0, y: 0, glide: 0 }];
    const out = conductUpdates(pads, { "tempo-arrow": "right", "tempo-low": 110, "tempo-high": 130 }, variables, 1, 0);
    expect((out.conductor.pads as { x: number }[])[0].x).toBe(1);
    expect(out.variables!.active.density).toBe(5);
    expect(out.conductor.tempo).toBe(130);
    expect(conductUpdates(pads, { "tempo-arrow": "off" }, null, 0.5, 0.5).conductor.tempo).toBeUndefined();
  });
});

describe("pattern editing: the rest of M's Pattern menu", () => {
  const pattern = { steps: [[60], [62, 65], [64]], scrambled: [[64], [60], [62, 65]], length: 3 };

  it("transposes by a semitone or an octave either way", () => {
    expect(runPatternCommand(pattern, "transpose-up-half").steps).toEqual([[61], [63, 66], [65]]);
    expect(runPatternCommand(pattern, "transpose-down-half").steps).toEqual([[59], [61, 64], [63]]);
    expect(runPatternCommand(pattern, "transpose-down-octave").steps).toEqual([[48], [50, 53], [52]]);
  });

  it("rotates the played steps either way", () => {
    expect(runPatternCommand(pattern, "rotate-forward").steps).toEqual([[62, 65], [64], [60]]);
    expect(runPatternCommand(pattern, "rotate-backward").steps).toEqual([[64], [60], [62, 65]]);
  });

  it("Triple puts two rests after every step; No chords splits each chord into steps", () => {
    expect(runPatternCommand(pattern, "triple")).toMatchObject({ steps: [[60], [], [], [62, 65], [], [], [64], [], []], length: 9 });
    expect(runPatternCommand(pattern, "eliminate-chords")).toMatchObject({ steps: [[60], [62], [65], [64]], length: 4 });
  });

  it("Original → Scrambled copies the played steps over the scrambled ones", () => {
    const copied = runPatternCommand(pattern, "original-to-scrambled");
    expect(copied.scrambled).toEqual(pattern.steps);
    expect(copied.steps).toEqual(pattern.steps);
  });

  it("a note past the end grows the pattern with rests up to it", () => {
    const grown = toggleNote({ steps: [[60]], scrambled: [[60]], length: 1 }, 3, 70);
    expect(grown.steps).toEqual([[60], [], [], [70]]);
    expect(grown.length).toBe(4);
  });

  it("an empty pattern centres its rows on middle C", () => {
    const empty = { steps: [[]], scrambled: [[]], length: 1 };
    expect(pitchRows(empty)).toEqual(Array.from({ length: 24 }, (_, i) => 72 - i));
    expect(fitPitchRows(empty)).toEqual(Array.from({ length: 12 }, (_, i) => 66 - i));
  });
});

describe("orchestra editing: edges", () => {
  it("adds a channel to a voice the matrix has no entry for yet", () => {
    expect(toggleChannel([[[1]]], 0, 3, 9)[0][3]).toEqual([9]);
  });

  it("shows and reads 0–127 numbering as stored", () => {
    expect(shownProgram(5, "0-127")).toBe("5");
    expect(parseProgram("5", "0-127")).toBe(5);
  });

  it("sends nothing for a program that is not a number or out of range", () => {
    expect(parseProgram("abc", "1-128")).toBeNull();
    expect(parseProgram("0", "1-128")).toBeNull();
    expect(parseProgram("129", "1-128")).toBeNull();
    expect(parseProgram("128", "1-128")).toBe(127);
  });
});

describe("the Triple XY's baton: a tempo range not yet set", () => {
  it("sweeps M's own 110–130 when the Conductor holds no range", () => {
    const pads = [{ x: 0, y: 0, glide: 0 }];
    expect(conductUpdates(pads, { "tempo-arrow": "right" }, null, 1, 0).conductor.tempo).toBe(130);
    expect(conductUpdates(pads, { "tempo-arrow": "right" }, null, -1, 0).conductor.tempo).toBe(110);
  });
});
