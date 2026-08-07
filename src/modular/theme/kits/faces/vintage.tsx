/**
 * Vintage Wood — Minimoog, u-he Diva, OSS Enterprise: a skeuomorphic metal
 * knob with a pointer line and radial ticks, mechanical rocker switches,
 * and a warm chrome-on-dark material language. See CATALOG.md entries 1,
 * 12, 13.
 *
 * No source in the set showed a slider or a numeric stepper for this
 * family — Diva drives its envelopes from knobs alone, Minimoog has no
 * fine-adjust field anywhere. Both are synthesized here in the same metal
 * material rather than left out, which is the point of this pass: every
 * kit answers the same fourteen-item taxonomy, not just the seven or eight
 * things its source photographs happened to show.
 */

import type { CSSProperties } from "react";
import { knobAngle, normalize, polarToCartesian, sliderPosition, stepperStep, tickAngles } from "../geometry";
import type { ButtonProps, JackProps, KitFace, KnobFaceProps, LedProps, SliderFaceProps, StepperProps, ToggleProps } from "../types";
import { makeParts } from "./parts";
import { SEGMENT_STACK } from "./fonts";

const ACCENT = "var(--mm-accent, #d98a3d)";
const INK = "var(--mm-text, #f1e9df)";
const METAL_ID = "vintage-metal";

function MetalGradient() {
  return (
    <radialGradient id={METAL_ID} cx="35%" cy="30%" r="75%">
      <stop offset="0%" stopColor="#e9e6e1" />
      <stop offset="45%" stopColor="#a8a29a" />
      <stop offset="100%" stopColor="#4a463f" />
    </radialGradient>
  );
}

function knob(props: KnobFaceProps) {
  const size = props.size ?? 44;
  const cx = size / 2;
  const cy = size / 2 + (props.label ? 0 : 0);
  const radius = size / 2 - 3;
  const t = normalize(props.value, props.min, props.max);
  const angle = knobAngle(t);
  const ticks = tickAngles(11);
  const pointerOuter = polarToCartesian(cx, cy, radius - 3, angle);
  const pointerInner = polarToCartesian(cx, cy, radius * 0.25, angle);
  return (
    <svg
      width={size}
      height={size + (props.label ? 14 : 0)}
      viewBox={`0 0 ${size} ${size + (props.label ? 14 : 0)}`}
      role="slider"
      aria-label={props.label}
      aria-valuemin={props.min}
      aria-valuemax={props.max}
      aria-valuenow={props.value}
      aria-disabled={props.disabled}
      style={{ cursor: props.disabled ? "default" : "ns-resize", touchAction: "none" }}
      opacity={props.disabled ? 0.45 : 1}
      {...props.dragHandlers}
    >
      <defs><MetalGradient /></defs>
      {ticks.map((deg, i) => {
        const outer = polarToCartesian(cx, cy, radius + 2, deg);
        const inner = polarToCartesian(cx, cy, radius - 1, deg);
        return <line key={i} x1={inner.x} y1={inner.y} x2={outer.x} y2={outer.y} stroke="var(--mm-muted, #9a9186)" strokeWidth={1} />;
      })}
      <circle cx={cx} cy={cy} r={radius - 2} fill={`url(#${METAL_ID})`} stroke="#2a2622" strokeWidth={props.dragging ? 1.5 : 1} />
      <line x1={pointerInner.x} y1={pointerInner.y} x2={pointerOuter.x} y2={pointerOuter.y} stroke="#1c1a17" strokeWidth={2} strokeLinecap="round" />
      {props.label && (
        <text x={cx} y={size + 11} textAnchor="middle" fontSize={9} fontWeight={700} fill="var(--mm-muted, #9a9186)" style={{ textTransform: "uppercase", letterSpacing: ".02em" }}>
          {props.label}
        </text>
      )}
    </svg>
  );
}

function slider(props: SliderFaceProps) {
  const vertical = (props.orientation ?? "vertical") === "vertical";
  const length = props.length ?? 90;
  const w = vertical ? 20 : length;
  const h = vertical ? length : 20;
  const t = normalize(props.value, props.min, props.max);
  const pos = sliderPosition(t, length - 16, vertical);
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="slider" aria-label={props.label}
      aria-valuemin={props.min} aria-valuemax={props.max} aria-valuenow={props.value}
      style={{ cursor: props.disabled ? "default" : vertical ? "ns-resize" : "ew-resize", touchAction: "none" }}
      opacity={props.disabled ? 0.45 : 1} {...props.dragHandlers}>
      <defs><MetalGradient /></defs>
      {vertical ? (
        <>
          <rect x={w / 2 - 2} y={2} width={4} height={h - 4} rx={2} fill="#2a2622" />
          <rect x={2} y={pos} width={w - 4} height={16} rx={3} fill={`url(#${METAL_ID})`} stroke="#1c1a17" />
        </>
      ) : (
        <>
          <rect x={2} y={h / 2 - 2} width={w - 4} height={4} rx={2} fill="#2a2622" />
          <rect x={pos} y={2} width={16} height={h - 4} rx={3} fill={`url(#${METAL_ID})`} stroke="#1c1a17" />
        </>
      )}
    </svg>
  );
}

function toggle(props: ToggleProps) {
  return (
    <button type="button" role="switch" aria-checked={props.value} disabled={props.disabled}
      onClick={() => props.onChange(!props.value)}
      style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "none", border: "none", cursor: props.disabled ? "default" : "pointer", opacity: props.disabled ? 0.45 : 1, padding: 0, font: "inherit" }}>
      <svg width={22} height={13} viewBox="0 0 22 13">
        <rect x={0} y={0} width={22} height={13} rx={2.5} fill="#1c1a17" stroke="#000" strokeWidth={0.5} />
        <rect x={props.value ? 11 : 1} y={1} width={10} height={11} rx={1.5} fill={props.value ? ACCENT : "#5c574c"} />
      </svg>
      {props.label && <span style={{ fontSize: 11, color: INK }}>{props.label}</span>}
    </button>
  );
}

function button(props: ButtonProps) {
  return (
    <button type="button" onClick={props.onClick} disabled={props.disabled}
      style={{
        font: "700 10px/1 ui-sans-serif, sans-serif", letterSpacing: ".03em", textTransform: "uppercase",
        padding: "7px 14px", borderRadius: 5,
        background: props.pressed ? "#2a2622" : "linear-gradient(180deg, #6b655a, #423e37)",
        color: props.pressed ? ACCENT : INK,
        border: "1px solid #1c1a17", boxShadow: props.pressed ? "inset 0 2px 3px rgba(0,0,0,.6)" : "0 1px 0 rgba(255,255,255,.08)",
        cursor: props.disabled ? "default" : "pointer", opacity: props.disabled ? 0.45 : 1,
      }}>
      {props.label}
    </button>
  );
}

function jack(props: JackProps) {
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
      <svg width={20} height={20} viewBox="0 0 20 20">
        <circle cx={10} cy={10} r={8.5} fill="#141311" stroke="#5c574c" strokeWidth={1.5} />
        <circle cx={10} cy={10} r={4} fill="#000" />
        {props.connected && <circle cx={10} cy={10} r={1.6} fill={ACCENT} />}
      </svg>
      {props.label && <small style={{ fontSize: 8.5, color: "var(--mm-muted, #9a9186)" }}>{props.label}</small>}
    </span>
  );
}

function led(props: LedProps) {
  const color = props.tone === "warn" ? "#d94c3d" : props.tone === "ok" ? "#5fbf6b" : ACCENT;
  return (
    <svg width={10} height={10} viewBox="0 0 10 10" aria-hidden="true">
      {props.on && <circle cx={5} cy={5} r={5} fill={color} opacity={0.35} />}
      <circle cx={5} cy={5} r={3} fill={props.on ? color : "#2a2622"} stroke="#141311" strokeWidth={0.75} />
    </svg>
  );
}

function stepper(props: StepperProps) {
  const btnStyle: CSSProperties = {
    background: "linear-gradient(180deg, #6b655a, #423e37)", border: "1px solid #1c1a17", color: INK,
    cursor: "pointer", font: "700 11px/1 ui-sans-serif, sans-serif", width: 18, height: 18, borderRadius: 3,
  };
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, opacity: props.disabled ? 0.45 : 1 }}>
      <button type="button" disabled={props.disabled} onClick={() => stepperStep(props, -1)} style={btnStyle}>−</button>
      <span style={{ font: "600 12px/1 ui-monospace, monospace", color: INK, minWidth: 22, textAlign: "center" }}>{props.value}</span>
      <button type="button" disabled={props.disabled} onClick={() => stepperStep(props, 1)} style={btnStyle}>+</button>
    </span>
  );
}

// Warm, softly-cornered, and everything is filled — a panel of moulded
// plastic and painted metal has no unfilled shapes on it.
const parts = makeParts({
  radius: 4,
  filled: true,
  // A vintage panel's numeric readout is an LED counter, so it takes the
  // segment stack too — a step behind the LCD kit, which is all readout.
  readoutFont: `600 12px/1 ${SEGMENT_STACK}`,
  labelFont: '600 10px/1.2 ui-sans-serif, system-ui, sans-serif',
  ink: INK,
  accent: ACCENT,
  dim: "rgba(241,233,223,.52)",
  surface: "var(--mm-surface-2, #2b221a)",
  border: "rgba(255,255,255,.2)",
  onAccent: "var(--mm-on-accent, #2a1808)",
  warn: "var(--status-blocked-text, #e4574b)",
  meterGap: 2,
  handleHeight: 16,
});

export const vintageFace: KitFace = { knob, slider, toggle, button, jack, led, stepper, ...parts };
