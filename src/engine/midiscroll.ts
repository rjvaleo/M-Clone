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
