// How far a control turns for a value.
//
// Three travels: straight, logarithmic (even in octaves, as the crate's
// panels mark a frequency or a time), and JUCE's skew, which is how a
// SoundHack dial spreads its range — proportion = ((v − min)/(max − min))^skew.
// The value a control sets is the same whichever travel draws it; only how
// far the pointer moves for it differs, which is what makes a faithful
// SoundHack dial point where the original's did.

export type Travel = "linear" | "log" | { skew: number };

const clamp01 = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x);

/** A logarithmic range must start above zero; one that does not is drawn straight. */
const usesLog = (travel: Travel, min: number) => travel === "log" && min > 0;

/** Where along its travel a value sits, 0 to 1. */
export function toFraction(value: number, min: number, max: number, travel: Travel): number {
  if (max <= min) return 0;
  if (usesLog(travel, min)) return clamp01(Math.log(Math.max(value, min) / min) / Math.log(max / min));
  const straight = clamp01((value - min) / (max - min));
  return typeof travel === "object" ? Math.pow(straight, travel.skew) : straight;
}

/** The value at a point along the travel. */
export function fromFraction(fraction: number, min: number, max: number, travel: Travel): number {
  const f = clamp01(fraction);
  if (usesLog(travel, min)) return min * Math.pow(max / min, f);
  const straight = typeof travel === "object" ? Math.pow(f, 1 / travel.skew) : f;
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
  const step = spec.step && spec.step > 0 ? spec.step : 0;
  const snapped = step ? Math.round(moved / step) * step : moved;
  return Number(Math.min(spec.max, Math.max(spec.min, snapped)).toPrecision(12));
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
