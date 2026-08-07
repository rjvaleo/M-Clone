// Geometry for the scrolling MIDI readout.
//
// The readout used to be a log: rows appended as events arrived, scrolled by
// however tall the list had grown. That drifts from the music by construction,
// because the list only moves when something happens — a bar of rests and the
// display sits still while the transport keeps going.
//
// Here everything is placed by musical time instead. A note at beat B sits a
// fixed distance from the playhead, and the distance is a function of how far
// the transport has travelled. Nothing is appended and nothing scrolls; the
// whole surface is a projection of the beat clock, so the row under the line
// is the note being heard rather than a row kept in step with it.
//
// Pure: no clock, no DOM. The caller supplies elapsed time and the viewport.

/** One row of the grid, in CSS pixels. */
export const ROW_HEIGHT_PX = 14;

export type ScrollSpeed = {
  id: string;
  label: string;
  /**
   * Rows a single beat occupies.
   *
   * More rows per beat means a beat is drawn taller, so the surface travels
   * further per beat and reads as scrolling faster.
   */
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

/** How many beats the transport has covered. */
export function beatsElapsed(elapsedSec: number, tempo: number): number {
  if (!(elapsedSec > 0) || !(tempo > 0)) return 0;
  return elapsedSec * (tempo / 60);
}

/**
 * Where a beat sits on screen, given where the music has reached.
 *
 * Future beats are above the playhead and past ones below, so material
 * arrives at the top and falls through the line. The value is continuous in
 * `currentBeat`: between two whole beats the surface keeps moving, rather
 * than stepping once per row.
 */
export function yForBeat(
  beat: number,
  currentBeat: number,
  playheadY: number,
  speed: ScrollSpeed,
): number {
  return playheadY - (beat - currentBeat) * speed.rowsPerBeat * ROW_HEIGHT_PX;
}

/**
 * The span of beats the viewport can show, with a row of margin either side
 * so nothing appears or vanishes inside the visible area.
 */
export function visibleBeatRange(
  currentBeat: number,
  playheadY: number,
  viewportHeight: number,
  speed: ScrollSpeed,
): { from: number; to: number } {
  const beatsPerPx = 1 / (speed.rowsPerBeat * ROW_HEIGHT_PX);
  const margin = 1 / speed.rowsPerBeat;
  return {
    // Below the bottom edge: already played, still on screen.
    from: currentBeat - (viewportHeight - playheadY) * beatsPerPx - margin,
    // Above the top edge: yet to arrive.
    to: currentBeat + playheadY * beatsPerPx + margin,
  };
}
