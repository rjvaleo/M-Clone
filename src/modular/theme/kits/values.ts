/**
 * Value transformation shared by every kit: turning a number into the string
 * a readout shows, picking the next option in a selector, and pulling a
 * fader onto its centre detent.
 *
 * These are the non-coordinate half of the kit's pure math — `geometry.ts`
 * answers "where does this draw", this file answers "what does it say" and
 * "what does it become". Both are held to 100% coverage; the `.tsx` faces
 * that call them are the documented exclusion.
 *
 * Everything here is drawn from `reference/panels/CATALOG.md`'s second pass,
 * which found that *readouts* — fields that display a value rather than set
 * one — appear in all eleven drum machines and samplers surveyed, and that
 * the panels are consistent about how they are punctuated.
 */

/** Units that sit hard against their number rather than a space away.
 * The panels are consistent about this: "0%" and "45°", but "0.0 dB",
 * "222 s", "0 cents". */
const HUGGING_UNITS = new Set(["%", "°"]);

/** What a readout shows when there is no value to show. */
const NO_VALUE = "—";

/**
 * Format a number the way a panel readout prints it.
 *
 * `decimals` defaults to what the value itself implies — none for a whole
 * number, one for a fraction — so a caller that has no opinion still gets
 * "2" rather than "2.0" and "1.5" rather than "2". Pass it explicitly
 * wherever a parameter has a fixed precision regardless of its current
 * value, which is most of them: a gain readout stays at "0.0 dB" rather
 * than flickering between one decimal and none as it crosses a whole number.
 *
 * `toFixed` is used rather than any rounding of our own precisely because it
 * keeps a negative sign on a value that rounds to zero — the ADSR Drum
 * Machine's Gain reads "-0.0" just below unity, and flattening that to "0.0"
 * would hide which side of zero the parameter is on.
 */
export function formatValue(value: number, unit?: string, decimals?: number): string {
  if (!Number.isFinite(value)) return NO_VALUE;
  const places = decimals ?? (Number.isInteger(value) ? 0 : 1);
  const text = value.toFixed(places);
  if (!unit) return text;
  return HUGGING_UNITS.has(unit) ? `${text}${unit}` : `${text} ${unit}`;
}

/**
 * The next option index in a selector, wrapping at both ends.
 *
 * A selector cycles rather than clamps — that is the whole difference
 * between it and a stepper. Pressing past the last option lands on the
 * first, which is what every cycling switch in the catalogue does (the
 * `NORMAL`/`FLAM`/`SUB S.` group, the `POLY`/`MONO RETRIG`/`MONO LEGATO`
 * radio list, K.O. II's dual-label keys).
 *
 * A `current` outside the list is pulled back in rather than treated as an
 * error, so a stale index saved in a document cannot wedge the control.
 */
export function cycleIndex(current: number, length: number, direction: 1 | -1): number {
  if (length <= 0) return 0;
  return (((current + direction) % length) + length) % length;
}

/**
 * What a selector's face calls to step to the next option.
 *
 * The same wrapper-next-to-its-math arrangement as `stepperStep` in
 * `geometry.ts`, and for the same reason: a face can import it without also
 * importing the control shell that imports the kit registry that imports
 * every face. Six faces each re-deriving "find the index, wrap it, look up
 * the value, call back" is six chances to get the wrap wrong.
 *
 * An unrecognised `value` yields index `-1`, which wraps forward to the
 * first option — so a stale value saved in a document degrades to "starts
 * from the beginning" rather than to a dead control.
 */
export function selectorAdvance(
  props: {
    options: readonly SelectorLike[];
    value: string;
    onChange: (value: string) => void;
  },
  direction: 1 | -1,
): void {
  if (props.options.length === 0) return;
  const current = props.options.findIndex((option) => option.value === props.value);
  props.onChange(props.options[cycleIndex(current, props.options.length, direction)].value);
}

/** The shape `selectorAdvance` needs from an option — structurally satisfied
 * by `SelectorOption`, without `values.ts` having to import from `types.ts`
 * and drag React's types into a module that has nothing to do with them. */
interface SelectorLike {
  value: string;
}

/**
 * Pull `value` onto `detent` when it lands within `tolerance` of it.
 *
 * This is what makes a pan control findable at centre and a mixer fader
 * findable at unity: K.O. II prints a centre tick on its fader track, and
 * the physical control has a notch there. `tolerance` is a radius, applied
 * on both sides; zero or negative means no assistance at all, so a caller
 * can disable the detent by passing 0 rather than by branching around this
 * function.
 */
export function detentSnap(value: number, detent: number, tolerance: number): number {
  return Math.abs(value - detent) <= Math.max(tolerance, 0) ? detent : value;
}
