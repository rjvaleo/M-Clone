/**
 * Eurorack White — Behringer EDGE, Cre8Audio West Pest, GRP-A4, Rossum: a
 * white or black panel with a flat-colour knob and ticks printed on the
 * *panel* rather than the knob body — the technique Behringer's overlay
 * makes clearest. See CATALOG.md entries 3, 4, 5, 6.
 *
 * No source showed a numeric stepper for this family; synthesized here as
 * a chunky rounded-rectangle pill, matching Cre8Audio's rounded button
 * language rather than inventing an unrelated shape.
 */

import { knobAngle, normalize, polarToCartesian, sliderPosition, stepperStep, tickAngles } from "../geometry";
import type { ButtonProps, JackProps, KitFace, KnobFaceProps, LedProps, SliderFaceProps, StepperProps, ToggleProps } from "../types";
import { makeParts } from "./parts";

const ACCENT = "var(--mm-accent, #f2c14e)";
const INK = "var(--mm-text, #1a1815)";
const PANEL_LINE = "rgba(0,0,0,.55)";

function knob(props: KnobFaceProps) {
  const size = props.size ?? 44;
  const cx = size / 2;
  const cy = size / 2;
  const bodyRadius = size / 2 - 7;
  const tickRadius = size / 2 - 2;
  const t = normalize(props.value, props.min, props.max);
  const angle = knobAngle(t);
  const ticks = tickAngles(11);
  const pointer = polarToCartesian(cx, cy, bodyRadius - 3, angle);
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
      {ticks.map((deg, i) => {
        const outer = polarToCartesian(cx, cy, tickRadius, deg);
        const inner = polarToCartesian(cx, cy, tickRadius - 3, deg);
        return <line key={i} x1={inner.x} y1={inner.y} x2={outer.x} y2={outer.y} stroke={PANEL_LINE} strokeWidth={1} />;
      })}
      <circle cx={cx} cy={cy} r={bodyRadius} fill={ACCENT} stroke={props.dragging ? INK : "rgba(0,0,0,.3)"} strokeWidth={props.dragging ? 2 : 1} />
      <line x1={cx} y1={cy} x2={pointer.x} y2={pointer.y} stroke="#fff" strokeWidth={2} strokeLinecap="round" />
      {props.label && (
        <text x={cx} y={size + 11} textAnchor="middle" fontSize={9} fontWeight={700} fill="var(--mm-text, #1a1815)">
          {props.label}
        </text>
      )}
    </svg>
  );
}

function slider(props: SliderFaceProps) {
  const vertical = (props.orientation ?? "vertical") === "vertical";
  const length = props.length ?? 90;
  const w = vertical ? 22 : length;
  const h = vertical ? length : 22;
  const t = normalize(props.value, props.min, props.max);
  const pos = sliderPosition(t, length - 18, vertical);
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="slider" aria-label={props.label}
      aria-valuemin={props.min} aria-valuemax={props.max} aria-valuenow={props.value}
      style={{ cursor: props.disabled ? "default" : vertical ? "ns-resize" : "ew-resize", touchAction: "none" }}
      opacity={props.disabled ? 0.45 : 1} {...props.dragHandlers}>
      {vertical ? (
        <>
          <rect x={w / 2 - 3} y={2} width={6} height={h - 4} rx={2} fill="none" stroke={PANEL_LINE} strokeWidth={1} />
          <rect x={1} y={pos} width={w - 2} height={18} rx={4} fill={ACCENT} stroke={INK} strokeWidth={1} />
        </>
      ) : (
        <>
          <rect x={2} y={h / 2 - 3} width={w - 4} height={6} rx={2} fill="none" stroke={PANEL_LINE} strokeWidth={1} />
          <rect x={pos} y={1} width={18} height={h - 2} rx={4} fill={ACCENT} stroke={INK} strokeWidth={1} />
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
      <svg width={24} height={12} viewBox="0 0 24 12">
        <rect x={0.5} y={0.5} width={23} height={11} rx={5.5} fill={props.value ? ACCENT : "#e8e5df"} stroke={INK} strokeWidth={1} />
        <circle cx={props.value ? 18 : 6} cy={6} r={4.5} fill="#fff" stroke={INK} strokeWidth={0.75} />
      </svg>
      {props.label && <span style={{ fontSize: 11, color: "var(--mm-text, #1a1815)" }}>{props.label}</span>}
    </button>
  );
}

function button(props: ButtonProps) {
  return (
    <button type="button" onClick={props.onClick} disabled={props.disabled}
      style={{
        font: "700 10px/1 ui-sans-serif, sans-serif", padding: "8px 10px", borderRadius: 999,
        background: props.pressed ? ACCENT : "#f3f1ec", color: INK, border: `2px solid ${INK}`,
        cursor: props.disabled ? "default" : "pointer", opacity: props.disabled ? 0.45 : 1,
      }}>
      {props.label}
    </button>
  );
}

function jack(props: JackProps) {
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", gap: 3, background: "#2d2d2d", padding: "4px 5px", borderRadius: 4 }}>
      <svg width={18} height={18} viewBox="0 0 18 18">
        <circle cx={9} cy={9} r={7.5} fill="#0c0c0c" stroke="#555" strokeWidth={1} />
        <circle cx={9} cy={9} r={3} fill="#000" />
        {props.connected && <circle cx={9} cy={9} r={1.4} fill={ACCENT} />}
      </svg>
      {props.label && <small style={{ fontSize: 8, color: "#d9d5cc" }}>{props.label}</small>}
    </span>
  );
}

function led(props: LedProps) {
  const color = props.tone === "warn" ? "#e0432f" : props.tone === "ok" ? "#3bb273" : ACCENT;
  return (
    <svg width={11} height={11} viewBox="0 0 11 11" aria-hidden="true">
      <circle cx={5.5} cy={5.5} r={5} fill="none" stroke={PANEL_LINE} strokeWidth={1} />
      <circle cx={5.5} cy={5.5} r={3} fill={props.on ? color : "transparent"} />
    </svg>
  );
}

function stepper(props: StepperProps) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 3, borderRadius: 999, border: `2px solid ${INK}`, padding: "2px 3px", opacity: props.disabled ? 0.45 : 1 }}>
      <button type="button" disabled={props.disabled} onClick={() => stepperStep(props, -1)}
        style={{ background: ACCENT, border: `1px solid ${INK}`, borderRadius: "50%", color: INK, cursor: "pointer", font: "800 11px/1 ui-sans-serif, sans-serif", width: 17, height: 17 }}>
        −
      </button>
      <span style={{ font: "700 12px/1 ui-monospace, monospace", color: INK, minWidth: 22, textAlign: "center" }}>{props.value}</span>
      <button type="button" disabled={props.disabled} onClick={() => stepperStep(props, 1)}
        style={{ background: ACCENT, border: `1px solid ${INK}`, borderRadius: "50%", color: INK, cursor: "pointer", font: "800 11px/1 ui-sans-serif, sans-serif", width: 17, height: 17 }}>
        +
      </button>
    </span>
  );
}

// Screen-printed on a white aluminium panel: near-square corners, dark ink,
// and the tight condensed caps a panel printer actually uses.
const parts = makeParts({
  radius: 2,
  filled: true,
  readoutFont: '700 12px/1 ui-monospace, "SF Mono", Menlo, monospace',
  labelFont: '700 9.5px/1.2 ui-sans-serif, "Helvetica Neue", sans-serif',
  ink: INK,
  accent: ACCENT,
  dim: "rgba(26,24,21,.5)",
  surface: "var(--mm-surface, #efece6)",
  border: PANEL_LINE,
  onAccent: "var(--mm-on-accent, #1a1815)",
  warn: "var(--status-blocked-text, #c0392b)",
  meterGap: 1.5,
  handleHeight: 14,
});

export const eurorackFace: KitFace = { knob, slider, toggle, button, jack, led, stepper, ...parts };
