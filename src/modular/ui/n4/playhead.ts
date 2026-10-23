/**
 * The NoteSeq's playhead, drawn without re-rendering the face. The face's
 * columns carry `data-playhead` (which lane) and `data-step`; while it plays,
 * only these marks move, ten times a second, and the lanes themselves render
 * only when the pattern is edited.
 */

export type PlayheadState = { index: number; cells: readonly number[]; source: string };
export type PlayheadMark = { lane: string; step: number; classes: string[] };

/** Every class the playhead may put on a column, so the old mark can be taken off. */
export const PLAYHEAD_CLASSES = ["is-playing", "is-original", "is-cyclic", "is-utterly"];
const CELL_LANES = ["accent", "legato", "rhythm"] as const;

export function playheadMarks({ index, cells, source }: PlayheadState): PlayheadMark[] {
  const marks: PlayheadMark[] = [];
  if (index >= 0) {
    marks.push({ lane: "step", step: index, classes: ["is-playing"] });
    marks.push({ lane: "notes", step: index, classes: ["is-playing", `is-${source || "original"}`] });
  }
  CELL_LANES.forEach((kind, i) => {
    const cell = cells[i] ?? -1;
    if (cell >= 0) marks.push({ lane: `cell-${kind}`, step: cell, classes: ["is-playing"] });
  });
  return marks;
}

/** Moves the marks inside `root`: takes the old ones off, puts the new ones on. */
export function applyPlayhead(root: ParentNode, marks: readonly PlayheadMark[]): void {
  for (const element of root.querySelectorAll("[data-playhead].is-playing")) element.classList.remove(...PLAYHEAD_CLASSES);
  for (const mark of marks) {
    for (const element of root.querySelectorAll(`[data-playhead="${mark.lane}"][data-step="${mark.step}"]`)) {
      element.classList.add(...mark.classes);
    }
  }
}
