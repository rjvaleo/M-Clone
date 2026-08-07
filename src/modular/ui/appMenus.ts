// The menu bar's contents.
//
// This replaces a row of about twenty buttons that had grown one command at a
// time and read as a list of everything the app could do, in the order the
// features were built. The commands are the same; what changes is that they
// are now grouped by what they act on — the document, the history, the graph,
// the view — so a command can be found by reasoning about it rather than by
// scanning.
//
// Starting and stopping the audio engine is deliberately *not* here. It is the
// control reached for most often, and a one-click toggle does not belong two
// clicks deep; it stays a button in the bar.
//
// Structure lives here and behaviour lives in ModularApp: the bar looks each
// id up in a handler table, and an id with no handler renders disabled. That
// keeps the shape of the menus testable without dragging React in, and makes
// "this command exists but does nothing yet" a visible state rather than a
// silent omission.

export type MenuItemSpec =
  | "separator"
  | { id: string; label: string; hint?: string };

export type AppMenu = { title: string; items: MenuItemSpec[] };

export const APP_MENUS: AppMenu[] = [
  {
    title: "File",
    items: [
      { id: "new", label: "New", hint: "Start again from the starter patch" },
      "separator",
      // The four templates are one decision taken four ways, so they sit
      // together rather than being spelled out across the top of the screen.
      { id: "template1", label: "1 Stream", hint: "Replace the patch with a one-stream template" },
      { id: "template4", label: "4 Streams", hint: "Replace the patch with a four-stream template" },
      { id: "template8", label: "8 Streams", hint: "Replace the patch with an eight-stream template" },
      { id: "template16", label: "16 Streams", hint: "Replace the patch with a sixteen-stream template" },
      "separator",
      { id: "open", label: "Open…", hint: "Open a saved project" },
      { id: "save", label: "Save", hint: "Save the project manifest" },
      { id: "savePack", label: "Save with Samples", hint: "Save the project with its samples inside it" },
    ],
  },
  {
    title: "Edit",
    items: [
      { id: "undo", label: "Undo" },
      { id: "redo", label: "Redo" },
      "separator",
      { id: "duplicate", label: "Duplicate", hint: "Copy the selected module" },
      { id: "delete", label: "Delete", hint: "Remove the selected module or cable" },
    ],
  },
  {
    title: "Patch",
    items: [
      // Adding a module used to be right-click only, which is the least
      // discoverable place a primary action can live.
      { id: "addModule", label: "Add Module…", hint: "Add a module at the centre of the view" },
      "separator",
      { id: "center", label: "Center Patch", hint: "Bring the view back to the patch" },
    ],
  },
  {
    title: "View",
    items: [
      { id: "zoomIn", label: "Zoom In" },
      { id: "zoomOut", label: "Zoom Out" },
      { id: "zoomReset", label: "Actual Size" },
      "separator",
      { id: "hand", label: "Hand Tool", hint: "Drag the canvas instead of selecting" },
      { id: "sounds", label: "Sound Pool", hint: "Show the sample pool" },
    ],
  },
];

/**
 * Items that show a check mark rather than simply firing.
 *
 * Kept as a set beside the menus rather than a flag on each item so the tests
 * can assert it against reality in both directions: every toggle is marked,
 * and nothing is marked that is not in a menu.
 */
export const CHECKABLE_ITEMS: ReadonlySet<string> = new Set([
  "hand", "sounds",
]);

export const menuTitles = (): string[] => APP_MENUS.map((menu) => menu.title);

export function menuIds(items: readonly MenuItemSpec[]): string[] {
  return items.flatMap((item) => (item === "separator" ? [] : [item.id]));
}

export function menuLabels(items: readonly MenuItemSpec[]): string[] {
  return items.flatMap((item) => (item === "separator" ? [] : [item.label]));
}
