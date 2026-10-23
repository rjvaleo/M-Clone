/**
 * M Conductor's face: Numerology's Triple XY (manual p163) — three tan X-Y
 * panels, each with its Current and Target values and a Glide time. Pad 1 is
 * M's baton: moving it moves every Variable armed in M Variables along its
 * arrow, and the tempo when M Clock's Conduct Tempo is armed. Pads 2 and 3
 * are plain CV for anything else on the canvas.
 */

import { M_LAB_TYPES } from "../../registry/mLabModules";
import { variablesStateOf } from "../../mlab/links";
import { conductUpdates, type Pad } from "../../mlab/conductorPad";
import { N4Field, N4Panel, XYPad } from "../n4/kit";
import { findNodeOfType, param, useMLabHost, type MLabFaceProps } from "./common";

const defaultPads = (): Pad[] => Array.from({ length: 3 }, () => ({ x: 0, y: 0, glide: 0 }));

export function ConductorFace({ node, setParameter, setParameters, status }: MLabFaceProps) {
  const host = useMLabHost();
  const pads = param<Pad[]>(node, "pads", defaultPads());
  const current = (() => {
    try { return JSON.parse(status.current ?? "[]") as { x: number; y: number }[]; } catch { return []; }
  })();
  const move = (index: number, x: number, y: number) => {
    if (index !== 0) {
      setParameter("pads", pads.map((pad, i) => (i === index ? { ...pad, x, y } : pad)) as never);
      return;
    }
    const variables = findNodeOfType(host?.graph, M_LAB_TYPES.variables);
    const clock = findNodeOfType(host?.graph, M_LAB_TYPES.clock);
    const out = conductUpdates(pads, clock?.parameters ?? null, variables ? variablesStateOf(variables) : null, x, y);
    setParameters(out.conductor);
    if (out.clock && clock) host?.setNodeParameters(clock.id, out.clock);
    if (out.variables && variables) host?.setNodeParameters(variables.id, { active: out.variables.active as never });
  };

  return (
    <N4Panel accent="tan" wide>
      <div className="n4-panels">
        {[0, 1, 2].map((index) => {
          const pad = pads[index] ?? { x: 0, y: 0, glide: 0 };
          const now = current[index] ?? pad;
          return (
            <div className="n4-xypanel" key={index}>
              <div className="n4-xypanel__title">X - Y {index + 1}{index === 0 ? " · Baton" : ""}</div>
              <div className="n4-xypanel__fields">
                <b>Curr</b>
                <span className="n4-field"><span>X:</span><input readOnly value={now.x.toFixed(2)} style={{ width: "4em" }} /></span>
                <span className="n4-field"><span>Y:</span><input readOnly value={now.y.toFixed(2)} style={{ width: "4em" }} /></span>
                <b>Targ</b>
                <N4Field label="X:" value={pad.x} min={-1} max={1} step={0.01} onChange={(x) => move(index, x, pad.y)} />
                <N4Field label="Y:" value={pad.y} min={-1} max={1} step={0.01} onChange={(y) => move(index, pad.x, y)} />
                <b>Glide</b>
                <N4Field value={pad.glide} min={0} max={10} step={0.01}
                  onChange={(glide) => setParameter("pads", pads.map((p, i) => (i === index ? { ...p, glide } : p)) as never)} />
              </div>
              <XYPad x={pad.x} y={pad.y} label={`X-Y ${index + 1}`} onChange={(x, y) => move(index, x, y)} />
            </div>
          );
        })}
      </div>
    </N4Panel>
  );
}
