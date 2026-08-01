import { describe, expect, it } from "vitest";
import {
  EDIT_MENU_ITEMS,
  FILE_MENU_ITEMS,
  MENU_TITLES,
  PATTERN_MENU_ITEMS,
  VARIABLES_MENU_ITEMS,
  WINDOWS_MENU_ITEMS,
  menuItemIds,
  menuItemLabels,
} from "./menus";

describe("the menu bar", () => {
  it("carries the six menus the manual documents", () => {
    // Chapters 19-22: File, Edit, then "The Variables, Pattern, and Windows
    // Menus", then Options.
    expect(MENU_TITLES).toEqual([
      "File", "Edit", "Variables", "Pattern", "Windows", "Options",
    ]);
  });
});

describe("the File menu", () => {
  it("lists every command in chapter 19, in order", () => {
    expect(menuItemLabels(FILE_MENU_ITEMS)).toEqual([
      "New",
      "Open…",
      "Open Midi File…",
      "Save",
      "Save As…",
      "Save Movie As Midi File…",
      "Save State As Startup",
      "Midi Assignment…",
      "Midi Setup…",
      "Quit",
    ]);
  });

  it("has no Close command", () => {
    // "In M, since you can only have one document open at a time, we dispensed
    //  with the Close command."
    expect(menuItemLabels(FILE_MENU_ITEMS)).not.toContain("Close");
  });
});

describe("the Edit menu", () => {
  it("lists every command in chapter 20, in order", () => {
    expect(menuItemLabels(EDIT_MENU_ITEMS)).toEqual([
      "Undo",
      "Redo",
      "Cut",
      "Copy",
      "Paste",
      "Paste Notes",
      "Insert Paste",
      "Clear",
      "Change to Rests",
      "Fill With Rests",
      "Erase Snapshot",
    ]);
  });

  it("keeps Insert Paste under one id, because its label changes with the selection", () => {
    // "If an entire Pattern is selected, this item is displayed as Paste At
    //  End. If a Region is selected, the command is displayed as Insert Paste."
    expect(menuItemIds(EDIT_MENU_ITEMS)).toContain("insertPaste");
    expect(menuItemIds(EDIT_MENU_ITEMS)).not.toContain("pasteAtEnd");
  });

  it("offers Redo alongside Undo", () => {
    // The original shipped Undo dead: "Undo is unimplemented." This build
    // restores it, so Redo belongs next to it.
    const ids = menuItemIds(EDIT_MENU_ITEMS);
    expect(ids.indexOf("redo")).toBe(ids.indexOf("undo") + 1);
  });
});

describe("the Pattern menu", () => {
  it("lists every command in chapter 21, in order", () => {
    expect(menuItemLabels(PATTERN_MENU_ITEMS)).toEqual([
      "Edit…",
      "Transpose Up Half-Step",
      "Transpose Up Octave",
      "Transpose Down Half-Step",
      "Transpose Down Octave",
      "ReScramble",
      "Original → Scrambled",
      "Swap Scrambled and Original",
      "Rotate Forward",
      "Rotate Backward",
      "Reverse Order",
      "Double with Rests",
      "Triple with Rests",
      "Eliminate Chords",
      "Eliminate Rests",
    ]);
  });

  it("opens with Edit..., which only opens the Pattern Editor", () => {
    // "The first command, Edit... merely opens the Pattern Editor."
    expect(menuItemIds(PATTERN_MENU_ITEMS)[0]).toBe("openPatternEditor");
  });
});

describe("the Variables menu", () => {
  it("opens an edit window for every Variable the manual documents", () => {
    expect(menuItemLabels(VARIABLES_MENU_ITEMS)).toEqual([
      "Pattern Group",
      "Note Density",
      "Velocity Range",
      "Note Order",
      "Transposition",
      "Time Distortion",
      "Rhythm",
      "Phrasing",
      "Accents",
      "Orchestration",
      "Sound Choice",
      "Voice 1 Color…",
      "Voice 2 Color…",
      "Voice 3 Color…",
      "Voice 4 Color…",
    ]);
  });

  it("ends with the four Voice colour commands", () => {
    // "Voice 1-4 Color... These commands bring up the standard Color Picker
    //  dialog to change the color that's used to display information for one
    //  of the four Voices."
    const ids = menuItemIds(VARIABLES_MENU_ITEMS).slice(-4);
    expect(ids).toEqual([
      "voiceColor.0", "voiceColor.1", "voiceColor.2", "voiceColor.3",
    ]);
  });
});

describe("the Windows menu", () => {
  it("starts with Close Edit Windows, ahead of the window list", () => {
    // "Close Edit Windows merely closes any edit windows you have open."
    expect(menuItemLabels(WINDOWS_MENU_ITEMS)).toEqual(["Close Edit Windows"]);
  });
});

describe("menu helpers", () => {
  it("skips separators when listing ids and labels", () => {
    const items = [
      { id: "a", label: "A" },
      "separator" as const,
      { id: "b", label: "B" },
    ];
    expect(menuItemIds(items)).toEqual(["a", "b"]);
    expect(menuItemLabels(items)).toEqual(["A", "B"]);
  });

  it("gives every item across every menu a unique id", () => {
    const all = [
      ...menuItemIds(FILE_MENU_ITEMS),
      ...menuItemIds(EDIT_MENU_ITEMS),
      ...menuItemIds(PATTERN_MENU_ITEMS),
      ...menuItemIds(VARIABLES_MENU_ITEMS),
      ...menuItemIds(WINDOWS_MENU_ITEMS),
    ];
    expect(new Set(all).size).toBe(all.length);
  });
});
