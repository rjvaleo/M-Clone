/**
 * Line Art — the MOTM-300, and only the MOTM-300 (CATALOG.md entry 2): pure
 * black-on-white engineering drawing. No fill, no gradient, no colour
 * anywhere except what the theme's own ink token supplies. A knob is an
 * open circle with radiating ticks and a printed scale, not a rendered
 * object — closer to a technical illustration of a knob than a knob.
 *
 * This kit is the one place `var(--mm-accent, …)` is deliberately never
 * used: MOTM-300 has no accent colour to begin with, and adding one back in
 * would be decorating a source that is emphatic about not being decorated.
 * Interactive state (dragging, on/off, connected) is carried entirely by
 * line weight and fill-vs-outline, the two variables the source actually
 * has.
 */

import { knobAngle, normalize, polarToCartesian, sliderPosition, stepperStep, tickAngles } from "../geometry";
import type { ButtonProps, JackProps, KitFace, KnobFaceProps, LedProps, SliderFaceProps, StepperProps, ToggleProps } from "../types";

const INK = "var(--mm-text, #111)";
const PAPER = "var(--mm-surface, #fff)";

function knob(props: KnobFaceProps) {
  const size = props.size ?? 46;
  const cx = size / 2;
  const cy = size / 2;
  const radius = size / 2 - 8;
  const t = normalize(props.value, props.min, props.max);
  const angle = knobAngle(t);
  const ticks = tickAngles(11);
  const pointer = polarToCartesian(cx, cy, radius, angle);
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
        const outer = polarToCartesian(cx, cy, radius + 5, deg);
        const inner = polarToCartesian(cx, cy, radius + 1, deg);
        return <line key={i} x1={inner.x} y1={inner.y} x2={outer.x} y2={outer.y} stroke={INK} strokeWidth={1} />;
      })}
      <circle cx={cx} cy={cy} r={radius} fill={PAPER} stroke={INK} strokeWidth={props.dragging ? 2 : 1.25} />
      <line x1={cx} y1={cy} x2={pointer.x} y2={pointer.y} stroke={INK} strokeWidth={2.25} strokeLinecap="round" />
      {props.label && (
        <text x={cx} y={size + 11} textAnchor="middle" fontSize={9} fontWeight={700} fill={INK} fontFamily="ui-monospace, monospace">
          {props.label.toUpperCase()}
        </text>
      )}
    </svg>
  );
}

function slider(props: SliderFaceProps) {
  const vertical = (props.orientation ?? "vertical") === "vertical";
  const length = props.length ?? 90;
  const w = vertical ? 18 : length;
  const h = vertical ? length : 18;
  const t = normalize(props.value, props.min, props.max);
  const pos = sliderPosition(t, length - 10, vertical);
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="slider" aria-label={props.label}
      aria-valuemin={props.min} aria-valuemax={props.max} aria-valuenow={props.value}
      style={{ cursor: props.disabled ? "default" : vertical ? "ns-resize" : "ew-resize", touchAction: "none" }}
      opacity={props.disabled ? 0.45 : 1} {...props.dragHandlers}>
      {vertical ? (
        <>
          <line x1={w / 2} y1={2} x2={w / 2} y2={h - 2} stroke={INK} strokeWidth={1.25} />
          <rect x={1} y={pos} width={w - 2} height={10} fill={PAPER} stroke={INK} strokeWidth={1.5} />
        </>
      ) : (
        <>
          <line x1={2} y1={h / 2} x2={w - 2} y2={h / 2} stroke={INK} strokeWidth={1.25} />
          <rect x={pos} y={1} width={10} height={h - 2} fill={PAPER} stroke={INK} strokeWidth={1.5} />
        </>
      )}
    </svg>
  );
}

/** The diamond 2-position selector — the source's actual toggle shape. */
function toggle(props: ToggleProps) {
  return (
    <button type="button" role="switch" aria-checked={props.value} disabled={props.disabled}
      onClick={() => props.onChange(!props.value)}
      style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "none", border: "none", cursor: props.disabled ? "default" : "pointer", opacity: props.disabled ? 0.45 : 1, padding: 0, font: "inherit" }}>
      <svg width={18} height={26} viewBox="0 0 18 26">
        <polygon points="9,1 17,13 9,25 1,13" fill={PAPER} stroke={INK} strokeWidth={1.25} />
        <circle cx={9} cy={props.value ? 7 : 19} r={2.25} fill={INK} />
      </svg>
      {props.label && <span style={{ fontSize: 11, color: INK, fontFamily: "ui-monospace, monospace" }}>{props.label}</span>}
    </button>
  );
}

function button(props: ButtonProps) {
  return (
    <button type="button" onClick={props.onClick} disabled={props.disabled}
      style={{
        font: "700 10px/1 ui-monospace, monospace", padding: "6px 12px",
        background: props.pressed ? INK : PAPER, color: props.pressed ? PAPER : INK,
        border: `1.5px solid ${INK}`, cursor: props.disabled ? "default" : "pointer", opacity: props.disabled ? 0.45 : 1,
      }}>
      {props.label.toUpperCase()}
    </button>
  );
}

/** The hex-nut jack — a hexagon outline with a printed centre dot. */
function jack(props: JackProps) {
  const hex = "9,1 16.5,5 16.5,13 9,17 1.5,13 1.5,5";
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
      <svg width={18} height={18} viewBox="0 0 18 18">
        <polygon points={hex} fill={PAPER} stroke={INK} strokeWidth={1.25} />
        <circle cx={9} cy={9} r={2} fill={props.connected ? INK : PAPER} stroke={INK} strokeWidth={1} />
      </svg>
      {props.label && <small style={{ fontSize: 8, color: INK, fontFamily: "ui-monospace, monospace" }}>{props.label.toUpperCase()}</small>}
    </span>
  );
}

function led(props: LedProps) {
  return (
    <svg width={9} height={9} viewBox="0 0 9 9" aria-hidden="true">
      <circle cx={4.5} cy={4.5} r={3.75} fill={props.on ? INK : PAPER} stroke={INK} strokeWidth={1} />
    </svg>
  );
}

function stepper(props: StepperProps) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 0, border: `1.5px solid ${INK}`, opacity: props.disabled ? 0.45 : 1 }}>
      <button type="button" disabled={props.disabled} onClick={() => stepperStep(props, -1)}
        style={{ background: PAPER, border: "none", borderRight: `1.5px solid ${INK}`, color: INK, cursor: "pointer", font: "700 12px/1 ui-monospace, monospace", padding: "2px 7px" }}>
        −
      </button>
      <span style={{ font: "700 12px/1 ui-monospace, monospace", color: INK, minWidth: 24, textAlign: "center" }}>{props.value}</span>
      <button type="button" disabled={props.disabled} onClick={() => stepperStep(props, 1)}
        style={{ background: PAPER, border: "none", borderLeft: `1.5px solid ${INK}`, color: INK, cursor: "pointer", font: "700 12px/1 ui-monospace, monospace", padding: "2px 7px" }}>
        +
      </button>
    </span>
  );
}

export const lineArtFace: KitFace = { knob, slider, toggle, button, jack, led, stepper };
