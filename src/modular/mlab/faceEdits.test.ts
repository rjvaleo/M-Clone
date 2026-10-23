import { describe, expect, it } from "vitest";
import { defaultOrchestration, defaultPrograms } from "./model";
import { defaultNoteSeqPatterns } from "./noteSeq";
import { pitchRows, runPatternCommand, setPatternLength, toggleNote } from "./patternEdit";
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

  it("moves the pad, the armed variables and the clock's conducted tempo together", () => {
    const variables = toggleArrow(defaultVariables(), "density", "right");
    const pads = [{ x: 0, y: 0, glide: 0 }, { x: 0, y: 0, glide: 0 }, { x: 0, y: 0, glide: 0 }];
    const out = conductUpdates(pads, { "tempo-arrow": "x", "adj-range": 5 }, variables, 0.98, 0);
    expect((out.conductor.pads as { x: number }[])[0].x).toBe(0.98);
    expect(out.variables!.active.density).toBe(5);
    expect(out.clock).toEqual({ fine: 4.9 });
    expect(conductUpdates(pads, { "tempo-arrow": "off" }, null, 0.5, 0.5).clock).toBeUndefined();
  });
});
