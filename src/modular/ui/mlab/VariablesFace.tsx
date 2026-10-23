/**
 * M Variables' face: M's Variables, in the Numerology style of the other
 * M modules.
 *
 * One row per Variable — its name, its conducting arrow, and its six
 * Positions a–f, each drawn in miniature with M Clone's own VarThumb: "a
 * miniature representation of each of its six Positions … four vertically
 * arranged settings, one for each Voice." Click a Position to make it active,
 * Alt-click to mark it, click a name to edit that Variable's values below.
 * The Cyclic Variables and Orchestration rows read the Positions held by the
 * NoteSeqs and M Orchestra, and the Snapshot strip is M's snapshots a–z.
 */

import { useState } from "react";
import type { CyclicStep, CyclicVariable } from "../../../engine/types";
import { normalizeCyclicStep } from "../../../engine/cyclic";
import type { PositionValue, PositionVarId } from "../../../engine/variables";
import { ConductingArrow } from "../../../ui/ConductingArrow";
import { VarThumb } from "../../../ui/VarThumb";
import { M_LAB_TYPES } from "../../registry/mLabModules";
import { variablesStateOf } from "../../mlab/links";
import { POSITION_LABELS } from "../../mlab/model";
import { defaultCells, type SeqCells } from "../../mlab/noteSeq";
import { defaultWarpBanks, warpToTimeMap, type WarpBank } from "../../mlab/warpSteps";
import {
  SNAPSHOT_SLOTS, activate, recallSnapshot, setTableValue, storeSnapshot,
  type MVariable, type VariablesState,
} from "../../mlab/variables";
import type { GraphDocument, NodeInstance } from "../../model/graph";
import { N4Box, N4Button, N4Panel, N4Spinner, RangeSlider, SplitBar, VoiceFaders } from "../n4/kit";
import { param, useMLabHost, type MLabFaceProps } from "./common";

/** M shows four Voices in each miniature. */
const VOICES = [0, 1, 2, 3];

const ROWS: { id: MVariable; lines: [string, string]; thumb?: PositionVarId }[] = [
  { id: "patternGroup", lines: ["Pattern", "Group"] },
  { id: "density", lines: ["Note", "Density"], thumb: "density" },
  { id: "velocityRange", lines: ["Velocity", "Range"], thumb: "velocityRange" },
  { id: "noteOrder", lines: ["Note", "Order"], thumb: "noteOrderMix" },
  { id: "transposition", lines: ["Trans-", "position"], thumb: "transposition" },
  { id: "timeDistortion", lines: ["Time", "Distortion"], thumb: "timeDistort" },
  { id: "accent", lines: ["", "Accent"] },
  { id: "legato", lines: ["", "Legato"] },
  { id: "rhythm", lines: ["", "Rhythm"] },
  { id: "orchestration", lines: ["Orch-", "estration"], thumb: "outputChannels" },
  { id: "soundChoice", lines: ["Sound", "Choice"] },
];

const nodesOfType = (graph: GraphDocument | undefined, type: string): NodeInstance[] =>
  graph ? Object.values(graph.nodes).filter((node) => node.moduleType === type) : [];

/** The NoteSeq playing each of the four voices, if there is one. */
const seqForVoice = (graph: GraphDocument | undefined, voice: number) =>
  nodesOfType(graph, M_LAB_TYPES.noteSeq).find((node) => Math.round(Number(node.parameters.voice ?? 1)) === voice + 1);

/** The Time Warp cabled into a NoteSeq's Warp In. */
const warpFor = (graph: GraphDocument | undefined, seq: NodeInstance | undefined) => {
  if (!graph || !seq) return undefined;
  const edge = Object.values(graph.edges).find((e) => e.to.nodeId === seq.id && e.to.portId === "warp-in");
  return edge ? graph.nodes[edge.from.nodeId] : undefined;
};

export function VariablesFace({ node, setParameter, setParameters }: MLabFaceProps) {
  const host = useMLabHost();
  const graph = host?.graph;
  const state = variablesStateOf(node);
  const [editing, setEditing] = useState<MVariable>("density");
  const write = (next: VariablesState) => setParameters({
    tables: next.tables as never, active: next.active as never, arrows: next.arrows as never,
    marks: next.marks as never, snapshots: next.snapshots as never,
  });
  const orchestra = nodesOfType(graph, M_LAB_TYPES.orchestra)[0];

  /** What one Position holds, per voice, for its miniature. */
  const slot = (row: (typeof ROWS)[number], p: number): PositionValue[] | null => {
    switch (row.id) {
      case "density": return VOICES.map((v) => state.tables.density[p][v]);
      case "velocityRange": return VOICES.map((v) => state.tables.velocityRange[p][v]);
      case "noteOrder": return VOICES.map((v) => state.tables.noteOrder[p][v]);
      case "transposition": return VOICES.map((v) => state.tables.transposition[p][v]);
      case "timeDistortion": return VOICES.map((v) => {
        const warp = warpFor(graph, seqForVoice(graph, v));
        const bank = (warp?.parameters.banks as unknown as WarpBank[] | undefined)?.[p] ?? defaultWarpBanks()[0];
        return warpToTimeMap(bank);
      });
      case "orchestration": return VOICES.map((v) =>
        (orchestra?.parameters.orchestration as unknown as number[][][] | undefined)?.[p]?.[v] ?? [v + 1]);
      default: return null;
    }
  };

  /** The Cyclic Variables in miniature, as M's Cyclic Variables window draws them. */
  const cycleBars = (kind: CyclicVariable, p: number) => VOICES.map((v) => {
    const cells = (seqForVoice(graph, v)?.parameters.cells as unknown as SeqCells | undefined)?.[kind]?.[p] ?? defaultCells()[kind][p];
    const sum = (cells as CyclicStep[]).reduce<number>((total, cell) => total + normalizeCyclicStep(cell).max, 0);
    return <i key={v} className={`uvoice uvoice--${v + 1}`} style={{ width: `${Math.max(2, (sum / 64) * 100)}%` }} />;
  });

  const programs = (p: number) => {
    const row = (orchestra?.parameters.programs as unknown as (number | null)[][] | undefined)?.[p] ?? [];
    const set = row.map((program, channel) => (program === null ? null : `${channel + 1}:${program + 1}`)).filter(Boolean);
    return set.length ? set.slice(0, 2).join(" ") : "—";
  };

  return (
    <N4Panel accent="orange" wide>
    <div className="m-varwin">
      <N4Box>
      <div className="uvars">
        {ROWS.map((row) => (
          <div className={`uvars__row${editing === row.id ? " is-editing" : ""}`} key={row.id}>
            <button type="button" className="uvars__label" onClick={() => setEditing(row.id)}
              aria-label={`Edit ${row.lines.join(" ").trim()}`}>
              <span>{row.lines[0]}</span><span>{row.lines[1]}</span>
            </button>
            <ConductingArrow label={row.lines.join(" ").trim()} state={state.arrows[row.id]}
              onChange={(next) => write({ ...state, arrows: { ...state.arrows, [row.id]: next } })} />
            <div className="uvars__cells">
              {POSITION_LABELS.map((label, p) => {
                const on = state.active[row.id] === p;
                const art = slot(row, p);
                return (
                  <button type="button" key={label}
                    className={`umini${art ? "" : " umini--group"}${on ? " umini--on" : ""}${state.marks[row.id][p] ? " umini--marked" : ""}`}
                    aria-pressed={on} aria-label={`${row.lines.join(" ").trim()} position ${label}`}
                    title="Click to activate; Alt-click to mark"
                    onClick={(event) => {
                      if (event.altKey) {
                        write({ ...state, marks: { ...state.marks, [row.id]: state.marks[row.id].map((m, i) => (i === p ? !m : m)) } });
                      } else write(activate(state, row.id, p));
                    }}>
                    {art && row.thumb
                      ? <VarThumb id={row.thumb} slot={art} />
                      : row.id === "accent" || row.id === "legato" || row.id === "rhythm"
                        ? <span className="m-varwin__cyc"><b>{label}</b>{cycleBars(row.id, p)}</span>
                        : row.id === "soundChoice"
                          ? <span className="m-varwin__sound"><b>{label}</b><small>{programs(p)}</small></span>
                          : <span className="umini__letter">{label}</span>}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      </N4Box>
      <N4Box title={undefined}><ValueEditor state={state} variable={editing} write={write} /></N4Box>
      <div className="n4-syncstrip">
        <b>Snapshot</b>
        <div className="m-varwin__snapshots n4-snapshots" role="group" aria-label="Snapshots">
          {Array.from({ length: SNAPSHOT_SLOTS }, (_, i) => (
            <N4Button small key={i} className={state.snapshots[i] ? "is-stored" : ""} title="Click to recall; Shift-click to store"
              onClick={(event) => write(event.shiftKey ? storeSnapshot(state, i) : recallSnapshot(state, i))}>
              {String.fromCharCode(97 + i)}</N4Button>
          ))}
        </div>
        <N4Spinner label="Quantize" value={param(node, "snapshot-quantize", "now")}
          options={[{ value: "now", label: "Now" }, { value: "beat", label: "Beat" }, { value: "bar", label: "Bar" }]}
          onChange={(v) => setParameter("snapshot-quantize", v)} />
      </div>
    </div>
    </N4Panel>
  );
}

/**
 * The values of the active Position of the Variable being edited, one per
 * Voice. Density and Transposition are faders side by side, so all four
 * voices can be swept in one drag; Velocity Range is a two-thumb slider per
 * voice; Note Order is each voice's Orig | Scram | Rand bar. The Cyclic, Time
 * Distortion and Orchestration Positions are edited on the modules that hold
 * them.
 */
function ValueEditor({ state, variable, write }: {
  state: VariablesState; variable: MVariable; write: (next: VariablesState) => void;
}) {
  const position = state.active[variable];
  const names: Partial<Record<MVariable, string>> = {
    density: "Note Density", transposition: "Transposition", velocityRange: "Velocity Range", noteOrder: "Note Order",
  };
  const title = names[variable];
  if (!title) return <p className="m-varwin__note">This Variable's Positions are edited on the module that plays them.</p>;
  const heading = <div className="n4-lanelabel"><span className="n4-label">{title}</span><span className="n4-value">Position {POSITION_LABELS[position]}</span></div>;
  if (variable === "density" || variable === "transposition") {
    const values = VOICES.map((v) => state.tables[variable][position][v]);
    return <div className="m-varwin__editor">{heading}
      <VoiceFaders label={`${title} per voice`} values={values}
        min={variable === "density" ? 0 : -24} max={variable === "density" ? 1 : 24} step={variable === "density" ? 0.01 : 1}
        format={(v) => (variable === "density" ? `${Math.round(v * 100)}%` : v > 0 ? `+${v}` : String(v))}
        onChange={(v, value) => write(setTableValue(state, variable, position, v, value))} />
    </div>;
  }
  if (variable === "velocityRange") {
    return <div className="m-varwin__editor">{heading}
      {VOICES.map((v) => {
        const range = state.tables.velocityRange[position][v];
        return <div key={v} className={`m-varwin__voice uvoice uvoice--${v + 1}`}><b>{v + 1}</b>
          <RangeSlider label="" low={range.low} high={range.high} min={1} max={127}
            onChange={(low, high) => write(setTableValue(state, "velocityRange", position, v, { low, high }))} /></div>;
      })}
    </div>;
  }
  return <div className="m-varwin__editor">{heading}
    {VOICES.map((v) => (
      <div key={v} className={`m-varwin__voice uvoice uvoice--${v + 1}`}><b>{v + 1}</b>
        <SplitBar mix={state.tables.noteOrder[position][v]} onChange={(mix) => write(setTableValue(state, "noteOrder", position, v, mix))} />
      </div>
    ))}
  </div>;
}
