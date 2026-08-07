/**
 * The seven second-pass controls, built from a per-kit style descriptor.
 *
 * The first seven controls are hand-written per face, because a Minimoog
 * knob and a line-art knob genuinely share nothing but their angle. These
 * seven are different: a level meter is a run of segments in every kit that
 * has one, a readout is text in a box, a waveform is the path
 * `waveformPath` already returns. What actually differs between kits is
 * *how* those are drawn — square segments or rounded, filled or stroked,
 * bitmap type or proportional, hard corners or soft — and that is exactly
 * what `FaceStyle` captures.
 *
 * So this is the same shared-layer/per-kit-face split the module already
 * uses, applied one level up. Six hand-written near-copies of "draw twelve
 * rectangles in a column" would not make the kits more distinct; it would
 * just give them six places to drift apart on the one thing they agree on.
 * Where a kit's rendering is *structurally* different rather than styled
 * differently — Line Art strokes what everything else fills, Hardware LCD
 * quantises curves onto a coarse grid — the style descriptor says so, and a
 * face is still free to override any of the seven outright.
 */

import type { CSSProperties, ReactElement } from "react";
import {
  envelopePoints,
  meterSegments,
  normalize,
  polylinePath,
  waveformPath,
  type Point,
} from "../geometry";
import { formatValue, selectorAdvance } from "../values";
import type {
  DisplayProps,
  EnvelopeProps,
  FaderFaceProps,
  KitFace,
  MeterProps,
  PadProps,
  SelectorProps,
  WaveformProps,
} from "../types";

export interface FaceStyle {
  /** Corner radius for rectangular parts. 0 gives the hard-cornered,
   * engineering look; 6+ reads as a modern software GUI. */
  radius: number;
  /** False means the kit draws outlines only and never fills a shape —
   * Line Art's whole premise. Filled parts become stroked ones. */
  filled: boolean;
  /** Type for values. Bitmap/monospace for hardware kits, proportional for
   * software ones. */
  readoutFont: string;
  /** Type for names and captions. */
  labelFont: string;
  ink: string;
  accent: string;
  /** Secondary text and unlit parts. */
  dim: string;
  /** The colour a part sits on. */
  surface: string;
  border: string;
  /** Legible against `accent` — for knocked-out text on a filled part. */
  onAccent: string;
  /** Clipping/overload colour for the top of a meter. */
  warn: string;
  /** Gap between meter segments, px. 0 gives a continuous bar. */
  meterGap: number;
  /** Height of a fader's finger pad, px. */
  handleHeight: number;
  /**
   * Round drawn coordinates onto a grid this many px across. Set only by
   * Hardware LCD, whose whole look is that it cannot draw a smooth
   * diagonal; every other kit leaves it undefined and draws true curves.
   */
  quantise?: number;
  /**
   * Ignore caller-supplied tints and draw everything in the kit's own ink.
   *
   * A `tint` is real data — which drum class this pad is, which channel this
   * fader belongs to — so most kits should honour it. But a pure line
   * drawing and a one-colour LCD physically cannot: a red Kick pad on a
   * monochrome blue display is not that display. These two kits drop the
   * hue and keep the information in the label, which is what the hardware
   * they come from does.
   */
  monochrome?: boolean;
}

// ---------------------------------------------------------------------------

const snapTo = (value: number, grid: number | undefined): number =>
  grid && grid > 0 ? Math.round(value / grid) * grid : value;

const snapPoint = (p: Point, grid: number | undefined): Point => ({
  x: snapTo(p.x, grid),
  y: snapTo(p.y, grid),
});

/** Fill colour for a part, or `none` in a kit that only strokes. */
const fillOr = (style: FaceStyle, colour: string): string => (style.filled ? colour : "none");

/** A caller's tint, or the kit's own ink where the kit has only one. */
const tintOr = (style: FaceStyle, tint: string | undefined): string =>
  style.monochrome || !tint ? style.accent : tint;

const focusRing = (dragging: boolean, style: FaceStyle): CSSProperties => ({
  outline: dragging ? `1px solid ${style.accent}` : "none",
  outlineOffset: 2,
});

// ---------------------------------------------------------------------------

export function makeParts(style: FaceStyle): Pick<
  KitFace,
  "fader" | "pad" | "selector" | "meter" | "display" | "envelope" | "waveform"
> {
  /**
   * A mixer channel fader: scale ticks, a groove, a coloured level line
   * below the handle, and a broad finger pad.
   *
   * The level line is what makes a channel readable at a glance across a
   * mixer — drumcomputer tints each track's line with that track's hue, so
   * eight faders read as eight channels rather than eight identical sticks.
   * `tint` is where a caller passes that hue in.
   */
  function fader(props: FaderFaceProps): ReactElement {
    const length = props.length ?? 120;
    const width = 34;
    const level = tintOr(style, props.tint);
    const travel = length - style.handleHeight;
    const t = normalize(props.value, props.min, props.max);
    // Vertical faders run bottom-to-top, so a high value sits at a low y.
    const handleY = travel * (1 - t);
    const grooveX = width / 2;
    const ticks = [0, 0.25, 0.5, 0.75, 1];

    return (
      <svg
        width={width}
        height={length + (props.label ? 15 : 0)}
        viewBox={`0 0 ${width} ${length + (props.label ? 15 : 0)}`}
        role="slider"
        aria-label={props.label}
        aria-valuemin={props.min}
        aria-valuemax={props.max}
        aria-valuenow={props.value}
        aria-disabled={props.disabled}
        style={{
          cursor: props.disabled ? "default" : "ns-resize",
          touchAction: "none",
          ...focusRing(props.dragging, style),
        }}
        opacity={props.disabled ? 0.45 : 1}
        {...props.dragHandlers}
      >
        {ticks.map((tick) => {
          const y = style.handleHeight / 2 + travel * (1 - tick);
          return (
            <line
              key={tick}
              x1={grooveX + 7}
              y1={y}
              x2={grooveX + 11}
              y2={y}
              stroke={style.dim}
              strokeWidth={1}
            />
          );
        })}

        {props.detent !== undefined && (
          <line
            x1={grooveX - 11}
            y1={style.handleHeight / 2 + travel * (1 - normalize(props.detent, props.min, props.max))}
            x2={grooveX - 6}
            y2={style.handleHeight / 2 + travel * (1 - normalize(props.detent, props.min, props.max))}
            stroke={style.ink}
            strokeWidth={1.5}
          />
        )}

        <rect
          x={grooveX - 2}
          y={style.handleHeight / 2}
          width={4}
          height={travel}
          rx={style.filled ? 2 : 0}
          fill={fillOr(style, style.border)}
          stroke={style.filled ? "none" : style.border}
        />
        <rect
          x={grooveX - 2}
          y={handleY + style.handleHeight / 2}
          width={4}
          height={Math.max(0, travel - handleY)}
          rx={style.filled ? 2 : 0}
          fill={fillOr(style, level)}
          stroke={style.filled ? "none" : level}
        />

        <rect
          x={grooveX - 12}
          y={handleY}
          width={24}
          height={style.handleHeight}
          rx={style.radius}
          fill={fillOr(style, style.surface)}
          stroke={props.dragging ? style.accent : style.ink}
          strokeWidth={props.dragging ? 2 : 1.25}
        />
        <line
          x1={grooveX - 8}
          y1={handleY + style.handleHeight / 2}
          x2={grooveX + 8}
          y2={handleY + style.handleHeight / 2}
          stroke={style.dim}
          strokeWidth={1}
        />

        {props.label && (
          <text
            x={grooveX}
            y={length + 11}
            textAnchor="middle"
            fontSize={9}
            fill={style.dim}
            style={{ font: style.labelFont }}
          >
            {props.label}
          </text>
        )}
      </svg>
    );
  }

  /**
   * A trigger pad. Momentary, so it fires on pointer *down* rather than on
   * click — a pad that waited for the release would feel broken to anyone
   * playing it, and every pad in the catalogue is something you play.
   */
  function pad(props: PadProps): ReactElement {
    const size = props.size ?? 62;
    const tint = tintOr(style, props.tint);
    const lit = props.active || props.pressed;
    return (
      <button
        type="button"
        disabled={props.disabled}
        aria-pressed={props.active ?? false}
        onPointerDown={props.disabled ? undefined : props.onTrigger}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            props.onTrigger();
          }
        }}
        style={{
          width: size,
          height: size * 0.72,
          borderRadius: style.radius * 1.5,
          border: `1.5px solid ${lit ? tint : style.border}`,
          background: lit && style.filled ? tint : style.surface,
          color: lit && style.filled ? style.onAccent : style.ink,
          cursor: props.disabled ? "default" : "pointer",
          opacity: props.disabled ? 0.4 : 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          justifyContent: "space-between",
          padding: "5px 7px",
          font: style.labelFont,
          textAlign: "left",
          // A pressed pad reads as physically depressed rather than merely
          // recoloured, which matters when the lit and active states would
          // otherwise look identical.
          transform: props.pressed ? "translateY(1px)" : "none",
        }}
      >
        <span style={{ fontSize: 8.5, opacity: 0.75, letterSpacing: ".04em" }}>{props.sublabel}</span>
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: lit && style.filled ? style.onAccent : tint,
          }}
        >
          {props.label}
        </span>
      </button>
    );
  }

  /** One of n options — cycling, segmented, or a list with indicators. */
  function selector(props: SelectorProps): ReactElement {
    const variant = props.variant ?? "segmented";
    const active = props.options.find((option) => option.value === props.value);

    if (variant === "cycle") {
      return (
        <button
          type="button"
          disabled={props.disabled}
          aria-label={props.label}
          onClick={() => selectorAdvance(props, 1)}
          onContextMenu={(event) => {
            // Right-click steps backwards. A cycling switch with only one
            // direction makes the last option the most expensive to reach.
            event.preventDefault();
            selectorAdvance(props, -1);
          }}
          style={{
            font: style.readoutFont,
            fontSize: 11,
            padding: "5px 10px",
            borderRadius: style.radius,
            border: `1px solid ${style.border}`,
            background: fillOr(style, style.surface),
            color: style.accent,
            cursor: props.disabled ? "default" : "pointer",
            opacity: props.disabled ? 0.45 : 1,
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          {active?.label ?? "—"}
          <span aria-hidden="true" style={{ fontSize: 8, color: style.dim }}>
            ▾
          </span>
        </button>
      );
    }

    if (variant === "list") {
      return (
        <span
          role="radiogroup"
          aria-label={props.label}
          style={{ display: "inline-flex", flexDirection: "column", gap: 3 }}
        >
          {props.options.map((option) => {
            const on = option.value === props.value;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={on}
                disabled={props.disabled}
                onClick={() => props.onChange(option.value)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  background: "none",
                  border: "none",
                  padding: 0,
                  cursor: props.disabled ? "default" : "pointer",
                  opacity: props.disabled ? 0.45 : 1,
                  font: style.labelFont,
                  fontSize: 10,
                  color: on ? style.ink : style.dim,
                }}
              >
                <svg width={9} height={9} viewBox="0 0 9 9" aria-hidden="true">
                  <circle
                    cx={4.5}
                    cy={4.5}
                    r={3.5}
                    fill={on ? style.accent : "none"}
                    stroke={on ? style.accent : style.border}
                    strokeWidth={1.25}
                  />
                </svg>
                {option.label}
              </button>
            );
          })}
        </span>
      );
    }

    return (
      <span
        role="radiogroup"
        aria-label={props.label}
        style={{
          display: "inline-flex",
          borderRadius: style.radius,
          border: `1px solid ${style.border}`,
          overflow: "hidden",
        }}
      >
        {props.options.map((option) => {
          const on = option.value === props.value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={props.disabled}
              onClick={() => props.onChange(option.value)}
              style={{
                font: style.labelFont,
                fontSize: 10,
                fontWeight: on ? 700 : 500,
                letterSpacing: ".03em",
                padding: "4px 9px",
                border: "none",
                borderRight: `1px solid ${style.border}`,
                background: on && style.filled ? style.accent : "transparent",
                color: on ? (style.filled ? style.onAccent : style.accent) : style.dim,
                cursor: props.disabled ? "default" : "pointer",
                opacity: props.disabled ? 0.45 : 1,
              }}
            >
              {option.label}
            </button>
          );
        })}
      </span>
    );
  }

  /**
   * A segmented level meter, one column (or row) per channel.
   *
   * The top segments take the warning colour, matching every hardware meter
   * in the catalogue: the point of a meter is spotting the overload without
   * reading a number, which a single-colour bar cannot do.
   */
  function meter(props: MeterProps): ReactElement {
    const segments = props.segments ?? 12;
    const vertical = (props.orientation ?? "vertical") === "vertical";
    const length = props.length ?? 76;
    const channels = props.levels.length || 1;
    const band = 7;
    const gap = style.meterGap;
    const cell = (length - gap * (segments - 1)) / segments;

    const across = channels * band + (channels - 1) * 2;
    const w = vertical ? across : length;
    const h = vertical ? length : across;
    // The last sixth of the scale is the overload zone.
    const hotFrom = Math.ceil(segments * 0.84);

    return (
      <svg
        width={w}
        height={h}
        viewBox={`0 0 ${w} ${h}`}
        role="meter"
        aria-label={props.label}
        aria-valuemin={0}
        aria-valuemax={1}
        aria-valuenow={props.levels[0] ?? 0}
      >
        {props.levels.map((level, channel) => {
          const lit = meterSegments(level, segments);
          const peakAt = props.peaks && channel < props.peaks.length
            ? meterSegments(props.peaks[channel], segments)
            : 0;
          const offset = channel * (band + 2);
          return Array.from({ length: segments }, (_, i) => {
            const on = i < lit;
            const isPeak = peakAt > 0 && i === peakAt - 1;
            const colour = i >= hotFrom ? style.warn : style.accent;
            const along = (cell + gap) * (vertical ? segments - 1 - i : i);
            return (
              <rect
                key={`${channel}-${i}`}
                x={vertical ? offset : along}
                y={vertical ? along : offset}
                width={vertical ? band : cell}
                height={vertical ? cell : band}
                rx={Math.min(style.radius, 2)}
                fill={on && style.filled ? colour : "none"}
                stroke={on || isPeak ? colour : style.border}
                strokeWidth={isPeak && !on ? 1.5 : 1}
                opacity={on || isPeak ? 1 : 0.5}
              />
            );
          });
        })}
      </svg>
    );
  }

  /** A readout: a value someone set, with its label and unit. */
  function display(props: DisplayProps): ReactElement {
    const variant = props.variant ?? "field";
    const text =
      typeof props.value === "number"
        ? formatValue(props.value, props.unit, props.decimals)
        : props.unit
          ? `${props.value} ${props.unit}`
          : props.value;
    const valueColour = props.tone === "accent" ? style.accent : style.ink;

    if (variant === "chip") {
      return (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          {props.label && (
            <span style={{ font: style.labelFont, fontSize: 9.5, color: style.dim }}>{props.label}</span>
          )}
          <span
            style={{
              font: style.readoutFont,
              fontSize: 10,
              padding: "2px 7px",
              borderRadius: 999,
              background: fillOr(style, style.border),
              border: style.filled ? "none" : `1px solid ${style.border}`,
              color: valueColour,
            }}
          >
            {text}
          </span>
        </span>
      );
    }

    if (variant === "inline") {
      return (
        <span style={{ display: "inline-flex", alignItems: "baseline", gap: 6 }}>
          {props.label && (
            <span
              style={{
                font: style.labelFont,
                fontSize: 9,
                letterSpacing: ".07em",
                textTransform: "uppercase",
                color: style.dim,
              }}
            >
              {props.label}
            </span>
          )}
          <span style={{ font: style.readoutFont, fontSize: 12, color: valueColour }}>{text}</span>
        </span>
      );
    }

    return (
      <span style={{ display: "inline-flex", flexDirection: "column", gap: 3 }}>
        <span
          style={{
            font: style.readoutFont,
            fontSize: 13,
            minWidth: 54,
            textAlign: "right",
            padding: "4px 8px",
            borderRadius: style.radius,
            border: `1px solid ${style.border}`,
            background: fillOr(style, style.surface),
            color: valueColour,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {text}
        </span>
        {props.label && (
          <span
            style={{
              font: style.labelFont,
              fontSize: 8.5,
              letterSpacing: ".07em",
              textTransform: "uppercase",
              color: style.dim,
              textAlign: "center",
            }}
          >
            {props.label}
          </span>
        )}
      </span>
    );
  }

  /** The picture of an ADSR shape. Read-only — see `EnvelopeProps`. */
  function envelope(props: EnvelopeProps): ReactElement {
    const width = props.width ?? 132;
    const height = props.height ?? 46;
    const points = envelopePoints(props.value, width, height).map((p) => snapPoint(p, style.quantise));
    const curve = polylinePath(points);
    const area = `${curve} L ${width} ${height} Z`;

    return (
      <svg
        width={width}
        height={height + (props.label ? 14 : 0)}
        viewBox={`0 0 ${width} ${height + (props.label ? 14 : 0)}`}
        role="img"
        aria-label={props.label ? `${props.label} envelope` : "Envelope"}
      >
        <rect x={0} y={0} width={width} height={height} rx={style.radius} fill="none" stroke={style.border} />
        {style.filled && <path d={area} fill={style.accent} opacity={0.16} />}
        <path d={curve} fill="none" stroke={style.accent} strokeWidth={1.75} strokeLinejoin="round" />
        {style.filled &&
          points.slice(1, 4).map((p) => (
            <circle key={`${p.x}-${p.y}`} cx={p.x} cy={p.y} r={2.5} fill={style.surface} stroke={style.accent} strokeWidth={1.25} />
          ))}
        {props.label && (
          <text x={0} y={height + 11} fontSize={9} fill={style.dim} style={{ font: style.labelFont }}>
            {props.label}
          </text>
        )}
      </svg>
    );
  }

  /** Sampled audio with its region, markers and playhead. */
  function waveform(props: WaveformProps): ReactElement {
    const width = props.width ?? 190;
    const height = props.height ?? 52;
    const peaks = style.quantise
      ? // The LCD kit has no fine vertical resolution, so its waveform is
        // drawn in coarse steps rather than pretending to a smoothness the
        // display could not show.
        props.peaks.map((p) => Math.round(p * 5) / 5)
      : props.peaks;
    const body = waveformPath(peaks, width, height);
    const at = (position: number) => Math.min(1, Math.max(0, position)) * width;

    return (
      <svg
        width={width}
        height={height + (props.label ? 14 : 0)}
        viewBox={`0 0 ${width} ${height + (props.label ? 14 : 0)}`}
        role="img"
        aria-label={props.label ? `${props.label} waveform` : "Waveform"}
      >
        <rect x={0} y={0} width={width} height={height} rx={style.radius} fill="none" stroke={style.border} />

        {props.region && (
          <rect
            x={at(props.region.start)}
            y={0}
            width={Math.max(0, at(props.region.end) - at(props.region.start))}
            height={height}
            fill={style.accent}
            opacity={0.14}
          />
        )}

        <line x1={0} y1={height / 2} x2={width} y2={height / 2} stroke={style.border} strokeWidth={1} />
        {body && (
          <path
            d={body}
            fill={style.filled ? style.ink : "none"}
            stroke={style.filled ? "none" : style.ink}
            strokeWidth={1}
            opacity={style.filled ? 0.75 : 1}
          />
        )}

        {props.markers?.map((marker) => (
          <g key={marker}>
            <line x1={at(marker)} y1={0} x2={at(marker)} y2={height} stroke={style.accent} strokeWidth={1} opacity={0.8} />
            <path
              d={`M ${at(marker) - 3} 0 L ${at(marker) + 3} 0 L ${at(marker)} 5 Z`}
              fill={style.accent}
            />
          </g>
        ))}

        {props.playhead !== undefined && (
          <line
            x1={at(props.playhead)}
            y1={0}
            x2={at(props.playhead)}
            y2={height}
            stroke={style.warn}
            strokeWidth={1.5}
          />
        )}

        {props.label && (
          <text x={0} y={height + 11} fontSize={9} fill={style.dim} style={{ font: style.labelFont }}>
            {props.label}
          </text>
        )}
      </svg>
    );
  }

  return { fader, pad, selector, meter, display, envelope, waveform };
}
