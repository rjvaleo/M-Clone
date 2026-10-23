/**
 * M Clock's face: Numerology's Groove Clock (manual p167). Transport, the bar
 * and beat readouts, BPM and Bar Length at the left; BPM Fine Adjust with its
 * Latch and Adj Range below; the bar's sixteen "1 e + a" diamonds in the
 * middle, lit as the beat passes; and the SYNC strip along the bottom.
 *
 * M's Conducting lives here too. Tap sets the tempo from your taps; Tap
 * Conduct holds the music until each tap; Fine Adjust is the conducted
 * tempo, and the Conductor's baton moves it when Conduct Tempo is armed.
 */

import { useRef } from "react";
import { tappedTempo } from "../../../engine/tap";
import { N4Body, N4Box, N4Button, N4Field, N4Panel, N4Spinner } from "../n4/kit";
import { param, useMLabHost, type MLabFaceProps } from "./common";

const COUNTS = ["1", "e", "+", "a", "2", "e", "+", "a", "3", "e", "+", "a", "4", "e", "+", "a"];

export function ClockFace({ node, setParameter, setParameters, status }: MLabFaceProps) {
  const host = useMLabHost();
  const taps = useRef<number[]>([]);
  const range = param(node, "adj-range", 5);
  const fine = param(node, "fine", 0);
  const now = (Number(status.beat ?? 1) - 1) * 4 + (Number(status.sixteenth ?? 1) - 1);
  const tap = () => {
    const time = performance.now() / 1000;
    taps.current = [...taps.current, time].slice(-8);
    const bpm = tappedTempo(taps.current);
    if (bpm !== null) setParameter("tempo", Number(bpm.toFixed(2)));
    host?.run(node.id, "tap", "Tap");
  };
  const counts = COUNTS.slice(0, Math.min(16, param(node, "bar-length", 4) * 4));

  return (
    <N4Panel accent="yellow" wide>
      <N4Body
        left={<>
          <N4Box>
            <div className="n4-transport">
              <N4Button onClick={() => host?.run(node.id, "stop", "Stop")} title="Back to the start">⏮</N4Button>
              <N4Button onClick={() => host?.run(node.id, "stop", "Stop")} title="Stop">■</N4Button>
              <N4Button onClick={() => host?.run(node.id, "play", "Play")} title="Play">▶</N4Button>
            </div>
            <div className="n4-line">
              <span className="n4-field"><input readOnly value={status.bar ?? "1"} aria-label="Bar" style={{ width: "4em" }} /></span>
              <span className="n4-field"><input readOnly value={status.beat ?? "1"} aria-label="Beat" style={{ width: "2.6em" }} /></span>
            </div>
            <div className="n4-bpm"><N4Field label="BPM:" value={param(node, "tempo", 120)} min={20} max={300} step={0.01}
              onChange={(v) => setParameter("tempo", v)} /></div>
            <N4Spinner label="Bar Length" value={param(node, "bar-length", 4)}
              options={Array.from({ length: 16 }, (_, i) => ({ value: i + 1, label: String(i + 1) }))}
              onChange={(v) => setParameter("bar-length", v)} />
          </N4Box>
          <N4Box title="BPM Fine Adjust (%)">
            <div className="n4-line">
              <input type="range" min={-range} max={range} step={0.01} value={fine} aria-label="BPM Fine Adjust"
                onChange={(event) => setParameter("fine", Number(event.currentTarget.value))}
                onPointerUp={() => { if (node.parameters.latch === false) setParameter("fine", 0); }} />
              <span>{fine.toFixed(2)}</span>
            </div>
            <div className="n4-line">
              <N4Button on={node.parameters.latch !== false} onClick={() => setParameter("latch", node.parameters.latch === false)}>Latch</N4Button>
              <N4Field label="Adj Range" value={range} min={1} max={50} onChange={(v) => setParameters({ "adj-range": v, fine: Math.max(-v, Math.min(v, fine)) })} width={3} />
            </div>
          </N4Box>
        </>}
        right={<>
          <N4Box title="Tap" className="n4-box--centred">
            <N4Button onClick={tap}>Tap</N4Button>
            <N4Spinner label="Conduct" value={param(node, "tap-conduct", "off")}
              options={[{ value: "off", label: "Off" }, { value: "held", label: "Held" }]}
              onChange={(v) => setParameter("tap-conduct", v)} />
            <span className="n4-muted">{status.run ?? ""}</span>
          </N4Box>
          <N4Box title="Conduct Tempo" className="n4-box--centred">
            <N4Spinner value={param(node, "tempo-arrow", "off")}
              options={[{ value: "off", label: "Off" }, { value: "x", label: "Baton X" }, { value: "y", label: "Baton Y" }]}
              onChange={(v) => setParameter("tempo-arrow", v)} />
          </N4Box>
        </>}>
        <div className="n4-groove" style={{ gridTemplateColumns: `repeat(${Math.min(8, counts.length)}, 1fr)` }}>
          {counts.map((count, i) => (
            <div key={i} className={`n4-groove__step${i === now ? " is-now" : ""}`}>
              <span>{count}</span>
              <i />
              <span className="n4-groove__diamond" />
              <span>{i === 0 ? "Fixed" : "0.00"}</span>
            </div>
          ))}
        </div>
      </N4Body>
      <div className="n4-syncstrip">
        <b>SYNC</b>
        <N4Button onClick={() => host?.run(node.id, "sync", "Sync")} title="Restart every voice's cycles">Sync</N4Button>
        <N4Spinner label="Sync On" value={param(node, "sync-quantize", "now")}
          options={[{ value: "now", label: "Now" }, { value: "beat", label: "Beat" }, { value: "bar", label: "Bar" }]}
          onChange={(v) => setParameter("sync-quantize", v)} />
      </div>
    </N4Panel>
  );
}
