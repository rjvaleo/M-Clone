// The Time Distortion Map — M's re-mapping of clock time onto real time.
//
// From the manual: "The horizontal axis is Real Time. The vertical axis is
// Clock Time. Real Time refers to how much time has actually gone by. Clock
// Time refers to how many ticks of M's clock have occurred." A neutral map is
// the straight diagonal, where ticks take a consistent amount of real time.
//
// Both axes are normalised 0..1 over one cycle of the map, and the corners
// (0,0) and (1,1) are implicit and immovable. That is what makes the map
// time-preserving: however hard the middle is bent, a cycle still takes exactly
// as long as it would have — "the same amount of time will go by when you use a
// Time Distortion Map, it'll just go by rather, well, distorted."
//
// Pure and fully tested: no audio, no DOM.

export type TimeMapPoint = { x: number; y: number };

export type TimeMap = {
  /** Breakpoints inside the unit square, ordered by x. Corners are implicit. */
  points: TimeMapPoint[];
  /** How many units of `denominator` one cycle of the map covers. */
  length: number;
  /** The unit as a note division: 1 = whole, 4 = quarter, 8 = eighth. */
  denominator: number;
};

/** Note values offered by the right-hand Length numerical. */
export const TIME_MAP_DENOMINATORS = [1, 2, 4, 8, 16] as const;
export const MAX_TIME_MAP_LENGTH = 64;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** The default, "ineffectual" map: a straight diagonal over one quarter note. */
export function neutralTimeMap(): TimeMap {
  return { points: [], length: 1, denominator: 4 };
}

export function cloneTimeMap(map: TimeMap): TimeMap {
  return { ...map, points: map.points.map((p) => ({ ...p })) };
}

/** True when the map leaves time alone, so callers can skip the arithmetic. */
export function isNeutralTimeMap(map: TimeMap): boolean {
  return map.points.every((p) => Math.abs(p.x - p.y) < 1e-9);
}

/** The drawable polyline: the breakpoints between the two fixed corners. */
export function timeMapPolyline(map: TimeMap): TimeMapPoint[] {
  return [{ x: 0, y: 0 }, ...map.points, { x: 1, y: 1 }];
}

/**
 * Put the breakpoints in order and force both axes to run forwards. Neither
 * real time nor clock time can go backwards, so a point that would double back
 * is pinned to its predecessor instead of being dropped.
 */
export function normalizeTimeMap(map: TimeMap): TimeMap {
  let prevX = 0;
  let prevY = 0;
  const points = map.points
    .map((p) => ({ x: clamp01(p.x), y: clamp01(p.y) }))
    .sort((a, b) => a.x - b.x)
    .map((p) => {
      const next = { x: Math.max(p.x, prevX), y: Math.max(p.y, prevY) };
      prevX = next.x;
      prevY = next.y;
      return next;
    });
  return { ...map, points };
}

/** Interpolate a monotonic polyline, reading `from` and returning `to`. */
function interpolate(
  polyline: TimeMapPoint[],
  value: number,
  from: "x" | "y",
): number {
  const to = from === "x" ? "y" : "x";
  const v = clamp01(value);
  // Walk to the first segment that reaches `v`. Taking the first rather than
  // the last matters where the graph jumps: the answer is the value just
  // before the jump, not just after.
  let i = 0;
  while (i < polyline.length - 2 && v > polyline[i + 1][from]) i++;
  const a = polyline[i];
  const b = polyline[i + 1];
  const span = b[from] - a[from];
  // A zero-width span is a breakpoint sitting on the axis we're reading from,
  // so that axis never advances across the segment and there is nothing to
  // interpolate — the value at the near end is the answer.
  if (span === 0) return a[to];
  return a[to] + ((v - a[from]) / span) * (b[to] - a[to]);
}

/** Real Time → Clock Time. This is the curve as drawn. */
export function realToClock(map: TimeMap, realPhase: number): number {
  return interpolate(timeMapPolyline(normalizeTimeMap(map)), realPhase, "x");
}

/**
 * Clock Time → Real Time: the inverse, and the direction the planner needs.
 * The sequencer knows which clock tick an event falls on and has to ask when
 * that actually sounds.
 */
export function clockToReal(map: TimeMap, clockPhase: number): number {
  return interpolate(timeMapPolyline(normalizeTimeMap(map)), clockPhase, "y");
}

/**
 * How long one cycle of the map lasts, in seconds. Length is a count times a
 * note value, so 1 whole note and 4 quarter notes describe the same span —
 * the manual is explicit that "there is absolutely no difference between one
 * of these combinations and another".
 */
export function timeMapSeconds(map: TimeMap, tempo: number): number {
  if (tempo <= 0 || map.length <= 0 || map.denominator <= 0) return 0;
  const quarterSec = 60 / tempo;
  return map.length * quarterSec * (4 / map.denominator);
}

/**
 * Convert elapsed clock time (seconds since the Voice started) into the real
 * time it should sound at. The map repeats for as long as the Voice plays —
 * "the Voice will repeat its Time Distortion Cycle".
 */
export function distortClockSeconds(
  map: TimeMap,
  tempo: number,
  clockSec: number,
): number {
  const span = timeMapSeconds(map, tempo);
  if (span <= 0 || isNeutralTimeMap(map) || clockSec < 0) return clockSec;
  const cycle = Math.floor(clockSec / span);
  const phase = (clockSec - cycle * span) / span;
  return (cycle + clockToReal(map, phase)) * span;
}

/* ===== Editing ===== */

/** Add a breakpoint, keeping the map ordered and monotonic. */
export function addBreakpoint(map: TimeMap, point: TimeMapPoint): TimeMap {
  if (map.points.length >= 32) return map;
  return normalizeTimeMap({ ...map, points: [...map.points, point] });
}

/** Tug an existing breakpoint to a new place. */
export function moveBreakpoint(
  map: TimeMap,
  index: number,
  point: TimeMapPoint,
): TimeMap {
  if (index < 0 || index >= map.points.length) return map;
  const points = map.points.map((p, i) => (i === index ? point : p));
  return normalizeTimeMap({ ...map, points });
}

export function removeBreakpoint(map: TimeMap, index: number): TimeMap {
  if (index < 0 || index >= map.points.length) return map;
  return { ...map, points: map.points.filter((_, i) => i !== index) };
}

/** The Clear button: erase the map, leaving its length alone. */
export function clearTimeMap(map: TimeMap): TimeMap {
  return { ...map, points: [] };
}

/** The two Length numericals. */
export function setTimeMapLength(
  map: TimeMap,
  length: number,
  denominator: number,
): TimeMap {
  return {
    ...map,
    length: Math.max(1, Math.min(MAX_TIME_MAP_LENGTH, Math.round(length) || 1)),
    denominator: TIME_MAP_DENOMINATORS.includes(
      denominator as (typeof TIME_MAP_DENOMINATORS)[number],
    )
      ? denominator
      : map.denominator,
  };
}
