// Conducting window (subset): transport buttons + tempo.

import { useM } from "../state/store";
import { getRuntime } from "./runtime";

export function Transport() {
  const isPlaying = useM((s) => s.isPlaying);
  const tempo = useM((s) => s.project.tempo);
  const setPlaying = useM((s) => s.setPlaying);
  const setTempo = useM((s) => s.setTempo);

  const start = async () => {
    await getRuntime().start();
    setPlaying(true);
  };
  const stop = () => {
    getRuntime().stop();
    setPlaying(false);
  };
  const sync = () => getRuntime().sync();

  return (
    <section className="window">
      <h2 className="window__title">Conducting</h2>
      <div className="window__body transport">
        <div className="transport__buttons">
          <button className="btn btn--play" onClick={start} disabled={isPlaying}>
            ▶ Start
          </button>
          <button className="btn" onClick={stop} disabled={!isPlaying}>
            ■ Stop
          </button>
          <button className="btn" onClick={sync}>
            ⟲ Sync
          </button>
        </div>
        <label className="field">
          <span>Tempo</span>
          <input
            type="range"
            min={30}
            max={280}
            value={tempo}
            onChange={(e) => setTempo(Number(e.target.value))}
          />
          <output>{tempo} BPM</output>
        </label>
      </div>
    </section>
  );
}
