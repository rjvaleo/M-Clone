// The Grain Engine's tuning menu and Keys window: the last two places of the
// switch row under its engine picker, as MultiGrainLive's pitch row has them
// (`ui/app.js`: `scaleButton`, `openScaleMenu`, `pickScale`; `keysButton`,
// `NOTE_KEYS`, `noteSemitones`, `playNote`, `shiftOctave`, `paintKeyboard`).
//
// Both set Pitch as its knob does, snapped to the tuning, so the engine, the
// knob and an LFO on it see one kind of change.

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import type { JsonValue, NodeInstance } from "../../model/graph";
import { GRAIN_SCALES, quantise, scaleDegrees, scaleOf, tuningName } from "../../registry/grainTuning";

type Setter = (id: string, value: JsonValue) => void;

const num = (value: JsonValue | undefined, fallback = 0) => (typeof value === "number" && Number.isFinite(value) ? value : fallback);

const NUMBER_WORDS: [string, string][] = [
  ["first", "1st"], ["second", "2nd"], ["third", "3rd"], ["fourth", "4th"], ["fifth", "5th"], ["sixth", "6th"],
  ["seventh", "7th"], ["eighth", "8th"], ["ninth", "9th"], ["tenth", "10th"], ["eleventh", "11th"], ["twelfth", "12th"],
  ["sixteenth", "16th"],
  ["zero", "0"], ["one", "1"], ["two", "2"], ["three", "3"], ["four", "4"], ["five", "5"], ["six", "6"], ["seven", "7"],
  ["eight", "8"], ["nine", "9"], ["ten", "10"], ["eleven", "11"], ["twelve", "12"], ["sixteen", "16"],
];
const LABEL_MAX = 24;

/** MultiGrainLive's `fitLabel`: qualifiers off, number words as numbers, then vowels; never cut. */
export function fitLabel(text: string): string {
  let t = String(text).replace(/\s*\([^)]*\)/g, "").replace(/\s*[-–—].*$/, "").trim();
  for (const [word, n] of NUMBER_WORDS) t = t.replace(new RegExp(`\\b${word}\\b`, "gi"), n);
  if (t.length <= LABEL_MAX) return t;
  return t.replace(/\B[aeiou]/gi, "");
}

/** The two answers that are not a scale, and the grid the control always had (`openScaleMenu`). */
const PLAIN: [string, string, number][] = [
  ["Free — no quantising", "the default — the slider’s own value, unrounded", 0],
  ["Semitone grid", "twelve to the octave", 1],
  ["Half-semitone grid", "twenty-four to the octave", 0.5],
];

const CATEGORIES = [...new Set(GRAIN_SCALES.map((s) => s.cat))].map((category) => ({
  category,
  scales: GRAIN_SCALES.filter((s) => s.cat === category),
}));

/** Where a pop-up goes: under its button when there is room, above it when not. */
function placeBy(anchor: DOMRect, height: number): CSSProperties {
  const below = window.innerHeight - anchor.bottom - 8;
  return {
    left: Math.max(6, Math.min(window.innerWidth - 340, anchor.left)),
    top: height <= below ? anchor.bottom + 4 : Math.max(6, Math.min(anchor.top - height - 4, window.innerHeight - height - 6)),
  };
}

/**
 * Slot 3: the tuning, a menu of every scale grouped by family with a filter
 * across them all, and the free and grid choices above them. Choosing one
 * snaps the pitch already set, as `pickScale` posts it with the current pitch.
 */
export function TuningButton({ node, setParameter, style }: { node: NodeInstance; setParameter: Setter; style: CSSProperties }) {
  const scale = scaleOf(node.parameters.scale);
  const step = num(node.parameters["pitch-step"]);
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const pick = (name: string | null, grid?: number) => {
    setOpen(false);
    const nextStep = grid ?? step;
    setParameter("scale", name ?? "free");
    if (grid !== undefined) setParameter("pitch-step", grid);
    setParameter("semitones", quantise(num(node.parameters.semitones), name, nextStep));
  };
  const name = fitLabel(tuningName(scale, step));
  return <>
    <button type="button" ref={button} className={`pnl-control pnl-switch pnl-tuning${scale ? " is-on" : ""}`} style={style}
      title={scale ? `${scale} — snap the pitch shift to a tuning` : "Snap the pitch shift to a tuning"}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => { event.stopPropagation(); setOpen(!open); }}>
      <span className="pnl-switch__text">{name}</span><i className="pnl-tuning__caret">▾</i>
    </button>
    {open && button.current && createPortal(
      <ScaleMenu anchor={button.current.getBoundingClientRect()} scale={scale} step={step} pick={pick} close={() => setOpen(false)} />,
      document.body)}
  </>;
}

function ScaleMenu({ anchor, scale, step, pick, close }: {
  anchor: DOMRect; scale: string | null; step: number; pick: (name: string | null, grid?: number) => void; close: () => void;
}) {
  const [filter, setFilter] = useState("");
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());
  const [place, setPlace] = useState<CSSProperties>({ left: anchor.left, top: anchor.bottom + 4 });
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (box.current) setPlace(placeBy(anchor, box.current.offsetHeight));
    box.current?.querySelector(".is-selected")?.scrollIntoView({ block: "nearest" });
    // A press anywhere but the menu closes it; inside it, typing or folding keeps it open.
    const away = (event: PointerEvent) => { if (!box.current?.contains(event.target as Node)) close(); };
    const t = setTimeout(() => document.addEventListener("pointerdown", away), 0);
    return () => { clearTimeout(t); document.removeEventListener("pointerdown", away); };
  }, []);
  const q = filter.trim().toLowerCase();
  const hit = (name: string, info: string) => !q || name.toLowerCase().includes(q) || info.toLowerCase().includes(q);
  const total = GRAIN_SCALES.length;
  const shown = PLAIN.filter(([l, i]) => hit(l, i)).length + GRAIN_SCALES.filter((s) => hit(s.name, s.info)).length;
  return <div ref={box} className="pnl-scale-pop" style={place} onPointerDown={(event) => event.stopPropagation()}>
    <div className="pnl-scale-pop__head">
      <span className="pnl-scale-pop__count">{q ? `${shown} shown` : `${total} scales`}</span>
      <input placeholder="filter…" value={filter} autoFocus onChange={(event) => setFilter(event.currentTarget.value)}
        onKeyDown={(event) => { event.stopPropagation(); if (event.key === "Escape") close(); }} />
    </div>
    {PLAIN.filter(([label, info]) => hit(label, info)).map(([label, info, grid]) => (
      <button type="button" key={label} className={`pnl-scale-item${!scale && step === grid ? " is-selected" : ""}`} onClick={() => pick(null, grid)}>
        <span className="pnl-scale-item__name">{label}</span><span className="pnl-scale-item__info">{info}</span>
      </button>
    ))}
    {CATEGORIES.map(({ category, scales }) => {
      const showing = scales.filter((s) => hit(s.name, s.info));
      if (!showing.length) return null;
      const shut = !q && folded.has(category);
      return <div key={category} className="pnl-scale-cat">
        <button type="button" className="pnl-scale-cat__head" onClick={() => {
          const next = new Set(folded);
          if (next.has(category)) next.delete(category); else next.add(category);
          setFolded(next);
        }}>{`${shut ? "▸" : "▾"} ${category}  (${scales.length})`}</button>
        {!shut && showing.map((s) => (
          <button type="button" key={s.name} className={`pnl-scale-item${s.name === scale ? " is-selected" : ""}`} onClick={() => pick(s.name)}>
            <span className="pnl-scale-item__name">{s.name}</span>
            <span className="pnl-scale-item__info">{`${s.cents.length} degrees · ${s.info}`}</span>
          </button>
        ))}
      </div>;
    })}
  </div>;
}

// ---- Keys ------------------------------------------------------------------------

/** The keys, by letter, and the degree from the tonic each plays (`NOTE_KEYS`). */
export const NOTE_KEYS: readonly [string, number][] = [
  ["a", 0], ["w", 1], ["s", 2], ["e", 3], ["d", 4], ["f", 5], ["t", 6],
  ["g", 7], ["y", 8], ["h", 9], ["u", 10], ["j", 11], ["k", 12],
  ["o", 13], ["l", 14], ["p", 15], [";", 16], ["'", 17],
];
/** The upper row, which a piano draws black. */
const UPPER_ROW = new Set(["w", "e", "t", "y", "u", "o", "p"]);
/** Which white each black follows. */
const WHITE_AFTER: Record<string, number> = { w: 0, e: 1, t: 3, y: 4, u: 5, o: 7, p: 8 };
const KEY_WIDTH = 26;
const HINTS = ["<b>A</b> is the tonic", "<b>Z</b> / <b>X</b> shift an octave, and latch"];

/** `noteSemitones`: degree `i` from the tonic, wrapping and climbing a span, at the octave latched. */
export function noteSemitones(i: number, octave: number, scale: string | null, step: number): number {
  const { cents, span } = scaleDegrees(scale, step);
  const n = cents.length || 1;
  const up = Math.floor(i / n);
  const c = cents[((i % n) + n) % n];
  const semis = (up * span + c) / 100 + octave * (span / 100);
  return Math.max(-48, Math.min(48, semis));
}

/** `shiftOctave`'s bound: as many spans as the pitch control reaches. */
export function octaveLimit(scale: string | null, step: number): number {
  const perOct = scaleDegrees(scale, step).span / 100;
  return Math.max(1, Math.floor(48 / Math.max(1, perOct)));
}

const inTextField = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

/**
 * Slot 4: Keys. A window you leave up while you work, drawn as a piano, that
 * plays the pitch from the computer keyboard: A is the tonic, the row above
 * plays the notes between, Z and X shift an octave and latch. The notes
 * follow the tuning. The letters play while the window is open.
 */
export function KeysButton({ node, setParameter }: { node: NodeInstance; setParameter: Setter }) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" className={`pnl-switch pnl-keys${open ? " is-on" : ""}`}
      title="Play the pitch from the computer keyboard. A is the tonic, the row above plays the notes between, Z and X shift an octave and latch. The notes follow whichever tuning is chosen."
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => { event.stopPropagation(); setOpen(!open); }}>
      <span className="pnl-switch__text">Keys <i>⧉</i></span>
    </button>
    {open && createPortal(<KeysWindow node={node} setParameter={setParameter} close={() => setOpen(false)} />, document.body)}
  </>;
}

function KeysWindow({ node, setParameter, close }: { node: NodeInstance; setParameter: Setter; close: () => void }) {
  const scale = scaleOf(node.parameters.scale);
  const step = num(node.parameters["pitch-step"]);
  const [octave, setOctave] = useState(0);
  const [held, setHeld] = useState<number | null>(null);
  const [hint, setHint] = useState(0);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  const play = (i: number, oct = octave) => {
    setParameter("semitones", quantise(noteSemitones(i, oct, scale, step), scale, step));
    setHeld(i);
  };
  const shift = (by: number) => {
    const limit = octaveLimit(scale, step);
    const next = Math.max(-limit, Math.min(limit, octave + by));
    setOctave(next);
    if (held !== null) play(held, next);
  };
  const latest = useRef({ play, shift });
  latest.current = { play, shift };
  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      if (inTextField(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
      const k = event.key.toLowerCase();
      if (k === "z" || k === "x") { event.preventDefault(); latest.current.shift(k === "z" ? -1 : 1); return; }
      const i = NOTE_KEYS.findIndex(([n]) => n === k);
      if (i < 0) return;
      event.preventDefault();
      if (!event.repeat) latest.current.play(i);
    };
    document.addEventListener("keydown", keys);
    const timer = setInterval(() => setHint((n) => n + 1), 10_000);
    return () => { document.removeEventListener("keydown", keys); clearInterval(timer); };
  }, []);
  const { cents } = scaleDegrees(scale, step);
  const whites = NOTE_KEYS.filter(([k]) => !UPPER_ROW.has(k));
  const blacks = NOTE_KEYS.filter(([k]) => UPPER_ROW.has(k));
  const key = (letter: string, kind: "white" | "black", left: number, width: number) => {
    const i = NOTE_KEYS.findIndex(([k]) => k === letter);
    const semis = noteSemitones(i, octave, scale, step);
    const sign = semis >= 0 ? "+" : "";
    return <button type="button" key={letter} className={`pnl-kb-key pnl-kb-key--${kind}${held === i ? " is-on" : ""}`}
      style={{ left, width }} title={`${letter.toUpperCase()} — degree ${(i % (cents.length || 1)) + 1} of ${cents.length}, ${sign}${semis.toFixed(2)} semitones`}
      onClick={() => play(i)}>
      <span className="pnl-kb-letter">{letter.toUpperCase()}</span>
      <span className="pnl-kb-semis">{`${sign}${semis.toFixed(2)}`}</span>
    </button>;
  };
  const span = whites.length * KEY_WIDTH;
  const drag = (event: React.PointerEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest("button")) return;
    const card = event.currentTarget.parentElement!.getBoundingClientRect();
    const dx = event.clientX - card.left;
    const dy = event.clientY - card.top;
    const move = (ev: PointerEvent) => setAt({
      left: Math.max(0, Math.min(window.innerWidth - card.width, ev.clientX - dx)),
      top: Math.max(0, Math.min(window.innerHeight - 40, ev.clientY - dy)),
    });
    const up = () => { document.removeEventListener("pointermove", move); document.removeEventListener("pointerup", up); };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
  };
  return <div className="pnl-kb" style={at ? { left: at.left, top: at.top, bottom: "auto", transform: "none" } : undefined}>
    <div className="pnl-kb__card" style={{ width: span + 14 }}>
      <header className="pnl-kb__head" onPointerDown={drag}>
        <h2>Keys</h2>
        <span className="pnl-kb__scale">{scale ? `${fitLabel(scale)} · ${cents.length} deg` : `${cents.length} steps / oct`}</span>
        <button type="button" onClick={close}>Close</button>
      </header>
      <div className="pnl-kb__body">
        <div className="pnl-kb__piano" style={{ width: span }}>
          {whites.map(([letter], n) => key(letter, "white", n * KEY_WIDTH, KEY_WIDTH))}
          {blacks.map(([letter]) => key(letter, "black", (WHITE_AFTER[letter] + 1) * KEY_WIDTH - KEY_WIDTH * 0.34, KEY_WIDTH * 0.62))}
        </div>
        <div className="pnl-kb__legend">
          <span className="pnl-kb__hint" onClick={() => setHint((n) => n + 1)} dangerouslySetInnerHTML={{ __html: HINTS[hint % HINTS.length] }} />
          <span className={`pnl-kb__oct${octave ? " is-on" : ""}`}>{octave === 0 ? "octave 0" : `octave ${octave > 0 ? "+" : ""}${octave}`}</span>
          <span className="pnl-kb__now">{held === null ? "" : `${noteSemitones(held, octave, scale, step).toFixed(2)} st`}</span>
        </div>
      </div>
    </div>
  </div>;
}
