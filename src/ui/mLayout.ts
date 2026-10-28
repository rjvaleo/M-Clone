// The M node's layout: every M window open at once, each at M's own size.
// M's main screen keeps M's own places. Every editor sits in a column under
// the window it edits, at that column's width, so edges line up:
//
//   under Variables          the variable editors, in Variables' row order
//   under Cyclic Variables   the Cyclic Editor, then Orchestration, out to
//                            Snapshot's right edge
//   right of Snapshot        the Pattern Editor (and any extra note windows
//                            beside it), then Midi View, Synth, Midi Assignment
//
// A closed window takes no space: the rest of its column closes up. The
// windows usually closed sit at the ends of their columns. Only the Pattern
// Editor is resized by hand; whatever grows pushes its column down.
//
// Any window can be dragged out of this arrangement. A moved window sits
// exactly where it was dropped and leaves its column, which closes up; it is
// never pushed and pushes nothing, so it may overlap. Tidy forgets the moves.
//
// Coordinates are the workspace's logical pixels, which are M's points.

import { CLASSIC_WINDOW_SIZES, type ClassicWindowId } from "./classicWindows";

export type Rect = { x: number; y: number; width: number; height: number };
export type Point = { x: number; y: number };
type Size = { width: number; height: number };

/** Title bar plus window borders, above each window's original body. */
export const M_TITLE_HEIGHT = 18;

export const M_WINDOW_IDS = [
  "patterns", "untitled", "snapshot", "variables", "cyclic", "midi",
  "midi-view", "midi-assignment", "synth", "pattern-editor", "cyclic-editor",
  "variable-editor-density", "variable-editor-velocityRange", "variable-editor-noteOrderMix",
  "variable-editor-transposition", "variable-editor-timeDistort", "variable-editor-outputChannels",
] as const;
export type MWindowId = (typeof M_WINDOW_IDS)[number];

/** The side column's width: the Pattern Editor's default, which is 42 steps wide. */
export const M_SIDE_WIDTH = 459;

const BODY: Record<MWindowId, ClassicWindowId | Size> = {
  patterns: "patterns",
  untitled: "conducting",
  snapshot: "snapshot",
  variables: "variables",
  cyclic: "cyclicVariables",
  midi: "midi",
  "midi-view": { width: M_SIDE_WIDTH, height: 233 },
  "midi-assignment": "midiAssignment",
  synth: { width: M_SIDE_WIDTH, height: 81 },
  "pattern-editor": { width: M_SIDE_WIDTH, height: 525 },
  "cyclic-editor": "cyclicEditor",
  "variable-editor-density": "noteDensity",
  "variable-editor-velocityRange": "velocityRange",
  "variable-editor-noteOrderMix": "noteOrder",
  "variable-editor-transposition": "transposition",
  "variable-editor-timeDistort": "timeDistortion",
  "variable-editor-outputChannels": "orchestration",
};

export const M_MAIN_WINDOW_IDS = ["patterns", "untitled", "snapshot", "variables", "cyclic", "midi"] as const;

/** M's main screen, in M's own places. */
export const M_LAYOUT_ORIGINS: Record<(typeof M_MAIN_WINDOW_IDS)[number], { x: number; y: number }> = {
  patterns: { x: 3, y: 1 },
  untitled: { x: 232, y: 1 },
  snapshot: { x: 464, y: 1 },
  variables: { x: 3, y: 130 },
  cyclic: { x: 232, y: 130 },
  midi: { x: 3, y: 312 },
};

const VARIABLE_COLUMN: MWindowId[] = [
  "variable-editor-density", "variable-editor-velocityRange", "variable-editor-noteOrderMix",
  "variable-editor-transposition", "variable-editor-timeDistort",
];
const CYCLIC_COLUMN: MWindowId[] = ["cyclic-editor", "variable-editor-outputChannels"];
const SIDE_COLUMN: MWindowId[] = ["midi-view", "synth", "midi-assignment"];

/** Windows drawn at their column's width rather than their own. */
export const M_FITTED_WINDOW_IDS: ReadonlySet<string> =
  new Set([...VARIABLE_COLUMN, ...CYCLIC_COLUMN, ...SIDE_COLUMN]);

const GAP = 8;

export function defaultMWindowSize(id: MWindowId): Size {
  const body = BODY[id];
  const size = typeof body === "string" ? CLASSIC_WINDOW_SIZES[body] : body;
  return { width: size.width, height: size.height + M_TITLE_HEIGHT };
}

const hits = (a: Rect, b: Rect) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/**
 * Lay out every M window. `measured` holds the sizes windows actually have
 * (the Pattern Editor after a resize, or a window drawn taller than M's
 * default); anything not measured uses M's size. `open` lists the windows on
 * screen; when it is left out, every window is. Closed windows still get a
 * place, where they would open, but take no space. `moved` holds where windows
 * were dragged to by hand.
 */
export function layoutMNode(
  measured: Partial<Record<string, Size>>,
  extraNoteWindows: readonly string[] = [],
  open?: ReadonlySet<string>,
  moved: Readonly<Record<string, Point>> = {},
): Record<MWindowId, Rect> & Record<string, Rect> {
  // A window takes space in the arrangement only while it is open and has not been moved.
  const isOpen = (id: string) => (!open || open.has(id)) && !moved[id];
  const size = (id: string): Size =>
    measured[id] ?? defaultMWindowSize((id.startsWith("pattern-editor") ? "pattern-editor" : id) as MWindowId);
  const rects = {} as Record<string, Rect>;
  for (const id of M_MAIN_WINDOW_IDS) rects[id] = { ...M_LAYOUT_ORIGINS[id], ...size(id) };
  const main = M_MAIN_WINDOW_IDS.filter(isOpen).map((id) => rects[id]);
  /** Just below the lowest open main window that spans any of x0..x1. */
  const below = (x0: number, x1: number) =>
    Math.max(0, ...main.filter((r) => r.x < x1 && r.x + r.width > x0).map((r) => r.y + r.height)) + GAP;
  const stack = (ids: readonly string[], x: number, width: number, top: number) => {
    let y = top;
    for (const id of ids) {
      rects[id] = { x, y, width, height: size(id).height };
      if (isOpen(id)) y += rects[id].height + GAP;
    }
  };

  const { variables, cyclic, snapshot } = rects;
  stack(VARIABLE_COLUMN, variables.x, variables.width, below(variables.x, variables.x + variables.width));
  const cyclicWidth = snapshot.x + snapshot.width - cyclic.x;
  stack(CYCLIC_COLUMN, cyclic.x, cyclicWidth, below(cyclic.x, cyclic.x + cyclicWidth));

  // The note windows lead the side column, side by side; the rest go below the tallest.
  const sideX = Math.max(...main.map((r) => r.x + r.width)) + GAP;
  const top = M_LAYOUT_ORIGINS.patterns.y;
  let nextX = sideX, noteHeight = 0;
  for (const id of ["pattern-editor", ...extraNoteWindows]) {
    rects[id] = { x: nextX, y: top, ...size(id) };
    if (!isOpen(id)) continue;
    nextX += rects[id].width + GAP;
    noteHeight = Math.max(noteHeight, rects[id].height);
  }
  stack(SIDE_COLUMN, sideX, M_SIDE_WIDTH, noteHeight ? top + noteHeight + GAP : top);

  for (const [id, at] of Object.entries(moved)) if (rects[id]) rects[id] = { ...rects[id], ...at };

  // A safety net for sizes no column expects: the lower of an overlapping pair moves down.
  const ids = [...M_WINDOW_IDS, ...extraNoteWindows].filter(isOpen);
  for (let pass = 0; pass < 64; pass++) {
    let moved = false;
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
      const a = rects[ids[i]], b = rects[ids[j]];
      if (!hits(a, b)) continue;
      const [upper, lower] = a.y <= b.y ? [a, b] : [b, a];
      lower.y = upper.y + upper.height + GAP;
      moved = true;
    }
    if (!moved) break;
  }
  return rects as Record<MWindowId, Rect> & Record<string, Rect>;
}
