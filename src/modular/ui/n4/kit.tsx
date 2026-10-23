/**
 * The Numerology 4 look, as React parts.
 *
 * Every M module is drawn from these, laid out the way Numerology lays out a
 * module: a dark header strip, then a body of three columns — boxes of
 * controls at the left, the step lanes in the middle, boxes of actions at the
 * right — with the advanced settings behind a triangle at the bottom left.
 * The arithmetic lives in logic.ts; these only draw and forward the pointer.
 */

import { useRef, useState, type ReactNode } from "react";
import "./n4.css";
import type { CyclicStep, NoteOrderMix } from "../../../engine/types";
import { normalizeCyclicStep } from "../../../engine/cyclic";
import { ACTION_SHARES, formatLaneValue, laneValueFromY, polyNoteName, splitFromDrag, stepFromX, type LaneFormat, type RowAction } from "./logic";

/** Numerology colours a sequencer's handles by its kind. */
export type N4Accent = "orange" | "red" | "blue" | "yellow" | "tan" | "mauve" | "purple";

/** Steps shown at once; more scroll, as Numerology's sequencers do. */
export const VISIBLE_STEPS = 16;

export function N4Panel({ accent, children, wide }: { accent: N4Accent; children: ReactNode; wide?: boolean }) {
  return <div className={`n4 n4--${accent}${wide ? " n4--wide" : ""}`}>{children}</div>;
}

/** Left boxes, the lanes, right boxes. */
export function N4Body({ left, children, right }: { left?: ReactNode; children: ReactNode; right?: ReactNode }) {
  return (
    <div className="n4-body">
      {left && <div className="n4-col n4-col--left">{left}</div>}
      <div className="n4-centre">{children}</div>
      {right && <div className="n4-col n4-col--right">{right}</div>}
    </div>
  );
}

export function N4Box({ title, children, className = "" }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <div className={`n4-box ${className}`}>
      {title && <div className="n4-box__title">{title}</div>}
      {children}
    </div>
  );
}

/** Numerology's ⇕ menus: Rate, Mode, Dir, H.Sync, the Generate algorithm. */
export function N4Spinner<T extends string | number>({ label, value, options, onChange, wide }: {
  label?: string; value: T; options: readonly { value: T; label: string }[]; onChange: (value: T) => void; wide?: boolean;
}) {
  return (
    <label className={`n4-spinner${wide ? " n4-spinner--wide" : ""}`}>
      {label && <span className="n4-spinner__label">{label}</span>}
      <span className="n4-spinner__control">
        <span aria-hidden="true">⇕</span>
        <select value={String(value)} onChange={(event) => {
          const picked = options.find((option) => String(option.value) === event.currentTarget.value);
          if (picked) onChange(picked.value);
        }}>
          {options.map((option) => <option key={String(option.value)} value={String(option.value)}>{option.label}</option>)}
        </select>
      </span>
    </label>
  );
}

export function N4Button({ on, onClick, children, title, small, className = "" }: {
  on?: boolean; onClick: (event: React.MouseEvent) => void; children: ReactNode; title?: string; small?: boolean; className?: string;
}) {
  return (
    <button type="button" className={`n4-button${on ? " is-on" : ""}${small ? " n4-button--small" : ""} ${className}`}
      aria-pressed={on === undefined ? undefined : on} title={title} onClick={onClick}>{children}</button>
  );
}

export function N4Field({ label, value, onChange, min, max, step = 1, width = 4 }: {
  label?: string; value: number; onChange: (value: number) => void; min: number; max: number; step?: number; width?: number;
}) {
  return (
    <label className="n4-field">
      {label && <span>{label}</span>}
      <input type="number" value={value} min={min} max={max} step={step} style={{ width: `${width}em` }}
        onChange={(event) => {
          const next = Number(event.currentTarget.value);
          if (Number.isFinite(next)) onChange(Math.max(min, Math.min(max, next)));
        }} />
    </label>
  );
}

/** Track a pointer across an element from press to release. */
function usePointerDrag(onPoint: (x: number, y: number, rect: DOMRect, phase: "down" | "move", event: React.PointerEvent | PointerEvent) => void) {
  const ref = useRef<HTMLDivElement | null>(null);
  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    const element = event.currentTarget;
    const rect = element.getBoundingClientRect();
    // Measured on screen, then scaled back to the element's own pixels, so the
    // canvas zoom does not skew where a value lands.
    const scaleX = rect.width / Math.max(1, element.offsetWidth);
    const scaleY = rect.height / Math.max(1, element.offsetHeight);
    const local = (e: { clientX: number; clientY: number }) =>
      [(e.clientX - rect.left) / scaleX, (e.clientY - rect.top) / scaleY] as const;
    const own = new DOMRect(0, 0, element.offsetWidth, element.offsetHeight);
    const [x, y] = local(event);
    onPoint(x, y, own, "down", event);
    const move = (e: PointerEvent) => { const [mx, my] = local(e); onPoint(mx, my, own, "move", e); };
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  return { ref, onPointerDown };
}

/** A knob, turned by dragging up or down, as Numerology's Humanize and Gate Adj. */
export function N4Knob({ label, value, min, max, step = 0.01, onChange, format }: {
  label: string; value: number; min: number; max: number; step?: number; onChange: (value: number) => void; format?: (value: number) => string;
}) {
  const start = useRef<{ y: number; value: number } | null>(null);
  const t = (value - min) / Math.max(1e-9, max - min);
  const angle = -135 + t * 270;
  return (
    <div className="n4-knob" title={`${label}: ${format ? format(value) : value}`}>
      <div className="n4-knob__dial" role="slider" aria-label={label} aria-valuemin={min} aria-valuemax={max} aria-valuenow={value}
        tabIndex={0}
        onPointerDown={(event) => {
          event.stopPropagation();
          start.current = { y: event.clientY, value };
          (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (!start.current) return;
          const raw = start.current.value + ((start.current.y - event.clientY) / 150) * (max - min);
          const snapped = Math.round(raw / step) * step;
          onChange(Number(Math.max(min, Math.min(max, snapped)).toFixed(4)));
        }}
        onPointerUp={() => { start.current = null; }}
        onDoubleClick={() => onChange(min <= 0 && max >= 0 && min < 0 ? 0 : max)}>
        <svg viewBox="0 0 40 40" aria-hidden="true">
          <circle cx="20" cy="20" r="15" className="n4-knob__ring" />
          <path className="n4-knob__arc" d={arc(20, 20, 15, -135, angle)} />
          <line x1="20" y1="20" x2={20 + 11 * Math.sin((angle * Math.PI) / 180)} y2={20 - 11 * Math.cos((angle * Math.PI) / 180)} />
        </svg>
      </div>
      <span className="n4-knob__label">{label}</span>
      <span className="n4-knob__value">{format ? format(value) : value.toFixed(2)}</span>
    </div>
  );
}

function arc(cx: number, cy: number, r: number, from: number, to: number): string {
  const point = (deg: number) => [cx + r * Math.sin((deg * Math.PI) / 180), cy - r * Math.cos((deg * Math.PI) / 180)];
  const [x1, y1] = point(from);
  const [x2, y2] = point(Math.max(from + 0.01, to));
  return `M ${x1} ${y1} A ${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${x2} ${y2}`;
}

/* ===== The lanes ===== */

type Window = { first: number; count: number };
const columns = (w: Window) => Array.from({ length: w.count }, (_, i) => w.first + i);

/**
 * The row of step numbers, with the green start marker and red end marker
 * (manual p88). Drag a marker along the row to move it.
 */
export function StepLabels({ window: w, start, end, playing, onStart, onEnd, fixedFirst }: {
  window: Window; start: number; end: number; playing: number; onStart?: (step: number) => void; onEnd: (step: number) => void; fixedFirst?: boolean;
}) {
  const dragging = useRef<"start" | "end" | null>(null);
  const drag = usePointerDrag((x, _y, rect, phase, event) => {
    const step = w.first + stepFromX(x, rect.width, w.count);
    if (phase === "down") {
      const target = (event.target as Element).closest("[data-marker]")?.getAttribute("data-marker");
      dragging.current = target === "start" && onStart ? "start" : target === "end" ? "end"
        : Math.abs(step - start) < Math.abs(step - end) && onStart ? "start" : "end";
    }
    if (dragging.current === "start") onStart?.(step);
    else onEnd(step);
  });
  return (
    <div className="n4-steplabels" ref={drag.ref} onPointerDown={drag.onPointerDown} data-n4-control="true"
      title="Drag the green marker to set the start step, the red one to set the end">
      {columns(w).map((step) => (
        <span key={step} data-marker={step === start ? "start" : step === end ? "end" : undefined}
          className={`n4-steplabel${step === start ? " is-start" : ""}${step === end ? " is-end" : ""}${step === playing ? " is-playing" : ""}`}>
          {step === 0 && fixedFirst ? "1" : step + 1}
        </span>
      ))}
    </div>
  );
}

const ACTION_LABELS: Record<RowAction, string> = { one: "One", few: "a Few", some: "Some", most: "Most", all: "All" };

/** A row of step buttons — Skip, Sel, Mute — with its action menu and clear button. */
export function ButtonRow({ label, flags, window: w, onToggle, onAction, onClear, kind }: {
  label: string; flags: readonly boolean[]; window: Window; onToggle: (step: number) => void;
  onAction: (action: RowAction, on: boolean) => void; onClear: () => void; kind: "skip" | "select" | "mute";
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="n4-row">
      <div className="n4-row__menu">
        <button type="button" className="n4-gear" aria-label={`${label} actions`} aria-expanded={open}
          onClick={(event) => { event.stopPropagation(); setOpen(!open); }}>⚙▾</button>
        <span>{label}</span>
        {open && (
          <div className="n4-popup" role="menu" onClick={(event) => event.stopPropagation()}>
            {[true, false].map((on) => (Object.keys(ACTION_SHARES) as RowAction[]).map((action) => (
              <button type="button" role="menuitem" key={`${on}-${action}`}
                onClick={() => { onAction(action, on); setOpen(false); }}>
                {on ? label : `Un${label.toLowerCase()}`} {ACTION_LABELS[action]}
              </button>
            )))}
          </div>
        )}
      </div>
      <div className="n4-row__cells">
        {columns(w).map((step) => (
          <button type="button" key={step} className={`n4-cell n4-cell--${kind}${flags[step] ? " is-on" : ""}`}
            aria-pressed={flags[step] === true} aria-label={`${label} step ${step + 1}`}
            onClick={(event) => { event.stopPropagation(); onToggle(step); }} />
        ))}
      </div>
      <button type="button" className="n4-clear" aria-label={`Clear ${label}`} onClick={(event) => { event.stopPropagation(); onClear(); }}>×</button>
    </div>
  );
}

/** The stacked lane names at the left of a slider row; the lit one is the lane shown. */
export function LaneSelect<T extends string>({ options, value, onChange }: {
  options: readonly { value: T; label: string }[]; value: T; onChange: (value: T) => void;
}) {
  return (
    <div className="n4-laneselect" role="tablist">
      {options.map((option) => (
        <button type="button" role="tab" key={option.value} aria-selected={option.value === value}
          className={option.value === value ? "is-on" : ""} onClick={(event) => { event.stopPropagation(); onChange(option.value); }}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

/**
 * A row of per-step sliders: a bar handle on each step and its value printed
 * beneath, as Numerology's Gate and Velocity rows. Drag across it to draw.
 *
 * Cyclic lanes add two things M has and Numerology does not: their own red
 * end marker, because each cycle has its own length, and ranges — shift-drag
 * a step open into a span of levels and M picks inside it at random.
 */
export function SliderLane({ values, window: w, min, max, step, format, onChange, onRange, ownLength, onOwnLength, playing, active, display }: {
  values: readonly (number | CyclicStep)[];
  window: Window; min: number; max: number; step: number; format: LaneFormat;
  onChange: (step: number, value: number) => void;
  onRange?: (step: number, from: number, to: number) => void;
  ownLength?: number; onOwnLength?: (length: number) => void;
  playing: number; active?: (step: number) => boolean;
  display?: (value: number | CyclicStep) => string;
}) {
  const anchor = useRef<{ step: number; level: number } | null>(null);
  const drag = usePointerDrag((x, y, rect, phase, event) => {
    const at = w.first + stepFromX(x, rect.width, w.count);
    const value = laneValueFromY(y, rect.height, min, max, step);
    if (phase === "down") anchor.current = (event as React.PointerEvent).shiftKey && onRange ? { step: at, level: value } : null;
    if (anchor.current && onRange) onRange(anchor.current.step, anchor.current.level, value);
    else onChange(at, value);
  });
  const lengthDrag = usePointerDrag((x, _y, rect) => onOwnLength?.(w.first + stepFromX(x, rect.width, w.count) + 1));
  const y = (v: number) => `${(1 - (v - min) / Math.max(1e-9, max - min)) * 100}%`;
  return (
    <div className="n4-lane">
      {ownLength !== undefined && (
        <div className="n4-lane__length" ref={lengthDrag.ref} onPointerDown={lengthDrag.onPointerDown} data-n4-control="true"
          title="This cycle's own length: drag the red marker">
          {columns(w).map((s) => <span key={s} className={s === ownLength - 1 ? "is-end" : ""}>{s === ownLength - 1 ? "◀" : ""}</span>)}
        </div>
      )}
      <div className="n4-lane__area" ref={drag.ref} onPointerDown={drag.onPointerDown} data-n4-control="true"
        title={onRange ? "Drag to set; shift-drag to open a step into a random range" : "Drag to set"}>
        {columns(w).map((s) => {
          const raw = values[s] ?? min;
          const dim = (ownLength !== undefined && s >= ownLength) || (active && !active(s));
          const range = typeof raw === "object" ? normalizeCyclicStep(raw) : null;
          return (
            <div key={s} className={`n4-lane__col${dim ? " is-dim" : ""}${s === playing ? " is-playing" : ""}${s % 4 === 0 ? " is-beat" : ""}`}>
              {range && range.min !== range.max
                ? <span className="n4-lane__range" style={{ top: y(range.max), bottom: `calc(100% - ${y(range.min)})` }} />
                : <span className="n4-lane__handle" style={{ top: y(typeof raw === "object" ? normalizeCyclicStep(raw).min : raw) }} />}
            </div>
          );
        })}
      </div>
      <div className="n4-lane__values">
        {columns(w).map((s) => <span key={s}>{display ? display(values[s] ?? min) : formatLaneValue(values[s] ?? min, format)}</span>)}
      </div>
    </div>
  );
}

/**
 * The PolyNote's pitch lane: note-name rows against the steps, chords
 * allowed. Click a cell to add or remove that note from the step. The step
 * playing now is lit in the colour of where M's Note Order read it from.
 */
export function NoteGrid({ steps, rows, window: w, length, onToggle, playing, source, header }: {
  steps: readonly number[][]; rows: readonly number[]; window: Window; length: number;
  onToggle: (step: number, pitch: number) => void; playing: number; source: string;
  /** Sits above the note names, in the lane-label column. */
  header?: ReactNode;
}) {
  // Two grid items, so the steps line up with every other row of the panel.
  return (
    <div className="n4-notegrid">
      <div className="n4-notegrid__side">
        {header}
        <div className="n4-notegrid__names" style={{ gridTemplateRows: `repeat(${rows.length}, 10px)` }}>
          {rows.map((pitch) => <span key={pitch} className={pitch % 12 === 0 ? "is-c" : ""}>{polyNoteName(pitch)}</span>)}
        </div>
      </div>
      <div className="n4-notegrid__cells" data-n4-control="true">
        {columns(w).map((s) => (
          <div key={s} className={`n4-notegrid__col${s >= length ? " is-dim" : ""}${s === playing ? ` is-playing is-${source || "original"}` : ""}${s % 4 === 0 ? " is-beat" : ""}`}>
            {rows.map((pitch) => (
              <button type="button" key={pitch} aria-label={`Step ${s + 1} ${polyNoteName(pitch)}`}
                className={`n4-note${steps[s]?.includes(pitch) ? " is-on" : ""}${pitch % 12 === 0 ? " is-c" : ""}`}
                onClick={(event) => { event.stopPropagation(); onToggle(s, pitch); }} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** The scrollbar under the lanes, for sequences longer than sixteen steps. */
export function N4Scrollbar({ first, total, onScroll }: { first: number; total: number; onScroll: (first: number) => void }) {
  if (total <= VISIBLE_STEPS) return <div className="n4-scrollbar is-empty" />;
  return (
    <input className="n4-scrollbar" type="range" min={0} max={total - VISIBLE_STEPS} step={1} value={Math.min(first, total - VISIBLE_STEPS)}
      aria-label="Steps shown" onChange={(event) => onScroll(Number(event.currentTarget.value))} />
  );
}

/**
 * M's Note Order as a three-part bar: Original, Scrambled (M's Cyclic
 * Random) and Utterly random. Drag the two edges between them.
 */
export function SplitBar({ mix, onChange }: { mix: NoteOrderMix; onChange: (mix: NoteOrderMix) => void }) {
  const edge = useRef<"originalEnd" | "utterlyStart">("originalEnd");
  const drag = usePointerDrag((x, _y, rect, phase) => {
    const position = Math.round(Math.max(0, Math.min(100, (x / rect.width) * 100)));
    if (phase === "down") {
      edge.current = Math.abs(position - mix.original) <= Math.abs(position - (100 - mix.utterly)) ? "originalEnd" : "utterlyStart";
    }
    onChange(splitFromDrag(mix, edge.current, position));
  });
  return (
    <div className="n4-split">
      <div className="n4-split__bar" ref={drag.ref} onPointerDown={drag.onPointerDown} data-n4-control="true"
        role="group" aria-label="Note order: original, scrambled, random">
        <span className="is-original" style={{ width: `${mix.original}%` }} />
        <span className="is-cyclic" style={{ width: `${mix.cyclic}%` }} />
        <span className="is-utterly" style={{ width: `${mix.utterly}%` }} />
      </div>
      <div className="n4-split__legend">
        <span className="is-original">Orig {mix.original}</span>
        <span className="is-cyclic">Scr {mix.cyclic}</span>
        <span className="is-utterly">Rnd {mix.utterly}</span>
      </div>
    </div>
  );
}

/** One X-Y panel of a Triple XY: a gridded pad and its dot, -1 to +1 each way. */
export function XYPad({ x, y, onChange, label }: { x: number; y: number; onChange: (x: number, y: number) => void; label: string }) {
  const drag = usePointerDrag((px, py, rect) => {
    const nx = Math.max(-1, Math.min(1, (px / rect.width) * 2 - 1));
    const ny = Math.max(-1, Math.min(1, 1 - (py / rect.height) * 2));
    onChange(Number(nx.toFixed(3)), Number(ny.toFixed(3)));
  });
  return (
    <div className="n4-xy" ref={drag.ref} onPointerDown={drag.onPointerDown} data-n4-control="true" role="group" aria-label={label}>
      <span className="n4-xy__dot" style={{ left: `${((x + 1) / 2) * 100}%`, top: `${((1 - y) / 2) * 100}%` }} />
    </div>
  );
}

/** One fader of a Fader Box. */
export function N4Fader({ value, min, max, step, onChange, label }: {
  value: number; min: number; max: number; step: number; onChange: (value: number) => void; label: string;
}) {
  const drag = usePointerDrag((_x, y, rect) => onChange(laneValueFromY(y, rect.height, min, max, step)));
  return (
    <div className="n4-fader" ref={drag.ref} onPointerDown={drag.onPointerDown} data-n4-control="true" role="slider"
      aria-label={label} aria-valuemin={min} aria-valuemax={max} aria-valuenow={value}>
      <span className="n4-fader__dot" style={{ top: `${(1 - (value - min) / Math.max(1e-9, max - min)) * 100}%` }} />
    </div>
  );
}

/** The ▶ triangle at the bottom left, and the settings strip it opens (manual p93). */
export function AdvancedPanel({ open, onToggle, children }: { open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <>
      <button type="button" className={`n4-advanced-toggle${open ? " is-open" : ""}`} aria-expanded={open}
        aria-label="Advanced settings" onClick={(event) => { event.stopPropagation(); onToggle(); }}>▶</button>
      {open && <div className="n4-advanced">{children}</div>}
    </>
  );
}
