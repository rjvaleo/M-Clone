// The Unified M interface — a single-screen recreation faithful to the classic
// six-window layout, wired to the live engine. Everything here binds to the
// same store the Studio view uses, so no functionality is lost.

import { useState } from "react";
import { useM } from "../state/store";
import { getRuntime } from "./runtime";
import { PatternGrid } from "./PatternGrid";
import { listMidiOutputs } from "../engine/outputs/webmidi";
import { NOTE_NAMES, midiToName, type ScaleName } from "../engine/music";
import type { NoteOrder } from "../engine/types";
import {
  POSITION_LABELS,
  type PositionVarId,
  type PositionValue,
} from "../engine/variables";

const ORDERS: NoteOrder[] = ["original", "reverse", "random", "random-walk"];
const DENOMS = [1, 2, 4, 8, 16];
const SCALES: ScaleName[] = [
  "chromatic", "major", "minor", "dorian", "mixolydian", "lydian",
  "phrygian", "harmonicMinor", "majorPentatonic", "minorPentatonic", "blues",
];

const VAR_ROWS: { id: PositionVarId; name: string }[] = [
  { id: "noteOrder", name: "Note Order" },
  { id: "transposition", name: "Transposition" },
  { id: "density", name: "Note Density" },
  { id: "velocity", name: "Vel Range" },
];

const CYCLIC = ["Accent", "Legato", "Rhythm"];

// Normalize a slot value to 0..1 for the miniature previews.
function norm(id: PositionVarId, value: PositionValue): number {
  if (id === "noteOrder") return ORDERS.indexOf(value as NoteOrder) / (ORDERS.length - 1);
  if (id === "transposition") return ((value as number) + 24) / 48;
  if (id === "density") return value as number;
  return (value as number) / 127; // velocity
}

function Win({ title, note, children, className }: {
  title: string;
  note?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={"uwin " + (className ?? "")}>
      <div className="uwin__title">
        <span className="uwin__name">{title}</span>
        <span className="uwin__slash">/</span>
        {note && <span className="uwin__note">{note}</span>}
      </div>
      <div className="uwin__body">{children}</div>
    </section>
  );
}

export function Unified() {
  const project = useM((s) => s.project);
  const selectedVoice = useM((s) => s.selectedVoice);
  const positions = useM((s) => s.positions);
  const snapshots = useM((s) => s.snapshots);
  const isPlaying = useM((s) => s.isPlaying);
  const editingVar = useM((s) => s.editingVar);
  const midiConduct = useM((s) => s.midiConduct);
  const robot = useM((s) => s.robotConductor);

  const setTempo = useM((s) => s.setTempo);
  const setPlaying = useM((s) => s.setPlaying);
  const selectVoice = useM((s) => s.selectVoice);
  const toggleVoiceEnabled = useM((s) => s.toggleVoiceEnabled);
  const setVoiceParam = useM((s) => s.setVoiceParam);
  const toggleStepPitch = useM((s) => s.toggleStepPitch);
  const setOutputLength = useM((s) => s.setOutputLength);
  const setRoot = useM((s) => s.setRoot);
  const setScale = useM((s) => s.setScale);
  const setScaleSnap = useM((s) => s.setScaleSnap);
  const setSeed = useM((s) => s.setSeed);
  const activatePosition = useM((s) => s.activatePosition);
  const setSlotValue = useM((s) => s.setSlotValue);
  const openEditor = useM((s) => s.openEditor);
  const closeEditor = useM((s) => s.closeEditor);
  const storeSnapshot = useM((s) => s.storeSnapshot);
  const recallSnapshot = useM((s) => s.recallSnapshot);
  const setMidiConduct = useM((s) => s.setMidiConduct);
  const setRobot = useM((s) => s.setRobot);

  const [group, setGroup] = useState(0);
  const [midiOuts, setMidiOuts] = useState<MIDIOutput[]>([]);
  const [midiId, setMidiId] = useState("");
  const [cyclic, setCyclic] = useState<boolean[][][]>(() =>
    CYCLIC.map(() => project.voices.map(() => Array(16).fill(false))),
  );

  const start = async () => { await getRuntime().start(); setPlaying(true); };
  const stop = () => { getRuntime().stop(); setPlaying(false); };
  const sync = () => getRuntime().sync();

  const toggleStep = (pi: number, step: number, pitches: number[]) => {
    if (pitches.length > 0) pitches.forEach((p) => toggleStepPitch(pi, step, p));
    else toggleStepPitch(pi, step, 60);
  };

  const enableMidi = async () => {
    const list = await listMidiOutputs();
    setMidiOuts(list);
  };
  const chooseMidi = (id: string) => {
    setMidiId(id);
    getRuntime().selectMidiOutput(midiOuts.find((o) => o.id === id) ?? null);
  };

  const editSlot = (id: PositionVarId, voice: number, value: PositionValue) =>
    setSlotValue(id, positions[id].active, voice, value);

  return (
    <div className="uroot">
      <div className="umenubar">
        <span className="umenubar__apple">&#63743;</span>
        {["File", "Edit", "Variables", "Pattern", "Windows", "Options", "Help"].map(
          (m) => <span key={m} className="umenubar__item">{m}</span>,
        )}
      </div>

      <div className="ustage">
        {/* Row 1 */}
        <div className="urow">
          <Win title="Patterns" note={`group ${POSITION_LABELS[group]}`} className="u-flex2">
            <div className="ugroup">
              {POSITION_LABELS.map((l, i) => (
                <button key={l} className={"utab" + (i === group ? " utab--on" : "")}
                  onClick={() => setGroup(i)}>{l}</button>
              ))}
            </div>
            <table className="utable">
              <thead>
                <tr>
                  <th>Play</th><th>V</th><th>Ch</th><th>Len</th><th>Base</th>
                  <th colSpan={16}>Steps</th>
                </tr>
              </thead>
              <tbody>
                {project.voices.map((v, i) => {
                  const pat = project.patterns[v.patternIndex];
                  return (
                    <tr key={i} className={i === selectedVoice ? "utable__sel" : ""}
                      onClick={() => selectVoice(i)}>
                      <td>
                        <input type="checkbox" checked={v.playEnabled}
                          onChange={() => toggleVoiceEnabled(i)}
                          aria-label={`play voice ${i + 1}`} />
                      </td>
                      <td className="b">{i + 1}</td>
                      <td>{v.channel}</td>
                      <td>
                        <input type="number" min={0} max={pat.steps.length}
                          value={pat.outputLength} className="unum"
                          onChange={(e) => setOutputLength(v.patternIndex, Number(e.target.value))} />
                      </td>
                      <td className="unowrap">
                        <input type="number" min={1} max={8} value={v.timeBaseNumerator}
                          className="unum unum--s"
                          onChange={(e) => setVoiceParam(i, "timeBaseNumerator", Number(e.target.value))} />
                        /
                        <select value={v.timeBaseDenominator}
                          onChange={(e) => setVoiceParam(i, "timeBaseDenominator", Number(e.target.value))}>
                          {DENOMS.map((d) => <option key={d} value={d}>{d}</option>)}
                        </select>
                      </td>
                      {Array.from({ length: 16 }, (_, step) => {
                        const on = step < pat.steps.length && pat.steps[step].pitches.length > 0;
                        const beat = step % 4 === 0;
                        return (
                          <td key={step} className="ustepcell">
                            <button
                              className={"ustep" + (on ? " ustep--on" : "") + (beat ? " ustep--beat" : "")}
                              disabled={step >= pat.steps.length}
                              onClick={(e) => { e.stopPropagation(); toggleStep(v.patternIndex, step, pat.steps[step]?.pitches ?? []); }}
                              aria-label={`voice ${i + 1} step ${step + 1}`} />
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Win>

          <Win title="Untitled" className="u-flex1">
            <div className="utransport">
              <button className={"ubtn" + (isPlaying ? " ubtn--on" : "")} onClick={start} disabled={isPlaying}>▶</button>
              <button className="ubtn" onClick={stop} disabled={!isPlaying}>■</button>
              <button className="ubtn" onClick={sync}>Sync</button>
            </div>
            <div className="urow2">
              <span className="b w44">Tempo</span>
              <input type="range" min={40} max={240} value={project.tempo}
                onChange={(e) => setTempo(Number(e.target.value))} className="ugrow" />
              <span className="b w30">{project.tempo}</span>
            </div>
            <div className="urow2">
              <label className="uchk"><input type="checkbox" checked={midiConduct}
                onChange={(e) => setMidiConduct(e.target.checked)} />Midi Conduct</label>
              <label className="uchk"><input type="checkbox" checked={robot}
                onChange={(e) => setRobot(e.target.checked)} />Robot</label>
            </div>
            <div className="udiv">
              <div className="urow2">
                <span className="b w36">Root</span>
                <select value={project.root} onChange={(e) => setRoot(Number(e.target.value))} className="ugrow">
                  {NOTE_NAMES.map((n, i) => <option key={n} value={i}>{n}</option>)}
                </select>
                <span className="b w36">Scale</span>
                <select value={project.scale} onChange={(e) => setScale(e.target.value as ScaleName)} className="ugrow">
                  {SCALES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div className="urow2 usplit">
                <label className="uchk b"><input type="checkbox" checked={project.scaleSnap}
                  onChange={(e) => setScaleSnap(e.target.checked)} />Scale Snap</label>
                <label className="uchk">Seed<input type="number" value={project.seed} className="unum"
                  onChange={(e) => setSeed(Number(e.target.value))} /></label>
              </div>
              <div className="urow2">
                <span className="b w36">MIDI</span>
                {midiOuts.length === 0
                  ? <button className="ubtn ubtn--wide" onClick={enableMidi}>Enable MIDI</button>
                  : <select value={midiId} onChange={(e) => chooseMidi(e.target.value)} className="ugrow">
                      <option value="">— none —</option>
                      {midiOuts.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                    </select>}
              </div>
            </div>
          </Win>

          <Win title="Snapshot" className="u-flexsnap">
            <div className="usnaps">
              {snapshots.map((snap, i) => (
                <button key={i}
                  className={"usnap" + (snap ? " usnap--full" : "")}
                  title={snap ? "Click: recall · Shift-click: overwrite" : "Click: store"}
                  onClick={(e) => {
                    if (!snap || e.shiftKey) storeSnapshot(i);
                    else recallSnapshot(i);
                  }}>{i + 1}</button>
              ))}
            </div>
            <div className="uhint">store / recall whole screen</div>
          </Win>
        </div>

        {/* Row 2 */}
        <div className="urow">
          <Win title="Variables" note="click name to edit · click cell to activate" className="u-flex2">
            <table className="uvars">
              <thead>
                <tr>
                  <th></th>
                  {POSITION_LABELS.map((l) => <th key={l}>{l}</th>)}
                </tr>
              </thead>
              <tbody>
                {VAR_ROWS.map(({ id, name }) => (
                  <tr key={id}>
                    <td className="uvars__name">
                      <button onClick={() => openEditor(id)}>{name}</button>
                    </td>
                    {positions[id].slots.map((slot, p) => (
                      <td key={p}>
                        <button
                          className={"umini" + (positions[id].active === p ? " umini--on" : "")}
                          onClick={() => activatePosition(id, p)}
                          aria-label={`${name} position ${POSITION_LABELS[p]}`}>
                          {slot.map((val, vi) => (
                            <span key={vi} className="umini__bar"
                              style={{ width: `${6 + norm(id, val) * 26}px` }} />
                          ))}
                        </button>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>

            {editingVar && (
              <div className="ueditor">
                <div className="ueditor__head">
                  <span className="b">
                    {VAR_ROWS.find((r) => r.id === editingVar)!.name} — Position{" "}
                    {POSITION_LABELS[positions[editingVar].active]}
                  </span>
                  <button className="ubtn" onClick={closeEditor}>Close</button>
                </div>
                <table className="uedit">
                  <tbody>
                    {positions[editingVar].slots[positions[editingVar].active].map((val, voice) => (
                      <tr key={voice}>
                        <td className="b">Voice {voice + 1}</td>
                        <td>
                          {editingVar === "noteOrder" && (
                            <select value={val as NoteOrder}
                              onChange={(e) => editSlot("noteOrder", voice, e.target.value as NoteOrder)}>
                              {ORDERS.map((o) => <option key={o} value={o}>{o}</option>)}
                            </select>
                          )}
                          {editingVar === "transposition" && (
                            <input type="number" min={-24} max={24} value={val as number}
                              onChange={(e) => editSlot("transposition", voice, Number(e.target.value))} />
                          )}
                          {editingVar === "density" && (
                            <input type="range" min={0} max={1} step={0.05} value={val as number}
                              onChange={(e) => editSlot("density", voice, Number(e.target.value))} />
                          )}
                          {editingVar === "velocity" && (
                            <input type="range" min={1} max={127} value={val as number}
                              onChange={(e) => editSlot("velocity", voice, Number(e.target.value))} />
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Win>

          <Win title="Cyclic Variables" note="preview — not yet sounding" className="u-flex1">
            <div className="ucyclics">
              {CYCLIC.map((name, ci) => (
                <div key={name} className="ucyc">
                  <div className="b ucyc__name">{name}</div>
                  {project.voices.map((_, vi) => (
                    <div key={vi} className="ucyc__row">
                      <span className="ucyc__lab">{vi + 1}</span>
                      <div className="ucyc__cells">
                        {cyclic[ci][vi].map((on, step) => (
                          <button key={step} className={"ucyccell" + (on ? " ucyccell--on" : "")}
                            onClick={() => setCyclic((prev) => {
                              const next = prev.map((a) => a.map((b) => b.slice()));
                              next[ci][vi][step] = !next[ci][vi][step];
                              return next;
                            })} />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </Win>
        </div>

        {/* Row 3 — Midi */}
        <Win title="Midi" note="per-voice output & transforms">
          <table className="utable umidi">
            <thead>
              <tr>
                <th>V</th><th>Channel</th><th>Program</th><th>Transpose</th>
                <th>Velocity</th><th>Density</th><th>Legato</th>
              </tr>
            </thead>
            <tbody>
              {project.voices.map((v, i) => (
                <tr key={i}>
                  <td className="b">{i + 1}</td>
                  <td><input type="number" min={1} max={16} value={v.channel} className="unum"
                    onChange={(e) => setVoiceParam(i, "channel", Number(e.target.value))} /></td>
                  <td><input type="number" min={0} max={127} value={v.program} className="unum"
                    onChange={(e) => setVoiceParam(i, "program", Number(e.target.value))} /></td>
                  <td><input type="number" min={-24} max={24} value={v.transposition} className="unum"
                    onChange={(e) => setVoiceParam(i, "transposition", Number(e.target.value))} /></td>
                  <td><input type="range" min={1} max={127} value={v.velocity}
                    onChange={(e) => setVoiceParam(i, "velocity", Number(e.target.value))} /></td>
                  <td><input type="range" min={0} max={1} step={0.05} value={v.density}
                    onChange={(e) => setVoiceParam(i, "density", Number(e.target.value))} /></td>
                  <td><input type="range" min={0.1} max={1.5} step={0.05} value={v.legato}
                    onChange={(e) => setVoiceParam(i, "legato", Number(e.target.value))} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Win>

        {/* Pattern Editor — full piano roll, preserving the sequencer */}
        <Win title="Pattern Editor" note={`Voice ${selectedVoice + 1} · ${midiToName(60)} = C4`}>
          <PatternGrid />
        </Win>
      </div>
    </div>
  );
}
