/**
 * The arithmetic behind the note window.
 *
 * A pattern's notes live anywhere in the MIDI range and a pattern can be longer
 * than sixteen steps, but a module face has room for about a dozen rows. The
 * roll therefore shows a *window* onto the whole grid rather than a fixed
 * octave: everything is rendered and scrolled to, so a note is never merely
 * invisible, and an overview above it draws the entire pattern at once with the
 * window's position marked on it.
 *
 * These are the pure parts — where the window sits, where it should open, and
 * where a click on the overview should send it. Kept out of the component so
 * they can be reasoned about without a DOM.
 */

/** Every MIDI pitch, because a note may be transposed to any of them. */
export const ROLL_PITCH_COUNT = 128;

/** The scroll geometry of the window, straight off the scrolling element. */
export type RollView = {
  scrollTop: number;
  scrollLeft: number;
  clientWidth: number;
  clientHeight: number;
  scrollWidth: number;
  scrollHeight: number;
};

export const EMPTY_VIEW: RollView = {
  scrollTop: 0, scrollLeft: 0,
  clientWidth: 0, clientHeight: 0,
  scrollWidth: 0, scrollHeight: 0,
};

const clamp = (value: number, low: number, high: number): number =>
  Math.max(low, Math.min(high, value));

/** A fraction that is safe when the element has not been measured yet. */
const ratio = (part: number, whole: number): number =>
  whole > 0 ? clamp(part / whole, 0, 1) : 0;

/**
 * Where the window sits over the whole roll, as fractions of each axis.
 *
 * The overview is drawn in note coordinates, so the caller multiplies these by
 * the step count and the pitch count. A window showing everything comes back as
 * the full unit square, which draws as an outline around the whole overview —
 * correct, and the reason there is no special case for it.
 */
export function viewWindow(view: RollView): {
  x: number; y: number; width: number; height: number;
} {
  return {
    x: ratio(view.scrollLeft, view.scrollWidth),
    y: ratio(view.scrollTop, view.scrollHeight),
    width: view.scrollWidth > 0 ? ratio(view.clientWidth, view.scrollWidth) : 1,
    height: view.scrollHeight > 0 ? ratio(view.clientHeight, view.scrollHeight) : 1,
  };
}

/**
 * The scroll offsets that centre the window on a point in the overview.
 *
 * Clicking the overview means "show me here", which is the centre of the window
 * rather than its corner — dragging it around then behaves like moving a
 * magnifier, and the clamp at each end stops the window sliding off the roll.
 */
export function centreOn(view: RollView, fx: number, fy: number): {
  scrollLeft: number; scrollTop: number;
} {
  return {
    scrollLeft: clamp(fx * view.scrollWidth - view.clientWidth / 2,
      0, Math.max(0, view.scrollWidth - view.clientWidth)),
    scrollTop: clamp(fy * view.scrollHeight - view.clientHeight / 2,
      0, Math.max(0, view.scrollHeight - view.clientHeight)),
  };
}

/** The pitches a pattern uses, lowest and highest, or null when it is empty. */
export function pitchSpan(steps: readonly (readonly number[])[]): {
  low: number; high: number;
} | null {
  let low = Infinity;
  let high = -Infinity;
  for (const step of steps) {
    for (const pitch of step) {
      if (pitch < low) low = pitch;
      if (pitch > high) high = pitch;
    }
  }
  return low <= high ? { low, high } : null;
}

/**
 * Where the window opens.
 *
 * Not the top of the range: pitch 127 is empty in every pattern anyone writes,
 * so opening there shows a blank grid and implies the pattern is empty. It
 * opens centred on the notes that exist, and on middle C when there are none.
 */
export function openingScrollTop(
  steps: readonly (readonly number[])[],
  view: RollView,
): number {
  const span = pitchSpan(steps);
  const centre = span ? (span.low + span.high) / 2 : 60;
  const rowHeight = view.scrollHeight / ROLL_PITCH_COUNT;
  const middle = (ROLL_PITCH_COUNT - 1 - centre + 0.5) * rowHeight;
  return clamp(middle - view.clientHeight / 2,
    0, Math.max(0, view.scrollHeight - view.clientHeight));
}
