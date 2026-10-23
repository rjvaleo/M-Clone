/**
 * M Conductor's face: M's own Conducting window — the transport and the
 * baton in one module. Play, Stop, Sync and Tap with the bar and beat; the
 * tempo bar M draws as low · tempo · high (110 · 120 · 130), with the arrow
 * that arms it to the baton; and the baton pad itself. Moving the baton moves
 * every Variable armed in M Variables, and the tempo when its arrow is on.
 * Two more X-Y pads, plain CV for anything else, fold out beside it.
 */

import { ConductingArrow } from "../../../ui/ConductingArrow";
import type { ArrowDir } from "../../../engine/snapshot";
import { M_LAB_TYPES } from "../../registry/mLabModules";
import { variablesStateOf } from "../../mlab/links";
import { conductUpdates, type Pad } from "../../mlab/conductorPad";
import { N4Button, N4Panel, N4Slider, N4Spinner, TempoBar, XYPad } from "../n4/kit";
import { findNodeOfType, param, useMLabHost, usePresets, type MLabFaceProps } from "./common";
import { PresetSlots } from "../n4/PresetManager";

const defaultPads = (): Pad[] => Array.from({ length: 3 }, () => ({ x: 0, y: 0, glide: 0 }));

export function ConductorFace({ node, setParameter, setParameters, status }: MLabFaceProps) {
  const host = useMLabHost();
  const presets = usePresets(node, setParameters);
  const pads = param<Pad[]>(node, "pads", defaultPads());
  const arrow = param<string>(node, "tempo-arrow", "off");
  const extra = node.parameters["extra-pads"] === true;
  const current = (() => {
    try { return JSON.parse(status.current ?? "[]") as { x: number; y: number }[]; } catch { return []; }
  })();
  const move = (index: number, x: number, y: number) => {
    if (index !== 0) {
      setParameter("pads", pads.map((pad, i) => (i === index ? { ...pad, x, y } : pad)) as never);
      return;
    }
    const variables = findNodeOfType(host?.graph, M_LAB_TYPES.variables);
    const out = conductUpdates(pads, node.parameters, variables ? variablesStateOf(variables) : null, x, y);
    setParameters(out.conductor);
    if (out.variables && variables) host?.setNodeParameters(variables.id, { active: out.variables.active as never });
  };
  const glide = (index: number, value: number) =>
    setParameter("pads", pads.map((p, i) => (i === index ? { ...p, glide: value } : p)) as never);
  const pad = (index: number, size: "big" | "small") => {
    const target = pads[index] ?? { x: 0, y: 0, glide: 0 };
    const now = current[index] ?? target;
    return (
      <div className={`n4-xypanel n4-xypanel--${size}`} key={index}>
        <div className="n4-xypanel__head">
          <span className="n4-label">{index === 0 ? "Baton" : `X-Y ${index + 1}`}</span>
          <span className="n4-value">{now.x.toFixed(2)} · {now.y.toFixed(2)}</span>
        </div>
        <XYPad x={target.x} y={target.y} label={index === 0 ? "Baton" : `X-Y ${index + 1}`} onChange={(x, y) => move(index, x, y)} />
        <N4Slider label="Glide" value={target.glide} min={0} max={4} onChange={(v) => glide(index, v)} format={(v) => `${v.toFixed(2)} s`} />
      </div>
    );
  };

  return (
    <N4Panel accent="yellow">
      <div className="n4-conductor">
        <div className="n4-conductor__transport">
          <div className="n4-transport">
            <N4Button onClick={() => host?.run(node.id, "play", "Play")} title="Play">▶</N4Button>
            <N4Button onClick={() => host?.run(node.id, "stop", "Stop")} title="Stop">■</N4Button>
            <N4Button onClick={() => host?.run(node.id, "sync", "Sync")} title="Restart every voice's cycles">Sync</N4Button>
            <N4Button onClick={() => host?.run(node.id, "tap", "Tap")} title="Tap">Tap</N4Button>
            <span className="n4-lcd" aria-label="Bar and beat">{status.bar ?? "1"}·{status.beat ?? "1"}·{status.sixteenth ?? "1"}</span>
          </div>
          <div className="n4-conductor__tempo">
            <ConductingArrow label="Tempo" className="n4-arrow"
              state={{ on: arrow !== "off", dir: (arrow === "off" ? "right" : arrow) as ArrowDir }}
              onChange={(next) => setParameter("tempo-arrow", next.on ? next.dir : "off")} />
            <TempoBar low={param(node, "tempo-low", 110)} tempo={param(node, "tempo", 120)} high={param(node, "tempo-high", 130)}
              onChange={(next) => setParameters({ "tempo-low": next.low, tempo: next.tempo, "tempo-high": next.high })} />
          </div>
          <div className="n4-line n4-line--wrap">
            <N4Spinner label="Tap" value={param(node, "tap-conduct", "off")}
              options={[{ value: "off", label: "Off" }, { value: "held", label: "Held" }]}
              onChange={(v) => setParameter("tap-conduct", v)} />
            <N4Spinner label="Sync" value={param(node, "sync-quantize", "now")}
              options={[{ value: "now", label: "Now" }, { value: "beat", label: "Beat" }, { value: "bar", label: "Bar" }]}
              onChange={(v) => setParameter("sync-quantize", v)} />
            <N4Spinner label="Bar" value={param(node, "bar-length", 4)}
              options={Array.from({ length: 16 }, (_, i) => ({ value: i + 1, label: `${i + 1}/4` }))}
              onChange={(v) => setParameter("bar-length", v)} />
          </div>
          <PresetSlots handlers={presets} />
          <span className="n4-muted">{status.run ?? ""}</span>
        </div>
        {pad(0, "big")}
        {extra && pad(1, "small")}
        {extra && pad(2, "small")}
        <button type="button" className="n4-fold" aria-expanded={extra} title={extra ? "Hide pads 2 and 3" : "Show pads 2 and 3"}
          onClick={(event) => { event.stopPropagation(); setParameter("extra-pads", !extra); }}>{extra ? "‹" : "+XY"}</button>
      </div>
    </N4Panel>
  );
}
