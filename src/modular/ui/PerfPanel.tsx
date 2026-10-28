/**
 * The performance panel (View › Performance): what takes the time, ranked by
 * total milliseconds over the last five seconds, with the frame rate and the
 * slow frames beside it. Opening it switches the recorder on; closing it
 * switches it off, so it costs nothing while shut. Copy puts the table on the
 * clipboard as text, for pasting into a conversation.
 */

import { useEffect, useState } from "react";
import { perf, SLOW_FRAME_MS, type FrameStats, type PerfRow } from "../perf/recorder";

const ms = (v: number) => (v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2));

export function perfReportText(rows: readonly PerfRow[], frames: FrameStats): string {
  const head = `frames ${frames.count}  fps ${frames.fps.toFixed(0)}  p95 ${ms(frames.p95Ms)}ms  slow(>${SLOW_FRAME_MS}ms) ${frames.slow}`;
  const lines = rows.map((r) => `${r.name.padEnd(30)} ${String(r.calls).padStart(5)}  total ${ms(r.totalMs).padStart(7)}  avg ${ms(r.avgMs).padStart(6)}  max ${ms(r.maxMs).padStart(6)}`);
  return [head, ...lines].join("\n");
}

export function PerfPanel({ onClose }: { onClose: () => void }) {
  const [rows, setRows] = useState<PerfRow[]>([]);
  const [frames, setFrames] = useState<FrameStats>({ count: 0, slow: 0, p95Ms: 0, fps: 0 });
  useEffect(() => {
    perf.enabled = true;
    let last = performance.now();
    let frame = requestAnimationFrame(function tick(now) {
      perf.frame(now - last);
      last = now;
      frame = requestAnimationFrame(tick);
    });
    const timer = window.setInterval(() => { setRows(perf.report()); setFrames(perf.frames()); }, 500);
    return () => { cancelAnimationFrame(frame); window.clearInterval(timer); perf.enabled = false; perf.clear(); };
  }, []);
  const top = rows.slice(0, 14);
  const worst = top[0]?.totalMs ?? 1;
  return (
    <aside className="mm-perf" aria-label="Performance" onClick={(event) => event.stopPropagation()}>
      <header className="mm-perf__head">
        <b>Performance</b>
        <span className={frames.slow ? "is-warn" : ""}>{frames.fps.toFixed(0)} fps · p95 {ms(frames.p95Ms)}ms · {frames.slow} slow</span>
        <button type="button" onClick={() => { void navigator.clipboard?.writeText(perfReportText(rows, frames)).catch(() => {}); }}>Copy</button>
        <button type="button" onClick={() => perf.clear()}>Clear</button>
        <button type="button" aria-label="Close performance" onClick={onClose}>×</button>
      </header>
      <table>
        <thead><tr><th>Last 5 s</th><th>calls</th><th>total</th><th>avg</th><th>max</th></tr></thead>
        <tbody>
          {top.map((r) => (
            <tr key={r.name}>
              <td><span className="mm-perf__bar" style={{ width: `${(r.totalMs / worst) * 100}%` }} />{r.name}</td>
              <td>{r.calls}</td><td>{ms(r.totalMs)}</td><td>{ms(r.avgMs)}</td><td className={r.maxMs > SLOW_FRAME_MS ? "is-warn" : ""}>{ms(r.maxMs)}</td>
            </tr>
          ))}
          {!top.length && <tr><td colSpan={5}>Recording… interact with the patch.</td></tr>}
        </tbody>
      </table>
    </aside>
  );
}
