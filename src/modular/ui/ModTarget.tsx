// A knob an LFO can move, wherever it is drawn: a module's standard face or a
// custom one like the synth's. Wraps the control in a ring of each mapped LFO's
// colour, carries what the modulation animator reads, picks this knob while an
// LFO's Map button is on, and lets the last LFO on it go on Alt-click.

import type { ReactNode } from "react";
import { targetKey } from "../modulation";
import { isMappable } from "../modulationTargets";
import { moduleRegistry } from "../registry/registry";
import { useModulation } from "./modulationContext";

export function ModTarget({ nodeId, moduleType, parameterId, value, children }: {
  nodeId: string;
  moduleType: string;
  parameterId: string;
  value: number;
  /** The control, told whether an LFO moves it so it can draw the second pointer. */
  children: (modulated: boolean) => ReactNode;
}) {
  const modulation = useModulation();
  if (!isMappable(moduleType, parameterId)) return <>{children(false)}</>;
  const descriptor = moduleRegistry.get(moduleType)?.parameters.find((p) => p.id === parameterId);
  const target = { nodeId, parameterId };
  const on = modulation.mappings.get(targetKey(target));
  const waiting = modulation.mappingFrom !== null;
  const label = descriptor?.label ?? parameterId;
  const classes = ["mm-mod-target", on ? "is-modulated" : "", waiting ? "is-mappable" : ""].filter(Boolean).join(" ");
  const ring = on
    ? { "--mod-color": on[0].color, "--mod-color-2": (on[1] ?? on[0]).color } as React.CSSProperties
    : undefined;
  return <div className={classes} style={ring}
    {...(on ? {
      "data-mod-lfos": on.map((m) => m.lfoNodeId).join(","),
      "data-mod-base": value,
      "data-mod-min": descriptor?.minimum,
      "data-mod-max": descriptor?.maximum,
      "data-mod-step": descriptor?.step,
    } : {})}
    title={waiting ? `Map ${label}` : on ? `${label} — moved by ${on.length === 1 ? "an LFO" : `${on.length} LFOs`} (Alt-click to unmap)` : undefined}
    onPointerDownCapture={(event) => {
      // While an LFO waits for a knob, a press picks this one rather than turning it.
      if (waiting) event.stopPropagation();
    }}
    onClickCapture={(event) => {
      if (waiting) {
        event.stopPropagation();
        event.preventDefault();
        modulation.finishMap(target);
      } else if (event.altKey && on) {
        event.stopPropagation();
        event.preventDefault();
        modulation.unmap(on[on.length - 1].lfoNodeId, target);
      }
    }}>
    {children(Boolean(on))}
  </div>;
}
