/**
 * The MIDI readout, as a beat-clocked scroller.
 *
 * This used to be a log: rows appended as events arrived, scrolled by however
 * tall the list had grown. That drifts from the music by construction, because
 * a list only moves when something happens — a bar of rests and the display
 * sits still while the transport keeps going.
 *
 * Now every row is placed by its position on the transport's 960 PPQN
 * timeline, and the surface is redrawn against the transport clock rather than
 * against the arrival of events. The row under the playhead is the note being
 * heard because both are the same number, not two things kept in step.
 */

import { useEffect, useRef, useState } from "react";
import {
  beatOfTick, formatLengthCell, scaleKey, type MidiViewEvent,
} from "../engine/midiview";
import {
  ROW_HEIGHT_PX, SCROLL_SPEEDS, beatsElapsed, scrollSpeed, yForBeat,
} from "../engine/midiscroll";
import { useM } from "../state/store";
import { getRuntime } from "./runtime";

/**
 * The playhead sits one row down from the top.
 *
 * So a note is heard almost as soon as it appears, and the surface below is
 * what has already played — a record running away from the line rather than a
 * queue running towards it.
 */
const PLAYHEAD_ROWS_FROM_TOP = 1;

export function MidiView() {
  const events = useM((state) => state.midiViewEvents);
  const transport = useM((state) => state.midiViewTransport);
  const clear = useM((state) => state.clearMidiView);
  const tempo = useM((state) => state.project.tempo);
  const isPlaying = useM((state) => state.isPlaying);
  const [speedId, setSpeedId] = useState("4/4");
  const speed = scrollSpeed(speedId);

  // No viewport measurement: the playhead is a fixed number of rows from the
  // top, so nothing here depends on how tall the window happens to be.
  const surface = useRef<HTMLDivElement>(null);

  /**
   * Drive the surface from the transport clock, not from React state.
   *
   * A re-render per frame would rebuild every row sixty times a second to move
   * them all by the same amount. Instead the rows are laid out once in beat
   * space and the whole surface is translated, so a frame costs one style
   * write however many notes are on screen.
   */
  useEffect(() => {
    let frame = 0;
    const tick = () => {
      const beat = beatsElapsed(getRuntime().transportElapsedSec(), tempo);
      if (surface.current) {
        surface.current.style.transform =
          `translateY(${beat * speed.rowsPerBeat * ROW_HEIGHT_PX}px)`;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [tempo, speed.rowsPerBeat]);

  const playheadY = PLAYHEAD_ROWS_FROM_TOP * ROW_HEIGHT_PX;
  // Laid out at beat zero; the rAF loop above slides the whole surface.
  const top = (beat: number) => yForBeat(beat, 0, playheadY, speed);
  const beatOf = (event: MidiViewEvent) =>
    event.atTick === undefined ? null : beatOfTick(event.atTick);

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
        {Array.from({ length: 4 }, (_, voice) => (
          <b key={voice} className={`uvoice uvoice--${voice + 1}`}>STREAM {voice + 1}</b>
        ))}
      </div>

      <div className="midiview__viewport">
        <div className="midiview__surface" ref={surface}>
          {transport.map((mark) => (
            <div key={`t${mark.id}`} className="midiview__line"
              style={{ top: top(beatsElapsed(mark.atSec, tempo)) }}>
              <span className={`midiview__ctrl midiview__ctrl--${mark.direction}`}>
                {mark.direction === "out" ? "▶" : "◀"} {mark.type.toUpperCase()}
              </span>
            </div>
          ))}

          {events.map((event) => {
            const beat = beatOf(event);
            if (beat === null) return null;
            // A note-off is the tail of a note already drawn, not its own row.
            if (event.type === "note-off") return null;
            return (
              <div key={event.id} className="midiview__line" style={{ top: top(beat) }}>
                <span className="midiview__ctrl midiview__ctrl--scale">
                  {event.scale ? scaleKey(event.scale) : ""}
                </span>
                <span
                  className={"midiview__note uvoice uvoice--" + (event.voice + 1)
                    + " midiview__note--" + (event.source ?? "original")}
                  style={{ gridColumn: event.voice + 2 }}
                >
                  <b>{event.noteName.padEnd(4, " ")}</b>
                  <i>V{String(event.velocity).padStart(3, "0")}</i>
                  <i>{formatLengthCell((event.durationTicks ?? 0) / 960)}</i>
                </span>
              </div>
            );
          })}
        </div>

        {/* Fixed to the viewport, not the surface: the music moves past it. */}
        <div className="midiview__playhead" style={{ top: playheadY }} />
        {empty && (
          <div className="midiview__waiting">
            {isPlaying ? "Running…" : "Waiting for generated MIDI data…"}
          </div>
        )}
      </div>
    </div>
  );
}
