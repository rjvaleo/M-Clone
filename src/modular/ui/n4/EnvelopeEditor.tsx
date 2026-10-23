/**
 * VOSM's envelope panel, tight: the curve with three square handles (peak,
 * knee, end) and its A · D · S · R printed under it. Drag a handle; the
 * nearest one to the pointer is the one that moves.
 */

import { useRef } from "react";
import { usePointerDrag } from "./kit";
import { formatValue } from "./format";
import { dragEnvelope, envelopeGeometry, nearestHandle, type Adsr, type EnvelopeHandle, type EnvelopeLimits } from "./envelope";

const BOX = { width: 128, height: 34 };
const PAD = 4;

export function EnvelopeEditor({ title, value, limits, onChange }: {
  title: string; value: Adsr; limits: EnvelopeLimits; onChange: (next: Adsr) => void;
}) {
  const g = envelopeGeometry(value, BOX, limits);
  const grabbed = useRef<EnvelopeHandle>("attack");
  const drag = usePointerDrag((x, y, _rect, phase) => {
    const px = x - PAD, py = y - PAD;
    if (phase === "down") grabbed.current = nearestHandle(g, px, py);
    onChange(dragEnvelope(value, grabbed.current, px, py, g, BOX, limits));
  });
  const p = (pt: { x: number; y: number }) => `${pt.x + PAD} ${pt.y + PAD}`;
  // Decay and release fall as curves, the way an exponential envelope sounds.
  const path = `M ${p(g.start)} L ${p(g.peak)} Q ${g.peak.x + PAD} ${g.decay.y + PAD} ${p(g.decay)} L ${p(g.hold)}`
    + ` Q ${g.hold.x + PAD} ${g.end.y + PAD} ${p(g.end)}`;
  const square = (pt: { x: number; y: number }, key: string) =>
    <rect key={key} className="n4-env__handle" x={pt.x + PAD - 2.5} y={pt.y + PAD - 2.5} width={5} height={5} />;
  return (
    <div className="n4-env">
      <span className="n4-env__title">{title}</span>
      <div className="n4-env__graph" ref={drag.ref} onPointerDown={drag.onPointerDown} data-n4-control="true"
        role="group" aria-label={`${title} envelope`}>
        <svg width={BOX.width + PAD * 2} height={BOX.height + PAD * 2} aria-hidden="true">
          <path className="n4-env__fill" d={`${path} Z`} />
          <path className="n4-env__line" d={path} />
          {square(g.peak, "a")}{square(g.decay, "d")}{square(g.end, "r")}
        </svg>
      </div>
      <div className="n4-env__values">
        <span><i>A</i>{formatValue(value.attack, { unit: "ms", step: 1 })}</span>
        <span><i>D</i>{formatValue(value.decay, { unit: "ms", step: 1 })}</span>
        <span><i>S</i>{formatValue(value.sustain, { step: 0.01 })}</span>
        <span><i>R</i>{formatValue(value.release, { unit: "ms", step: 1 })}</span>
      </div>
    </div>
  );
}
