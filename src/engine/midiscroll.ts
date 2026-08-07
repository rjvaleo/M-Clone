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
  /** How many of this lane's rows the note covers, so length reads as height. */
  spanRows: number;
  /** Kept for the renderer; a note always takes its whole lane now. */
  subIndex: number;
  subCount: number;
};

/** Rows a lane fits in a beat, at most and at least, whatever it asks for. */
const MAX_LANE_ROWS = 64;
const MIN_LANE_ROWS = 1;

/**
 * A lane's own row rate.
 *
 * Lanes share a clock but not a speed. The Rhythm variable is the voice's
 * clock divider — the planner scales both a step's length and its advance by
 * it — so a voice at 0.5 takes steps twice as often. Dividing the base rate by
 * it keeps one step to a row in every lane, which is what lets a fast lane
 * push its earlier notes down sooner rather than squeezing them sideways.
 *
 * Clamped, because a divider near zero would ask for thousands of rows a beat
 * and lock the display up drawing them.
 */
export function laneRowsPerBeat(speed: ScrollSpeed, rhythm: number | undefined): number {
  if (!rhythm || !(rhythm > 0)) return speed.rowsPerBeat;
  return Math.min(MAX_LANE_ROWS, Math.max(MIN_LANE_ROWS, speed.rowsPerBeat / rhythm));
}

/**
 * Fit one lane's notes to that lane's rows.
 *
 * Every note takes a whole row. Notes are never narrowed to share one: when a
 * voice runs fast its lane simply has more rows, so the notes that used to
 * collide get a row each and the earlier ones are pushed down sooner. That is
 * the difference between a display that speeds up and one that shrinks.
 *
 * A note spans the rows its length covers, so a phrase's shape reads as height
 * rather than as a number. It is truncated where the next note begins, because
 * legato over 100% overlaps notes in time and on a grid that would draw one
 * block across another.
 */
export function layoutStreamNotes<T extends GridNote>(
  notes: readonly T[],
  speed: ScrollSpeed,
  rhythm: number | undefined,
): LaidNote<T>[] {
  const rowsPerBeat = laneRowsPerBeat(speed, rhythm);
  const perRow = PPQN / rowsPerBeat;
  const rowOf = (tick: number) => Math.floor(tick / perRow);
  const ordered = [...notes].sort((a, b) => a.atTick - b.atTick || a.id - b.id);

  return ordered.map((note, index) => {
    const startRow = rowOf(note.atTick);

    // The next note that starts on a later row is the one this can run into.
    let limit = Infinity;
    for (let ahead = index + 1; ahead < ordered.length; ahead++) {
      const nextRow = rowOf(ordered[ahead].atTick);
      if (nextRow > startRow) {
        limit = nextRow - startRow;
        break;
      }
    }

    // At least one row: shorter than the grid is not the same as invisible.
    const wanted = Math.max(1, Math.ceil((note.durationTicks ?? 0) / perRow));
    return {
      ...note,
      startRow,
      spanRows: Math.max(1, Math.min(wanted, limit)),
      subIndex: 0,
      subCount: 1,
    };
  });
}
