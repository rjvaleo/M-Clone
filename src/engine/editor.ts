// Pattern Editor constraint and scrolling rules.
//
// The Editing Grid looks like a free canvas but the manual fences it in
// carefully: Regions may only cover steps that exist, the MIDI Edit Range may
// reach exactly one step past the end, the Counter is trapped inside that
// range, and the horizontal scroll is measured against the Pattern's *maximum*
// size rather than its current length. Those rules are pure arithmetic, so
// they live here where they can be tested without a browser.

/** A block of consecutive steps. */
export type Region = { from: number; to: number };

const order = (r: Region): Region =>
  r.from <= r.to ? { from: r.from, to: r.to } : { from: r.to, to: r.from };

const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));

/**
 * Trim a dragged Region to the steps the Pattern actually holds — "you can
 * select only Regions that contain notes or rests" — or reject it outright if
 * it misses the Pattern completely.
 */
export function clampRegionToPattern(
  region: Region,
  stepCount: number,
): Region | null {
  if (stepCount <= 0) return null;
  const { from, to } = order(region);
  if (from > stepCount - 1 || to < 0) return null;
  return { from: Math.max(0, from), to: Math.min(stepCount - 1, to) };
}

/**
 * Fence the MIDI Edit Range. It may reach one step beyond the last existing
 * step — that is the insert point for new material — but never past the
 * Pattern Size Numerical.
 */
export function clampEditRange(
  range: Region,
  stepCount: number,
  maxSize: number,
): Region {
  const ceiling = Math.max(0, Math.min(stepCount, maxSize - 1));
  const { from, to } = order(range);
  return {
    from: clamp(from, 0, ceiling),
    to: clamp(to, 0, ceiling),
  };
}

/** The Counter moves only within the Range. */
export function clampCounter(counter: number, range: Region): number {
  const { from, to } = order(range);
  return clamp(counter, from, to);
}

/**
 * Keep `step` in view, scrolling by the smallest amount that does it — what
 * happens when the Counter is dragged past the edge of the Editing Grid.
 */
export function scrollToFollow(
  step: number,
  start: number,
  cols: number,
  maxStart: number,
): number {
  const wanted =
    step < start ? step : step > start + cols - 1 ? step - cols + 1 : start;
  return clamp(wanted, 0, maxStart);
}

/** Clicking the scroll bar's dotted area pages by one full Editing Grid. */
export function pageStart(
  start: number,
  cols: number,
  direction: number,
  maxStart: number,
): number {
  return clamp(start + direction * cols, 0, maxStart);
}

/**
 * Where the Thumb puts you: "a location which is proportional to the maximum
 * size of the Pattern", not to how many steps it currently holds.
 */
export function thumbStart(
  fraction: number,
  maxSize: number,
  cols: number,
): number {
  const maxStart = Math.max(0, maxSize - cols);
  return clamp(Math.round(clamp(fraction, 0, 1) * maxSize), 0, maxStart);
}
