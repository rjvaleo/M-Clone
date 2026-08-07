// Grid for the MIDI readout.
//
// The readout is a tracker, not a piano roll. A row is one subdivision of the
// beat — the speed setting decides how many — and *every* subdivision gets a
// row whether or not a note lands in it. Notes occupy slots on that grid, and
// the surface steps down one whole row at a time as the clock advances.
//
// Two earlier models were wrong in opposite ways. A log appended a row per
// event, so a bar of rests froze the display. Placing rows at their exact
// position in beat space then scrolled smoothly, but spaced the music by how
// dense it happened to be: a fast passage bunched, a slow one spread, and
// notes a few ticks apart drew on top of each other. A fixed grid of
// subdivisions has neither problem — spacing comes from the subdivision, so
// fast and slow passages read the same, two near-simultaneous notes share one
// row rather than overlapping, and the movement is a clock tick rather than a
// glide.
//
// Pure: no clock, no DOM.

import { PPQN } from "./planner";

/** One row of the grid, in CSS pixels. */
export const ROW_HEIGHT_PX = 14;

export type ScrollSpeed = {
  id: string;
  label: string;
  /** Rows one beat is divided into. */
  rowsPerBeat: number;
};

export const SCROLL_SPEEDS: readonly ScrollSpeed[] = [
  { id: "2/4", label: "2/4", rowsPerBeat: 2 },
  { id: "4/4", label: "4/4", rowsPerBeat: 4 },
  { id: "8/4", label: "8/4", rowsPerBeat: 8 },
];

const DEFAULT_SPEED = SCROLL_SPEEDS[1];

/** Look a speed up by id, defaulting rather than throwing. */
export function scrollSpeed(id: string): ScrollSpeed {
  return SCROLL_SPEEDS.find((speed) => speed.id === id) ?? DEFAULT_SPEED;
}

/** How many transport ticks one row covers. */
export function ticksPerRow(speed: ScrollSpeed): number {
  return PPQN / speed.rowsPerBeat;
}

/** How many beats the transport has covered. */
export function beatsElapsed(elapsedSec: number, tempo: number): number {
  if (!(elapsedSec > 0) || !(tempo > 0)) return 0;
  return elapsedSec * (tempo / 60);
}

/**
 * The row a tick belongs to.
 *
 * Anything between two subdivisions is floored into the row it falls in, so
 * two notes a few ticks apart share a row instead of drawing on top of one
 * another.
 */
export function rowOfTick(tick: number, speed: ScrollSpeed): number {
  return Math.floor(tick / ticksPerRow(speed));
}

/**
 * The rows to draw, newest first.
 *
 * New rows arrive at the top and push the rest down, so this counts backwards
 * from the current row into the past.
 *
 * It always fills the viewport, including before the music has got that far:
 * rows from before the start come back negative and draw as empty grid. A
 * short list would leave the screen half blank at the top of a run and grow
 * into place, which is the opposite of a display that persists.
 */
export function rowSpanForViewport(
  currentRow: number,
  viewportHeight: number,
  leadRows: number,
): number[] {
  const visible = Math.max(1, Math.ceil(viewportHeight / ROW_HEIGHT_PX));
  const top = currentRow + leadRows;
  const rows: number[] = [];
  for (let row = top; rows.length < visible; row--) rows.push(row);
  return rows;
}

/** The minimum a note needs to know to be placed on the grid. */
export type GridNote = {
  id: number;
  atTick: number;
  durationTicks?: number;
};

export type LaidNote<T extends GridNote> = T & {
  startRow: number;
  /** How many rows the note covers, so length reads as height. */
  spanRows: number;
  /** Which share of the row this note takes, when several start together. */
  subIndex: number;
  subCount: number;
};

/**
 * Fit one stream's notes to the grid.
 *
 * Two things the uniform grid cannot express on its own, and both matter:
 *
 * A note longer than a row spans the rows it fills, so a phrase's shape is
 * visible as height rather than only readable as a number.
 *
 * Notes arriving faster than the grid — a clock divider running at twice the
 * speed, or a chord — share a slot instead of overlapping it, each taking an
 * equal share of the row's height. Two fit in the space of one, three in
 * three, and the grid itself never changes pitch.
 *
 * A note is truncated where the next one begins, because legato over 100%
 * makes notes overlap in time and on a grid that would draw one block across
 * another. Notes that *start* together are a chord rather than a collision,
 * so they subdivide sideways and both keep their full length.
 */
export function layoutStreamNotes<T extends GridNote>(
  notes: readonly T[],
  speed: ScrollSpeed,
): LaidNote<T>[] {
  const perRow = ticksPerRow(speed);
  const ordered = [...notes].sort((a, b) => a.atTick - b.atTick || a.id - b.id);

  // How many notes share each starting row, for the sideways split.
  const shareCount = new Map<number, number>();
  for (const note of ordered) {
    const row = rowOfTick(note.atTick, speed);
    shareCount.set(row, (shareCount.get(row) ?? 0) + 1);
  }

  const seen = new Map<number, number>();
  return ordered.map((note, index) => {
    const startRow = rowOfTick(note.atTick, speed);

    // The next note that starts strictly later is the one this can run into.
    let limit = Infinity;
    for (let ahead = index + 1; ahead < ordered.length; ahead++) {
      const nextRow = rowOfTick(ordered[ahead].atTick, speed);
      if (nextRow > startRow) {
        limit = nextRow - startRow;
        break;
      }
    }

    // At least one row: shorter than the grid is not the same as invisible.
    const wanted = Math.max(1, Math.ceil((note.durationTicks ?? 0) / perRow));
    const subIndex = seen.get(startRow) ?? 0;
    seen.set(startRow, subIndex + 1);

    return {
      ...note,
      startRow,
      spanRows: Math.max(1, Math.min(wanted, limit)),
      subIndex,
      // Populated for every startRow in the pass above, so this always hits.
      subCount: shareCount.get(startRow)!,
    };
  });
}
