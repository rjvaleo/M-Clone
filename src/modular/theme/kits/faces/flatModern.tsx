/**
 * Flat Modern — Surge XT, the unbranded VOSM wavetable synth, WaveNode: a
 * flat charcoal GUI where the slider is the primary control, knobs are
 * sparse and thin, and colour is a single warm accent against near-black.
 * See CATALOG.md entries 11, 14, 18.
 *
 * The one family in the whole set whose reference (WaveNode) uses *no*
 * knob anywhere — every parameter there is a slider. The knob face below
 * is still built, in the family's own flat-thin idiom, because a kit that
 * cannot render a knob at all cannot stand in for the others; the gap is
 * closed rather than carried forward into the kit.
 */

import { knobAngle, normalize, polarToCartesian, sliderPosition, stepperStep } from "../geometry";
import type { ButtonProps, JackProps, KitFace, KnobFaceProps, LedProps, SliderFaceProps, StepperProps, ToggleProps } from "../types";

const ACCENT = "var(--mm-accent, #e0983c)";
const TRACK = "rgba(255,255,255,.10)";
const INK = "var(--mm-text, #d7d2c8)";

function knob(props: KnobFaceProps) {
  const size = props.size ?? 40;
  const cx = size / 2;
  const cy = size / 2;
  const radius = size / 2 - 3;
  const t = normalize(props.value, props.min, props.max);
  const angle = knobAngle(t);
  const pointer = polarToCartesian(cx, cy, radius, angle);
  return (
    <svg width={size} height={size + (props.label ? 13 : 0)} viewBox={`0 0 ${size} ${size + (props.label ? 13 : 0)}`}
      role="slider" aria-label={props.label} aria-valuemin={props.min} aria-valuemax={props.max} aria-valuenow={props.value}
      aria-disabled={props.disabled} style={{ cursor: props.disabled ? "default" : "ns-resize", touchAction: "none" }}
      opacity={props.disabled ? 0.45 : 1} {...props.dragHandlers}>
      <circle cx={cx} cy={cy} r={radius} fill="none" stroke={TRACK} strokeWidth={1.5} />
      <line x1={cx} y1={cy} x2={pointer.x} y2={pointer.y} stroke={ACCENT} strokeWidth={props.dragging ? 2.5 : 1.75} strokeLinecap="round" />
      {props.label && (
        <text x={cx} y={size + 10} textAnchor="middle" fontSize={8.5} fill="var(--mm-muted, #8f897c)">{props.label}</text>
      )}
    </svg>
  );
}

function slider(props: SliderFaceProps) {
  const vertical = (props.orientation ?? "vertical") === "vertical";
  const length = props.length ?? 100;
  const thickness = 6;
  const w = vertical ? thickness + 8 : length;
  const h = vertical ? length : thickness + 8;
  const t = normalize(props.value, props.min, props.max);
  const pos = sliderPosition(t, length, vertical);
  const handleR = 4;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="slider" aria-label={props.label}
      aria-valuemin={props.min} aria-valuemax={props.max} aria-valuenow={props.value}
      style={{ cursor: props.disabled ? "default" : vertical ? "ns-resize" : "ew-resize", touchAction: "none" }}
      opacity={props.disabled ? 0.45 : 1} {...props.dragHandlers}>
      {vertical ? (
        <>
          <line x1={w / 2} y1={2} x2={w / 2} y2={h - 2} stroke={TRACK} strokeWidth={2} />
          <line x1={w / 2} y1={pos} x2={w / 2} y2={h - 2} stroke={ACCENT} strokeWidth={2} />
          <circle cx={w / 2} cy={pos} r={handleR} fill={ACCENT} />
        </>
      ) : (
        <>
          <line x1={2} y1={h / 2} x2={w - 2} y2={h / 2} stroke={TRACK} strokeWidth={2} />
          <line x1={2} y1={h / 2} x2={pos} y2={h / 2} stroke={ACCENT} strokeWidth={2} />
          <circle cx={pos} cy={h / 2} r={handleR} fill={ACCENT} />
        </>
      )}
    </svg>
  );
}

function toggle(props: ToggleProps) {
  return (
    <button type="button" role="switch" aria-checked={props.value} disabled={props.disabled}
      onClick={() => props.onChange(!props.value)}
      style={{
        font: "600 10px/1 ui-sans-serif, sans-serif", padding: "5px 9px", borderRadius: 4,
        background: props.value ? ACCENT : "transparent", color: props.value ? "#1a1200" : INK,
        border: `1px solid ${props.value ? ACCENT : "rgba(255,255,255,.18)"}`,
        cursor: props.disabled ? "default" : "pointer", opacity: props.disabled ? 0.45 : 1,
      }}>
      {props.label ?? (props.value ? "On" : "Off")}
    </button>
  );
}

function button(props: ButtonProps) {
  return (
    <button type="button" onClick={props.onClick} disabled={props.disabled}
      style={{
        font: "600 10.5px/1 ui-sans-serif, sans-serif", padding: "6px 11px", borderRadius: 4,
        background: props.pressed ? ACCENT : "rgba(255,255,255,.05)", color: props.pressed ? "#1a1200" : INK,
        border: "1px solid rgba(255,255,255,.14)", cursor: props.disabled ? "default" : "pointer", opacity: props.disabled ? 0.45 : 1,
      }}>
      {props.label}
    </button>
  );
}

function jack(props: JackProps) {
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
      <svg width={16} height={16} viewBox="0 0 16 16">
        <circle cx={8} cy={8} r={6.5} fill="none" stroke={props.connected ? ACCENT : TRACK} strokeWidth={1.5} />
        <circle cx={8} cy={8} r={1.75} fill={props.connected ? ACCENT : "rgba(255,255,255,.25)"} />
      </svg>
      {props.label && <small style={{ fontSize: 8, color: "var(--mm-muted, #8f897c)" }}>{props.label}</small>}
    </span>
  );
}

function led(props: LedProps) {
  const color = props.tone === "warn" ? "#e05a3d" : props.tone === "ok" ? "#4fbf7a" : ACCENT;
  return (
    <svg width={8} height={8} viewBox="0 0 8 8" aria-hidden="true">
      <rect x={0.5} y={0.5} width={7} height={7} rx={1.5} fill={props.on ? color : "rgba(255,255,255,.08)"} />
    </svg>
  );
}

function stepper(props: StepperProps) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 0, borderRadius: 4, border: "1px solid rgba(255,255,255,.14)", overflow: "hidden", opacity: props.disabled ? 0.45 : 1 }}>
      <button type="button" disabled={props.disabled} onClick={() => stepperStep(props, -1)}
        style={{ background: "rgba(255,255,255,.05)", border: "none", color: INK, cursor: "pointer", font: "600 11px/1 ui-sans-serif, sans-serif", padding: "3px 7px" }}>
        −
      </button>
      <span style={{ font: "600 11px/1 ui-monospace, monospace", color: INK, minWidth: 22, textAlign: "center", padding: "0 2px" }}>{props.value}</span>
      <button type="button" disabled={props.disabled} onClick={() => stepperStep(props, 1)}
        style={{ background: "rgba(255,255,255,.05)", border: "none", color: INK, cursor: "pointer", font: "600 11px/1 ui-sans-serif, sans-serif", padding: "3px 7px" }}>
        +
      </button>
    </span>
  );
}

export const flatModernFace: KitFace = { knob, slider, toggle, button, jack, led, stepper };
