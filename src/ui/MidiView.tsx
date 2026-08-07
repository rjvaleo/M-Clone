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
  ROW_HEIGHT_PX, SCROLL_SPEEDS, beatsElapsed, layoutStreamNotes, rowOfTick,
  rowSpanForViewport, scrollSpeed,
} from "../engine/midiscroll";
import { PPQN } from "../engine/planner";
import { useM } from "../state/store";
import { getRuntime } from "./runtime";

/** Rows of empty grid kept above the newest one, so it is not flush to the top. */
const LEAD_ROWS = 1;

type Row = { ctrl: string | null; tune: string | null };

export function MidiView() {
  const events = useM((state) => state.midiViewEvents);
  const transport = useM((state) => state.midiViewTransport);
  const clear = useM((state) => state.clearMidiView);
  const tempo = useM((state) => state.project.tempo);
  const isPlaying = useM((state) => state.isPlaying);
  const [speedId, setSpeedId] = useState("4/4");
  const speed = scrollSpeed(speedId);

  /**
   * The row the transport is on, as a whole number.
   *
   * Polled every frame but stored as state, so React re-renders on the tick
   * and not between ticks: the display only ever changes when this integer
   * changes, and a frame landing mid-row has nothing to draw.
   *
   * Only while running. `transportElapsedSec` is measured from a fixed origin
   * against a clock that never stops, so it keeps climbing after the transport
   * halts — polling it then would scroll the last run's notes past the
   * playhead indefinitely. Stopped, the grid holds where it was left, which is
   * also what makes the last bars readable after the music ends.
   */
  const [currentRow, setCurrentRow] = useState(0);
  useEffect(() => {
    if (!isPlaying) return;
    let frame = 0;
    const poll = () => {
      const beat = beatsElapsed(getRuntime().transportElapsedSec(), tempo);
      const row = Math.floor(beat * speed.rowsPerBeat);
      setCurrentRow((previous) => (previous === row ? previous : row));
      frame = requestAnimationFrame(poll);
    };
    frame = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(frame);
  }, [isPlaying, tempo, speed.rowsPerBeat]);

  // A new run starts the grid again at the top, matching the cleared readout.
  useEffect(() => {
    if (isPlaying) setCurrentRow(0);
  }, [isPlaying]);

  /**
   * The CTRL and TUNE lanes, keyed by row.
   *
   * Notes are laid out separately below, because a note can span rows and
   * these two cannot.
   */
  const lanes = useMemo(() => {
    const byRow = new Map<number, Row>();
    const rowAt = (index: number): Row => {
      let row = byRow.get(index);
      if (!row) {
        row = { ctrl: null, tune: null };
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
      const tune = event.scale ? scaleKey(event.scale) : null;
      if (tune && tune !== lastTune) {
        rowAt(rowOfTick(event.atTick, speed)).tune = tune;
        lastTune = tune;
      }
    }
    return byRow;
  }, [events, transport, speed, tempo]);

  /**
   * Notes per stream, fitted to the grid.
   *
   * A note spans the rows its length covers, and notes sharing a slot split it
   * between them — so a clock divider running faster than the grid fits two in
   * the space of one instead of drawing them on top of each other.
   */
  const streams = useMemo(() => {
    const perVoice: MidiViewEvent[][] = [[], [], [], []];
    for (const event of events) {
      if (event.atTick === undefined || event.type === "note-off") continue;
      perVoice[event.voice]?.push(event);
    }
    return perVoice.map((voiceNotes) =>
      layoutStreamNotes(
        voiceNotes.map((note) => ({ ...note, atTick: note.atTick! })),
        speed,
      ));
  }, [events, speed]);

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
  // The row drawn at y = 0. Named, because a bare `top` resolves to window.top.
  const topRow = currentRow + LEAD_ROWS;

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
        {/* The grid. Uniform rows in normal flow, one line tall each. */}
        {indices.map((index) => (
          <div
            key={index}
            className={"midiview__row"
              + (index === currentRow ? " is-now" : "")
              // A rule on the beat, so the pulse is readable at a glance.
              + (index % speed.rowsPerBeat === 0 ? " is-beat" : "")}
          >
            <span className="midiview__ctrl">{lanes.get(index)?.ctrl ?? ""}</span>
            <span className="midiview__tune">{lanes.get(index)?.tune ?? ""}</span>
            <span className="midiview__cell" />
            <span className="midiview__cell" />
            <span className="midiview__cell" />
            <span className="midiview__cell" />
          </div>
        ))}

        {/* Notes sit over the grid rather than inside a row, because a note
            can be taller than one row and a row cannot. The layer repeats the
            grid's own columns, so each stream gets the same width as its
            heading without either having to know the other's measurements. */}
        <div className="midiview__notes">
        {streams.map((voiceNotes, voice) => (
          <div key={voice} className="midiview__stream">
            {voiceNotes.map((note) => {
              const fromTop = topRow - note.startRow;
              if (fromTop < 0 || fromTop >= indices.length) return null;
              const share = 1 / note.subCount;
              return (
                <span
                  key={note.id}
                  className={"midiview__note uvoice uvoice--" + (voice + 1)
                    + " midiview__note--" + (note.source ?? "original")}
                  style={{
                    top: fromTop * ROW_HEIGHT_PX,
                    height: note.spanRows * ROW_HEIGHT_PX,
                    // Notes sharing a slot split it, so two fit where one did.
                    left: `${note.subIndex * share * 100}%`,
                    width: `${share * 100}%`,
                  }}
                >
                  <b>{note.noteName}</b>
                  <i>V{String(note.velocity).padStart(3, "0")}</i>
                  <i>{formatLengthCell((note.durationTicks ?? 0) / PPQN)}</i>
                  {/* Per-stream effect slot: transpose, glide, clock divide.
                      Blank until the planner reports what it applied. */}
                  <i className="midiview__efx">{"   "}</i>
                </span>
              );
            })}
          </div>
        ))}
        </div>

        {empty && (
          <div className="midiview__waiting">Waiting for generated MIDI data…</div>
        )}
      </div>
    </div>
  );
}
