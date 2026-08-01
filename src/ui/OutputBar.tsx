// Output + key/scale controls: master volume, built-in synth toggle, Web MIDI
// device selection, and the harmonic context (root / scale / snap).

import { useState } from "react";
import { useM } from "../state/store";
import { getRuntime } from "./runtime";
import { NOTE_NAMES, type ScaleName } from "../engine/music";

const SCALES: ScaleName[] = [
  "chromatic",
  "major",
  "minor",
  "dorian",
  "mixolydian",
  "lydian",
  "phrygian",
  "harmonicMinor",
  "majorPentatonic",
  "minorPentatonic",
  "blues",
];

export function OutputBar() {
  const root = useM((s) => s.project.root);
  const scale = useM((s) => s.project.scale);
  const scaleSnap = useM((s) => s.project.scaleSnap);
  const setRoot = useM((s) => s.setRoot);
  const setScale = useM((s) => s.setScale);
  const setScaleSnap = useM((s) => s.setScaleSnap);

  const [synthOn, setSynthOn] = useState(true);
  const [volume, setVolume] = useState(0.8);
  const [outputs, setOutputs] = useState<MIDIOutput[]>([]);
  const [midiIds, setMidiIds] = useState<string[]>([]);
  const [midiError, setMidiError] = useState("");

  const enableMidi = async () => {
    try {
      const registry = getRuntime().midiPorts();
      const list = await registry.enable();
      setOutputs(list);
      registry.subscribe(setOutputs);
      if (list.length === 0) setMidiError("No MIDI outputs found.");
    } catch {
      setMidiError("Web MIDI unavailable or permission denied.");
    }
  };

  const chooseMidi = (ids: string[]) => {
    setMidiIds(ids);
    getRuntime().midiPorts().select(ids);
  };

  return (
    <section className="window">
      <h2 className="window__title">Output &amp; Key</h2>
      <div className="window__body outbar">
        <label className="field field--inline">
          <input
            type="checkbox"
            checked={synthOn}
            onChange={(e) => {
              setSynthOn(e.target.checked);
              getRuntime().setSynthEnabled(e.target.checked);
            }}
          />
          <span>Built-in synth</span>
        </label>

        <label className="field">
          <span>Volume</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={volume}
            onChange={(e) => {
              const v = Number(e.target.value);
              setVolume(v);
              getRuntime().setMasterVolume(v);
            }}
          />
        </label>

        <div className="field">
          <span>MIDI out</span>
          {outputs.length === 0 ? (
            <button className="btn" onClick={enableMidi}>
              Enable MIDI
            </button>
          ) : (
            <select multiple value={midiIds}
              aria-label="MIDI outputs"
              onChange={(e) => chooseMidi(
                Array.from(e.target.selectedOptions, (option) => option.value),
              )}>
              {outputs.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          )}
          {midiError && <small className="err">{midiError}</small>}
        </div>

        <label className="field">
          <span>Key</span>
          <select value={root} onChange={(e) => setRoot(Number(e.target.value))}>
            {NOTE_NAMES.map((n, i) => (
              <option key={n} value={i}>
                {n}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Scale</span>
          <select value={scale} onChange={(e) => setScale(e.target.value as ScaleName)}>
            {SCALES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>

        <label className="field field--inline">
          <input
            type="checkbox"
            checked={scaleSnap}
            onChange={(e) => setScaleSnap(e.target.checked)}
          />
          <span>Snap to key</span>
        </label>
      </div>
    </section>
  );
}
