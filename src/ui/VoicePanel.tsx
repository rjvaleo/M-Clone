// Variables + Midi windows (subset): one row per Voice with the transforms
// that are wired into the engine so far.

import { useM } from "../state/store";
const DENOMS = [1, 2, 4, 8, 16];

export function VoicePanel() {
  const voices = useM((s) => s.project.voices);
  const selected = useM((s) => s.selectedVoice);
  const selectVoice = useM((s) => s.selectVoice);
  const toggleEnabled = useM((s) => s.toggleVoiceEnabled);
  const setParam = useM((s) => s.setVoiceParam);

  return (
    <section className="window window--wide">
      <h2 className="window__title">Variables &amp; Midi</h2>
      <div className="window__body">
        <table className="voices">
          <thead>
            <tr>
              <th>Edit</th>
              <th>Play</th>
              <th>Voice</th>
              <th>Note Order</th>
              <th>Transpose</th>
              <th>Density</th>
              <th>Velocity Range</th>
              <th>Time Base</th>
              <th>Legato</th>
              <th>Chan</th>
              <th>Prog</th>
            </tr>
          </thead>
          <tbody>
            {voices.map((v, i) => (
              <tr key={i} className={i === selected ? "voices__row--sel" : ""}>
                <td>
                  <input
                    type="radio"
                    name="voice"
                    checked={i === selected}
                    onChange={() => selectVoice(i)}
                    aria-label={`edit voice ${i + 1}`}
                  />
                </td>
                <td>
                  <button
                    className={"speaker" + (v.playEnabled ? " speaker--on" : "")}
                    onClick={() => toggleEnabled(i)}
                    aria-pressed={v.playEnabled}
                    aria-label={`play enable voice ${i + 1}`}
                  >
                    {v.playEnabled ? "🔊" : "🔇"}
                  </button>
                </td>
                <td>{i + 1}</td>
                <td>
                  {v.noteOrderMix.original}/{v.noteOrderMix.cyclic}/{v.noteOrderMix.utterly}
                </td>
                <td>
                  <input
                    type="number"
                    min={-24}
                    max={24}
                    value={v.transposition}
                    onChange={(e) => setParam(i, "transposition", Number(e.target.value))}
                  />
                </td>
                <td>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={v.density}
                    onChange={(e) => setParam(i, "density", Number(e.target.value))}
                  />
                </td>
                <td>
                  <span>{v.velocityRange.low}–{v.velocityRange.high}</span>
                </td>
                <td>
                  <select
                    value={v.timeBaseDenominator}
                    onChange={(e) =>
                      setParam(i, "timeBaseDenominator", Number(e.target.value))
                    }
                  >
                    {DENOMS.map((d) => (
                      <option key={d} value={d}>
                        1/{d}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    type="range"
                    min={0.1}
                    max={1.5}
                    step={0.05}
                    value={v.legato}
                    onChange={(e) => setParam(i, "legato", Number(e.target.value))}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    min={1}
                    max={16}
                    value={v.channel}
                    onChange={(e) => setParam(i, "channel", Number(e.target.value))}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    min={0}
                    max={127}
                    value={v.program}
                    onChange={(e) => setParam(i, "program", Number(e.target.value))}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
