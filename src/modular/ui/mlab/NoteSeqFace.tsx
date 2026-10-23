/**
 * M NoteSeq's face: a Numerology MonoNote/PolyNote front panel carrying one
 * voice of M, tightened.
 *
 * Every lane is on screen at once and each is only as tall as what it holds
 * — the note grid, then thin rows for Accent, Legato and Rhythm (each with
 * its own cycle length, so M's polymeter can be seen), Velocity and the Warp
 * lane — the way Consequence stacks its lanes. Skip, Mute and Random Jump
 * share one chip row above the steps, as Omnisphere's arpeggiator puts a
 * modifier over each step. Each lane has its own dice. Pairs that are one
 * thing — the Velocity Range — are one two-thumb slider.
 */

import { useEffect, useRef, useState } from "react";
import type { CyclicStep, CyclicVariable, NoteOrderMix } from "../../../engine/types";
import { Rng } from "../../../engine/rng";
import { normalizeCyclicStep } from "../../../engine/cyclic";
import { NOTE_NAMES, SCALES } from "../../../engine/music";
import {
  AdvancedPanel, AdvancedToggle, DiceIcon, LaneLabel, N4Box, N4Button, N4Field, N4Panel, N4Scrollbar, N4Slider, N4Spinner, N4Stepper,
  NoteGrid, RangeSlider, SliderLane, SplitBar, StepChips, StepLabels, VISIBLE_STEPS,
} from "../n4/kit";
import { applyRowAction, cellRangeDrag, moveSelected, nextChip, nextJump, type RowAction } from "../n4/logic";
import { DIRECTION_LABELS, MAX_SEQ_STEPS, SEQ_DIRECTIONS, invertPitches } from "../../mlab/noteSeq";
import { GENERATORS, generate, type GeneratorId } from "../../mlab/generate";
import { DEFAULT_EVOLVE, EVOLVE_TRANSFORMS, evolve, type EvolveConfig, type EvolveDimension } from "../../mlab/evolve";
import {
  RATE_OPTIONS, applyMaterial, cellLengthInPlay, cellsInPlay, currentMaterial, normGates, patternInPlay, randomizeLane, rateOf,
  setCellLength, setCellValue, setEndStep, setRate, setWarpLength, setWarpStep, shiftAll, toggleNoteIn, warpInPlay,
  zeroPitchesIn, type LaneId,
} from "../../mlab/noteSeqEdit";
import { MAX_WARP_OFFSET } from "../../mlab/warpSteps";
import { fitPitchRows } from "../../mlab/patternEdit";
import { POSITION_LABELS, type CycleValues } from "../../mlab/model";
import { param, useMLabHost, usePresets, type MLabFaceProps } from "./common";
import { PresetSlots } from "../n4/PresetManager";

const freshRng = () => new Rng((Math.random() * 0x7fffffff) >>> 0);
const H_SYNC = [["none", "None"], ["1", "1 Beat"], ["2", "2 Beats"], ["4", "1 Bar"], ["8", "2 Bars"], ["16", "4 Bars"]] as const;
const RUN_MODES = [["normal", "Normal"], ["manual", "Manual"], ["cv-gated", "CV Trig: Gated"], ["cv-step", "CV Trig: Step"]] as const;
const options = <T extends string>(pairs: readonly (readonly [T, string])[]) => pairs.map(([value, label]) => ({ value, label }));
const LANE_HEIGHT = 22;

export function NoteSeqFace({ node, setParameter, setParameters, status }: MLabFaceProps) {
  const host = useMLabHost();
  const p = node.parameters;
  const pattern = patternInPlay(p);
  const view = param<"orig" | "scram">(node, "pitch-view", "orig");
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
  const warp = warpInPlay(p);
  const presets = usePresets(node, setParameters);
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

  const grown = <T,>(id: string, length: number, fill: T): T[] =>
    Array.from({ length: Math.max(length, param<T[]>(node, id, []).length) }, (_, i) => param<T[]>(node, id, [])[i] ?? fill);
  const toggleChip = (step: number, how: "chip" | "jump" | "select") => {
    const n = Math.max(step + 1, pattern.length);
    if (how === "select") {
      const next = grown("select", n, false);
      next[step] = !next[step];
      setParameter("select", next);
    } else if (how === "jump") {
      const next = grown("rnd-jump", n, 0);
      next[step] = nextJump(next[step]);
      setParameter("rnd-jump", next);
    } else {
      const skip = grown("skip", n, false);
      const mute = grown("mute", n, false);
      const chip = nextChip({ skip: skip[step], mute: mute[step] });
      skip[step] = chip.skip;
      mute[step] = chip.mute;
      setParameters({ skip, mute });
    }
  };
  const rowAction = (id: "skip" | "mute" | "select", action: RowAction, on: boolean) => {
    const base = grown(id, pattern.length, false).map((v) => v === true);
    setParameter(id, applyRowAction(base, action, on, range, freshRng()));
  };
  const setLaneValue = (id: string, min: number, max: number) => (step: number, value: number) =>
    setParameter(id, moveSelected(grown(id, step + 1, 0), flags("select"), step, value, min, max));
  const dice = (id: LaneId) => (share: "few" | "some" | "most" | "all") => setParameters(randomizeLane(p, id, share, freshRng()));
  const cellLane = (kind: CyclicVariable, show: (level: number) => string) => {
    const playingCell = playingCells[["accent", "legato", "rhythm"].indexOf(kind)] ?? -1;
    return (
      <SliderLane compact height={LANE_HEIGHT} values={cellsInPlay(p, kind)} window={cellWindow} min={0} max={4} step={1} format="level"
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
    setParameters(applyMaterial(p, generate(id, currentMaterial(p), freshRng(), { preserveRests: p["preserve-rests"] === true })));
  };
  const runEvolve = (d: EvolveDimension) =>
    setParameters(applyMaterial(p, evolve(d, param<EvolveConfig>(node, "evolve", DEFAULT_EVOLVE), currentMaterial(p), freshRng())));
  const invert = () => {
    const groups = [...(p.patterns as unknown as typeof pattern[])];
    groups[Math.round(param(node, "group", 0))] = {
      ...pattern, steps: invertPitches(pattern.steps, pattern.length), scrambled: invertPitches(pattern.scrambled, pattern.length),
    };
    setParameter("patterns", groups as never);
  };

  const evolveConfig = param<EvolveConfig>(node, "evolve", DEFAULT_EVOLVE);
  const steps = view === "orig" ? pattern.steps : pattern.scrambled;
  const activeStep = (s: number) => s < pattern.length;

  // Global settings ride in a toolbar above the steps, as Omnisphere's
  // arpeggiator and WaveNode's sequencer carry theirs.
  const toolbar = <>
    <div className="n4-toolbar">
      <div className="n4-transport">
        <N4Button icon onClick={() => host?.command(node.id, "reset")} title="Reset to the start step">⏮</N4Button>
        <N4Button icon on={p.play === false} onClick={() => setParameters({ play: false, "run-mode": "manual" })} title="Stop">■</N4Button>
        <N4Button icon on={p.play !== false} onClick={() => setParameter("play", true)} title="Play">▶</N4Button>
        <N4Button icon on={showRun} onClick={() => setShowRun(!showRun)} title="Run Mode">E</N4Button>
        <N4Button icon on={p["mute-all"] === true} onClick={() => setParameter("mute-all", p["mute-all"] !== true)} title="Mute">M</N4Button>
      </div>
      {showRun && <N4Spinner value={param(node, "run-mode", "normal")} options={options(RUN_MODES)}
        onChange={(value) => setParameter("run-mode", value)} />}
      <N4Spinner label="Rate" value={rateOf(p)} options={[...RATE_OPTIONS.map((r) => ({ value: r.value as string, label: r.label })),
        ...(RATE_OPTIONS.some((r) => r.value === rateOf(p)) ? [] : [{ value: rateOf(p), label: rateOf(p) }])]}
        onChange={(value) => setParameters(setRate(value))} />
      <N4Spinner label="Dir" value={param(node, "dir", "fwd")} options={SEQ_DIRECTIONS.map((d) => ({ value: d, label: DIRECTION_LABELS[d] }))}
        onChange={(value) => setParameter("dir", value)} />
      <N4Spinner label="Sync" value={param(node, "h-sync", "none")} options={options(H_SYNC)}
        onChange={(value) => setParameter("h-sync", value)} />
      <span className="n4-toolbar__gap" />
      <N4Spinner value={param(node, "key", 0)} options={NOTE_NAMES.map((name, i) => ({ value: i, label: name }))}
        onChange={(value) => setParameter("key", value)} />
      <N4Spinner value={param(node, "scale", "major")} options={Object.keys(SCALES).map((s) => ({ value: s, label: s[0].toUpperCase() + s.slice(1) }))}
        onChange={(value) => setParameter("scale", value)} />
      <N4Stepper label="Oct" value={param(node, "octave", 0)} min={-4} max={4} onChange={(v) => setParameter("octave", v)} />
      <N4Stepper label="Trn" value={param(node, "transposition", 0)} min={-48} max={48} onChange={(v) => setParameter("transposition", v)} />
      <span className="n4-toolbar__gap" />
      <PresetSlots handlers={presets} />
      <AdvancedToggle open={p.advanced === true} onToggle={() => setParameter("advanced", p.advanced !== true)} />
    </div>
    <div className="n4-toolbar n4-toolbar--sub">
      <span className="n4-label">Generate</span>
      <N4Spinner value={param<GeneratorId>(node, "generate", "rescramble")}
        options={GENERATORS.map((g) => ({ value: g.id, label: g.label }))}
        onChange={(value) => setParameter("generate", value)} />
      <label className="n4-check" title="Don't scramble rests"><input type="checkbox" checked={p["preserve-rests"] === true}
        onChange={(event) => setParameter("preserve-rests", event.currentTarget.checked)} />rests</label>
      <N4Button onClick={runGenerate}>Now</N4Button>
      <span className="n4-toolbar__gap" />
      <span className="n4-label">Evolve</span>
      {(["x", "y", "z"] as EvolveDimension[]).map((d) => <N4Button icon key={d} onClick={() => runEvolve(d)}>{d.toUpperCase()}</N4Button>)}
      <N4Button on={p["evolve-auto"] === true} onClick={() => setParameter("evolve-auto", p["evolve-auto"] !== true)}>Auto</N4Button>
      <N4Button icon on={showEvolve} onClick={() => setShowEvolve(!showEvolve)} title="Edit the transformations">E</N4Button>
      <span className="n4-toolbar__gap" />
      <N4Button icon onClick={() => setParameters(shiftAll(p, -1))} title="Shift every step left">&lt;&lt;</N4Button>
      <N4Button icon onClick={() => setParameters(shiftAll(p, 1))} title="Shift every step right">&gt;&gt;</N4Button>
    </div>
  </>;

  return (
    <N4Panel accent={view === "scram" ? "blue" : "orange"} wide>
      {toolbar}
      <div className="n4-centre">
        {/* Each lane's own controls sit at its left, as Consequence keeps Gate's next to Gate. */}
        <div className="n4-rowgrid n4-rowgrid--aside">
          <span className="n4-spacer" />
          <span className="n4-spacer" />
          <StepLabels window={w} start={start} end={pattern.length - 1} playing={playing}
            onStart={(step) => setParameter("start", step)} onEnd={(step) => setParameters(setEndStep(p, step))} />

          <span className="n4-spacer" />
          <StepChips window={w} skip={flags("skip")} mute={flags("mute")} jump={lane("rnd-jump")} select={flags("select")}
            onToggle={toggleChip} onAction={rowAction} onClear={() => setParameters({ skip: [], mute: [], "rnd-jump": [], select: [] })} />

          <div className="n4-aside">
            <div className="n4-line">
              <div className="n4-tabs" role="tablist" aria-label="Pitch list">
                {(["orig", "scram"] as const).map((v) => (
                  <button type="button" role="tab" key={v} aria-selected={view === v} className={view === v ? "is-on" : ""}
                    onClick={(event) => { event.stopPropagation(); setParameter("pitch-view", v); }}>{v === "orig" ? "Orig" : "Scram"}</button>
                ))}
              </div>
              <span className="n4-sidebtns">
                <button type="button" title="Randomize pitches" onClick={() => setParameters(randomizeLane(p, "pitch", "few", freshRng()))}><DiceIcon /></button>
                <button type="button" title="Zero All: every note to the first" onClick={() => setParameters(zeroPitchesIn(p))}>∅</button>
                <button type="button" title="Invert" onClick={invert}>1/x</button>
              </span>
            </div>
            <span className="n4-label">Note Order</span>
            <SplitBar mix={mix} onChange={(next) => setParameter("note-order", next)} />
            <N4Slider label="Density" value={param(node, "density", 1)} min={0} max={1} onChange={(v) => setParameter("density", v)}
              format={(v) => `${Math.round(v * 100)}%`} />
          </div>
          <NoteGrid steps={steps} rows={fitPitchRows(pattern)} window={w} length={pattern.length}
            onToggle={(step, pitch) => setParameters(toggleNoteIn(p, view, step, pitch))}
            playing={playing} source={status.source ?? ""} />

          <div className="n4-aside">
            <RangeSlider label="Vel range" low={param(node, "vel-low", 48)} high={param(node, "vel-high", 110)} min={1} max={127}
              onChange={(low, high) => setParameters({ "vel-low": low, "vel-high": high })} />
          </div>
          <LaneLabel name="Accent" length={cellLengthInPlay(p, "accent")} onDice={dice("accent")} />
          {cellLane("accent", String)}

          <div className="n4-aside">
            <N4Slider label="Gate adj" value={param(node, "legato", 1)} min={0} max={2} onChange={(v) => setParameter("legato", v)} />
          </div>
          <LaneLabel name="Legato" length={cellLengthInPlay(p, "legato")} onDice={dice("legato")} />
          {cellLane("legato", (level) => `${values.legato[level]}%`)}

          <div className="n4-aside n4-aside--row">
            <N4Button small onClick={() => setParameters(normGates(p))} title="Every legato cell to the middle level">Norm gate</N4Button>
          </div>
          <LaneLabel name="Rhythm" length={cellLengthInPlay(p, "rhythm")} onDice={dice("rhythm")} />
          {cellLane("rhythm", (level) => `×${values.rhythm[level]}`)}

          <div className="n4-aside n4-aside--row">
            <N4Button small onClick={() => setParameter("velocity", [])} title="Velocity lane to zero">Norm vel</N4Button>
          </div>
          <LaneLabel name="Velocity" onDice={dice("velocity")} />
          <SliderLane compact bipolar height={LANE_HEIGHT} values={grown("velocity", w.first + w.count, 0)} window={w} min={-1} max={1} step={0.01} format="signed"
            display={(v) => (Number(v) === 0 ? "" : `${Number(v) > 0 ? "+" : ""}${Math.round(Number(v) * 63)}`)}
            onChange={setLaneValue("velocity", -1, 1)} playing={playing} active={activeStep} />

          <div className="n4-aside n4-aside--row">
            <N4Spinner label="Pos" value={Math.round(param(node, "warp-position", 0))}
              options={POSITION_LABELS.map((name, i) => ({ value: i, label: name }))} onChange={(v) => setParameter("warp-position", v)} />
          </div>
          <LaneLabel name="Warp" length={warp.length} onDice={dice("warp")} />
          <SliderLane compact bipolar fixedFirst height={LANE_HEIGHT} values={warp.offsets} window={cellWindow}
            min={-MAX_WARP_OFFSET} max={MAX_WARP_OFFSET} step={0.01} format="signed"
            display={(v) => (Number(v) === 0 ? "" : Number(v).toFixed(2))}
            onChange={(step, value) => { if (step > 0) setParameters(setWarpStep(p, step, value)); }}
            ownLength={warp.length} onOwnLength={(length) => setParameters(setWarpLength(p, length))} playing={-1} />

          <span className="n4-spacer" />
          <span className="n4-spacer" />
          <N4Scrollbar first={w.first} total={total} onScroll={(value) => setParameter("scroll", value)} />
        </div>
      </div>
      {showEvolve && (
        <N4Box title="Evolve transformations">
          {(["x", "y", "z"] as EvolveDimension[]).map((d) => (
            <div className="n4-line n4-line--wrap" key={d}>
              <b className="n4-value">{d.toUpperCase()}</b>
              {EVOLVE_TRANSFORMS.map((t) => {
                const entry = evolveConfig[d].find((e) => e.id === t.id);
                return (
                  <label key={t.id} className="n4-field" title={t.label}>
                    <span className="n4-label">{t.label}</span>
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
      <AdvancedPanel toggle={false} open={p.advanced === true} onToggle={() => setParameter("advanced", p.advanced !== true)}>
        <N4Field label="Voice" value={param(node, "voice", 1)} min={1} max={8} onChange={(v) => setParameter("voice", v)} />
        <N4Field label="MIDI Channel" value={param(node, "channel", 1)} min={1} max={16} onChange={(v) => setParameter("channel", v)} />
        <N4Field label="Rate (n)" value={param(node, "rate-num", 1)} min={1} max={64} onChange={(v) => setParameter("rate-num", v)} />
        <N4Field label="Rate (/d)" value={param(node, "rate-den", 8)} min={1} max={64} onChange={(v) => setParameter("rate-den", v)} />
        <N4Field label="Seq Size" value={pattern.length} min={1} max={MAX_SEQ_STEPS} onChange={(v) => setParameters(setEndStep(p, v - 1))} width={5} />
        <N4Spinner label="Pattern group" value={Math.round(param(node, "group", 0))}
          options={POSITION_LABELS.map((name, i) => ({ value: i, label: name }))} onChange={(v) => setParameter("group", v)} />
        <N4Slider label="Warp amount" value={param(node, "warp-amount", 1)} min={0} max={1} onChange={(v) => setParameter("warp-amount", v)}
          format={(v) => `${Math.round(v * 100)}%`} />
        {(["scale-snap", "diatonic", "chord-tones"] as const).map((id) => (
          <label className="n4-check" key={id}><input type="checkbox" checked={p[id] === true}
            onChange={(event) => setParameter(id, event.currentTarget.checked)} />
            {{ "scale-snap": "Scale Snap", diatonic: "Diatonic Transpose", "chord-tones": "Chord Tones" }[id]}</label>
        ))}
        {(["legato", "rhythm"] as const).map((kind) => (
          <div className="n4-line" key={kind}>
            <span className="n4-label">{kind === "legato" ? "Legato %" : "Rhythm ×"}</span>
            {values[kind].map((value, level) => (
              <input key={level} className="n4-input" type="number" value={value} style={{ width: "3.4em" }} aria-label={`${kind} level ${level}`}
                onChange={(event) => {
                  const next = structuredClone(values);
                  next[kind][level] = Number(event.currentTarget.value) || 0;
                  setParameter("cycle-values", next as never);
                }} />
            ))}
          </div>
        ))}
        <div className="n4-line">
          <span className="n4-label">Cycle positions</span>
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
