/**
 * The Numerology 4 look, as React parts.
 *
 * Every M module is drawn from these, laid out the way Numerology lays out a
 * module: a dark header strip, then a body of three columns — boxes of
 * controls at the left, the step lanes in the middle, boxes of actions at the
 * right — with the advanced settings behind a triangle at the bottom left.
 * The arithmetic lives in logic.ts; these only draw and forward the pointer.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import "./n4.css";
import type { CyclicStep, NoteOrderMix } from "../../../engine/types";
import { normalizeCyclicStep } from "../../../engine/cyclic";
import { ACTION_SHARES, faderUnder, formatLaneValue, laneValueFromY, polyNoteName, rangeDrag, splitFromDrag, stepFromX, tempoRangeDrag, type LaneFormat, type RowAction } from "./logic";

/**
 * A pop-up that closes when you click anywhere outside it, or press Escape.
 * Returns the ref for the element holding both the button and the pop-up.
 */
export function useDismiss<T extends HTMLElement>(open: boolean, close: () => void) {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) close(); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    window.addEventListener("pointerdown", away, true);
    window.addEventListener("keydown", key);
    return () => { window.removeEventListener("pointerdown", away, true); window.removeEventListener("keydown", key); };
  }, [open, close]);
  return ref;
}

/** Numerology colours a sequencer's handles by its kind. */
export type N4Accent = "orange" | "red" | "blue" | "yellow" | "tan" | "mauve" | "purple";

/** Steps shown at once; more scroll, as Numerology's sequencers do. */
export const VISIBLE_STEPS = 16;

export function N4Panel({ accent, children, wide, narrow }: {
  accent: N4Accent; children: ReactNode; wide?: boolean;
  /** As wide as its widest fixed part (the steps); toolbars wrap to fit. */
  narrow?: boolean;
}) {
  return <div className={`n4 n4--${accent}${wide ? " n4--wide" : ""}${narrow ? " n4--narrow" : ""}`}>{children}</div>;
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

export function N4Button({ on, onClick, children, title, small, icon, className = "" }: {
  on?: boolean; onClick: (event: React.MouseEvent) => void; children: ReactNode; title?: string; small?: boolean;
  /** A square key for a glyph or a letter, as tight as a transport button gets. */
  icon?: boolean; className?: string;
}) {
  return (
    <button type="button" className={`n4-button${on ? " is-on" : ""}${small ? " n4-button--small" : ""}${icon ? " n4-button--icon" : ""} ${className}`}
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
export function usePointerDrag(onPoint: (x: number, y: number, rect: DOMRect, phase: "down" | "move", event: React.PointerEvent | PointerEvent) => void) {
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
export function N4Knob({ label, value, min, max, step = 0.01, onChange, format, modulated = false }: {
  label: string; value: number; min: number; max: number; step?: number; onChange: (value: number) => void; format?: (value: number) => string;
  /** An LFO moves this knob: draw a second pointer, and a live value, that the
   * modulation animator moves without a render (see ui/modulationAnimator.ts). */
  modulated?: boolean;
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
          {modulated && <line className="n4-knob__mod" x1="20" y1="20" x2="20" y2="6" />}
        </svg>
      </div>
      <span className="n4-knob__label">{label}</span>
      <span className="n4-knob__value">{format ? format(value) : value.toFixed(2)}</span>
      {modulated && <span className="n4-knob__live" aria-hidden="true" />}
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
export function StepLabels({ window: w, start, end, playing, onStart, onEnd, fixedFirst, playhead }: {
  window: Window; start: number; end: number; playing: number; onStart?: (step: number) => void; onEnd: (step: number) => void; fixedFirst?: boolean;
  /** Tags each label so a playhead can be drawn on it without a render (see playhead.ts). */
  playhead?: string;
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
          data-playhead={playhead} data-step={step}
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
  const menu = useDismiss<HTMLDivElement>(open, () => setOpen(false));
  return (
    <div className="n4-row">
      <div className="n4-row__menu" ref={menu}>
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
export function SliderLane({ values, window: w, min, max, step, format, onChange, onRange, ownLength, onOwnLength, playing, active, display, height, compact, bipolar, fixedFirst, playhead }: {
  values: readonly (number | CyclicStep)[];
  window: Window; min: number; max: number; step: number; format: LaneFormat;
  onChange: (step: number, value: number) => void;
  onRange?: (step: number, from: number, to: number) => void;
  ownLength?: number; onOwnLength?: (length: number) => void;
  playing: number; active?: (step: number) => boolean;
  /** Tags each column so a playhead can be drawn on it without a render (see playhead.ts). */
  playhead?: string;
  display?: (value: number | CyclicStep) => string;
  /** A thin lane, as Consequence stacks them: values printed inside each step. */
  compact?: boolean; height?: number;
  /** Bars grow from the middle, for values either side of zero. */
  bipolar?: boolean;
  /** Step 1 cannot be moved (Time Distortion's first boundary). */
  fixedFirst?: boolean;
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
  const t = (v: number) => (v - min) / Math.max(1e-9, max - min);
  const y = (v: number) => `${(1 - t(v)) * 100}%`;
  const text = (s: number) => (display ? display(values[s] ?? min) : formatLaneValue(values[s] ?? min, format));
  return (
    <div className={`n4-lane${compact ? " n4-lane--compact" : ""}`}>
      {ownLength !== undefined && !compact && (
        <div className="n4-lane__length" ref={lengthDrag.ref} onPointerDown={lengthDrag.onPointerDown} data-n4-control="true"
          title="This cycle's own length: drag the red marker">
          {columns(w).map((s) => <span key={s} className={s === ownLength - 1 ? "is-end" : ""}>{s === ownLength - 1 ? "◀" : ""}</span>)}
        </div>
      )}
      <div className="n4-lane__area" ref={drag.ref} onPointerDown={(event) => {
        // In a thin lane the length marker rides along the top edge: grab it there.
        if (compact && ownLength !== undefined && onOwnLength && (event.target as Element).closest(".n4-lane__end")) {
          lengthDrag.onPointerDown(event);
          return;
        }
        drag.onPointerDown(event);
      }} data-n4-control="true" style={height ? { height } : undefined}
        title={onRange ? "Drag to set; shift-drag to open a step into a random range" : "Drag to set"}>
        {columns(w).map((s) => {
          const raw = values[s] ?? min;
          const dim = (ownLength !== undefined && s >= ownLength) || (active && !active(s));
          const range = typeof raw === "object" ? normalizeCyclicStep(raw) : null;
          const point = typeof raw === "object" ? normalizeCyclicStep(raw).min : raw;
          const zero = bipolar ? t(0) : 0;
          return (
            <div key={s} data-playhead={playhead} data-step={s} className={`n4-lane__col${dim ? " is-dim" : ""}${s === playing ? " is-playing" : ""}${s % 4 === 0 ? " is-beat" : ""}`}>
              {compact
                ? range && range.min !== range.max
                  ? <span className="n4-lane__bar is-range" style={{ bottom: `${t(range.min) * 100}%`, height: `${(t(range.max) - t(range.min)) * 100}%` }} />
                  : <span className={`n4-lane__bar${fixedFirst && s === 0 ? " is-fixed" : ""}`}
                    style={{ bottom: `${Math.min(zero, t(point)) * 100}%`, height: `${Math.max(2, Math.abs(t(point) - zero) * 100)}%` }} />
                : range && range.min !== range.max
                  ? <span className="n4-lane__range" style={{ top: y(range.max), bottom: `calc(100% - ${y(range.min)})` }} />
                  : <span className="n4-lane__handle" style={{ top: y(point) }} />}
              {compact && <span className="n4-lane__text">{fixedFirst && s === 0 ? "Fixed" : text(s)}</span>}
              {compact && ownLength !== undefined && s === ownLength - 1 && <span className="n4-lane__end" title="This cycle's own length: drag">◀</span>}
            </div>
          );
        })}
      </div>
      {!compact && (
        <div className="n4-lane__values">
          {columns(w).map((s) => <span key={s}>{text(s)}</span>)}
        </div>
      )}
    </div>
  );
}

/**
 * The PolyNote's pitch lane: note-name rows against the steps, chords
 * allowed. Click a cell to add or remove that note from the step. The step
 * playing now is lit in the colour of where M's Note Order read it from.
 */
export function NoteGrid({ steps, rows, window: w, length, onToggle, playing, source, header, playhead }: {
  steps: readonly number[][]; rows: readonly number[]; window: Window; length: number;
  onToggle: (step: number, pitch: number) => void; playing: number; source: string;
  /** Tags each column so a playhead can be drawn on it without a render (see playhead.ts). */
  playhead?: string;
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
          <div key={s} data-playhead={playhead} data-step={s} className={`n4-notegrid__col${s >= length ? " is-dim" : ""}${s === playing ? ` is-playing is-${source || "original"}` : ""}${s % 4 === 0 ? " is-beat" : ""}`}>
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

/** The ▶ triangle that opens a module's advanced settings (manual p93). */
export function AdvancedToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button type="button" className={`n4-advanced-toggle${open ? " is-open" : ""}`} aria-expanded={open}
      aria-label="Advanced settings" title="Advanced settings" onClick={(event) => { event.stopPropagation(); onToggle(); }}>▶</button>
  );
}

/**
 * The advanced settings strip. Its triangle sits wherever the face has room
 * for it — pass `toggle={false}` and place an AdvancedToggle yourself — so it
 * never costs a row of its own.
 */
export function AdvancedPanel({ open, onToggle, children, toggle = true }: { open: boolean; onToggle: () => void; children: ReactNode; toggle?: boolean }) {
  return (
    <>
      {toggle && <AdvancedToggle open={open} onToggle={onToggle} />}
      {open && <div className="n4-advanced">{children}</div>}
    </>
  );
}

/* ===== Controls that hold two values, or many ===== */

/**
 * The step chip row: Skip, Mute and Random Jump on one row of chips, one per
 * step, as Omnisphere's arpeggiator puts a modifier over each step. Click
 * cycles none → Skip → Mute; Alt-click steps the Random Jump chance; Shift-click
 * selects the step for relative edits.
 */
export function StepChips({ window: w, skip, mute, jump, select, onToggle, onAction, onClear }: {
  window: Window; skip: readonly boolean[]; mute: readonly boolean[]; jump: readonly number[]; select: readonly boolean[];
  onToggle: (step: number, how: "chip" | "jump" | "select") => void;
  onAction: (row: "skip" | "mute" | "select", action: RowAction, on: boolean) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const menu = useDismiss<HTMLDivElement>(open, () => setOpen(false));
  return (
    <div className="n4-row">
      <div className="n4-row__menu" ref={menu}>
        <button type="button" className="n4-gear" aria-label="Step actions" aria-expanded={open}
          onClick={(event) => { event.stopPropagation(); setOpen(!open); }}>⚙▾</button>
        <span className="n4-label">Step</span>
        {open && (
          <div className="n4-popup n4-popup--wide" role="menu" onClick={(event) => event.stopPropagation()}>
            {(["skip", "mute", "select"] as const).map((row) => (
              <div key={row} className="n4-popup__group">
                {[true, false].map((on) => (Object.keys(ACTION_SHARES) as RowAction[]).map((action) => (
                  <button type="button" role="menuitem" key={`${row}-${on}-${action}`}
                    onClick={() => { onAction(row, action, on); setOpen(false); }}>
                    {on ? "" : "Un"}{on ? row[0].toUpperCase() + row.slice(1) : row} {ACTION_LABELS[action]}
                  </button>
                )))}
              </div>
            ))}
          </div>
        )}
        <button type="button" className="n4-clear" aria-label="Clear the step chips" onClick={(event) => { event.stopPropagation(); onClear(); }}>×</button>
      </div>
      <div className="n4-chips">
        {columns(w).map((step) => {
          const state = skip[step] ? "skip" : mute[step] ? "mute" : "";
          const chance = jump[step] ?? 0;
          return (
            <button type="button" key={step}
              className={`n4-chip${state ? ` is-${state}` : ""}${select[step] ? " is-selected" : ""}`}
              aria-label={`Step ${step + 1}${state ? ` ${state}` : ""}${chance ? `, random jump ${Math.round(chance * 100)}%` : ""}`}
              title="Click: Skip / Mute · Alt-click: Random Jump · Shift-click: select"
              onClick={(event) => { event.stopPropagation(); onToggle(step, event.altKey ? "jump" : event.shiftKey ? "select" : "chip"); }}>
              {state === "skip" ? "S" : state === "mute" ? "M" : ""}
              {chance > 0 && <i className="n4-chip__jump" style={{ opacity: 0.35 + chance * 0.65 }}><DiceIcon size={9} /></i>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** A die, drawn: the ⚄ character is missing from too many fonts to rely on. */
export function DiceIcon({ size = 12 }: { size?: number }) {
  return (
    <svg className="n4-dice-icon" width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <rect x="1.5" y="1.5" width="13" height="13" rx="3" fill="none" stroke="currentColor" strokeWidth="1.4" />
      {[[5, 5], [11, 5], [8, 8], [5, 11], [11, 11]].map(([cx, cy]) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="1.3" fill="currentColor" />)}
    </svg>
  );
}

/** The dice on a lane: randomize a Few, Some, Most or All of just that lane. */
export function LaneDice({ label, onPick }: { label: string; onPick: (share: "few" | "some" | "most" | "all") => void }) {
  const [open, setOpen] = useState(false);
  const menu = useDismiss<HTMLSpanElement>(open, () => setOpen(false));
  return (
    <span className="n4-dice" ref={menu}>
      <button type="button" aria-label={`Randomize ${label}`} aria-expanded={open} title={`Randomize ${label}`}
        onClick={(event) => { event.stopPropagation(); setOpen(!open); }}><DiceIcon /></button>
      {open && (
        <div className="n4-popup" role="menu" onClick={(event) => event.stopPropagation()}>
          {(["few", "some", "most", "all"] as const).map((share) => (
            <button type="button" role="menuitem" key={share} onClick={() => { onPick(share); setOpen(false); }}>
              Randomize {share === "few" ? "a Few" : share[0].toUpperCase() + share.slice(1)}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}

/** A two-thumb slider for a low/high pair: Velocity Range, a tempo range. */
export function RangeSlider({ label, low, high, min, max, step = 1, onChange, format = String }: {
  label: string; low: number; high: number; min: number; max: number; step?: number;
  onChange: (low: number, high: number) => void; format?: (value: number) => string;
}) {
  const thumb = useRef<"low" | "high">("low");
  const at = (v: number) => `${((v - min) / Math.max(1e-9, max - min)) * 100}%`;
  const drag = usePointerDrag((x, _y, rect, phase) => {
    const raw = min + (Math.max(0, Math.min(rect.width, x)) / rect.width) * (max - min);
    const value = Math.round(raw / step) * step;
    if (phase === "down") thumb.current = Math.abs(value - low) <= Math.abs(value - high) ? "low" : "high";
    const next = rangeDrag({ low, high }, value, thumb.current);
    onChange(next.low, next.high);
  });
  return (
    <div className="n4-range">
      <div className="n4-range__head"><span className="n4-label">{label}</span><span className="n4-value">{format(low)}–{format(high)}</span></div>
      <div className="n4-range__track" ref={drag.ref} onPointerDown={drag.onPointerDown} data-n4-control="true"
        role="group" aria-label={`${label} ${format(low)} to ${format(high)}`}>
        <span className="n4-range__fill" style={{ left: at(low), right: `calc(100% - ${at(high)})` }} />
        <span className="n4-range__thumb" style={{ left: at(low) }} />
        <span className="n4-range__thumb" style={{ left: at(high) }} />
      </div>
    </div>
  );
}

/** M's Conducting tempo bar: low · tempo · high on one track (110 · 120 · 130). */
export function TempoBar({ low, tempo, high, min = 20, max = 300, onChange }: {
  low: number; tempo: number; high: number; min?: number; max?: number;
  onChange: (next: { low: number; tempo: number; high: number }) => void;
}) {
  const part = useRef<"low" | "high" | "tempo">("tempo");
  const at = (v: number) => `${((v - min) / (max - min)) * 100}%`;
  const drag = usePointerDrag((x, _y, rect, phase) => {
    const value = min + (Math.max(0, Math.min(rect.width, x)) / rect.width) * (max - min);
    if (phase === "down") {
      const d = (v: number) => Math.abs(v - value);
      part.current = d(tempo) <= Math.min(d(low), d(high)) ? "tempo" : d(low) < d(high) ? "low" : "high";
    }
    onChange(tempoRangeDrag({ low, tempo, high }, part.current, value));
  });
  return (
    <div className="n4-tempo">
      <div className="n4-tempo__track" ref={drag.ref} onPointerDown={drag.onPointerDown} data-n4-control="true"
        role="group" aria-label={`Tempo ${tempo}, conducted between ${low} and ${high}`}>
        <span className="n4-tempo__span" style={{ left: at(low), right: `calc(100% - ${at(high)})` }} />
        <span className="n4-tempo__end" style={{ left: at(low) }} />
        <span className="n4-tempo__end" style={{ left: at(high) }} />
        <span className="n4-tempo__now" style={{ left: at(tempo) }} />
      </div>
      <div className="n4-tempo__legend">
        <span className="n4-value">{low}</span>
        <span><b className="n4-value n4-value--big">{tempo}</b> <span className="n4-label">BPM</span></span>
        <span className="n4-value">{high}</span>
      </div>
    </div>
  );
}

/**
 * Faders side by side, one per voice — swept in one drag, so four voices can
 * be set in a single gesture, as an ADSR fader cluster is.
 */
export function VoiceFaders({ values, min, max, step, onChange, format, label }: {
  values: readonly number[]; min: number; max: number; step: number;
  onChange: (index: number, value: number) => void; format: (value: number) => string; label: string;
}) {
  const drag = usePointerDrag((x, y, rect) => {
    const { index, value } = faderUnder(x, y, rect.width, rect.height, values.length, min, max, step);
    onChange(index, value);
  });
  const t = (v: number) => (v - min) / Math.max(1e-9, max - min);
  const zero = min < 0 && max > 0 ? t(0) : 0;
  return (
    <div className="n4-vfaders">
      <div className="n4-vfaders__area" ref={drag.ref} onPointerDown={drag.onPointerDown} data-n4-control="true"
        role="group" aria-label={label}>
        {values.map((v, i) => (
          <div key={i} className={`n4-vfaders__col uvoice uvoice--${i + 1}`}>
            <span className="n4-vfaders__bar" style={{ bottom: `${Math.min(zero, t(v)) * 100}%`, height: `${Math.max(2, Math.abs(t(v) - zero) * 100)}%` }} />
          </div>
        ))}
      </div>
      <div className="n4-vfaders__legend">
        {values.map((v, i) => <span key={i} className={`uvoice uvoice--${i + 1}`}><b>{i + 1}</b> {format(v)}</span>)}
      </div>
    </div>
  );
}

/** ‹ value › — a stepper, for Octave and other short ranges. */
export function N4Stepper({ label, value, min, max, onChange, format = (v: number) => (v > 0 ? `+${v}` : String(v)) }: {
  label: string; value: number; min: number; max: number; onChange: (value: number) => void; format?: (value: number) => string;
}) {
  return (
    <div className="n4-stepper">
      <span className="n4-label">{label}</span>
      <span className="n4-stepper__control">
        <button type="button" aria-label={`${label} down`} onClick={() => onChange(Math.max(min, value - 1))}>‹</button>
        <span className="n4-value">{format(value)}</span>
        <button type="button" aria-label={`${label} up`} onClick={() => onChange(Math.min(max, value + 1))}>›</button>
      </span>
    </div>
  );
}

/** A single value as a label, its value, and a thin track under them (one line, one gesture). */
export function N4Slider({ label, value, min, max, step = 0.01, onChange, format = (v: number) => v.toFixed(2) }: {
  label: string; value: number; min: number; max: number; step?: number; onChange: (value: number) => void; format?: (value: number) => string;
}) {
  const drag = usePointerDrag((x, _y, rect) => {
    const raw = min + (Math.max(0, Math.min(rect.width, x)) / rect.width) * (max - min);
    onChange(Number((Math.round(raw / step) * step).toFixed(4)));
  });
  const at = `${((value - min) / Math.max(1e-9, max - min)) * 100}%`;
  return (
    <div className="n4-range">
      <div className="n4-range__head"><span className="n4-label">{label}</span><span className="n4-value">{format(value)}</span></div>
      <div className="n4-range__track" ref={drag.ref} onPointerDown={drag.onPointerDown} data-n4-control="true"
        role="slider" aria-label={label} aria-valuemin={min} aria-valuemax={max} aria-valuenow={value}>
        <span className="n4-range__fill" style={{ left: 0, right: `calc(100% - ${at})` }} />
        <span className="n4-range__thumb" style={{ left: at }} />
      </div>
    </div>
  );
}

/** A lane's label: its name, its own cycle length, and its dice. */
export function LaneLabel({ name, length, onDice }: { name: string; length?: number; onDice?: (share: "few" | "some" | "most" | "all") => void }) {
  return (
    <div className="n4-lanelabel">
      <span className="n4-label">{name}</span>
      {length !== undefined && <span className="n4-lanelabel__len" title="This cycle's own length">◀{length}</span>}
      {onDice && <LaneDice label={name} onPick={onDice} />}
    </div>
  );
}
