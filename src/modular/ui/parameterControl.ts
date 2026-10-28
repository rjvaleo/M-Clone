/**
 * Which control a parameter gets.
 *
 * The app has rendered every parameter as a raw `<input>` or `<select>` since
 * it was built, while `theme/kits/` grew a fourteen-control vocabulary drawn
 * from thirty-one real synthesizer panels. This is the join: one pure
 * function from what a parameter *is* to what a person should touch, so the
 * decision is made once, tested, and identical for all sixty-one modules
 * instead of being re-guessed per face.
 *
 * The rules come from `reference/panels/CATALOG.md`. The one that does the
 * most work is the split between a stepper and a slider: panels use a
 * `− value +` stepper where hitting an exact position matters and there are
 * few of them (octave, division, pattern length), and a continuous control
 * where sweeping matters. That is a property of the parameter's range, not of
 * the module, which is why it can be decided here.
 */

import type { ParameterDescriptor } from "../model/graph";

export type ParameterControlKind =
  | "toggle"
  | "selector"
  | "knob"
  | "slider"
  | "fader"
  | "stepper"
  | "button"
  | "number"
  | "text"
  | "none";

/**
 * The longest integer range still offered as a stepper.
 *
 * Twenty-four is two octaves in semitones and a bar and a half in
 * sixteenths — the point where "press until you get there" stops being
 * reasonable and a sweep is the better gesture.
 */
export const STEPPER_MAX_SPAN = 24;

/** The most options a segmented row shows before cycling is the better fit. */
const SEGMENTED_MAX_OPTIONS = 3;

/** The longest option label a segmented row will carry. */
const SEGMENTED_MAX_LABEL = 4;

/**
 * Which of the selector's renderings suits a given option list.
 *
 * A segmented row shows every alternative at once, which is the better
 * control when they fit — the catalogue's `NORMAL | FLAM | SUB S.` and
 * `LP | BP | HP` rows. When they do not fit, a node row is the wrong place to
 * try, and the cycling variant shows one option in the space of one.
 */
export function selectorVariant(options: readonly string[]): "segmented" | "cycle" {
  if (options.length === 0 || options.length > SEGMENTED_MAX_OPTIONS) return "cycle";
  return options.every((option) => option.length <= SEGMENTED_MAX_LABEL) ? "segmented" : "cycle";
}

/** Whether a number parameter has a travel a control could actually draw. */
function hasDrawableRange(descriptor: ParameterDescriptor): boolean {
  const { minimum, maximum } = descriptor;
  if (minimum === undefined || maximum === undefined) return false;
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum)) return false;
  // A zero-width or inverted range has no travel; a slider drawn on it would
  // be permanently pinned and silently unusable.
  return maximum > minimum;
}

export function parameterControlKind(descriptor: ParameterDescriptor): ParameterControlKind {
  // An explicit request always wins. The rules below are good defaults, but a
  // module that knows its parameter wants a fader is a better authority on it
  // than a heuristic reading the unit.
  if (descriptor.control) return descriptor.control;

  switch (descriptor.kind) {
    case "json":
      return "none";
    case "boolean":
      return "toggle";
    case "enum":
      return "selector";
    case "string":
      return "text";
    case "number": {
      if (!hasDrawableRange(descriptor)) return "number";
      const span = (descriptor.maximum as number) - (descriptor.minimum as number);
      const step = descriptor.step ?? 0;
      // Whole steps and few of them: the positions are the point.
      if (Number.isInteger(step) && step >= 1 && span <= STEPPER_MAX_SPAN) return "stepper";
      // Levels are the one continuous parameter the panels consistently do
      // *not* give a knob — a channel level is a fader — and decibels are
      // what identify one without having to read its name.
      if (descriptor.unit === "dB") return "fader";
      return "knob";
    }
  }
}
