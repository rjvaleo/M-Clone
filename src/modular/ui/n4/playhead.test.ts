import { describe, expect, it } from "vitest";
import { playheadMarks } from "./playhead";

describe("the NoteSeq playhead", () => {
  it("lights the playing step on the step lanes, the note grid in its source's colour, and each cell lane's own cell", () => {
    expect(playheadMarks({ index: 5, cells: [2, -1, 0], source: "cyclic" })).toEqual([
      { lane: "step", step: 5, classes: ["is-playing"] },
      { lane: "notes", step: 5, classes: ["is-playing", "is-cyclic"] },
      { lane: "cell-accent", step: 2, classes: ["is-playing"] },
      { lane: "cell-rhythm", step: 0, classes: ["is-playing"] },
    ]);
  });

  it("lights nothing when stopped, and reads an empty source as the original order", () => {
    expect(playheadMarks({ index: -1, cells: [], source: "" })).toEqual([]);
    expect(playheadMarks({ index: 0, cells: [], source: "" })[1].classes).toEqual(["is-playing", "is-original"]);
  });
});
