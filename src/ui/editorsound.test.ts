import { describe, expect, it } from "vitest";
import { editorSoundAllowed } from "./editorsound";

describe("Pattern Editor sound while playing", () => {
  it("requires both the local sound switch and the playback option", () => {
    expect(editorSoundAllowed(true, false, false)).toBe(true);
    expect(editorSoundAllowed(true, true, false)).toBe(false);
    expect(editorSoundAllowed(true, true, true)).toBe(true);
    expect(editorSoundAllowed(false, false, true)).toBe(false);
  });
});
