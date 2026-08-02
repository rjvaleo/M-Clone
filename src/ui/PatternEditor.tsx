// Pattern Editor — rebuilt against the original window rather than from
// memory of it. Chapter 14 of the M 2.7 manual is the spec; the layout below
// follows it control for control:
//
//   row 1  8va · note-scroll up · step ruler (the Step Editing Tools act here)
//   row 2  note readout + left Reference Keyboard · Editing Grid ·
//          right Reference Keyboard · Mode Selector (View/Chd/Ins/Dr/Size)
//   row 3  8vb · note-scroll down · MIDI Edit Range Bar + Counter · All · Ctr ·
//          Editor Sound Velocity
//   row 4  scroll arrows · scroll bar with thumb · Editor Sound · Size Box
//
// Two details worth naming because they read as bugs otherwise. Cells are a
// fixed size: growing the window reveals more of the Pattern, it never
// stretches what's already there. And steps within the Pattern are ruled in
// black while everything past its last step is dotted grey — that grey area is
// still live, and clicking in it extends the Pattern with rests behind you.

import { useEffect, useRef, useState } from "react";
import { useM, MAX_PATTERN_STEPS } from "../state/store";
import {
  clampCounter,
  clampEditRange,
  clampRegionToPattern,
  pageStart,
  scrollToFollow,
  thumbStart,
} from "../engine/editor";
import { midiToName } from "../engine/music";
import { getRuntime } from "./runtime";
import { useDraggable } from "./useDraggable";
import { useWindowContextMenu } from "./windowlauncher";
import { usePatternMenus } from "./patternMenus";
import { editorSoundAllowed } from "./editorsound";
import { isLegacyClearKey } from "./editorkeys";
import { focusWindowPointerDown } from "./windowfocus";
import { clearSteps } from "../engine/patterncmd";
import type { ChordMode, InsertMode } from "../engine/types";
import {
  IconBuild,
  IconChord,
  IconDrumOff,
  IconDrumOn,
  IconEraser,
  IconInsert,
  IconOctave,
  IconOverdub,
  IconPlunger,
  IconReplace,
  IconScissors,
  IconSelector,
  IconSingleNote,
  IconSizeBox,
  IconSpeaker,
  IconTriangle,
} from "./icons";

const CELL_W = 10;
const CELL_H = 8;
const MIN_PITCH = 24; // C1
const MAX_PITCH = 108; // C8
const BLACK = new Set([1, 3, 6, 8, 10]);
/**
 * The two places where white keys touch on a chromatic run. The keyboard is
 * drawn top-down in descending pitch, and the separator hangs off the bottom
 * of a key, so these are the upper key of each pair: F sits above E, C above B.
 */
const WHITE_PAIR = new Set([5, 0]);

const TOOLS = [
  { id: "select", Icon: IconSelector, label: "Selector" },
  { id: "erase", Icon: IconEraser, label: "Eraser" },
  { id: "plunge", Icon: IconPlunger, label: "Plunger" },
  { id: "scissor", Icon: IconScissors, label: "Scissors" },
] as const;
type ToolId = (typeof TOOLS)[number]["id"];

const CHORD_MODES: { id: ChordMode; Icon: typeof IconChord; label: string }[] = [
  { id: "single", Icon: IconSingleNote, label: "Single Note" },
  { id: "chord", Icon: IconChord, label: "Chord" },
  { id: "build", Icon: IconBuild, label: "Build" },
];

const INSERT_MODES: { id: InsertMode; Icon: typeof IconInsert; label: string }[] = [
  { id: "insert", Icon: IconInsert, label: "Insert" },
  { id: "replace", Icon: IconReplace, label: "Replace" },
  { id: "overdub", Icon: IconOverdub, label: "Overdub" },
];

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * Repeat an action for as long as the button is held — the manual says to
 * "hold down the mouse button on either arrow to see the Editing Grid
 * scrolling", and the same for the octave icons.
 */
function useHoldRepeat() {
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const stop = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };
  useEffect(() => stop, []);
  const start = (step: () => void) => {
    stop();
    step();
    // A pause before the repeat kicks in, so a single click stays a single step.
    const begin = setTimeout(function tick() {
      step();
      timers.current.push(setTimeout(tick, 60));
    }, 350);
    timers.current.push(begin);
  };
  return { start, stop };
}

/** Drives a pointer drag to completion, then cleans itself up. */
function drag(onMove: (e: PointerEvent) => void, onUp?: () => void) {
  const up = () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", up);
    onUp?.();
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", up);
}

/**
 * A Picture Matrix cell: click to cycle to the next picture. M popped a menu
 * out on click; cycling is the honest browser equivalent and keeps the same
 * one-click cost.
 */
function PictureCell<T extends string>({
  options,
  value,
  onChange,
  title,
}: {
  options: { id: T; Icon: (p: { size?: number }) => JSX.Element; label: string }[];
  value: T;
  onChange: (next: T) => void;
  title: string;
}) {
  const index = Math.max(0, options.findIndex((o) => o.id === value));
  const current = options[index];
  return (
    <button
      className="pepic"
      title={`${title}: ${current.label}`}
      aria-label={`${title}: ${current.label}`}
      onClick={() => onChange(options[(index + 1) % options.length].id)}
    >
      <current.Icon size={14} />
    </button>
  );
}

export function PatternEditor({ onClose }: { onClose?: () => void } = {}) {
  const selectedVoice = useM((s) => s.selectedVoice);
  const voices = useM((s) => s.project.voices);
  const patterns = useM((s) => s.project.patterns);
  const paintStep = useM((s) => s.paintStep);
  const setPatternMaxSize = useM((s) => s.setPatternMaxSize);
  const setPatternMode = useM((s) => s.setPatternMode);
  const eraseRegion = useM((s) => s.eraseRegion);
  const insertSteps = useM((s) => s.insertSteps);
  const deleteRegion = useM((s) => s.deleteRegion);
  const selectVoice = useM((s) => s.selectVoice);
  const runPatternCommand = useM((s) => s.runPatternCommand);
  const isPlaying = useM((s) => s.isPlaying);
  const editorSoundWhilePlaying = useM((s) => s.options.editorSoundWhilePlaying);
  const patternGroup = useM((s) => s.patternGroup);

  const patternIndex = voices[selectedVoice].patternIndex;
  const pattern = patterns[patternIndex];
  const len = pattern.outputLength;

  const [tool, setTool] = useState<ToolId>("select");
  const [topPitch, setTopPitch] = useState(84); // C6 at the top
  const [startStep, setStartStep] = useState(0);
  const [viewW, setViewW] = useState(250);
  const [viewH, setViewH] = useState(160);
  // Patterns shown behind the edited one (shift-click a View number).
  const [ghosts, setGhosts] = useState<number[]>([]);
  // The Selector's region. `point` marks a Pointwise selection — a click with
  // no drag, which draws a triangle instead of a span. It lives in the store
  // so the global Edit and Pattern menus can act on it too.
  const region = useM((s) => s.editorRegion);
  const setRegion = useM((s) => s.setEditorRegion);
  const [legend, setLegend] = useState<{ step: number; pitch: number } | null>(null);
  const range = useM((s) => s.midiEditRange);
  const counter = useM((s) => s.midiEditCounter);
  const setMidiEditState = useM((s) => s.setMidiEditState);
  const setRange = (next: { from: number; to: number }) => setMidiEditState(next, counter);
  const setCounter = (next: number | ((current: number) => number)) =>
    setMidiEditState(range, typeof next === "function" ? next(counter) : next);
  const [soundOn, setSoundOn] = useState(true);
  const [soundVel, setSoundVel] = useState(64);

  const hold = useHoldRepeat();

  const { ref, pos, z, onPointerDown: onTitleDown, bringToFront } = useDraggable(
    "pattern-editor", { x: 42, y: 38 }, { autoPlace: true },
  );

  const cols = clamp(Math.round(viewW / CELL_W), 8, 96);
  const rows = clamp(Math.round(viewH / CELL_H), 8, MAX_PITCH - MIN_PITCH + 1);
  const top = clamp(topPitch, MIN_PITCH + rows - 1, MAX_PITCH);
  const start = clamp(startStep, 0, Math.max(0, pattern.maxSize - cols));

  const pitches = Array.from({ length: rows }, (_, i) => top - i);
  const steps = Array.from({ length: cols }, (_, i) => start + i);
  const gridW = cols * CELL_W;
  const gridH = rows * CELL_H;
  // Width of the black-ruled portion: everything up to the Pattern's last step.
  const inkW = clamp(len - start, 0, cols) * CELL_W;

  const audition = (notes: number[]) => {
    if (!editorSoundAllowed(soundOn, isPlaying, editorSoundWhilePlaying)
      || notes.length === 0) return;
    getRuntime().audition(
      notes, soundVel, voices[selectedVoice].outputChannels, 0.35, selectedVoice,
    );
  };

  /**
   * Two keyboard equivalents from the Power User appendix:
   * "Tilde/Grave key - plays step at MIDI Edit Counter in Pattern Editor (held
   * as long as you hold the key down)" and "Comma/Greater Than key - plays step
   * in Legend in Pattern Editor Editing Grid (the step at the cursor position,
   * at the junction of the dotted lines)."
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.metaKey || e.ctrlKey) return;
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      if (isLegacyClearKey(e.key)) {
        e.preventDefault();
        const selection = region && !region.point
          ? { from: region.from, to: region.to }
          : null;
        runPatternCommand(patternIndex, (steps) => clearSteps(steps, selection));
        return;
      }
      const step =
        e.key === "`" || e.key === "~"
          ? counter
          : e.key === "," || e.key === "<"
            ? legend?.step
            : undefined;
      if (step === undefined) return;
      e.preventDefault();
      audition(pattern.steps[step]?.pitches ?? []);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  /* ---- Editing Grid ---- */

  // Press to start, drag to continue. The first cell picks the mode, so a drag
  // never flickers between drawing and erasing.
  const paintRef = useRef<"draw" | "erase" | null>(null);

  const paintAt = (e: PointerEvent) => {
    if (!paintRef.current) return;
    // If the pointerup was ever missed — dragged out of the window, a
    // synthetic event, a lost capture — the latch would otherwise leave every
    // subsequent mouse move drawing notes. No button down, no painting.
    if (e.buttons === 0) {
      paintRef.current = null;
      return;
    }
    const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
    if (!el || !el.classList.contains("pecell")) return;
    const { step, pitch } = el.dataset;
    if (step === undefined || pitch === undefined) return;
    const on = paintRef.current === "draw";
    paintStep(patternIndex, Number(step), Number(pitch), on);
    if (on) audition([Number(pitch)]);
  };

  const startPaint = (e: React.PointerEvent, step: number, pitch: number, on: boolean) => {
    e.preventDefault();
    // Clicking in the Grid always adds or removes notes; the Step Editing
    // Tools only apply in the strip above it.
    paintRef.current = on ? "erase" : "draw";
    paintStep(patternIndex, step, pitch, !on);
    if (!on) audition([pitch]);
    setCounter(clamp(step, 0, Math.max(0, pattern.maxSize - 1)));
    drag(paintAt, () => {
      paintRef.current = null;
    });
  };

  /* ---- The Edit and Pattern menus ---- */

  // Built from the shared source so the right-click here and the global menu
  // bar always offer exactly the same commands.
  const { editMenu, patternMenu } = usePatternMenus();

  const context = useWindowContextMenu([...editMenu, "separator", ...patternMenu]);

  /* ---- Step Editing Tools, which operate in the strip above the grid ---- */

  const stepFromClientX = (clientX: number, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    return clamp(start + Math.floor((clientX - r.left) / CELL_W), 0, pattern.maxSize - 1);
  };

  const applyTool = (from: number, to: number) => {
    if (tool === "erase") eraseRegion(patternIndex, from, to);
    else if (tool === "plunge") insertSteps(patternIndex, from, to - from + 1);
    else if (tool === "scissor") deleteRegion(patternIndex, from, to);
  };

  const startRuler = (e: React.PointerEvent) => {
    e.preventDefault();
    const strip = e.currentTarget as HTMLElement;
    const anchor = stepFromClientX(e.clientX, strip);
    let latest = { from: anchor, to: anchor, point: true };
    setRegion(latest);
    drag(
      (ev) => {
        const s = stepFromClientX(ev.clientX, strip);
        latest = {
          from: Math.min(anchor, s),
          to: Math.max(anchor, s),
          point: s === anchor,
        };
        setRegion(latest);
      },
      () => {
        // "you can select only Regions that contain notes or rests"
        const fenced = clampRegionToPattern(latest, pattern.steps.length);
        if (!fenced) {
          setRegion(null);
          return;
        }
        if (tool === "select") {
          setRegion({ ...fenced, point: latest.point });
        } else {
          applyTool(fenced.from, fenced.to);
          setRegion(null);
        }
      },
    );
  };

  /* ---- MIDI Edit Range Bar ---- */

  /**
   * The Range Bar carries two things. Dragging the Counter box moves the
   * Counter — and scrolls the grid along if you drag past its edge. Shift-drag
   * anywhere on the bar draws a new Range, which may reach one step past the
   * end of the Pattern.
   */
  const startRangeDrag = (e: React.PointerEvent) => {
    e.preventDefault();
    const strip = e.currentTarget as HTMLElement;

    if (e.shiftKey) {
      const anchor = stepFromClientX(e.clientX, strip);
      const setFrom = (clientX: number) => {
        const next = clampEditRange(
          { from: anchor, to: stepFromClientX(clientX, strip) },
          pattern.steps.length,
          pattern.maxSize,
        );
        setRange(next);
        setCounter((c) => clampCounter(c, next));
      };
      setFrom(e.clientX);
      drag((ev) => setFrom(ev.clientX));
      return;
    }

    const move = (clientX: number) => {
      const step = clampCounter(stepFromClientX(clientX, strip), range);
      setCounter(step);
      // "you can drag the MIDI Edit Counter past the end of the Editing Grid
      //  and it will scroll along with you."
      setStartStep((st) => scrollToFollow(step, st, cols, MAX_START));
      if (step < pattern.steps.length) {
        // "If you're viewing more than one Pattern, steps for each Pattern
        //  (if they exist) are played when you drag the MIDI Edit Counter."
        const heard = [
          ...pattern.steps[step].pitches,
          ...ghosts.flatMap(
            (vi) => patterns[voices[vi].patternIndex].steps[step]?.pitches ?? [],
          ),
        ];
        audition(heard);
      }
    };
    move(e.clientX);
    drag((ev) => move(ev.clientX));
  };

  /* ---- Scroll bar ---- */

  const extent = pattern.maxSize;
  const MAX_START = Math.max(0, extent - cols);
  const startThumbDrag = (e: React.PointerEvent) => {
    e.preventDefault();
    const track = (e.currentTarget as HTMLElement).parentElement!;
    const move = (clientX: number) => {
      const r = track.getBoundingClientRect();
      const frac = (clientX - r.left) / r.width;
      setStartStep(thumbStart(frac, extent, cols));
    };
    drag((ev) => move(ev.clientX));
  };

  const pageTrack = (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const frac = (e.clientX - r.left) / r.width;
    const dir = frac * extent < start ? -1 : 1;
    setStartStep((s) => pageStart(s, cols, dir, MAX_START));
  };

  /* ---- Size Box ---- */

  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const x0 = e.clientX, y0 = e.clientY, w0 = viewW, h0 = viewH;
    drag((ev) => {
      setViewW(clamp(w0 + ev.clientX - x0, 200, 960));
      setViewH(clamp(h0 + ev.clientY - y0, 96, 560));
    });
  };

  /* ---- Reference Keyboards ---- */

  const Keyboard = ({ side }: { side: "left" | "right" }) => (
    <div className={`pekeys pekeys--${side}`} style={{ height: gridH }}>
      {pitches.map((pitch) => {
        const pc = ((pitch % 12) + 12) % 12;
        const black = BLACK.has(pc);
        return (
          <button
            key={pitch}
            className={
              "pekey" + (black ? " pekey--black" : "") +
              (!black && WHITE_PAIR.has(pc) ? " pekey--split" : "")
            }
            style={{ height: CELL_H }}
            title={midiToName(pitch)}
            aria-label={`Play ${midiToName(pitch)}`}
            onPointerDown={() => audition([pitch])}
          />
        );
      })}
    </div>
  );

  const noteReadout = midiToName(legend ? legend.pitch : top);

  return (
    <section
      ref={ref}
      className="peditor-host movable"
      aria-label="Pattern Editor"
      style={{ left: pos.x, top: pos.y, zIndex: z }}
      onPointerDownCapture={(event) => focusWindowPointerDown(event, bringToFront)}
      onContextMenu={context.onContextMenu}
    >
      {context.menu}
      <div className="uwin peditor">
      <div className="uwin__title movable__handle" onPointerDown={onTitleDown}>
        <span className="uwin__name">Pattern Editor</span>
        <span className="uwin__slash">/</span>
        <span className="uwin__note">group {String.fromCharCode(97 + patternGroup)}</span>
        {onClose && <button className="uwin__close" onClick={onClose}
          aria-label="Close Pattern Editor">×</button>}
        <div className="peditor__tools" role="group" aria-label="Step Editing Tools">
          {TOOLS.map(({ id, Icon, label }) => (
            <button
              key={id}
              title={label}
              aria-label={label}
              aria-pressed={tool === id}
              className={"petool" + (tool === id ? " petool--on" : "")}
              onClick={() => setTool(id)}
            >
              <Icon size={16} />
            </button>
          ))}
        </div>
      </div>

      {/* Row 1 — octave up, note-scroll up, step ruler, Mode Selector header */}
      <div className="perow perow--head">
        <button
          className="peoct"
          title="Scroll up an octave"
          aria-label="Scroll up an octave"
          onPointerDown={() => hold.start(() => setTopPitch((p) => clamp(p + 12, MIN_PITCH + rows - 1, MAX_PITCH)))}
          onPointerUp={hold.stop}
          onPointerLeave={hold.stop}
        >
          <IconOctave dir="up" />
        </button>
        <button
          className="pearrow"
          title="Scroll up one note"
          aria-label="Scroll up one note"
          onPointerDown={() => hold.start(() => setTopPitch((p) => clamp(p + 1, MIN_PITCH + rows - 1, MAX_PITCH)))}
          onPointerUp={hold.stop}
          onPointerLeave={hold.stop}
        >
          <IconTriangle dir="up" size={14} />
        </button>

        {/* The strip the Step Editing Tools operate in. */}
        <div
          className={`peruler peruler--${tool}`}
          style={{ width: gridW }}
          onPointerDown={startRuler}
          role="group"
          aria-label="Step ruler and region selector"
        >
          <span className="peruler__num" style={{ left: 2 }}>{start + 1}</span>
          {legend && legend.step !== start && (
            <span
              className="peruler__num peruler__num--live"
              style={{ left: (legend.step - start) * CELL_W + 2 }}
            >
              {legend.step + 1}
            </span>
          )}
          {region && !region.point && region.to >= start && region.from < start + cols && (
            <span
              className="peruler__region"
              style={{
                left: (Math.max(region.from, start) - start) * CELL_W,
                width: (Math.min(region.to, start + cols - 1) - Math.max(region.from, start) + 1) * CELL_W,
              }}
            />
          )}
          {region?.point && region.from >= start && region.from < start + cols && (
            <span
              className="peruler__point"
              style={{ left: (region.from - start) * CELL_W }}
            />
          )}
        </div>

        {/* Keeps the header sitting over its own columns: row 2 gains the
            width of the right Reference Keyboard before the Mode Selector. */}
        <span className="pekeygap" aria-hidden="true" />
        <div className="pemodes__head">
          <span>View</span><span>Chd</span><span>Ins</span><span>Dr</span><span>Size</span>
        </div>
      </div>

      {/* Row 2 — keyboards, Editing Grid, Mode Selector rows */}
      <div className="perow perow--body">
        <div className="pesidecol">
          <span className="penote">{noteReadout}</span>
          <Keyboard side="left" />
        </div>

        <div
          className={`pegrid uvoice uvoice--${selectedVoice + 1}`}
          style={{ width: gridW, height: gridH }}
          onPointerLeave={() => setLegend(null)}
        >
          {/* Black rule up to the Pattern's last step; dotted grey past it. */}
          <span className="pegrid__ink" style={{ width: inkW }} aria-hidden="true" />

          {region && !region.point && region.to >= start && region.from < start + cols && (
            <span
              className="pegrid__region"
              aria-hidden="true"
              style={{
                left: (Math.max(region.from, start) - start) * CELL_W,
                width: (Math.min(region.to, start + cols - 1) - Math.max(region.from, start) + 1) * CELL_W,
              }}
            />
          )}

          {pitches.map((pitch) => (
            <div key={pitch} className="pegrid__row" style={{ height: CELL_H }}>
              {steps.map((step) => {
                const st = pattern.steps[step];
                const on = st ? st.pitches.includes(pitch) : false;
                const ghost =
                  !on &&
                  ghosts.some((vi) => {
                    const gp = patterns[voices[vi].patternIndex];
                    return gp.steps[step]?.pitches.includes(pitch) ?? false;
                  });
                return (
                  <button
                    key={step}
                    className={
                      "pecell" + (on ? " pecell--on" : ghost ? " pecell--ghost" : "")
                    }
                    style={{ width: CELL_W, height: CELL_H }}
                    data-step={step}
                    data-pitch={pitch}
                    aria-label={`${midiToName(pitch)} step ${step + 1}`}
                    aria-pressed={on}
                    onPointerEnter={() => setLegend({ step, pitch })}
                    onPointerDown={(e) => startPaint(e, step, pitch, on)}
                  />
                );
              })}
            </div>
          ))}

          {/* Legend — the dotted guide marks that track the cursor. */}
          {legend && (
            <>
              <span
                className="pelegend pelegend--v"
                aria-hidden="true"
                style={{ left: (legend.step - start) * CELL_W }}
              />
              <span
                className="pelegend pelegend--h"
                aria-hidden="true"
                style={{ top: (top - legend.pitch) * CELL_H }}
              />
            </>
          )}
        </div>

        <Keyboard side="right" />

        <div className="pemodes">
          {voices.map((v, i) => {
            const p = patterns[v.patternIndex];
            return (
              <div key={i} className="pemodes__row">
                <button
                  className={
                    "peview__num" + (i === selectedVoice ? " peview__num--on" : "") +
                    (ghosts.includes(i) ? " peview__num--ghost" : "")
                  }
                  aria-pressed={i === selectedVoice}
                  aria-label={`View Pattern ${i + 1}`}
                  title={`View Pattern ${i + 1} (shift-click to show it behind)`}
                  onClick={(e) => {
                    if (e.shiftKey) {
                      setGhosts((g) =>
                        g.includes(i) ? g.filter((x) => x !== i) : [...g, i],
                      );
                    } else {
                      selectVoice(i);
                    }
                  }}
                >
                  {i + 1}
                </button>
                <PictureCell
                  title="Chord Mode"
                  options={CHORD_MODES}
                  value={p.chordMode}
                  onChange={(next) => setPatternMode(v.patternIndex, "chordMode", next)}
                />
                <PictureCell
                  title="Insertion Mode"
                  options={INSERT_MODES}
                  value={p.insertMode}
                  onChange={(next) => setPatternMode(v.patternIndex, "insertMode", next)}
                />
                <button
                  className="pepic"
                  title={`Drum Machine Record: ${p.drumMachine ? "Enabled" : "Disabled"}`}
                  aria-label={`Drum Machine Record: ${p.drumMachine ? "Enabled" : "Disabled"}`}
                  aria-pressed={p.drumMachine}
                  onClick={() => setPatternMode(v.patternIndex, "drumMachine", !p.drumMachine)}
                >
                  {p.drumMachine ? <IconDrumOn size={14} /> : <IconDrumOff size={14} />}
                </button>
                <input
                  type="number"
                  className="pesize__num"
                  min={p.steps.length}
                  max={MAX_PATTERN_STEPS}
                  value={p.maxSize}
                  aria-label={`Pattern ${i + 1} size`}
                  onChange={(e) => setPatternMaxSize(v.patternIndex, Number(e.target.value))}
                />
              </div>
            );
          })}
        </div>
      </div>

      {/* Row 3 — octave down, note-scroll down, MIDI Edit Range Bar, All/Ctr/velocity */}
      <div className="perow perow--range">
        <button
          className="peoct"
          title="Scroll down an octave"
          aria-label="Scroll down an octave"
          onPointerDown={() => hold.start(() => setTopPitch((p) => clamp(p - 12, MIN_PITCH + rows - 1, MAX_PITCH)))}
          onPointerUp={hold.stop}
          onPointerLeave={hold.stop}
        >
          <IconOctave dir="down" />
        </button>
        <button
          className="pearrow"
          title="Scroll down one note"
          aria-label="Scroll down one note"
          onPointerDown={() => hold.start(() => setTopPitch((p) => clamp(p - 1, MIN_PITCH + rows - 1, MAX_PITCH)))}
          onPointerUp={hold.stop}
          onPointerLeave={hold.stop}
        >
          <IconTriangle dir="down" size={14} />
        </button>

        <div
          className="perange"
          style={{ width: gridW }}
          onPointerDown={startRangeDrag}
          role="group"
          aria-label="MIDI Edit Range"
        >
          {range.to >= start && range.from < start + cols && (
            <span
              className="perange__bar"
              aria-hidden="true"
              style={{
                left: (Math.max(range.from, start) - start) * CELL_W,
                width: (Math.min(range.to, start + cols - 1) - Math.max(range.from, start) + 1) * CELL_W,
              }}
            />
          )}
          {counter >= start && counter < start + cols && (
            <span
              className="perange__ctr"
              aria-hidden="true"
              style={{ left: (counter - start) * CELL_W }}
            />
          )}
        </div>

        <button
          className="pebtn"
          title="Set the MIDI Edit Range to the whole Pattern"
          onClick={() => setRange({ from: 0, to: Math.max(0, len - 1) })}
        >
          All
        </button>
        <button
          className="pebtn"
          title="Set the MIDI Edit Range to the MIDI Edit Counter"
          onClick={() => setRange({ from: counter, to: counter })}
        >
          Ctr
        </button>
        <input
          type="number"
          className="pevel"
          min={1}
          max={127}
          value={soundVel}
          aria-label="Editor Sound Velocity"
          title="Editor Sound Velocity"
          onChange={(e) => setSoundVel(clamp(Number(e.target.value) || 0, 1, 127))}
        />
      </div>

      {/* Row 4 — scroll bar, Editor Sound Enable, Size Box */}
      <div className="perow perow--foot">
        <button
          className="pescrollbtn"
          aria-label="Scroll back one step"
          disabled={start <= 0}
          onPointerDown={() => hold.start(() => setStartStep((s) => Math.max(0, s - 1)))}
          onPointerUp={hold.stop}
          onPointerLeave={hold.stop}
        >
          <IconTriangle dir="left" size={12} />
        </button>
        <div className="pescroll" onMouseDown={pageTrack}>
          <span
            className="pescroll__thumb"
            role="slider"
            tabIndex={0}
            aria-label="Scroll through the Pattern"
            aria-valuemin={1}
            aria-valuemax={extent}
            aria-valuenow={start + 1}
            style={{
              left: `${(start / extent) * 100}%`,
              width: `${(Math.min(cols, extent) / extent) * 100}%`,
            }}
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDown={startThumbDrag}
          />
        </div>
        <button
          className="pescrollbtn"
          aria-label="Scroll forward one step"
          disabled={start >= extent - cols}
          onPointerDown={() => hold.start(() => setStartStep((s) => clamp(s + 1, 0, MAX_START)))}
          onPointerUp={hold.stop}
          onPointerLeave={hold.stop}
        >
          <IconTriangle dir="right" size={12} />
        </button>
        <button
          className={"pesound" + (soundOn ? " pesound--on" : "")}
          aria-pressed={soundOn}
          title="Editor Sound Enable"
          aria-label="Editor Sound Enable"
          onClick={() => setSoundOn((v) => !v)}
        >
          <IconSpeaker size={14} />
        </button>
        <button
          className="pesizebox"
          title="Drag to resize the Pattern Editor"
          aria-label="Resize the Pattern Editor"
          onPointerDown={startResize}
        >
          <IconSizeBox size={16} />
        </button>
      </div>
      </div>
    </section>
  );
}
