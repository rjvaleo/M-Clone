// How far a control turns for a value.
//
// Three travels: straight, logarithmic (even in octaves, as the crate's
// panels mark a frequency or a time), and JUCE's skew, which is how a
// SoundHack dial spreads its range — proportion = ((v − min)/(max − min))^skew.
// The value a control sets is the same whichever travel draws it; only how
// far the pointer moves for it differs, which is what makes a faithful
// SoundHack dial point where the original's did.

export type Travel = "linear" | "log" | { skew: number } | LogTicks;

/**
 * MultiGrainLive's logarithmic slider: a range input of `log` ticks, each
 * tick the value `min·(max/min)^(tick/log)`, never snapped to the step
 * (`param` in its `app.js`). `round` rounds the value, where its handler does.
 */
export type LogTicks = { log: number; round?: true };

const isTicks = (travel: Travel): travel is LogTicks => typeof travel === "object" && "log" in travel;

const clamp01 = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x);

/** A logarithmic range must start above zero; one that does not is drawn straight. */
const usesLog = (travel: Travel, min: number) => (travel === "log" || isTicks(travel)) && min > 0;

/** Where along its travel a value sits, 0 to 1. */
export function toFraction(value: number, min: number, max: number, travel: Travel): number {
  if (max <= min) return 0;
  if (usesLog(travel, min)) return clamp01(Math.log(Math.max(value, min) / min) / Math.log(max / min));
  const straight = clamp01((value - min) / (max - min));
  return typeof travel === "object" && "skew" in travel ? Math.pow(straight, travel.skew) : straight;
}

/** The value at a point along the travel. */
export function fromFraction(fraction: number, min: number, max: number, travel: Travel): number {
  const f = clamp01(fraction);
  if (isTicks(travel) && min > 0) {
    const value = min * Math.pow(max / min, Math.round(f * travel.log) / travel.log);
    return travel.round ? Math.round(value) : value;
  }
  if (usesLog(travel, min)) return min * Math.pow(max / min, f);
  const straight = typeof travel === "object" && "skew" in travel ? Math.pow(f, 1 / travel.skew) : f;
  return min + straight * (max - min);
}

/** Pixels of vertical drag from one end of the travel to the other. */
export const DRAG_PIXELS = 150;

/**
 * The value after dragging `dy` pixels up from where the drag began. Shift
 * drags ten times finer. Snapped to the step and held to the range.
 */
export function dragValue(
  start: number,
  dy: number,
  spec: { min: number; max: number; travel: Travel; step?: number },
  fine = false,
): number {
  const from = toFraction(start, spec.min, spec.max, spec.travel);
  const moved = fromFraction(from + dy / (DRAG_PIXELS * (fine ? 10 : 1)), spec.min, spec.max, spec.travel);
  // A tick of a logarithmic slider is its value already.
  if (isTicks(spec.travel)) return moved;
  const step = spec.step && spec.step > 0 ? spec.step : 0;
  const snapped = step ? snapStep(moved, spec.min, step) : moved;
  return Number(Math.min(spec.max, Math.max(spec.min, snapped)).toPrecision(12));
}

/**
 * The nearest step, counted from the bottom of the range as a range input
 * counts it: from 3 in steps of 2 is 3, 5, 7. From a multiple of the step, as
 * nearly every range starts, that is the plain grid.
 */
export function snapStep(value: number, min: number, step: number): number {
  return min + Math.round((value - min) / step) * step;
}

/** A knob's pointer, in degrees from straight up: 270° of travel. */
export const knobAngle = (fraction: number): number => -135 + clamp01(fraction) * 270;

/** An SVG arc from one knob angle to another. */
export function arcPath(cx: number, cy: number, r: number, from: number, to: number): string {
  const point = (deg: number) => [cx + r * Math.sin((deg * Math.PI) / 180), cy - r * Math.cos((deg * Math.PI) / 180)];
  const [x1, y1] = point(from);
  const [x2, y2] = point(Math.max(from + 0.01, to));
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

/**
 * The travel a parameter implies. prism-gen gives a control the crate marks
 * logarithmic a step of a hundredth of its minimum (see registry/prismModules
 * `stepFor`); everything else turns straight.
 */
export function travelFor(parameter: { minimum?: number; maximum?: number; step?: number }): Travel {
  const min = parameter.minimum ?? 0;
  const max = parameter.maximum ?? 1;
  const step = parameter.step ?? 0;
  return min > 0 && max > min && step > 0 && Math.abs(step - min / 100) <= min * 1e-9 ? "log" : "linear";
}

type Axis = { min: number; max: number; step?: number };

const snap = (value: number, axis: Axis) => {
  const step = axis.step && axis.step > 0 ? axis.step : 0;
  const snapped = step ? Math.round(value / step) * step : value;
  return Number(Math.min(axis.max, Math.max(axis.min, snapped)).toPrecision(12));
};

/**
 * Hyperprism's pad: a point, as fractions across from the left and down from
 * the top, to the values of its two controls. Linear on both axes, as the
 * original's was; X runs left to right and Y bottom to top, as the Prism tab's.
 */
export function padValues(across: number, down: number, x: Axis, y: Axis): [number, number] {
  return [
    snap(fromFraction(across, x.min, x.max, "linear"), x),
    snap(fromFraction(1 - Math.min(1, Math.max(0, down)), y.min, y.max, "linear"), y),
  ];
}

/** Where two values sit on the pad, as fractions across and down. */
export function padPoint(xValue: number, yValue: number, x: Axis, y: Axis): [number, number] {
  return [toFraction(xValue, x.min, x.max, "linear"), 1 - toFraction(yValue, y.min, y.max, "linear")];
}
