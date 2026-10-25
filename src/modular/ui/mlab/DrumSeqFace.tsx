/**
 * The Drum Sequencer's face: Numerology 4's DrumSeq front panel (manual
 * p119), in its red, tightened the way the M NoteSeq face is.
 *
 * A toolbar carries the transport, Rate, the pattern length, Swing and the
 * track count. Below the step labels — the red end marker is the pattern
 * length — each pad has its row: its name (double-click to rename), its note,
 * its own length (polymeter: "Pat" follows the pattern), a mute, and sixteen
 * pads that light when on, filled to their velocity, marked with a ratchet
 * count, an ƒ for a flam and a percentage when they only play some of the
 * time. Under the rows, one slider lane edits the selected row: Velocity,
 * Chance, Flam or Ratchet, picked from the tabs; its red marker drags that
 * row's own length.
 *
 * The playhead moves by class, ten times a second, without rendering the
 * body: each row's pads carry `row-<n>`, so a short row's light runs on its
 * own cycle (see n4/playhead.ts).
 */

import { memo, useLayoutEffect, useRef, useState } from "react";
import { applyPlayhead } from "../n4/playhead";
import {
  AdvancedPanel, AdvancedToggle, DiceIcon, LaneLabel, N4Button, N4Field, N4Panel, N4Scrollbar, N4Slider, N4Spinner,
  SliderLane, StepLabels, VISIBLE_STEPS,
} from "../n4/kit";
import {
  DRUM_LANES, MAX_DRUM_ROWS, MAX_DRUM_STEPS, clearRow, drumPlayheadMarks, readDrumRows, rowLength, setRowField,
  setStepValue, shiftRow, stepValue, toggleStep, type DrumLane, type DrumRow,
} from "../../drums/drumSeq";
import { DRUM_KITS, rowsFromKit } from "../../drums/drumKits";
import { RATE_OPTIONS, rateOf, setRate } from "../../mlab/noteSeqEdit";
import { noteName } from "../PercussionSlots";
import { PresetSlots } from "../n4/PresetManager";
import { param, useMLabHost, usePresets, type MLabFaceProps } from "./common";

const LANES: Record<DrumLane, { label: string; min: number; max: number; step: number; show: (v: number) => string }> = {
  vel: { label: "Velocity", min: 1, max: 127, step: 1, show: (v) => String(Math.round(v)) },
  prob: { label: "Chance", min: 0, max: 1, step: 0.05, show: (v) => (v >= 1 ? "" : `${Math.round(v * 100)}%`) },
  flam: { label: "Flam", min: 0, max: 1, step: 0.05, show: (v) => (v <= 0 ? "" : `${Math.round(v * 100)}`) },
  ratchet: { label: "Ratchet", min: 1, max: 8, step: 1, show: (v) => (v <= 1 ? "" : `×${v}`) },
};
const LENGTH_OPTIONS = [{ value: 0, label: "Pat" }, ...Array.from({ length: MAX_DRUM_STEPS }, (_, i) => ({ value: i + 1, label: String(i + 1) }))];

export function DrumSeqFace({ node, setParameter, setParameters, status }: MLabFaceProps) {
  const root = useRef<HTMLDivElement | null>(null);
  const step = Number(status.step ?? -1);
  const rows = status.rows ?? "[]";
  useLayoutEffect(() => {
    let parsed: number[] = [];
    try { parsed = JSON.parse(rows) as number[]; } catch { parsed = []; }
    if (root.current) applyPlayhead(root.current, drumPlayheadMarks(step, parsed));
  });
  return <div ref={root} className="n4-playhead-root"><DrumSeqBody node={node} setParameter={setParameter} setParameters={setParameters} /></div>;
}

const DrumSeqBody = memo(function DrumSeqBody({ node, setParameter, setParameters }: Omit<MLabFaceProps, "status">) {
  const host = useMLabHost();
  const p = node.parameters;
  const rows = readDrumRows(p.rows);
  const tracks = Math.max(1, Math.min(MAX_DRUM_ROWS, Math.round(param(node, "tracks", 10))));
  const length = Math.max(1, Math.min(MAX_DRUM_STEPS, Math.round(param(node, "length", 16))));
  const editRow = Math.max(0, Math.min(tracks - 1, Math.round(param(node, "edit-row", 0))));
  const lane = param<DrumLane>(node, "edit-lane", "vel");
  const spec = LANES[lane] ?? LANES.vel;
  const longest = Math.max(length, ...rows.slice(0, tracks).map((row) => rowLength(row, length)));
  const total = Math.min(MAX_DRUM_STEPS, Math.max(VISIBLE_STEPS, Math.ceil(longest / VISIBLE_STEPS) * VISIBLE_STEPS));
  const w = { first: Math.max(0, Math.min(Math.round(param(node, "scroll", 0)), total - VISIBLE_STEPS)), count: VISIBLE_STEPS };
  const steps = Array.from({ length: w.count }, (_, i) => w.first + i);
  const presets = usePresets(node, setParameters);
  const [renaming, setRenaming] = useState<number | null>(null);

  const setRows = (next: DrumRow[]) => setParameter("rows", next as never);
  const edited = rows[editRow];
  const editedLength = rowLength(edited, length);

  const toolbar = <>
    <div className="n4-toolbar">
      <div className="n4-transport">
        <N4Button icon onClick={() => host?.command(node.id, "reset")} title="Back to step 1">⏮</N4Button>
        <N4Button icon on={p.play === false} onClick={() => setParameter("play", false)} title="Stop: silent, keeping its place">■</N4Button>
        <N4Button icon on={p.play !== false} onClick={() => setParameter("play", true)} title="Play">▶</N4Button>
      </div>
      <N4Spinner label="Rate" value={rateOf(p)} options={[...RATE_OPTIONS.map((r) => ({ value: r.value as string, label: r.label })),
        ...(RATE_OPTIONS.some((r) => r.value === rateOf(p)) ? [] : [{ value: rateOf(p), label: rateOf(p) }])]}
        onChange={(value) => setParameters(setRate(value))} />
      <N4Field label="Len" value={length} min={1} max={MAX_DRUM_STEPS} onChange={(v) => setParameter("length", v)} width={3} />
      <div className="n4-toolbar__cell"><N4Slider label="Swing" value={param(node, "swing", 50)} min={50} max={75} step={1}
        onChange={(v) => setParameter("swing", v)} format={(v) => `${Math.round(v)}%`} /></div>
      <N4Field label="Tracks" value={tracks} min={1} max={MAX_DRUM_ROWS} onChange={(v) => setParameter("tracks", v)} width={3} />
      <label className="n4-check" title="Each row loops on its own length, never restarted by the pattern">
        <input type="checkbox" checked={p.free === true} onChange={(event) => setParameter("free", event.currentTarget.checked)} />free rows</label>
      <span className="n4-toolbar__gap" />
      <PresetSlots handlers={presets} />
      <AdvancedToggle open={p.advanced === true} onToggle={() => setParameter("advanced", p.advanced !== true)} />
    </div>
    <div className="n4-toolbar n4-toolbar--sub">
      <div className="n4-tabs" role="tablist" aria-label="Lane shown">
        {DRUM_LANES.map((id) => (
          <button type="button" role="tab" key={id} aria-selected={lane === id} className={lane === id ? "is-on" : ""}
            onClick={(event) => { event.stopPropagation(); setParameter("edit-lane", id); }}>{LANES[id].label}</button>
        ))}
      </div>
      <div className="n4-toolbar__cell"><N4Slider label="Flam level" value={param(node, "flam-level", 0.6)} min={0} max={1}
        onChange={(v) => setParameter("flam-level", v)} format={(v) => `${Math.round(v * 100)}%`} /></div>
      <N4Field label="Seed" value={Math.round(param(node, "seed", 0))} min={0} max={9999} onChange={(v) => setParameter("seed", v)} width={4} />
      <span className="n4-sidebtns">
        <button type="button" title="New seed: the chances fall another way" onClick={() => setParameter("seed", Math.floor(Math.random() * 10000))}><DiceIcon /></button>
      </span>
      <span className="n4-toolbar__gap" />
      <span className="n4-label">{edited.name}</span>
      <N4Button icon onClick={() => setRows(shiftRow(rows, editRow, editedLength, -1))} title="Shift this row left">&lt;&lt;</N4Button>
      <N4Button icon onClick={() => setRows(shiftRow(rows, editRow, editedLength, 1))} title="Shift this row right">&gt;&gt;</N4Button>
    </div>
  </>;

  const head = (row: DrumRow, r: number) => (
    <div key={`head-${r}`} className={`n4-drumrow__head${r === editRow ? " is-edit" : ""}`}>
      {renaming === r
        ? <input className="n4-input n4-drumrow__rename" autoFocus defaultValue={row.name} aria-label={`Row ${r + 1} name`}
          onBlur={(event) => { setRows(setRowField(rows, r, { name: event.currentTarget.value.trim() || row.name })); setRenaming(null); }}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") setRenaming(null);
          }} />
        : <button type="button" className="n4-drumrow__name" title="Click to edit this row's lanes; double-click to rename"
          onClick={(event) => { event.stopPropagation(); setParameter("edit-row", r); }}
          onDoubleClick={(event) => { event.stopPropagation(); setRenaming(r); }}>{row.name}</button>}
      <input className="n4-input n4-drumrow__note" type="number" min={0} max={127} value={row.note}
        title={`Note ${noteName(row.note)}`} aria-label={`Row ${r + 1} note`}
        onChange={(event) => {
          const note = Number(event.currentTarget.value);
          if (Number.isFinite(note)) setRows(setRowField(rows, r, { note }));
        }} />
      <label className="n4-drumrow__len" title="This row's own length (Pat follows the pattern)">
        <select value={row.length} aria-label={`Row ${r + 1} length`}
          onChange={(event) => setRows(setRowField(rows, r, { length: Number(event.currentTarget.value) }))}>
          {LENGTH_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </label>
      <N4Button small icon on={row.mute} onClick={(event) => { event.stopPropagation(); setRows(setRowField(rows, r, { mute: !row.mute })); }}
        title={`Mute ${row.name}`}>M</N4Button>
    </div>
  );

  const pads = (row: DrumRow, r: number) => {
    const own = rowLength(row, length);
    return (
      <div key={`pads-${r}`} className={`n4-drumrow__pads${row.mute ? " is-muted" : ""}`} data-n4-control="true">
        {steps.map((s) => {
          const on = row.on[s] === true;
          const vel = stepValue(row, "vel", s);
          const ratchet = stepValue(row, "ratchet", s);
          const flam = stepValue(row, "flam", s);
          const prob = stepValue(row, "prob", s);
          return (
            <button type="button" key={s} data-playhead={`row-${r}`} data-step={s}
              className={`n4-pad${on ? " is-on" : ""}${s >= own ? " is-dim" : ""}${s % 4 === 0 ? " is-beat" : ""}`}
              aria-pressed={on} aria-label={`${row.name} step ${s + 1}`}
              title={`${row.name} step ${s + 1}: velocity ${vel}${prob < 1 ? `, ${Math.round(prob * 100)}% chance` : ""}${flam > 0 ? ", flam" : ""}${ratchet > 1 ? `, ×${ratchet}` : ""}`}
              onClick={(event) => {
                event.stopPropagation();
                if (event.altKey) setParameters({ "edit-row": r });
                else setRows(toggleStep(rows, r, s));
              }}>
              {on && <span className="n4-pad__vel" style={{ height: `${(vel / 127) * 100}%` }} />}
              {on && ratchet > 1 && <i className="n4-pad__ratchet">{ratchet}</i>}
              {on && flam > 0 && <i className="n4-pad__flam">ƒ</i>}
              {on && prob < 1 && <i className="n4-pad__prob">{Math.round(prob * 100)}</i>}
            </button>
          );
        })}
      </div>
    );
  };

  return (
    <N4Panel accent="red" narrow>
      {toolbar}
      <div className="n4-centre">
        <div className="n4-rowgrid n4-rowgrid--drum">
          <span className="n4-spacer" />
          <StepLabels window={w} start={0} end={length - 1} playing={-1} playhead="step" onEnd={(s) => setParameter("length", s + 1)} />
          <span className="n4-spacer" />

          {rows.slice(0, tracks).flatMap((row, r) => [
            head(row, r),
            pads(row, r),
            <button type="button" key={`clear-${r}`} className="n4-clear" aria-label={`Clear ${row.name}`} title={`Clear ${row.name}`}
              onClick={(event) => { event.stopPropagation(); setRows(clearRow(rows, r)); }}>×</button>,
          ])}

          <LaneLabel name={`${edited.name} ${spec.label}`} />
          <SliderLane compact height={26} values={Array.from({ length: total }, (_, s) => stepValue(edited, lane, s))} window={w}
            min={spec.min} max={spec.max} step={spec.step} format="number" display={(v) => spec.show(Number(v))}
            onChange={(s, value) => setRows(setStepValue(rows, editRow, lane, s, value))}
            ownLength={editedLength} onOwnLength={(own) => setRows(setRowField(rows, editRow, { length: own === length ? 0 : own }))}
            playing={-1} playhead={`row-${editRow}`} active={(s) => edited.on[s] === true} />
          <span className="n4-spacer" />

          <span className="n4-spacer" />
          <N4Scrollbar first={w.first} total={total} onScroll={(value) => setParameter("scroll", value)} />
          <span className="n4-spacer" />
        </div>
      </div>
      <AdvancedPanel toggle={false} open={p.advanced === true} onToggle={() => setParameter("advanced", p.advanced !== true)}>
        <N4Field label="MIDI Channel" value={param(node, "channel", 10)} min={1} max={16} onChange={(v) => setParameter("channel", v)} />
        <N4Field label="Rate (n)" value={param(node, "rate-num", 1)} min={1} max={64} onChange={(v) => setParameter("rate-num", v)} />
        <N4Field label="Rate (/d)" value={param(node, "rate-den", 16)} min={1} max={64} onChange={(v) => setParameter("rate-den", v)} />
        {DRUM_KITS.map((kit) => (
          <N4Button key={kit.id} onClick={() => setRows(rowsFromKit(kit, rows))}
            title={`Name and renote the first ${kit.pads.length} rows after the ${kit.name} kit's pads, keeping their steps`}>
            Rows from {kit.name}
          </N4Button>
        ))}
      </AdvancedPanel>
    </N4Panel>
  );
});

