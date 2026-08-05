/**
 * Thin Ring — Sektor, Axon3, KULT, ANA 2's shared language: a dark plugin
 * GUI where a knob has no body at all, just an arc of progress and a
 * pointer tick. See CATALOG.md entries 7, 8, 9, 10, 15.
 *
 * Colour comes from the theme, not the kit: every stroke below reads
 * `var(--mm-accent, …)`, so switching a *theme* still repaints a Thin Ring
 * knob, and only switching the *kit* changes what shape it draws. The
 * fallback after each `var()` is this family's own default — what the knob
 * looks like before any theme has been chosen at all.
 */

import { describeArc, knobAngle, normalize, polarToCartesian, sliderPosition, stepperStep } from "../geometry";
import type { ButtonProps, JackProps, KitFace, KnobFaceProps, LedProps, SliderFaceProps, StepperProps, ToggleProps } from "../types";

const RING_TRACK = "rgba(255,255,255,.12)";
const ACCENT = "var(--mm-accent, #5fd0c2)";
const INK = "var(--mm-text, #e7ecef)";

function knob(props: KnobFaceProps) {
  const size = props.size ?? 44;
  const cx = size / 2;
  const cy = size / 2;
  const radius = size / 2 - 4;
  const t = normalize(props.value, props.min, props.max);
  const angle = knobAngle(t);
  const trackPath = describeArc(cx, cy, radius, 135, 405);
  const valuePath = describeArc(cx, cy, radius, 135, angle);
  const tick = polarToCartesian(cx, cy, radius - 2, angle);
  const tickInner = polarToCartesian(cx, cy, radius * 0.45, angle);
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
      <path d={trackPath} fill="none" stroke={RING_TRACK} strokeWidth={2.5} strokeLinecap="round" />
      <path
        d={valuePath}
        fill="none"
        stroke={ACCENT}
        strokeWidth={props.dragging ? 3.2 : 2.5}
        strokeLinecap="round"
      />
      <circle cx={cx} cy={cy} r={radius * 0.5} fill="var(--mm-surface-2, #1a1f24)" />
      <line x1={tickInner.x} y1={tickInner.y} x2={tick.x} y2={tick.y} stroke={INK} strokeWidth={2} strokeLinecap="round" />
      {props.label && (
        <text x={cx} y={size + 11} textAnchor="middle" fontSize={9} fill="var(--mm-muted, #8a97a0)">
          {props.label}
        </text>
      )}
    </svg>
  );
}

function slider(props: SliderFaceProps) {
  const vertical = (props.orientation ?? "vertical") === "vertical";
  const length = props.length ?? 90;
  const thickness = 14;
  const w = vertical ? thickness : length;
  const h = vertical ? length : thickness;
  const t = normalize(props.value, props.min, props.max);
  const pos = sliderPosition(t, length - thickness, vertical);
  const capCenter = vertical ? pos + thickness / 2 : pos + thickness / 2;
  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      role="slider"
      aria-label={props.label}
      aria-valuemin={props.min}
      aria-valuemax={props.max}
      aria-valuenow={props.value}
      style={{ cursor: props.disabled ? "default" : vertical ? "ns-resize" : "ew-resize", touchAction: "none" }}
      opacity={props.disabled ? 0.45 : 1}
      {...props.dragHandlers}
    >
      {vertical ? (
        <>
          <rect x={w / 2 - 1.5} y={2} width={3} height={h - 4} rx={1.5} fill={RING_TRACK} />
          <circle cx={w / 2} cy={capCenter} r={6} fill={ACCENT} stroke={INK} strokeWidth={props.dragging ? 1.5 : 1} />
        </>
      ) : (
        <>
          <rect x={2} y={h / 2 - 1.5} width={w - 4} height={3} rx={1.5} fill={RING_TRACK} />
          <circle cx={capCenter} cy={h / 2} r={6} fill={ACCENT} stroke={INK} strokeWidth={props.dragging ? 1.5 : 1} />
        </>
      )}
    </svg>
  );
}

function toggle(props: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={props.value}
      disabled={props.disabled}
      onClick={() => props.onChange(!props.value)}
      style={{
        display: "inline-flex", alignItems: "center", gap: 6, background: "none", border: "none",
        cursor: props.disabled ? "default" : "pointer", opacity: props.disabled ? 0.45 : 1, padding: 0, font: "inherit",
      }}
    >
      <svg width={16} height={16} viewBox="0 0 16 16">
        <circle cx={8} cy={8} r={6.5} fill={props.value ? ACCENT : "none"} stroke={props.value ? ACCENT : RING_TRACK} strokeWidth={2} />
        {props.value && <circle cx={8} cy={8} r={2.5} fill="var(--mm-surface-2, #1a1f24)" />}
      </svg>
      {props.label && <span style={{ fontSize: 11, color: INK }}>{props.label}</span>}
    </button>
  );
}

function button(props: ButtonProps) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      disabled={props.disabled}
      style={{
        font: "600 11px/1 ui-sans-serif, sans-serif", letterSpacing: ".02em", padding: "6px 12px",
        borderRadius: 999, border: `1px solid ${props.pressed ? ACCENT : "rgba(255,255,255,.18)"}`,
        background: props.pressed ? ACCENT : "transparent",
        color: props.pressed ? "var(--mm-on-accent, #05100e)" : INK,
        cursor: props.disabled ? "default" : "pointer", opacity: props.disabled ? 0.45 : 1,
      }}
    >
      {props.label}
    </button>
  );
}

function jack(props: JackProps) {
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
      <svg width={20} height={20} viewBox="0 0 20 20">
        <circle cx={10} cy={10} r={8} fill="var(--mm-surface-2, #1a1f24)" stroke={props.connected ? ACCENT : RING_TRACK} strokeWidth={2} />
        <circle cx={10} cy={10} r={2.5} fill={props.connected ? ACCENT : "rgba(255,255,255,.3)"} />
      </svg>
      {props.label && <small style={{ fontSize: 8.5, color: "var(--mm-muted, #8a97a0)" }}>{props.label}</small>}
    </span>
  );
}

function led(props: LedProps) {
  const color = props.tone === "warn" ? "var(--status-blocked-text, #e4574b)" : props.tone === "ok" ? "var(--status-done-text, #4ac783)" : ACCENT;
  return (
    <svg width={9} height={9} viewBox="0 0 9 9" aria-hidden="true">
      <circle cx={4.5} cy={4.5} r={4} fill={props.on ? color : "rgba(255,255,255,.1)"} />
    </svg>
  );
}

function stepper(props: StepperProps) {
  return (
    <span
      style={{
        display: "inline-flex", alignItems: "center", gap: 2, borderRadius: 999,
        border: "1px solid rgba(255,255,255,.16)", padding: "2px 4px", opacity: props.disabled ? 0.45 : 1,
      }}
    >
      <button type="button" disabled={props.disabled} onClick={() => stepperStep(props, -1)}
        style={{ background: "none", border: "none", color: INK, cursor: "pointer", font: "700 12px/1 ui-monospace, monospace", padding: "2px 6px" }}>
        −
      </button>
      <span style={{ font: "600 12px/1 ui-monospace, monospace", color: INK, minWidth: 24, textAlign: "center" }}>
        {props.value}
      </span>
      <button type="button" disabled={props.disabled} onClick={() => stepperStep(props, 1)}
        style={{ background: "none", border: "none", color: INK, cursor: "pointer", font: "700 12px/1 ui-monospace, monospace", padding: "2px 6px" }}>
        +
      </button>
    </span>
  );
}

export const thinRingFace: KitFace = { knob, slider, toggle, button, jack, led, stepper };
