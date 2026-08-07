/**
 * Pure control-drawing math, shared by every kit.
 *
 * The catalogue in `reference/panels/CATALOG.md` found the same handful of
 * shapes reused across nineteen synthesizers: a value swept around an arc, a
 * ring of tick marks, a value walked along a line. None of that math cares
 * which kit is drawing — a Minimoog pointer line and a KULT progress ring are
 * the same angle computed two different ways. Putting it here once, instead
 * of once per kit's face renderer, is what keeps six kits from drifting six
 * different ways on the one thing they actually share: whether turning a
 * knob a given amount moves the pointer by the correct number of degrees.
 *
 * Everything below is deterministic and allocation-free, so it is exactly the
 * kind of code this project holds to 100% coverage — unlike the `.tsx` face
 * renderers that call it, which draw JSX and are the one deliberate exclusion
 * `vitest.config.ts` already documents.
 */

/** Clamp `value` into `[low, high]`. */
export function clamp(value: number, low: number, high: number): number {
  if (Number.isNaN(value)) return low;
  return Math.min(high, Math.max(low, value));
}

/**
 * A value's position in its range, `0..1`.
 *
 * `max === min` is a zero-width range — a parameter with nothing to show —
 * and returns 0 rather than dividing by zero, so a malformed descriptor
 * degrades to "pinned at the start" instead of `NaN` propagating into an SVG
 * angle and drawing nothing at all.
 */
export function normalize(value: number, min: number, max: number): number {
  if (max === min) return 0;
  return clamp((value - min) / (max - min), 0, 1);
}

/** The inverse of `normalize`: a `0..1` position back to a value in range. */
export function denormalize(t: number, min: number, max: number): number {
  return min + clamp(t, 0, 1) * (max - min);
}

/** Snap `value` to the nearest multiple of `step`, if a step is given. */
export function snap(value: number, step: number | undefined, min: number): number {
  if (!step || step <= 0) return value;
  return min + Math.round((value - min) / step) * step;
}

/**
 * The standard hardware-synth knob sweep: 270° of travel, pointing down-left
 * at minimum and down-right at maximum, with straight up as the midpoint.
 * Matches the sweep every rotary in the catalogue actually uses — the
 * Minimoog, the MOTM-300 and the thin-ring plugins all stop 45° short of
 * straight down on both ends, not a full circle.
 */
export const KNOB_START_DEG = 135;
export const KNOB_END_DEG = 405; // wraps through 360; see polarToCartesian

/** Map a `0..1` position onto the knob's sweep, in degrees. */
export function knobAngle(t: number): number {
  return KNOB_START_DEG + clamp(t, 0, 1) * (KNOB_END_DEG - KNOB_START_DEG);
}

/**
 * A point on a circle at `angleDeg`, measured clockwise from 3 o'clock —
 * SVG's native convention, which is why 90° is straight down rather than
 * straight up.
 */
export function polarToCartesian(
  cx: number,
  cy: number,
  radius: number,
  angleDeg: number,
): { x: number; y: number } {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: cx + radius * Math.cos(rad), y: cy + radius * Math.sin(rad) };
}

/**
 * An SVG arc path from `startDeg` to `endDeg` around `(cx, cy)` at `radius`.
 *
 * This is the thin-ring knob's progress arc (Sektor, Axon3, KULT, ANA) and
 * also the tick-mark ring the line-art and skeuomorphic kits draw ticks
 * around — one path generator serves both because both are "a stroke along
 * part of a circle," just with a different stroke width and dash pattern
 * applied by the caller.
 *
 * The large-arc-flag is derived rather than passed in: every sweep this
 * module draws is 270° at most (a knob's full travel), so the flag is only
 * ever 1 when the caller asks for more than half the circle — never actually
 * true for a knob arc, but computed honestly rather than hardcoded to 0, so
 * a future full-circle use (a level meter ring, say) is not a silent bug.
 */
export function describeArc(
  cx: number,
  cy: number,
  radius: number,
  startDeg: number,
  endDeg: number,
): string {
  const start = polarToCartesian(cx, cy, radius, startDeg);
  const end = polarToCartesian(cx, cy, radius, endDeg);
  const sweep = endDeg - startDeg;
  const largeArc = Math.abs(sweep) > 180 ? 1 : 0;
  const sweepFlag = sweep >= 0 ? 1 : 0;
  return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArc} ${sweepFlag} ${end.x} ${end.y}`;
}

/**
 * Evenly spaced angles across the knob's sweep, for a tick-mark ring —
 * the MOTM-300's line-art scale and the GRP-A4's panel-printed ticks both
 * draw exactly this, differing only in how each tick is rendered.
 *
 * `count` is ticks, not gaps, so `count: 11` (matching a 0–10 printed scale)
 * places a tick at both ends of the sweep as well as every step between.
 */
export function tickAngles(count: number, startDeg = KNOB_START_DEG, endDeg = KNOB_END_DEG): number[] {
  if (count <= 1) return [startDeg];
  const step = (endDeg - startDeg) / (count - 1);
  return Array.from({ length: count }, (_, i) => startDeg + i * step);
}

/**
 * Where a slider's handle sits along its track, `0` at the `min` end.
 *
 * Vertical sliders in the catalogue (ANA's envelope stacks, WaveNode's octave
 * rows) run bottom-to-top for increasing value, matching a physical fader;
 * horizontal ones (Surge XT) run left-to-right. `invert` flips that so the
 * same `t` still means "toward max" regardless of axis.
 */
export function sliderPosition(t: number, trackLength: number, invert: boolean): number {
  const clamped = clamp(t, 0, 1);
  return invert ? trackLength * (1 - clamped) : trackLength * clamped;
}

/**
 * Convert a pointer drag into a value change.
 *
 * Every kit's knob and vertical slider share this: dragging up increases the
 * value, dragging down decreases it, and the relationship is linear in
 * pixels rather than in angle — which is what makes a fine adjustment
 * possible at all. A knob that mapped drag distance to *angle* directly
 * would need a full 270°, i.e. a very long drag, to sweep the whole range;
 * mapping to a fraction of `sensitivity` pixels instead makes every kind of
 * control feel the same to operate, independent of how it is drawn.
 *
 * `sensitivity` is pixels of drag for the full range; 150 is a comfortable
 * default — big enough for a fine touch, small enough not to need scrolling
 * the mouse off the control.
 */
/**
 * A stepper's `−`/`+` press: move by one `step` (or 1, if the control
 * declares none — a stepper with no step is still expected to do
 * something on every click) and clamp into range.
 */
export function stepBy(value: number, direction: 1 | -1, step: number | undefined, min: number, max: number): number {
  return clamp(value + direction * (step && step > 0 ? step : 1), min, max);
}

/**
 * What a face's `−`/`+` buttons call. A thin wrapper over `stepBy` rather
 * than every face re-deriving "clamp, then call onChange" — the wrapper
 * lives here, next to the math it wraps, rather than in `controls/Stepper`,
 * so a face can import it without also importing the control shell that
 * imports the kit registry that imports every face. That import cycle is
 * real in JS (module evaluation would still resolve it, since nothing here
 * runs at load time) but there is no reason to lean on that guarantee when
 * the wrapper has no actual need to sit on the other side of it.
 */
export function stepperStep(
  props: { value: number; min: number; max: number; step?: number; onChange: (value: number) => void },
  direction: 1 | -1,
): void {
  props.onChange(stepBy(props.value, direction, props.step, props.min, props.max));
}

export function dragDeltaToValue(
  startValue: number,
  pixelDeltaY: number,
  min: number,
  max: number,
  sensitivity = 150,
): number {
  const range = max - min;
  const deltaT = -pixelDeltaY / sensitivity;
  return clamp(startValue + deltaT * range, min, max);
}

export interface Point {
  x: number;
  y: number;
}

/** An SVG path through a run of points: one move, then a line to each of
 * the rest. Shared by the envelope and by any face drawing a curve. */
export function polylinePath(points: readonly Point[]): string {
  if (points.length === 0) return "";
  return points
    .slice(1)
    .reduce((d, p) => `${d} L ${p.x} ${p.y}`, `M ${points[0].x} ${points[0].y}`);
}

/** An ADSR envelope. `attack`/`decay`/`release` are relative durations —
 * any non-negative numbers, read as a ratio between the three — while
 * `sustain` is a level in `0..1`. */
export interface EnvelopeShape {
  attack: number;
  decay: number;
  sustain: number;
  release: number;
}

/**
 * How much of an envelope display's width is given to the held sustain
 * segment, rather than shared out between attack, decay and release.
 *
 * An envelope's sustain has no duration of its own — it lasts as long as
 * the key is held — so it cannot be scaled from a parameter the way the
 * other three stages are. Every drawn envelope in `CATALOG.md` solves this
 * the same way: reserve a fixed slice of the width for the flat part, and
 * let the sloped parts compete for what remains.
 */
const SUSTAIN_HOLD_FRACTION = 0.22;

/** A stage duration, guarding against negatives and NaN. Unlike a level,
 * a duration has no upper bound — it is only meaningful relative to the
 * other two stages. */
function stageTime(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * The five corners of an ADSR shape, in a box `width` × `height`, with `y`
 * measured downward from the top the way SVG does — so the peak sits at
 * `y = 0` and silence at `y = height`.
 *
 * Returned as points rather than a path so a face can do more than stroke
 * them: the kits that draw handles need somewhere to put them, and the LCD
 * kit quantises the same points onto its pixel grid before drawing.
 *
 * A fully degenerate envelope — all three durations zero — is drawn with the
 * three stages sharing the width equally rather than collapsing onto `x = 0`.
 * A vertical spike is not a more honest picture of "no envelope"; it is just
 * an unreadable one, and the numbers beside it already say zero.
 */
export function envelopePoints(env: EnvelopeShape, width: number, height: number): Point[] {
  const attack = stageTime(env.attack);
  const decay = stageTime(env.decay);
  const release = stageTime(env.release);
  const total = attack + decay + release;
  const available = width * (1 - SUSTAIN_HOLD_FRACTION);
  const share = total > 0 ? available / total : available / 3;

  const attackX = total > 0 ? attack * share : share;
  const decayX = attackX + (total > 0 ? decay * share : share);
  const sustainEndX = decayX + width * SUSTAIN_HOLD_FRACTION;
  const sustainY = height * (1 - clamp(env.sustain, 0, 1));

  return [
    { x: 0, y: height },
    { x: attackX, y: 0 },
    { x: decayX, y: sustainY },
    { x: sustainEndX, y: sustainY },
    { x: width, y: height },
  ];
}

/** The envelope as a single stroked path. */
export function envelopePath(env: EnvelopeShape, width: number, height: number): string {
  return polylinePath(envelopePoints(env, width, height));
}

/**
 * A closed, filled waveform outline from peak magnitudes in `0..1`.
 *
 * Peaks are magnitudes, not samples: the shape is drawn mirrored around the
 * vertical centre, which is what every waveform in the catalogue shows. A
 * sign on the input is therefore not information — it is taken as its
 * magnitude rather than silently drawing half the shape inside out.
 *
 * Fewer than two peaks draws nothing. A single sample cannot describe a
 * waveform, and stretching it across the full width would draw a confident
 * rectangle from data that says nothing at all.
 */
export function waveformPath(peaks: readonly number[], width: number, height: number): string {
  if (peaks.length < 2) return "";
  const centre = height / 2;
  let top = "";
  let bottom = "";
  for (let i = 0; i < peaks.length; i += 1) {
    // Fractions of the span rather than a running step, so the last peak
    // lands exactly on `width` instead of a float-accumulated near-miss.
    const x = (i / (peaks.length - 1)) * width;
    const offset = clamp(Math.abs(peaks[i]), 0, 1) * centre;
    top += i === 0 ? `M ${x} ${centre - offset}` : ` L ${x} ${centre - offset}`;
    bottom = ` L ${x} ${centre + offset}${bottom}`;
  }
  return `${top}${bottom} Z`;
}

/**
 * How many of a meter's segments are lit at `level` (`0..1`).
 *
 * Rounds up rather than to nearest, so the faintest signal lights the first
 * segment — the behaviour of every hardware meter in the catalogue, and the
 * reason a meter reading empty on audible output looks broken. Only true
 * silence lights nothing.
 */
export function meterSegments(level: number, count: number): number {
  if (count <= 0) return 0;
  const t = clamp(level, 0, 1);
  if (t <= 0) return 0;
  return Math.min(count, Math.ceil(t * count));
}
