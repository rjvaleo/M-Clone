import { describe, expect, it } from "vitest";
import { applyPlayhead, playheadMarks } from "./playhead";

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

describe("moving the NoteSeq playhead", () => {
  // A stand-in column: its lane, its step and its classes.
  const column = (lane: string, step: number, classes: string[] = []) => {
    const list = new Set(classes);
    return {
      lane,
      step,
      list,
      classList: { add: (...names: string[]) => names.forEach((name) => list.add(name)), remove: (...names: string[]) => names.forEach((name) => list.delete(name)) },
    };
  };
  const rootOf = (columns: ReturnType<typeof column>[]) => ({
    querySelectorAll: (selector: string) => {
      if (selector === "[data-playhead].is-playing") return columns.filter((entry) => entry.list.has("is-playing"));
      const match = /^\[data-playhead="(.+)"\]\[data-step="(\d+)"\]$/.exec(selector)!;
      return columns.filter((entry) => entry.lane === match[1] && entry.step === Number(match[2]));
    },
  }) as unknown as ParentNode;

  it("takes every playhead class off the old marks and puts the new marks' classes on", () => {
    const old = column("notes", 3, ["is-playing", "is-utterly", "note"]);
    const step = column("step", 4);
    const notes = column("notes", 4);
    const accent = column("cell-accent", 1);
    const idle = column("cell-legato", 1);
    applyPlayhead(rootOf([old, step, notes, accent, idle]), playheadMarks({ index: 4, cells: [1], source: "utterly" }));
    expect([...old.list]).toEqual(["note"]);
    expect([...step.list]).toEqual(["is-playing"]);
    expect([...notes.list]).toEqual(["is-playing", "is-utterly"]);
    expect([...accent.list]).toEqual(["is-playing"]);
    expect([...idle.list]).toEqual([]);
  });
});
