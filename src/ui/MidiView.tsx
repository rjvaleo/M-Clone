/**
 * The MIDI readout, as a tracker.
 *
 * A row is one subdivision of the beat and every subdivision gets one, whether
 * or not a note lands in it. New rows arrive at the top and push the rest
 * down, a whole row at a time, so the movement is a clock tick rather than a
 * glide. Two notes a few ticks apart share a row instead of drawing on top of
 * each other, and a fast passage takes exactly as much space as a slow one —
 * the grid comes from the subdivision, not from how dense the music is.
 *
 * Two earlier models were wrong in opposite ways. A log appended a row per
 * event, so a bar of rests froze the display. Placing rows at their exact
 * position in beat space scrolled smoothly but spaced the music by its own
 * density, which is what made switching between fast and slow passages look
 * sloppy and let text overlap.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { formatLengthCell, scaleKey, type MidiViewEvent } from "../engine/midiview";
import {
  SCROLL_SPEEDS, beatsElapsed, rowOfTick, rowSpanForViewport, scrollSpeed,
} from "../engine/midiscroll";
import { PPQN } from "../engine/planner";
import { useM } from "../state/store";
import { getRuntime } from "./runtime";

/** Rows of empty grid kept above the newest one, so it is not flush to the top. */
const LEAD_ROWS = 1;

type Row = {
  ctrl: string | null;
  tune: string | null;
  streams: (MidiViewEvent | null)[];
};

export function MidiView() {
  const events = useM((state) => state.midiViewEvents);
  const transport = useM((state) => state.midiViewTransport);
  const clear = useM((state) => state.clearMidiView);
  const tempo = useM((state) => state.project.tempo);
  const [speedId, setSpeedId] = useState("4/4");
  const speed = scrollSpeed(speedId);

  /**
   * The row the transport is on, as a whole number.
   *
   * Polled every frame but stored as state, so React re-renders on the tick
   * and not between ticks: the display only ever changes when this integer
   * changes, and a frame landing mid-row has nothing to draw.
   */
  const [currentRow, setCurrentRow] = useState(0);
  useEffect(() => {
    let frame = 0;
    const poll = () => {
      const beat = beatsElapsed(getRuntime().transportElapsedSec(), tempo);
      const row = Math.floor(beat * speed.rowsPerBeat);
      setCurrentRow((previous) => (previous === row ? previous : row));
      frame = requestAnimationFrame(poll);
    };
    frame = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(frame);
  }, [tempo, speed.rowsPerBeat]);

  /**
   * Fold both event lists onto the grid, keyed by row.
   *
   * A stream keeps only the last note in its row: a subdivision is one slot,
   * and stacking two notes into it is what made rows grow and text collide.
   */
  const rows = useMemo(() => {
    const byRow = new Map<number, Row>();
    const rowAt = (index: number): Row => {
      let row = byRow.get(index);
      if (!row) {
        row = { ctrl: null, tune: null, streams: [null, null, null, null] };
        byRow.set(index, row);
      }
      return row;
    };

    // CTRL carries the transport and nothing else.
    for (const mark of transport) {
      const tick = beatsElapsed(mark.atSec, tempo) * PPQN;
      rowAt(rowOfTick(tick, speed)).ctrl =
        `${mark.direction === "out" ? "▶" : "◀"} ${mark.type.toUpperCase()}`;
    }

    // TUNE prints once, on the row where it changes — not against every note.
    let lastTune: string | null = null;
    for (const event of events) {
      if (event.atTick === undefined || event.type === "note-off") continue;
      const row = rowAt(rowOfTick(event.atTick, speed));
      row.streams[event.voice] = event;
      const tune = event.scale ? scaleKey(event.scale) : null;
      if (tune && tune !== lastTune) {
        row.tune = tune;
        lastTune = tune;
      }
    }
    return byRow;
  }, [events, transport, speed, tempo]);

  const viewport = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(200);
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const measure = () => setHeight(el.clientHeight);
    measure();
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(el);
    return () => observer?.disconnect();
  }, []);

  // Newest at the top, counting back. Always a full screen of grid, including
  // the negative rows from before the run started, which draw empty.
  const indices = rowSpanForViewport(currentRow, height, LEAD_ROWS);

  const empty = events.length === 0 && transport.length === 0;

  return (
    <div className="midiview">
      <div className="midiview__tools">
        <span>{events.length} messages</span>
        <label className="midiview__speed">
          SPEED
          <select value={speedId} onChange={(e) => setSpeedId(e.currentTarget.value)}>
            {SCROLL_SPEEDS.map((option) => (
              <option key={option.id} value={option.id}>{option.label}</option>
            ))}
          </select>
        </label>
        <button onClick={clear}>Clear</button>
      </div>

      <div className="midiview__tracker-head">
        <b>CTRL</b>
        <b>TUNE</b>
        {Array.from({ length: 4 }, (_, voice) => (
          <b key={voice} className={`uvoice uvoice--${voice + 1}`}>STREAM {voice + 1}</b>
        ))}
      </div>

      <div className="midiview__viewport" ref={viewport}>
        {indices.map((index) => {
          const row = rows.get(index);
          return (
            <div
              key={index}
              className={"midiview__row"
                + (index === currentRow ? " is-now" : "")
                // A rule on the beat, so the pulse is readable at a glance.
                + (index % speed.rowsPerBeat === 0 ? " is-beat" : "")}
            >
              <span className="midiview__ctrl">{row?.ctrl ?? ""}</span>
              <span className="midiview__tune">{row?.tune ?? ""}</span>
              {Array.from({ length: 4 }, (_, voice) => {
                const note = row?.streams[voice];
                if (!note) return <span key={voice} className="midiview__cell" />;
                return (
                  <span
                    key={voice}
                    className={"midiview__cell uvoice uvoice--" + (voice + 1)
                      + " midiview__cell--" + (note.source ?? "original")}
                  >
                    <b>{note.noteName.padEnd(4, " ")}</b>
                    <i>V{String(note.velocity).padStart(3, "0")}</i>
                    <i>{formatLengthCell((note.durationTicks ?? 0) / PPQN)}</i>
                    {/* Per-stream effect slot — transpose, glide, clock divide.
                        Blank until the planner reports what it applied. */}
                    <i className="midiview__efx">{"   "}</i>
                  </span>
                );
              })}
            </div>
          );
        })}
        {empty && (
          <div className="midiview__waiting">Waiting for generated MIDI data…</div>
        )}
      </div>
    </div>
  );
}
