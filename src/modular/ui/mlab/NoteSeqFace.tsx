/**
 * M NoteSeq's face: a Numerology MonoNote/PolyNote front panel carrying one
 * voice of M. The rows run as the MonoNote's do (manual p88) — step labels,
 * Skip, the pitch lane, Sel, the timing lane, Mute, the timbre lane — with
 * PolyNote's note grid for pitch, because M's steps can be chords.
 *
 * M's own controls sit where Numerology would put them: Note Order and
 * Density under Rate and Dir, the Pattern Group a–f under the pitch
 * controls, ReScramble and M's Pattern commands in the Generate menu, and the
 * Accent, Legato and Rhythm cycles as lanes with their own end markers.
 */

import { useEffect, useRef, useState } from "react";
import type { CyclicStep, CyclicVariable, NoteOrderMix } from "../../../engine/types";
import { Rng } from "../../../engine/rng";
import { normalizeCyclicStep } from "../../../engine/cyclic";
import { NOTE_NAMES, SCALES } from "../../../engine/music";
import {
  AdvancedPanel, ButtonRow, LaneSelect, N4Body, N4Box, N4Button, N4Field, N4Knob, N4Panel, N4Scrollbar, N4Spinner,
  NoteGrid, SliderLane, SplitBar, StepLabels, VISIBLE_STEPS,
} from "../n4/kit";
import { applyRowAction, cellRangeDrag, moveSelected, type RowAction } from "../n4/logic";
import { DIRECTION_LABELS, MAX_SEQ_STEPS, SEQ_DIRECTIONS, invertPitches } from "../../mlab/noteSeq";
import { GENERATORS, generate, type GeneratorId } from "../../mlab/generate";
import { DEFAULT_EVOLVE, EVOLVE_TRANSFORMS, evolve, type EvolveConfig, type EvolveDimension } from "../../mlab/evolve";
import {
  RATE_OPTIONS, applyMaterial, cellLengthInPlay, cellsInPlay, currentMaterial, normGates, patternInPlay, rateOf,
  setCellLength, setCellValue, setEndStep, setRate, shiftAll, toggleNoteIn, zeroGates, zeroPitchesIn,
} from "../../mlab/noteSeqEdit";
import { pitchRows } from "../../mlab/patternEdit";
import { POSITION_LABELS, type CycleValues } from "../../mlab/model";
import { param, useMLabHost, type MLabFaceProps } from "./common";

const freshRng = () => new Rng((Math.random() * 0x7fffffff) >>> 0);
const H_SYNC = [["none", "None"], ["1", "1 Beat"], ["2", "2 Beats"], ["4", "1 Bar"], ["8", "2 Bars"], ["16", "4 Bars"]] as const;
const RUN_MODES = [["normal", "Normal"], ["manual", "Manual"], ["cv-gated", "CV Trig: Gated"], ["cv-step", "CV Trig: Step"]] as const;
const options = <T extends string>(pairs: readonly (readonly [T, string])[]) => pairs.map(([value, label]) => ({ value, label }));

export function NoteSeqFace({ node, setParameter, setParameters, status }: MLabFaceProps) {
  const host = useMLabHost();
  const p = node.parameters;
  const pattern = patternInPlay(p);
  const view = param<"orig" | "scram">(node, "pitch-view", "orig");
  const timing = param<"legato" | "rhythm" | "rnd-jump">(node, "timing-lane", "legato");
  const timbre = param<"accent" | "velocity">(node, "timbre-lane", "accent");
  const first = Math.max(0, Math.round(param(node, "scroll", 0)));
  const total = Math.min(MAX_SEQ_STEPS, Math.max(VISIBLE_STEPS, Math.ceil((Math.max(pattern.length, pattern.steps.length) + 4) / 16) * 16));
  const w = { first: Math.min(first, Math.max(0, total - VISIBLE_STEPS)), count: VISIBLE_STEPS };
  const cellWindow = { first: 0, count: VISIBLE_STEPS };
  const start = Math.round(param(node, "start", 0));
  const range = { from: start, to: pattern.length - 1 };
  const flags = (id: string) => param<boolean[]>(node, id, []);
  const lane = (id: string) => param<number[]>(node, id, []);
  const values = param<CycleValues>(node, "cycle-values", { legato: [6, 25, 50, 75, 100], rhythm: [1, 1, 1.5, 2, 5] });
  const playing = Number(status.index ?? -1);
  const playingCells = (() => { try { return JSON.parse(status.cells ?? "[]") as number[]; } catch { return []; } })();
  const mix = param<NoteOrderMix>(node, "note-order", { original: 100, cyclic: 0, utterly: 0 });
  const [showRun, setShowRun] = useState(false);
  const [showEvolve, setShowEvolve] = useState(false);

  // Auto Evolve: each dimension once at the end of every bar (manual p51).
  const lastBar = useRef(status.bar);
  useEffect(() => {
    if (status.bar === lastBar.current) return;
    lastBar.current = status.bar;
    if (p["evolve-auto"] !== true || status.bar === undefined) return;
    let material = currentMaterial(p);
    const config = param<EvolveConfig>(node, "evolve", DEFAULT_EVOLVE);
    for (const d of ["x", "y", "z"] as EvolveDimension[]) material = evolve(d, config, material, freshRng());
    setParameters(applyMaterial(p, material));
  });

  const toggleFlag = (id: string, step: number) => {
    const next = [...flags(id)];
    while (next.length <= step) next.push(false);
    next[step] = !next[step];
    setParameter(id, next);
  };
  const rowAction = (id: string) => (action: RowAction, on: boolean) => {
    const base = Array.from({ length: Math.max(pattern.length, flags(id).length) }, (_, i) => flags(id)[i] === true);
    setParameter(id, applyRowAction(base, action, on, range, freshRng()));
  };
  const setLaneValue = (id: string, min: number, max: number) => (step: number, value: number) => {
    const current = Array.from({ length: Math.max(step + 1, lane(id).length) }, (_, i) => lane(id)[i] ?? 0);
    setParameter(id, moveSelected(current, flags("select"), step, value, min, max));
  };
  const cellLane = (kind: CyclicVariable, show: (level: number) => string) => {
    const cells = cellsInPlay(p, kind);
    const playingCell = playingCells[["accent", "legato", "rhythm"].indexOf(kind)] ?? -1;
    return (
      <SliderLane values={cells} window={cellWindow} min={0} max={4} step={1} format="level"
        display={(cell) => {
          const { min, max } = normalizeCyclicStep(cell as CyclicStep);
          return min === max ? show(min) : `${show(min)}–${show(max)}`;
        }}
        onChange={(index, level) => setParameters(setCellValue(p, kind, index, level))}
        onRange={(index, from, to) => setParameters(setCellValue(p, kind, index,
          cellRangeDrag(Math.round(from), to >= from ? "top" : "bottom", to)))}
        ownLength={cellLengthInPlay(p, kind)}
        onOwnLength={(length) => setParameters(setCellLength(p, kind, length))}
        playing={playingCell} />
    );
  };
  const runGenerate = () => {
    const id = param<GeneratorId>(node, "generate", "rescramble");
    const next = generate(id, currentMaterial(p), freshRng(), { preserveRests: p["preserve-rests"] === true });
    setParameters(applyMaterial(p, next));
  };
  const runEvolve = (d: EvolveDimension) =>
    setParameters(applyMaterial(p, evolve(d, param<EvolveConfig>(node, "evolve", DEFAULT_EVOLVE), currentMaterial(p), freshRng())));

  const left = <>
    <N4Box>
      <div className="n4-transport">
        <N4Button onClick={() => host?.command(node.id, "reset")} title="Reset to the start step">⏮</N4Button>
        <N4Button on={p.play === false} onClick={() => setParameters({ play: false, "run-mode": "manual" })} title="Stop">■</N4Button>
        <N4Button on={p.play !== false} onClick={() => setParameter("play", true)} title="Play">▶</N4Button>
      </div>
      <div className="n4-line">
        <N4Button small on={showRun} onClick={() => setShowRun(!showRun)} title="Run Mode">E</N4Button>
        <N4Button on={p["mute-all"] === true} onClick={() => setParameter("mute-all", p["mute-all"] !== true)}>mute</N4Button>
      </div>
      {showRun && <N4Spinner wide value={param(node, "run-mode", "normal")} options={options(RUN_MODES)}
        onChange={(value) => setParameter("run-mode", value)} />}
    </N4Box>
    <N4Box>
      <N4Spinner label="Rate" value={rateOf(p)} options={[...RATE_OPTIONS.map((r) => ({ value: r.value as string, label: r.label })),
        ...(RATE_OPTIONS.some((r) => r.value === rateOf(p)) ? [] : [{ value: rateOf(p), label: rateOf(p) }])]}
        onChange={(value) => setParameters(setRate(value))} />
      <N4Spinner label="Dir" value={param(node, "dir", "fwd")} options={SEQ_DIRECTIONS.map((d) => ({ value: d, label: DIRECTION_LABELS[d] }))}
        onChange={(value) => setParameter("dir", value)} />
      <N4Spinner label="H.Sync" value={param(node, "h-sync", "none")} options={options(H_SYNC)}
        onChange={(value) => setParameter("h-sync", value)} />
    </N4Box>
    <N4Box title="Note Order">
      <SplitBar mix={mix} onChange={(next) => setParameter("note-order", next)} />
      <N4Knob label="Density" value={param(node, "density", 1)} min={0} max={1} onChange={(v) => setParameter("density", v)}
        format={(v) => `${Math.round(v * 100)}%`} />
    </N4Box>
    <N4Box>
      <N4Spinner label="Key" value={param(node, "key", 0)} options={NOTE_NAMES.map((name, i) => ({ value: i, label: name }))}
        onChange={(value) => setParameter("key", value)} />
      <N4Spinner wide value={param(node, "scale", "major")} options={Object.keys(SCALES).map((s) => ({ value: s, label: s[0].toUpperCase() + s.slice(1) }))}
        onChange={(value) => setParameter("scale", value)} />
      <div className="n4-line">
        <span>Octave</span>
        <div className="n4-octaves" role="group" aria-label="Octave">
          {[4, 3, 2, 1, 0, -1, -2, -3, -4].map((o) => (
            <button type="button" key={o} className={param(node, "octave", 0) === o ? "is-on" : ""}
              onClick={() => setParameter("octave", o)}>{o > 0 ? `+${o}` : o}</button>
          ))}
        </div>
      </div>
      <N4Field label="Transp" value={param(node, "transposition", 0)} min={-48} max={48} onChange={(v) => setParameter("transposition", v)} />
      <div className="n4-box__title">Group</div>
      <div className="n4-positions" role="group" aria-label="Pattern Group">
        {POSITION_LABELS.map((name, g) => (
          <N4Button small key={name} on={Math.round(param(node, "group", 0)) === g} onClick={() => setParameter("group", g)}>{name}</N4Button>
        ))}
      </div>
    </N4Box>
  </>;

  const evolveConfig = param<EvolveConfig>(node, "evolve", DEFAULT_EVOLVE);
  const right = <>
    <N4Box title="Generate" className="n4-box--centred">
      <N4Spinner wide value={param<GeneratorId>(node, "generate", "rescramble")}
        options={GENERATORS.map((g) => ({ value: g.id, label: g.label }))}
        onChange={(value) => setParameter("generate", value)} />
      <N4Button onClick={runGenerate}>Now</N4Button>
      <label className="n4-check"><input type="checkbox" checked={p["preserve-rests"] === true}
        onChange={(event) => setParameter("preserve-rests", event.currentTarget.checked)} />Keep rests</label>
    </N4Box>
    <N4Box title="Evolve" className="n4-box--centred">
      <div className="n4-line n4-line--centre">
        {(["x", "y", "z"] as EvolveDimension[]).map((d) => <N4Button key={d} onClick={() => runEvolve(d)}>{d.toUpperCase()}</N4Button>)}
      </div>
      <div className="n4-line n4-line--centre">
        <N4Button small on={showEvolve} onClick={() => setShowEvolve(!showEvolve)} title="Edit the transformations">E</N4Button>
        <N4Button small on={p["evolve-auto"] === true} onClick={() => setParameter("evolve-auto", p["evolve-auto"] !== true)}>Auto</N4Button>
      </div>
    </N4Box>
    <N4Box className="n4-box--centred">
      <N4Knob label="Vel Lo" value={param(node, "vel-low", 48)} min={1} max={127} step={1} onChange={(v) => setParameter("vel-low", v)} format={String} />
      <N4Knob label="Vel Hi" value={param(node, "vel-high", 110)} min={1} max={127} step={1} onChange={(v) => setParameter("vel-high", v)} format={String} />
      <N4Button onClick={() => setParameter("velocity", [])}>Norm All</N4Button>
    </N4Box>
    <N4Box className="n4-box--centred">
      <N4Button onClick={() => setParameters(normGates(p))}>Norm All</N4Button>
      <N4Knob label="Gate Adj" value={param(node, "legato", 1)} min={0} max={2} onChange={(v) => setParameter("legato", v)} />
      <N4Button onClick={() => setParameters(zeroGates(p))}>ZeroGate</N4Button>
    </N4Box>
    <div className="n4-line n4-line--centre">
      <N4Button onClick={() => setParameters(shiftAll(p, -1))} title="Shift left">&lt;&lt;</N4Button>
      <N4Button onClick={() => setParameters(shiftAll(p, 1))} title="Shift right">&gt;&gt;</N4Button>
    </div>
  </>;

  const steps = view === "orig" ? pattern.steps : pattern.scrambled;
  const timingLane = timing === "rnd-jump"
    ? <SliderLane values={lane("rnd-jump")} window={w} min={0} max={1} step={0.01} format="number"
      display={(v) => (Number(v) > 0 ? Number(v).toFixed(2) : "–")}
      onChange={setLaneValue("rnd-jump", 0, 1)} playing={playing} active={(s) => s < pattern.length} />
    : timing === "legato"
      ? cellLane("legato", (level) => `${values.legato[level]}%`)
      : cellLane("rhythm", (level) => `×${values.rhythm[level]}`);
  const timbreLane = timbre === "velocity"
    ? <SliderLane values={lane("velocity")} window={w} min={-1} max={1} step={0.01} format="signed"
      onChange={setLaneValue("velocity", -1, 1)} playing={playing} active={(s) => s < pattern.length} />
    : cellLane("accent", String);

  return (
    <N4Panel accent={view === "scram" ? "blue" : "orange"} wide>
      <N4Body left={left} right={right}>
        <div className="n4-rowgrid">
          <span className="n4-spacer" />
          <StepLabels window={w} start={start} end={pattern.length - 1} playing={playing}
            onStart={(step) => setParameter("start", step)} onEnd={(step) => setParameters(setEndStep(p, step))} />
          <span className="n4-spacer" />

          <ButtonRow label="Skip" kind="skip" flags={flags("skip")} window={w} onToggle={(s) => toggleFlag("skip", s)}
            onAction={rowAction("skip")} onClear={() => setParameter("skip", [])} />

          <NoteGrid steps={steps} rows={pitchRows(pattern, 24)} window={w} length={pattern.length}
            header={<LaneSelect options={[{ value: "orig", label: "Orig" }, { value: "scram", label: "Scram" }]} value={view}
              onChange={(value) => setParameter("pitch-view", value)} />}
            onToggle={(step, pitch) => setParameters(toggleNoteIn(p, view, step, pitch))}
            playing={playing} source={status.source ?? ""} />
          <div className="n4-sidebtns">
            <button type="button" title="Zero All: every note to the first" onClick={() => setParameters(zeroPitchesIn(p))}>∅</button>
            <button type="button" title="Invert" onClick={() => setParameters({ patterns: (() => {
              const groups = [...(p.patterns as unknown as typeof pattern[])];
              const g = Math.round(param(node, "group", 0));
              groups[g] = { ...pattern, steps: invertPitches(pattern.steps, pattern.length), scrambled: invertPitches(pattern.scrambled, pattern.length) };
              return groups as never;
            })() })}>1/x</button>
          </div>

          <ButtonRow label="Sel" kind="select" flags={flags("select")} window={w} onToggle={(s) => toggleFlag("select", s)}
            onAction={rowAction("select")} onClear={() => setParameter("select", [])} />

          <LaneSelect options={[{ value: "legato", label: "Legato" }, { value: "rhythm", label: "Rhythm" }, { value: "rnd-jump", label: "Rnd Jump" }]}
            value={timing} onChange={(value) => setParameter("timing-lane", value)} />
          {timingLane}
          <span className="n4-spacer" />

          <ButtonRow label="Mute" kind="mute" flags={flags("mute")} window={w} onToggle={(s) => toggleFlag("mute", s)}
            onAction={rowAction("mute")} onClear={() => setParameter("mute", [])} />

          <LaneSelect options={[{ value: "accent", label: "Accent" }, { value: "velocity", label: "Velocity" }]}
            value={timbre} onChange={(value) => setParameter("timbre-lane", value)} />
          {timbreLane}
          <span className="n4-spacer" />

          <span className="n4-spacer" />
          <N4Scrollbar first={w.first} total={total} onScroll={(value) => setParameter("scroll", value)} />
          <span className="n4-spacer" />
        </div>
      </N4Body>
      {showEvolve && (
        <N4Box title="Evolve transformations">
          {(["x", "y", "z"] as EvolveDimension[]).map((d) => (
            <div className="n4-line" key={d}>
              <b>{d.toUpperCase()}</b>
              {EVOLVE_TRANSFORMS.map((t) => {
                const entry = evolveConfig[d].find((e) => e.id === t.id);
                return (
                  <label key={t.id} className="n4-field" title={t.label}>
                    <span className="n4-muted">{t.label}</span>
                    <input type="number" min={0} max={100} value={entry?.probability ?? 0} style={{ width: "3.2em" }}
                      onChange={(event) => {
                        const probability = Math.max(0, Math.min(100, Number(event.currentTarget.value) || 0));
                        const others = evolveConfig[d].filter((e) => e.id !== t.id);
                        setParameter("evolve", { ...evolveConfig, [d]: probability > 0 ? [...others, { id: t.id, probability }].slice(0, 8) : others } as never);
                      }} />
                  </label>
                );
              })}
            </div>
          ))}
        </N4Box>
      )}
      <AdvancedPanel open={p.advanced === true} onToggle={() => setParameter("advanced", p.advanced !== true)}>
        <N4Field label="Voice" value={param(node, "voice", 1)} min={1} max={8} onChange={(v) => setParameter("voice", v)} />
        <N4Field label="MIDI Channel" value={param(node, "channel", 1)} min={1} max={16} onChange={(v) => setParameter("channel", v)} />
        <N4Field label="Rate (n)" value={param(node, "rate-num", 1)} min={1} max={64} onChange={(v) => setParameter("rate-num", v)} />
        <N4Field label="Rate (/d)" value={param(node, "rate-den", 8)} min={1} max={64} onChange={(v) => setParameter("rate-den", v)} />
        <N4Field label="Seq Size" value={pattern.length} min={1} max={MAX_SEQ_STEPS} onChange={(v) => setParameters(setEndStep(p, v - 1))} width={5} />
        {(["scale-snap", "diatonic", "chord-tones"] as const).map((id) => (
          <label className="n4-check" key={id}><input type="checkbox" checked={p[id] === true}
            onChange={(event) => setParameter(id, event.currentTarget.checked)} />
            {{ "scale-snap": "Scale Snap", diatonic: "Diatonic Transpose", "chord-tones": "Chord Tones" }[id]}</label>
        ))}
        {(["legato", "rhythm"] as const).map((kind) => (
          <div className="n4-line" key={kind}>
            <span>{kind === "legato" ? "Legato %" : "Rhythm ×"}</span>
            {values[kind].map((value, level) => (
              <input key={level} type="number" value={value} style={{ width: "3.4em" }} aria-label={`${kind} level ${level}`}
                onChange={(event) => {
                  const next = structuredClone(values);
                  next[kind][level] = Number(event.currentTarget.value) || 0;
                  setParameter("cycle-values", next as never);
                }} />
            ))}
          </div>
        ))}
        <div className="n4-line">
          <span>Cycle positions</span>
          {(["accent", "legato", "rhythm"] as CyclicVariable[]).map((kind) => (
            <N4Spinner key={kind} label={kind[0].toUpperCase()} value={param<Record<string, number>>(node, "cycle-positions", {})[kind] ?? 0}
              options={POSITION_LABELS.map((name, i) => ({ value: i, label: name }))}
              onChange={(value) => setParameter("cycle-positions", { ...param<Record<string, number>>(node, "cycle-positions", {}), [kind]: value })} />
          ))}
        </div>
      </AdvancedPanel>
    </N4Panel>
  );
}
