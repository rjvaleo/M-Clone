import { describe, expect, it } from "vitest";
import {
  APP_MENUS,
  CHECKABLE_ITEMS,
  menuIds,
  menuLabels,
  menuTitles,
} from "./appMenus";

describe("the menu bar", () => {
  it("groups the app's commands into four menus", () => {
    expect(menuTitles()).toEqual(["File", "Edit", "Patch", "View"]);
  });

  it("gives every item a unique id", () => {
    const all = APP_MENUS.flatMap((menu) => menuIds(menu.items));
    expect(new Set(all).size).toBe(all.length);
  });

  it("never opens or closes a menu with a separator", () => {
    // A rule the flat button bar never had to care about, and the fastest way
    // to end up with a stray rule floating at the top of a pull-down.
    for (const menu of APP_MENUS) {
      expect(menu.items[0]).not.toBe("separator");
      expect(menu.items[menu.items.length - 1]).not.toBe("separator");
    }
  });
});

describe("what each menu holds", () => {
  const items = (title: string) =>
    menuLabels(APP_MENUS.find((menu) => menu.title === title)!.items);

  it("puts documents and the stream templates under File", () => {
    expect(items("File")).toEqual([
      "New",
      "1 Stream",
      "4 Streams",
      "8 Streams",
      "16 Streams",
      "Open…",
      "Save",
      "Save with Samples",
    ]);
  });

  it("puts the history and the selection commands under Edit", () => {
    expect(items("Edit")).toEqual(["Undo", "Redo", "Duplicate", "Delete"]);
  });

  it("puts graph-level commands under Patch", () => {
    expect(items("Patch")).toEqual(["Add Module…", "Center Patch"]);
  });

  it("puts the view controls under View", () => {
    expect(items("View")).toEqual([
      "Zoom In", "Zoom Out", "Actual Size", "Hand Tool", "Sound Pool",
    ]);
  });

  it("leaves the audio engine out, because it stays a button", () => {
    // Starting and stopping the engine is the most-reached-for control in the
    // app. A one-click toggle does not belong two clicks deep in a menu.
    const all = APP_MENUS.flatMap((menu) => menuIds(menu.items));
    expect(all).not.toContain("audio");
  });
});

describe("nothing the old project bar could do was dropped", () => {
  it("carries every command the flat button row had", () => {
    // The bar this replaces, button by button. A menu that quietly loses a
    // command is worse than the row of twenty buttons it tidied up.
    const required = [
      "new", "template1", "template4", "template8", "template16",
      "open", "save", "savePack",
      "undo", "redo", "duplicate", "delete",
      "hand", "center", "sounds",
      "zoomIn", "zoomOut",
    ];
    const all = new Set(APP_MENUS.flatMap((menu) => menuIds(menu.items)));
    for (const id of required) {
      expect(all.has(id), `${id} has no home in the menu bar`).toBe(true);
    }
  });

  it("adds a module command the bar never had", () => {
    // Adding a module was right-click only, which is undiscoverable.
    const all = APP_MENUS.flatMap((menu) => menuIds(menu.items));
    expect(all).toContain("addModule");
  });
});

describe("toggles", () => {
  it("marks exactly the items that hold an on/off state", () => {
    expect([...CHECKABLE_ITEMS].sort()).toEqual(["hand", "sounds"]);
  });

  it("only marks ids that actually exist", () => {
    const all = new Set(APP_MENUS.flatMap((menu) => menuIds(menu.items)));
    for (const id of CHECKABLE_ITEMS) {
      expect(all.has(id), `${id} is checkable but not in any menu`).toBe(true);
    }
  });
});

describe("menu helpers", () => {
  it("skips separators when listing ids and labels", () => {
    const items = [
      { id: "a", label: "A" },
      "separator" as const,
      { id: "b", label: "B" },
    ];
    expect(menuIds(items)).toEqual(["a", "b"]);
    expect(menuLabels(items)).toEqual(["A", "B"]);
  });
});
