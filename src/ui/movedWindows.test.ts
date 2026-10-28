import { describe, expect, it } from "vitest";
import { MOVED_WINDOWS_KEY, loadMovedWindows, moveWindowTo, saveMovedWindows, tidyWindows } from "./movedWindows";

const memory = (initial: Record<string, string> = {}) => {
  const data = { ...initial };
  return {
    data,
    getItem: (key: string) => data[key] ?? null,
    setItem: (key: string, value: string) => { data[key] = value; },
  };
};

describe("moved windows", () => {
  it("remembers where each window was dropped, in whole points, and nowhere negative", () => {
    const moved = moveWindowTo(moveWindowTo({}, "synth", { x: 812.6, y: 40.2 }), "midi", { x: -5, y: 9 });
    expect(moved).toEqual({ synth: { x: 813, y: 40 }, midi: { x: 0, y: 9 } });
  });

  it("leaves the map it was given alone", () => {
    const before = { synth: { x: 1, y: 2 } };
    moveWindowTo(before, "synth", { x: 30, y: 40 });
    expect(before).toEqual({ synth: { x: 1, y: 2 } });
  });

  it("Tidy forgets every moved window", () => {
    expect(tidyWindows()).toEqual({});
  });

  it("round-trips through storage", () => {
    const storage = memory();
    saveMovedWindows({ "pattern-editor-2": { x: 900, y: 12 } }, storage);
    expect(JSON.parse(storage.data[MOVED_WINDOWS_KEY])).toEqual({ "pattern-editor-2": { x: 900, y: 12 } });
    expect(loadMovedWindows(storage)).toEqual({ "pattern-editor-2": { x: 900, y: 12 } });
  });

  it("ignores missing, broken or malformed storage", () => {
    expect(loadMovedWindows(memory())).toEqual({});
    expect(loadMovedWindows(memory({ [MOVED_WINDOWS_KEY]: "{not json" }))).toEqual({});
    expect(loadMovedWindows(memory({ [MOVED_WINDOWS_KEY]: JSON.stringify({ a: { x: "1", y: 2 }, b: { x: 3, y: 4 } }) })))
      .toEqual({ b: { x: 3, y: 4 } });
    const throwing = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(loadMovedWindows(throwing)).toEqual({});
    expect(() => saveMovedWindows({ a: { x: 1, y: 1 } }, throwing)).not.toThrow();
  });
});
