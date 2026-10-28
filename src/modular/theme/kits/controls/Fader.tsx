// The shared mixer Fader. Same arrangement as Knob and Slider — the shell
// owns the gesture, the face only draws — with one addition: the detent.
//
// A detent belongs here rather than in a face because it changes the value a
// drag produces, and a face never touches values. Putting it in the shell
// also means every kit's fader notches identically, which is the point: a
// detent you can feel in one kit and not another would make the kits behave
// differently, not just look different.

import { useCallback } from "react";
import { useKit } from "../KitContext";
import { faceFor } from "../registry";
import type { FaderProps } from "../types";
import { detentSnap } from "../values";
import { useDragValue } from "./useDragValue";

// Longer travel than a slider, so a fader needs more pixels of drag to cross
// its range or it would feel twitchy next to the track it is drawn on.
const SENSITIVITY = 220;

/** How close the handle has to get before an unspecified detent grabs it, as
 * a fraction of the fader's range. 2% is roughly the width of the printed
 * centre tick on the hardware faders in the catalogue. */
const DEFAULT_DETENT_FRACTION = 0.02;

export function Fader(props: FaderProps) {
  const kit = useKit();
  const { detent, detentTolerance, min, max, onChange } = props;

  const change = useCallback(
    (next: number) => {
      if (detent === undefined) {
        onChange(next);
        return;
      }
      const tolerance = detentTolerance ?? Math.abs(max - min) * DEFAULT_DETENT_FRACTION;
      onChange(detentSnap(next, detent, tolerance));
    },
    [detent, detentTolerance, min, max, onChange],
  );

  const { dragging, handlers } = useDragValue({
    value: props.value,
    min,
    max,
    step: props.step,
    disabled: props.disabled,
    sensitivity: SENSITIVITY,
    onChange: change,
  });

  return faceFor(kit).fader({ ...props, dragging, dragHandlers: handlers });
}
