// The LFO's own controls beyond its knobs: its colour, the Map button, and the
// knobs it moves, each with a way to let it go.

import type { JsonValue, NodeInstance } from "../model/graph";
import { LFO_COLORS, lfoColor, targetsOf, withoutTarget } from "../modulation";
import { useModulation } from "./modulationContext";

export function LfoMapFace({ node, setParameter }: {
  node: NodeInstance;
  setParameter: (id: string, value: JsonValue) => void;
}) {
  const modulation = useModulation();
  const waiting = modulation.mappingFrom === node.id;
  const targets = targetsOf(node);
  const color = lfoColor(node);
  return <div className="mm-lfo" style={{ "--mod-color": color } as React.CSSProperties}>
    <div className="mm-lfo__colors" role="radiogroup" aria-label="Colour">
      {LFO_COLORS.map((c) => <button type="button" key={c.name} role="radio"
        aria-checked={c.value === color} aria-label={c.name} title={c.name}
        className={`mm-lfo__swatch${c.value === color ? " is-on" : ""}`}
        style={{ background: c.value }}
        onClick={() => setParameter("color", c.name)} />)}
    </div>
    <button type="button" className={`mm-lfo__map${waiting ? " is-on" : ""}`}
      aria-pressed={waiting}
      title={waiting ? "Click a knob to map it — Esc to stop" : "Map: then click the knob this LFO should move"}
      onClick={() => (waiting ? modulation.cancelMap() : modulation.startMap(node.id))}>
      {waiting ? "Click a knob…" : "Map"}
    </button>
    {targets.length > 0 && <ul className="mm-lfo__targets" aria-label="Mapped to">
      {targets.map((target) => <li key={`${target.nodeId}|${target.parameterId}`}>
        <span>{modulation.describe(target)}</span>
        <button type="button" aria-label={`Unmap ${modulation.describe(target)}`} title="Unmap"
          onClick={() => setParameter("targets", withoutTarget(targets, target))}>×</button>
      </li>)}
    </ul>}
  </div>;
}
