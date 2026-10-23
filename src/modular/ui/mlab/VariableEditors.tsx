/**
 * M's Variable edit windows, laid out as M lays them out and drawn in the
 * modules' finish: Note Density (a 0–100 scale, each voice a bar ending in a
 * square), Velocity Range (low · band · high), Transposition (the note and
 * octave Middle C lands on) and Note Order (each voice's Original | Cyclic |
 * Utterly bar, numbered). Each has M's six position boxes at its top right.
 */

import { useRef } from "react";
import type { NoteOrderMix, VelocityRange } from "../../../engine/types";
import { setNoteOrderBoundary } from "../../../engine/transform";
import { usePointerDrag } from "../n4/kit";
import { densityAt, dragVelocityRange, transpositionLabel, transposeBy } from "../../mlab/variableEdit";
import { POSITION_LABELS } from "../../mlab/model";

const VOICES = [0, 1, 2, 3];

/** The window's title and M's six position boxes, the one being edited filled. */
export function EditorHead({ title, position, onPosition }: { title: string; position: number; onPosition: (p: number) => void }) {
  return (
    <div className="m-ed__head">
      <span className="m-ed__title">{title}</span>
      <span className="m-ed__positions" role="group" aria-label={`${title} position`}>
        {POSITION_LABELS.map((label, p) => (
          <button type="button" key={label} className={p === position ? "is-on" : ""} aria-pressed={p === position}
            title={`Position ${label}`} onClick={(event) => { event.stopPropagation(); onPosition(p); }} />
        ))}
      </span>
    </div>
  );
}

export function DensityEditor({ values, onChange }: { values: readonly number[]; onChange: (voice: number, value: number) => void }) {
  return (
    <div className="m-ed m-ed--density">
      <div className="m-ed__row m-ed__row--scale">
        <span /><span className="m-ed__unit">%</span>
        <div className="m-ed__scale">{[0, 25, 50, 75, 100].map((n) => <span key={n} style={{ left: `${n}%` }}>{n}</span>)}</div>
      </div>
      {VOICES.map((v) => <DensityRow key={v} voice={v} value={values[v] ?? 1} onChange={(x) => onChange(v, x)} />)}
    </div>
  );
}

function DensityRow({ voice, value, onChange }: { voice: number; value: number; onChange: (value: number) => void }) {
  const drag = usePointerDrag((x, _y, rect) => onChange(densityAt(x, rect.width)));
  return (
    <div className={`m-ed__row uvoice uvoice--${voice + 1}`}>
      <span className="m-ed__voice">{voice + 1}</span>
      <span className="m-ed__box">{Math.round(value * 100)}</span>
      <div className="m-ed__track m-ed__track--grid" ref={drag.ref} onPointerDown={drag.onPointerDown} data-n4-control="true"
        role="slider" aria-label={`Voice ${voice + 1} note density`} aria-valuenow={Math.round(value * 100)}>
        <span className="m-ed__bar" style={{ width: `${value * 100}%` }} />
        <span className="m-ed__square" style={{ left: `${value * 100}%` }} />
      </div>
    </div>
  );
}

export function VelocityEditor({ values, onChange }: { values: readonly VelocityRange[]; onChange: (voice: number, range: VelocityRange) => void }) {
  return (
    <div className="m-ed m-ed--velocity">
      {VOICES.map((v) => <VelocityRow key={v} voice={v} range={values[v] ?? { low: 48, high: 110 }} onChange={(r) => onChange(v, r)} />)}
    </div>
  );
}

function VelocityRow({ voice, range, onChange }: { voice: number; range: VelocityRange; onChange: (range: VelocityRange) => void }) {
  const grab = useRef<{ part: "low" | "high" | "band"; from: number; start: VelocityRange }>({ part: "band", from: 0, start: range });
  const drag = usePointerDrag((x, _y, rect, phase) => {
    const value = 1 + (x / rect.width) * 126;
    if (phase === "down") {
      const inside = value > range.low + 3 && value < range.high - 3;
      grab.current = {
        part: inside ? "band" : Math.abs(value - range.low) <= Math.abs(value - range.high) ? "low" : "high",
        from: value, start: range,
      };
    }
    const { part, from, start } = grab.current;
    onChange(dragVelocityRange(start, part, value, value - from));
  });
  const at = (v: number) => `${((v - 1) / 126) * 100}%`;
  return (
    <div className={`m-ed__row m-ed__row--range uvoice uvoice--${voice + 1}`}>
      <span className="m-ed__voice">{voice + 1}</span>
      <span className="m-ed__box">{range.low}</span>
      <div className="m-ed__track" ref={drag.ref} onPointerDown={drag.onPointerDown} data-n4-control="true"
        role="group" aria-label={`Voice ${voice + 1} velocity ${range.low} to ${range.high}`}>
        <span className="m-ed__line" />
        <span className="m-ed__band" style={{ left: at(range.low), width: `calc(${at(range.high)} - ${at(range.low)})` }} />
      </div>
      <span className="m-ed__box">{range.high}</span>
    </div>
  );
}

export function TranspositionEditor({ values, onChange }: { values: readonly number[]; onChange: (voice: number, semitones: number) => void }) {
  const any = values.slice(0, 4).some((v) => v !== 0);
  return (
    <div className="m-ed m-ed--transpose">
      <div className="m-ed__cells">
        <div className="m-ed__row m-ed__row--head"><span /><span className="m-ed__unit">Note</span><span className="m-ed__unit">Oct</span></div>
        {VOICES.map((v) => {
          const t = values[v] ?? 0;
          const { note, octave } = transpositionLabel(t);
          return (
            <div key={v} className={`m-ed__row uvoice uvoice--${v + 1}`}>
              <span className="m-ed__voice">{v + 1}</span>
              <StepCell label={`Voice ${v + 1} note`} text={note} onStep={(n) => onChange(v, transposeBy(t, "note", n))} />
              <StepCell label={`Voice ${v + 1} octave`} text={String(octave)} onStep={(n) => onChange(v, transposeBy(t, "octave", n))} />
            </div>
          );
        })}
      </div>
      <div className="m-ed__note" title={any ? "Transposed" : "No Transposition"}>Mid C<br /><b>C3</b></div>
    </div>
  );
}

/** A cell you drag up or down a step at a time, or nudge with the wheel or arrow keys. */
function StepCell({ text, label, onStep }: { text: string; label: string; onStep: (steps: number) => void }) {
  const origin = useRef(0);
  const drag = usePointerDrag((_x, y, _rect, phase) => {
    if (phase === "down") { origin.current = y; return; }
    const steps = Math.trunc((origin.current - y) / 8);
    if (steps !== 0) { onStep(steps); origin.current -= steps * 8; }
  });
  return (
    <span className="m-ed__box m-ed__box--step" ref={drag.ref} onPointerDown={drag.onPointerDown} data-n4-control="true"
      role="spinbutton" aria-label={label} aria-valuetext={text} tabIndex={0} title="Drag up or down"
      onKeyDown={(event) => { if (event.key === "ArrowUp") onStep(1); if (event.key === "ArrowDown") onStep(-1); }}>
      {text}
    </span>
  );
}

export function NoteOrderEditor({ values, onChange }: { values: readonly NoteOrderMix[]; onChange: (voice: number, mix: NoteOrderMix) => void }) {
  return (
    <div className="m-ed m-ed--order">
      {VOICES.map((v) => <OrderRow key={v} voice={v} mix={values[v] ?? { original: 100, cyclic: 0, utterly: 0 }} onChange={(m) => onChange(v, m)} />)}
      <div className="m-ed__legend">
        <span><i className="is-original" />Original Order</span>
        <span><i className="is-cyclic" />Cyclic Random</span>
        <span><i className="is-utterly" />Utterly Random</span>
      </div>
    </div>
  );
}

function OrderRow({ voice, mix, onChange }: { voice: number; mix: NoteOrderMix; onChange: (mix: NoteOrderMix) => void }) {
  const edge = useRef<"originalEnd" | "utterlyStart">("originalEnd");
  const drag = usePointerDrag((x, _y, rect, phase) => {
    const position = Math.round(Math.max(0, Math.min(100, (x / rect.width) * 100)));
    if (phase === "down") edge.current = Math.abs(position - mix.original) <= Math.abs(position - (100 - mix.utterly)) ? "originalEnd" : "utterlyStart";
    onChange(setNoteOrderBoundary(mix, edge.current, position));
  });
  return (
    <div className={`m-ed__row m-ed__row--order uvoice uvoice--${voice + 1}`}>
      <span className="m-ed__voice">{voice + 1}</span>
      <div className="m-ed__order" ref={drag.ref} onPointerDown={drag.onPointerDown} data-n4-control="true"
        role="group" aria-label={`Voice ${voice + 1} note order ${mix.original}, ${mix.cyclic}, ${mix.utterly}`}>
        <span className="is-original" style={{ width: `${mix.original}%` }} />
        <span className="is-cyclic" style={{ width: `${mix.cyclic}%` }} />
        <span className="is-utterly" style={{ width: `${mix.utterly}%` }} />
        <b className="m-ed__num" style={{ left: 0 }}>{mix.original}</b>
        <b className="m-ed__num m-ed__num--mid" style={{ left: `${mix.original + mix.cyclic / 2}%` }}>{mix.cyclic}</b>
        <b className="m-ed__num" style={{ right: 0 }}>{mix.utterly}</b>
      </div>
    </div>
  );
}
