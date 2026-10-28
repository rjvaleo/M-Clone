/**
 * The Synth, tight: three oscillator lines (wave menu, detune, level, width),
 * the filter's knobs, its envelope and the amp envelope drawn as VOSM draws
 * them, and the output with a live scope. Under them, the scale sequencer's
 * parts: its three LFOs, its tape delay, the classic switch, and its twenty
 * presets with the morph. Every value is printed, always.
 */

import { useEffect, useRef, useState } from "react";
import type { JsonValue } from "../../model/graph";
import { DELAY_NOTES, LFO_TARGETS, LFO_WAVES, TAPE_SPEEDS } from "../../audio/synthLaws";
import { SYNTH_PRESET_LIBRARY, morphValuesAt, planMorph, touchingLfos } from "../../audio/synthPresets";
import { EnvelopeEditor } from "../n4/EnvelopeEditor";
import { formatValue } from "../n4/format";
import { N4Button, N4Knob, N4Panel, N4Spinner } from "../n4/kit";
import { ModTarget } from "../ModTarget";
import { Scope } from "../n4/Scope";
import { useMLabHost, type MLabFaceProps } from "./common";

const WAVES = [
  { value: "sawtooth", label: "Saw" }, { value: "square", label: "Square" }, { value: "triangle", label: "Tri" },
  { value: "sine", label: "Sine" }, { value: "pulse", label: "Pulse" },
] as const;
const LIMITS = { attack: 4000, decay: 4000, release: 8000 };
const LFO_WAVE_OPTIONS = LFO_WAVES.map((value) => ({ value, label: { sine: "Sine", triangle: "Tri", sawtooth: "Saw" }[value] }));
const LFO_TARGET_OPTIONS = LFO_TARGETS.map((value) => ({
  value,
  label: { none: "—", filter: "Filter", resonance: "Reso", volume: "Volume", pw: "Pulse W", "delay-wet": "Dly wet" }[value],
}));
const NOTE_OPTIONS = DELAY_NOTES.map((note) => ({ value: note.label, label: note.label }));
const TAPE_OPTIONS = TAPE_SPEEDS.map((speed) => ({ value: speed.label, label: speed.label }));
const LIBRARY_OPTIONS = SYNTH_PRESET_LIBRARY.map((preset, index) => ({ value: index, label: preset.name.split(" · ")[0] }));

export function SynthFace({ node, setParameter, setParameters, status }: MLabFaceProps) {
  const n = (id: string, fallback = 0) => { const v = node.parameters[id]; return typeof v === "number" ? v : fallback; };
  // Every knob here is one an LFO can map, like any other face's.
  const knob = (id: string, label: string, min: number, max: number, step: number, unit?: string) =>
    <ModTarget nodeId={node.id} moduleType={node.moduleType} parameterId={id} value={n(id)}>
      {(modulated) => <N4Knob label={label} value={n(id)} min={min} max={max} step={step}
        format={(v) => formatValue(v, { unit, step })} onChange={(v) => setParameter(id, v)} modulated={modulated} />}
    </ModTarget>;
  const env = (prefix: string) => ({
    attack: n(`${prefix}-attack`), decay: n(`${prefix}-decay`), sustain: n(`${prefix}-sustain`), release: n(`${prefix}-release`),
  });
  const setEnv = (prefix: string) => (next: { attack: number; decay: number; sustain: number; release: number }) =>
    setParameters(Object.fromEntries(Object.entries(next).map(([k, v]) => [`${prefix}-${k}`, v])) as Record<string, JsonValue>);
  const waveIndex = (i: number) => Math.max(0, WAVES.findIndex((w) => w.value === node.parameters[`osc${i}-wave`]));
  const host = useMLabHost();
  const routes = Array.isArray(node.parameters.matrix) ? node.parameters.matrix.length : 0;
  const choice = (id: string, fallback: string) => String(node.parameters[id] ?? fallback);
  const classic = node.parameters.classic === true;

  // The library and its morph: the original's sliders glide from where they
  // are to the preset over the morph time, a frame at a time, in slider steps.
  const [picked, setPicked] = useState(0);
  const morphing = useRef<number | null>(null);
  const live = useRef(node.parameters);
  live.current = node.parameters;
  const stopMorph = () => {
    if (morphing.current !== null) cancelAnimationFrame(morphing.current);
    morphing.current = null;
  };
  useEffect(() => stopMorph, []);
  const load = () => {
    stopMorph();
    setParameters(touchingLfos(SYNTH_PRESET_LIBRARY[picked].values, live.current));
  };
  const morph = () => {
    stopMorph();
    const plan = planMorph(live.current, SYNTH_PRESET_LIBRARY[picked].values);
    setParameters(plan.immediate);
    const started = performance.now();
    const seconds = n("morph-time", 5);
    const frame = (now: number) => {
      const t = Math.min(1, (now - started) / (seconds * 1000));
      setParameters(touchingLfos(morphValuesAt(plan, t), live.current));
      morphing.current = t < 1 ? requestAnimationFrame(frame) : null;
    };
    morphing.current = requestAnimationFrame(frame);
  };
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
              {knob(`osc${i}-width`, "Wid", 0.05, 0.95, 0.01)}
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
              {knob("filter-amount", "Oct", -8, 8, 0.1)}
              {knob("filter-env", "Env", -1, 1, 0.01)}
            </div>
          </div>
          <div className="n4-box n4-synth__row">
            <div className="n4-synth__outhead">
              <span className="n4-box__title">Out</span>
              <N4Button small on={node.parameters.mute === true} title="Mute"
                onClick={(event) => { event.stopPropagation(); setParameter("mute", node.parameters.mute !== true); }}>M</N4Button>
              <N4Button small on={classic} title="Classic: one filter for every note, as the scale sequencer"
                onClick={(event) => { event.stopPropagation(); setParameter("classic", !classic); }}>C</N4Button>
              <span className="n4-synth__readout" title="Voices sounding">{status.voices ?? "Idle"}</span>
              <span className="n4-synth__readout" title="Modulation routes">MOD {routes}</span>
            </div>
            <div className="n4-synth__out">
              {knob("level", "Lvl", 0, 1, 0.01)}
              {knob("pan", "Pan", -1, 1, 0.01)}
              {knob("max-voices", "Vce", 1, 32, 1)}
              {knob("volume", "Vol", 0, 1, 0.001)}
              <Scope width={40} height={26} read={(into) => host?.readScope?.(node.id, into) ?? false} />
            </div>
          </div>
        </div>
        <div className="n4-box n4-synth__envs">
          <EnvelopeEditor title="Filter env" value={env("filter")} limits={LIMITS} onChange={setEnv("filter")} />
          <EnvelopeEditor title="Amp" value={env("amp")} limits={LIMITS} onChange={setEnv("amp")} />
        </div>
        <div className="n4-box n4-synth__lfos" onPointerDown={(event) => event.stopPropagation()}>
          <span className="n4-box__title">LFOs</span>
          {(["a", "b", "c"] as const).map((id, index) => (
            <div className="n4-synth__lfo" key={id}>
              <span className="n4-synth__num">{index + 1}</span>
              <N4Spinner value={choice(`lfo-${id}-wave`, "sine")} options={LFO_WAVE_OPTIONS}
                onChange={(wave) => setParameter(`lfo-${id}-wave`, wave)} />
              <N4Spinner value={choice(`lfo-${id}-target`, "none")} options={LFO_TARGET_OPTIONS}
                onChange={(target) => setParameter(`lfo-${id}-target`, target)} />
              {knob(`lfo-${id}-rate`, "Rate", 0.05, 20, 0.01, "Hz")}
              {knob(`lfo-${id}-depth`, "Dep", 0, 1, 0.01)}
            </div>
          ))}
        </div>
        <div className="n4-box n4-synth__delay" onPointerDown={(event) => event.stopPropagation()}>
          <span className="n4-box__title">Delay</span>
          <div className="n4-synth__delayrow">
            <N4Spinner value={choice("delay-note", "1/8")} options={NOTE_OPTIONS}
              onChange={(note) => setParameter("delay-note", note)} />
            <N4Spinner value={choice("tape", "7.5 IPS")} options={TAPE_OPTIONS}
              onChange={(tape) => setParameter("tape", tape)} />
          </div>
          <div className="n4-synth__knobs n4-synth__knobs--delay">
            {knob("delay-feedback", "Fb", 0, 0.95, 0.01)}
            {knob("delay-wet", "Wet", 0, 1, 0.01)}
            {knob("delay-spread", "Spr", 0, 1, 0.01)}
            {knob("delay-hicut", "Cut", 200, 20000, 1, "Hz")}
            {knob("tempo", "BPM", 20, 300, 1)}
          </div>
        </div>
        <div className="n4-box n4-synth__library" onPointerDown={(event) => event.stopPropagation()}>
          <span className="n4-box__title">Scale sequencer</span>
          <N4Spinner value={picked} options={LIBRARY_OPTIONS} onChange={setPicked} wide />
          <N4Button small title="Load the preset now" onClick={(event) => { event.stopPropagation(); load(); }}>Load</N4Button>
          <N4Button small title="Morph to the preset over the morph time" onClick={(event) => { event.stopPropagation(); morph(); }}>Morph</N4Button>
          {knob("morph-time", "Time", 0.5, 30, 0.5, "s")}
        </div>
      </div>
    </N4Panel>
  );
}
