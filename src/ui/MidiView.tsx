import { useEffect, useMemo, useRef, useState } from "react";
import { groupMidiViewRows } from "../engine/midiview";
import { useM } from "../state/store";

export function MidiView() {
  const events = useM((state) => state.midiViewEvents);
  const clear = useM((state) => state.clearMidiView);
  const [follow, setFollow] = useState(true);
  const viewport = useRef<HTMLDivElement>(null);
  const rows = useMemo(() => groupMidiViewRows(events), [events]);

  useEffect(() => {
    if (follow && viewport.current) {
      viewport.current.scrollTop = viewport.current.scrollHeight;
    }
  }, [events, follow]);

  return (
    <div className="midiview">
      <div className="midiview__tools">
        <span>{events.length} messages</span>
        <button className={follow ? "is-on" : ""} onClick={() => setFollow((value) => !value)}>
          Follow
        </button>
        <button onClick={clear}>Clear</button>
      </div>
      <div className="midiview__tracker-head">
        <b>TIME</b>
        {Array.from({ length: 4 }, (_, voice) => (
          <b key={voice} className={`uvoice uvoice--${voice + 1}`}>STREAM {voice + 1}</b>
        ))}
      </div>
      <div className="midiview__viewport" ref={viewport}>
        {rows.map((row) => (
          <div className="midiview__row" key={row.atSec}>
            <time>{row.atSec.toFixed(3)}</time>
            {row.streams.map((stream, voice) => (
              <div key={voice} className={`midiview__cell uvoice uvoice--${voice + 1}`}>
                {stream.map((event) => (
                  <span key={event.id} className={`midiview__message midiview__message--${event.type}`}>
                    <strong>{event.type === "note-on" ? "ON " : "OFF"}</strong>
                    <b>{event.noteName}</b>
                    <i>#{String(event.note).padStart(3, "0")}</i>
                    <i>V{String(event.velocity).padStart(3, "0")}</i>
                    <i>C{String(event.channel).padStart(2, "0")}</i>
                    {event.type === "note-on" && <i>D{event.durationSec.toFixed(3)}</i>}
                  </span>
                ))}
              </div>
            ))}
          </div>
        ))}
        {events.length === 0 && <div className="midiview__waiting">Waiting for generated MIDI data…</div>}
      </div>
    </div>
  );
}
