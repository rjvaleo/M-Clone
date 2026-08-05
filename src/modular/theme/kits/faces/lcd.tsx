/**
 * Hardware LCD — the "Sample Edit" retro screen (CATALOG.md entry 17),
 * itself a photograph of a real Akai/E-mu-style monochrome LCD rather than
 * a rendered GUI. Nothing there is smooth: the waveform is a solid blue
 * fill, the buttons are small square bitmap glyphs, low resolution is the
 * material, not a limitation to work around.
 *
 * None of the source's seven controls beyond button and waveform exist in
 * the photograph — a hardware LCD sampler has no knob, because the actual
 * hardware around the screen has real potentiometers the screen itself
 * never draws. Every shape below is built from the same material logic as
 * the one thing the source *does* show: segmented, blocky, quantised to a
 * visible grid rather than smoothly interpolated — an LED/LCD segment
 * display's own vocabulary, extended to knob and slider rather than
 * borrowing another family's smooth curves.
 */

import { normalize, sliderPosition, stepperStep } from "../geometry";
import type { ButtonProps, JackProps, KitFace, KnobFaceProps, LedProps, SliderFaceProps, StepperProps, ToggleProps } from "../types";

const INK = "var(--mm-accent, #1b3a8a)";
const SCREEN = "var(--mm-surface, #d8e4f2)";
const SEGMENT_COUNT = 12;

function knob(props: KnobFaceProps) {
  const size = props.size ?? 42;
  const t = normalize(props.value, props.min, props.max);
  const filled = Math.round(t * SEGMENT_COUNT);
  const cx = size / 2;
  const cy = size / 2;
  const outer = size / 2 - 2;
  const inner = outer - 6;
  return (
    <svg
      width={size}
      height={size + (props.label ? 13 : 0)}
      viewBox={`0 0 ${size} ${size + (props.label ? 13 : 0)}`}
      role="slider"
      aria-label={props.label}
      aria-valuemin={props.min}
      aria-valuemax={props.max}
      aria-valuenow={props.value}
      aria-disabled={props.disabled}
      style={{ cursor: props.disabled ? "default" : "ns-resize", touchAction: "none", imageRendering: "pixelated" }}
      opacity={props.disabled ? 0.45 : 1}
      {...props.dragHandlers}
    >
      <circle cx={cx} cy={cy} r={outer + 1} fill={SCREEN} />
      {Array.from({ length: SEGMENT_COUNT }, (_, i) => {
        // 270° sweep starting at 135°, same convention as every other kit's
        // knob, quantised to blocky segments instead of a smooth arc.
        const startDeg = 135 + (270 / SEGMENT_COUNT) * i + 2;
        const endDeg = 135 + (270 / SEGMENT_COUNT) * (i + 1) - 2;
        const a1 = (startDeg * Math.PI) / 180;
        const a2 = (endDeg * Math.PI) / 180;
        const p1o = { x: cx + outer * Math.cos(a1), y: cy + outer * Math.sin(a1) };
        const p2o = { x: cx + outer * Math.cos(a2), y: cy + outer * Math.sin(a2) };
        const p1i = { x: cx + inner * Math.cos(a1), y: cy + inner * Math.sin(a1) };
        const p2i = { x: cx + inner * Math.cos(a2), y: cy + inner * Math.sin(a2) };
        const on = i < filled;
        return (
          <path
            key={i}
            d={`M ${p1i.x} ${p1i.y} L ${p1o.x} ${p1o.y} L ${p2o.x} ${p2o.y} L ${p2i.x} ${p2i.y} Z`}
            fill={on ? INK : "none"}
            stroke={INK}
            strokeWidth={0.5}
          />
        );
      })}
      {props.label && (
        <text x={cx} y={size + 10} textAnchor="middle" fontSize={8} fontFamily="ui-monospace, monospace" fill={INK}>
          {props.label.toUpperCase()}
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
  const cells = 14;
  const filled = Math.round(t * cells);
  const cellLen = length / cells;
  const pos = sliderPosition(t, length, vertical);
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="slider" aria-label={props.label}
      aria-valuemin={props.min} aria-valuemax={props.max} aria-valuenow={props.value}
      style={{ cursor: props.disabled ? "default" : vertical ? "ns-resize" : "ew-resize", touchAction: "none" }}
      opacity={props.disabled ? 0.45 : 1} {...props.dragHandlers}>
      <rect x={0} y={0} width={w} height={h} fill={SCREEN} />
      {Array.from({ length: cells }, (_, i) => {
        // Vertical fills from the bottom (index counted from the far end);
        // horizontal fills from the left — matches sliderPosition's own
        // "max is away from the origin" convention for each axis.
        const on = vertical ? i >= cells - filled : i < filled;
        return vertical ? (
          <rect key={i} x={2} y={i * cellLen + 1} width={w - 4} height={cellLen - 2} fill={on ? INK : "none"} stroke={INK} strokeWidth={0.5} />
        ) : (
          <rect key={i} x={i * cellLen + 1} y={2} width={cellLen - 2} height={h - 4} fill={on ? INK : "none"} stroke={INK} strokeWidth={0.5} />
        );
      })}
      {vertical ? (
        <rect x={0} y={pos - 1} width={w} height={2} fill={INK} opacity={props.dragging ? 1 : 0.6} />
      ) : (
        <rect x={pos - 1} y={0} width={2} height={h} fill={INK} opacity={props.dragging ? 1 : 0.6} />
      )}
    </svg>
  );
}

function toggle(props: ToggleProps) {
  return (
    <button type="button" role="switch" aria-checked={props.value} disabled={props.disabled}
      onClick={() => props.onChange(!props.value)}
      style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "none", border: "none", cursor: props.disabled ? "default" : "pointer", opacity: props.disabled ? 0.45 : 1, padding: 0, font: "inherit" }}>
      <svg width={13} height={13} viewBox="0 0 13 13">
        <rect x={0.5} y={0.5} width={12} height={12} fill={props.value ? INK : SCREEN} stroke={INK} strokeWidth={1} />
      </svg>
      {props.label && <span style={{ fontSize: 10, color: INK, fontFamily: "ui-monospace, monospace" }}>{props.label.toUpperCase()}</span>}
    </button>
  );
}

function button(props: ButtonProps) {
  return (
    <button type="button" onClick={props.onClick} disabled={props.disabled}
      style={{
        font: "700 9px/1 ui-monospace, monospace", padding: "5px 8px",
        background: props.pressed ? INK : SCREEN, color: props.pressed ? SCREEN : INK,
        border: `1px solid ${INK}`, cursor: props.disabled ? "default" : "pointer", opacity: props.disabled ? 0.45 : 1,
      }}>
      {props.label.toUpperCase()}
    </button>
  );
}

function jack(props: JackProps) {
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
      <svg width={13} height={13} viewBox="0 0 13 13">
        <rect x={0.5} y={0.5} width={12} height={12} fill={SCREEN} stroke={INK} strokeWidth={1} />
        <rect x={4.5} y={4.5} width={4} height={4} fill={props.connected ? INK : "none"} stroke={INK} strokeWidth={1} />
      </svg>
      {props.label && <small style={{ fontSize: 7.5, color: INK, fontFamily: "ui-monospace, monospace" }}>{props.label.toUpperCase()}</small>}
    </span>
  );
}

function led(props: LedProps) {
  return (
    <svg width={8} height={8} viewBox="0 0 8 8" aria-hidden="true">
      <rect x={0.5} y={0.5} width={7} height={7} fill={props.on ? INK : SCREEN} stroke={INK} strokeWidth={1} />
    </svg>
  );
}

function stepper(props: StepperProps) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 0, border: `1px solid ${INK}`, opacity: props.disabled ? 0.45 : 1 }}>
      <button type="button" disabled={props.disabled} onClick={() => stepperStep(props, -1)}
        style={{ background: SCREEN, border: "none", borderRight: `1px solid ${INK}`, color: INK, cursor: "pointer", font: "700 11px/1 ui-monospace, monospace", padding: "2px 6px" }}>
        −
      </button>
      <span style={{ font: "700 11px/1 ui-monospace, monospace", color: INK, background: SCREEN, minWidth: 22, textAlign: "center" }}>{props.value}</span>
      <button type="button" disabled={props.disabled} onClick={() => stepperStep(props, 1)}
        style={{ background: SCREEN, border: "none", borderLeft: `1px solid ${INK}`, color: INK, cursor: "pointer", font: "700 11px/1 ui-monospace, monospace", padding: "2px 6px" }}>
        +
      </button>
    </span>
  );
}

export const lcdFace: KitFace = { knob, slider, toggle, button, jack, led, stepper };
