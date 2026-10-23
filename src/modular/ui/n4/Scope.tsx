/**
 * A small oscilloscope on a module's output: the live waveform, triggered on
 * a rising zero crossing so a steady note stands still, drawn as one bright
 * accent trace over a dark well with a centre line. Flat when nothing plays.
 */

import { useEffect, useRef } from "react";
import { triggerIndex } from "./scopeTrace";

export function Scope({ read, width = 56, height = 26, label = "Output" }: {
  read: (into: Float32Array) => boolean; width?: number; height?: number; label?: string;
}) {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const readRef = useRef(read);
  readRef.current = read;
  useEffect(() => {
    const samples = new Float32Array(2048);
    let frame = 0;
    const draw = () => {
      frame = requestAnimationFrame(draw);
      const el = canvas.current;
      const c = el?.getContext("2d");
      if (!el || !c) return;
      const dpr = window.devicePixelRatio || 1;
      if (el.width !== width * dpr) { el.width = width * dpr; el.height = height * dpr; }
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.clearRect(0, 0, width, height);
      const style = getComputedStyle(el);
      c.strokeStyle = style.getPropertyValue("--n4-cell").trim() || "#333";
      c.lineWidth = 1;
      c.beginPath(); c.moveTo(0, height / 2 + 0.5); c.lineTo(width, height / 2 + 0.5); c.stroke();
      const live = readRef.current(samples);
      const from = live ? triggerIndex(samples, samples.length / 2) : 0;
      const span = 512;
      c.strokeStyle = style.getPropertyValue("--n4-accent").trim() || "#ffae42";
      c.shadowColor = c.strokeStyle; c.shadowBlur = 3; c.lineWidth = 1.1;
      c.beginPath();
      for (let x = 0; x <= width; x++) {
        const v = live ? samples[from + Math.floor((x / width) * span)] ?? 0 : 0;
        const y = height / 2 - Math.max(-1, Math.min(1, v)) * (height / 2 - 1);
        if (x === 0) c.moveTo(x, y); else c.lineTo(x, y);
      }
      c.stroke();
      c.shadowBlur = 0;
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [width, height]);
  return <canvas ref={canvas} className="n4-scope" style={{ width, height }} role="img" aria-label={`${label} waveform`} />;
}
