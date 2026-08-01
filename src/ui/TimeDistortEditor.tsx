// The Time Distortion Edit Window.
//
// Unlike every other Variable's edit window, this one is not four sets of
// controls — the manual is explicit: "Each edit window (except the Time
// Distortion Edit Window) has four sets of editing controls, labeled 1-4. …
// In the Time Distortion Edit Window, you select numbers 1-4 to choose which
// Voice's Time Map to edit." So: one shared graph showing all four maps, with
// a Map Edit selector picking which one is live.
//
// Horizontal is Real Time, vertical is Clock Time, and the faint diagonal is
// the neutral map — where the two run together. Drawing the live map above
// that diagonal means the clock is running ahead of real time, so notes crowd
// together; below it, they stretch out.

import { useRef } from "react";
import { useM } from "../state/store";
import {
  type TimeMap,
  type TimeMapPoint,
  TIME_MAP_DENOMINATORS,
  MAX_TIME_MAP_LENGTH,
  addBreakpoint,
  clearTimeMap,
  moveBreakpoint,
  removeBreakpoint,
  setTimeMapLength,
  timeMapPolyline,
} from "../engine/timemap";

const SIZE = 260; // the graph is square, as in the original
const PAD = 10;
const PLOT = SIZE - PAD * 2;
/** How close a click must land to count as grabbing a breakpoint. */
const GRAB_PX = 9;

const NOTE_GLYPH: Record<number, string> = {
  1: "\u{1D15D}", // whole
  2: "\u{1D15E}", // half
  4: "♩", // quarter
  8: "♪", // eighth
  16: "♬", // sixteenth
};

/** Graph space (0..1, origin bottom-left) to SVG pixels. */
const px = (p: TimeMapPoint) => ({
  x: PAD + p.x * PLOT,
  y: PAD + (1 - p.y) * PLOT,
});

export function TimeDistortEditor({ editVoice, onEditVoice }: {
  editVoice: number;
  onEditVoice: (voice: number) => void;
}) {
  const positions = useM((s) => s.positions);
  const setSlotValue = useM((s) => s.setSlotValue);
  const svgRef = useRef<SVGSVGElement>(null);

  const active = positions.timeDistort.active;
  const maps = positions.timeDistort.slots[active] as unknown as TimeMap[];
  const map = maps[editVoice];

  const write = (next: TimeMap) =>
    setSlotValue("timeDistort", active, editVoice, next);

  /** Pointer position in graph space, clamped to the unit square. */
  const toGraph = (clientX: number, clientY: number): TimeMapPoint => {
    const r = svgRef.current!.getBoundingClientRect();
    const x = ((clientX - r.left) / r.width) * SIZE;
    const y = ((clientY - r.top) / r.height) * SIZE;
    return {
      x: Math.max(0, Math.min(1, (x - PAD) / PLOT)),
      y: Math.max(0, Math.min(1, 1 - (y - PAD) / PLOT)),
    };
  };

  /** Which breakpoint, if any, is under the pointer. */
  const hitTest = (clientX: number, clientY: number): number => {
    const r = svgRef.current!.getBoundingClientRect();
    const scale = r.width / SIZE;
    return map.points.findIndex((p) => {
      const q = px(p);
      const dx = r.left + q.x * scale - clientX;
      const dy = r.top + q.y * scale - clientY;
      return Math.hypot(dx, dy) <= GRAB_PX;
    });
  };

  const dragPoint = (index: number, pointerId: number) => {
    const move = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      write(moveBreakpoint(map, index, toGraph(e.clientX, e.clientY)));
    };
    const up = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const onGraphPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    const hit = hitTest(e.clientX, e.clientY);
    if (hit >= 0) {
      // "you can tug on the breakpoints and move them around for fine tuning"
      dragPoint(hit, e.pointerId);
      return;
    }
    // Clicking off the line sets a new breakpoint, and the map redraws through
    // it. Drag straight on to place it precisely.
    const next = addBreakpoint(map, toGraph(e.clientX, e.clientY));
    write(next);
    const index = next.points.findIndex(
      (p) => Math.abs(p.x - toGraph(e.clientX, e.clientY).x) < 1e-9,
    );
    if (index >= 0) dragPoint(index, e.pointerId);
  };

  return (
    <div className="utd">
      <div className="utd__bar">
        <span className="utd__label">Edit:</span>
        <div className="utd__voices" role="group" aria-label="Map Edit selector">
          {[0, 1, 2, 3].map((v) => (
            <button key={v} type="button"
              className={"utd__voice" + (v === editVoice ? " utd__voice--on" : "")}
              aria-pressed={v === editVoice}
              aria-label={`Edit Voice ${v + 1}'s time map`}
              onClick={() => onEditVoice(v)}>
              {v + 1}
            </button>
          ))}
        </div>
        <button type="button" className="utd__clear"
          title="Erase the map currently being edited"
          onClick={() => write(clearTimeMap(map))}>
          Clear
        </button>
        <span className="utd__label">Length</span>
        <input type="number" className="utd__len" min={1} max={MAX_TIME_MAP_LENGTH}
          value={map.length}
          aria-label="Map length"
          onChange={(e) =>
            write(setTimeMapLength(map, Number(e.target.value), map.denominator))} />
        <span className="utd__times">&times;</span>
        <select className="utd__unit" value={map.denominator}
          aria-label="Map length unit"
          onChange={(e) =>
            write(setTimeMapLength(map, map.length, Number(e.target.value)))}>
          {TIME_MAP_DENOMINATORS.map((d) => (
            <option key={d} value={d}>{NOTE_GLYPH[d]}</option>
          ))}
        </select>
      </div>

      <svg ref={svgRef} className="utd__graph"
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        role="application"
        aria-label={`Time map for Voice ${editVoice + 1}`}
        onPointerDown={onGraphPointerDown}>
        <rect x={0.5} y={0.5} width={SIZE - 1} height={SIZE - 1}
          className="utd__frame" />

        {/* Every Voice's map is drawn; the one being edited is heavier. */}
        {maps.map((m, v) => {
          if (v === editVoice) return null;
          const d = timeMapPolyline(m)
            .map((p, i) => `${i === 0 ? "M" : "L"} ${px(p).x} ${px(p).y}`)
            .join(" ");
          return <path key={v} className={`utd__other uvoice uvoice--${v + 1}`} d={d} />;
        })}

        {/* The neutral diagonal, where clock time and real time run together.
            Drawn after the other Voices so it stays visible when their maps
            are neutral and therefore sitting exactly on top of it. */}
        <line className="utd__identity"
          x1={PAD} y1={PAD + PLOT} x2={PAD + PLOT} y2={PAD} />


        <path className={`utd__live uvoice uvoice--${editVoice + 1}`}
          d={timeMapPolyline(map)
            .map((p, i) => `${i === 0 ? "M" : "L"} ${px(p).x} ${px(p).y}`)
            .join(" ")} />

        {map.points.map((p, i) => (
          <rect key={i} className="utd__grip"
            x={px(p).x - 3} y={px(p).y - 3} width={6} height={6}
            onDoubleClick={(e) => {
              e.stopPropagation();
              write(removeBreakpoint(map, i));
            }}>
            <title>Breakpoint {i + 1} — drag to tug, double-click to remove</title>
          </rect>
        ))}
      </svg>
    </div>
  );
}
