import { describe, expect, it } from "vitest";
import { NOTE_WINDOW_LIMIT, closeNoteWindow, openNoteWindow, setNoteWindowVoice } from "./noteWindows";

describe("extra note windows", () => {
  it("opens a window on a chosen track, numbered after the first Pattern Editor", () => {
    const list = openNoteWindow([], 4);
    expect(list).toEqual([{ id: "pattern-editor-2", voice: 4 }]);
    expect(openNoteWindow(list, 1).map((w) => w.id)).toEqual(["pattern-editor-2", "pattern-editor-3"]);
  });

  it("reuses the lowest free number after one closes", () => {
    let list = openNoteWindow(openNoteWindow([], 0), 1);
    list = closeNoteWindow(list, "pattern-editor-2");
    expect(openNoteWindow(list, 2).map((w) => w.id)).toEqual(["pattern-editor-3", "pattern-editor-2"]);
  });

  it("stops at the limit, counting the first Pattern Editor", () => {
    let list: ReturnType<typeof openNoteWindow> = [];
    for (let i = 0; i < 10; i++) list = openNoteWindow(list, i % 4);
    expect(list).toHaveLength(NOTE_WINDOW_LIMIT - 1);
  });

  it("changes the track a window shows", () => {
    const list = setNoteWindowVoice(openNoteWindow([], 0), "pattern-editor-2", 3);
    expect(list[0].voice).toBe(3);
  });
});
