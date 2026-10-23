/**
 * The Synth, tight: three oscillator lines (wave menu, detune, level, width),
 * the filter's four knobs, its envelope and the amp envelope drawn as VOSM
 * draws them, and the output with a live scope. Every value is printed, always.
 */

import type { JsonValue } from "../../model/graph";
import { EnvelopeEditor } from "../n4/EnvelopeEditor";
import { formatValue } from "../n4/format";
import { N4Button, N4Knob, N4Panel, N4Spinner } from "../n4/kit";
import { Scope } from "../n4/Scope";
import { useMLabHost, type MLabFaceProps } from "./common";

const WAVES = [
  { value: "sawtooth", label: "Saw" }, { value: "square", label: "Square" }, { value: "triangle", label: "Tri" },
  { value: "sine", label: "Sine" }, { value: "pulse", label: "Pulse" },
] as const;
const LIMITS = { attack: 4000, decay: 4000, release: 8000 };

export function SynthFace({ node, setParameter, setParameters, status }: MLabFaceProps) {
  const n = (id: string, fallback = 0) => { const v = node.parameters[id]; return typeof v === "number" ? v : fallback; };
  const knob = (id: string, label: string, min: number, max: number, step: number, unit?: string) =>
    <N4Knob label={label} value={n(id)} min={min} max={max} step={step}
      format={(v) => formatValue(v, { unit, step })} onChange={(v) => setParameter(id, v)} />;
  const env = (prefix: string) => ({
    attack: n(`${prefix}-attack`), decay: n(`${prefix}-decay`), sustain: n(`${prefix}-sustain`), release: n(`${prefix}-release`),
  });
  const setEnv = (prefix: string) => (next: { attack: number; decay: number; sustain: number; release: number }) =>
    setParameters(Object.fromEntries(Object.entries(next).map(([k, v]) => [`${prefix}-${k}`, v])) as Record<string, JsonValue>);
  const waveIndex = (i: number) => Math.max(0, WAVES.findIndex((w) => w.value === node.parameters[`osc${i}-wave`]));
  const host = useMLabHost();
  const routes = Array.isArray(node.parameters.matrix) ? node.parameters.matrix.length : 0;
  return (
    <N4Panel accent="orange">
      <div className="n4-synth">
        <div className="n4-box n4-synth__oscs">
          {([1, 2, 3] as const).map((i) => (
            <div className="n4-synth__osc" key={i}>
              <span className="n4-synth__num">{i}</span>
              <span className="n4-synth__wave" onPointerDown={(event) => event.stopPropagation()}>
                <N4Knob label="Wave" value={waveIndex(i)} min={0} max={WAVES.length - 1} step={1} format={() => ""}
                  onChange={(v) => setParameter(`osc${i}-wave`, WAVES[Math.round(v)].value)} />
                <N4Spinner value={String(node.parameters[`osc${i}-wave`] ?? "sawtooth")} options={WAVES}
                  onChange={(wave) => setParameter(`osc${i}-wave`, wave)} />
              </span>
              {knob(`osc${i}-detune`, "Det", -2400, 2400, 1, "¢")}
              {knob(`osc${i}-level`, "Lvl", 0, 1, 0.01)}
              {knob(`osc${i}-width`, "Wid", 0.1, 0.9, 0.01)}
            </div>
          ))}
        </div>
        <div className="n4-synth__side">
          <div className="n4-box n4-synth__row">
            <span className="n4-box__title">Filter</span>
            <div className="n4-synth__knobs">
              {knob("cutoff", "Cut", 20, 20000, 1, "Hz")}
              {knob("resonance", "Res", 0.1, 30, 0.1, "Q")}
              {knob("key-follow", "Key", 0, 1, 0.01)}
              {knob("filter-amount", "Env", -8, 8, 0.1)}
            </div>
          </div>
          <div className="n4-box n4-synth__row">
            <div className="n4-synth__outhead">
              <span className="n4-box__title">Out</span>
              <N4Button small on={node.parameters.mute === true} title="Mute"
                onClick={(event) => { event.stopPropagation(); setParameter("mute", node.parameters.mute !== true); }}>M</N4Button>
              <span className="n4-synth__readout" title="Voices sounding">{status.voices ?? "Idle"}</span>
              <span className="n4-synth__readout" title="Modulation routes">MOD {routes}</span>
            </div>
            <div className="n4-synth__out">
              {knob("level", "Lvl", 0, 1, 0.01)}
              {knob("pan", "Pan", -1, 1, 0.01)}
              {knob("max-voices", "Vce", 1, 32, 1)}
              <Scope width={40} height={26} read={(into) => host?.readScope?.(node.id, into) ?? false} />
            </div>
          </div>
        </div>
        <div className="n4-box n4-synth__envs">
          <EnvelopeEditor title="Filter env" value={env("filter")} limits={LIMITS} onChange={setEnv("filter")} />
          <EnvelopeEditor title="Amp" value={env("amp")} limits={LIMITS} onChange={setEnv("amp")} />
        </div>
      </div>
    </N4Panel>
  );
}
