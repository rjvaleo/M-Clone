/**
 * The kit vocabulary: what a theme's *shape* is, as opposed to what its
 * *colour* is.
 *
 * `src/modular/theme/themes.ts` already lets a theme repaint the app —
 * writing new values onto the same `--mm-*` custom properties every control
 * already reads. That swaps colour; it cannot make a knob draw as a chrome
 * 3D dial in one theme and a thin arc-ring in another, because nothing about
 * "colour" says anything about "shape." A kit is that second axis: a
 * complete set of renderers for the same fourteen controls, keyed to the
 * same tokens, so switching a kit changes what a knob *is* without touching
 * what a theme has already decided its colours are.
 *
 * The six kits come from `reference/panels/CATALOG.md`, which surveyed
 * thirty-one reference panels and found that no single one covers the whole
 * vocabulary. A kit is complete where a single photograph never was.
 *
 * The vocabulary is fourteen controls, settled in that catalog's closing
 * section. The first pass built seven; the second pass — drum machines and
 * samplers — added the seven below, which the synth-panel sources had barely
 * shown: `fader`, `pad`, `selector`, `meter`, `display`, `envelope` and
 * `waveform`. Two of those deserve a note, since they look like duplicates
 * and are not:
 *
 *   - `fader` is not a long `slider`. A slider is a thin track with a small
 *     cap (Mimic's PITCH/MOD); a fader is a wide finger pad on a scaled
 *     track with a detent (K.O. II, drumcomputer's mixer). Different
 *     proportions, different affordance, different gesture.
 *   - `display` reads a value someone *set*; `meter` reads a *live* signal.
 *     One is text and holds still, the other is segments and moves.
 */

import type { PointerEvent, ReactElement } from "react";
import type { EnvelopeShape } from "./geometry";

export type KitId = "vintage" | "eurorack" | "thinRing" | "flatModern" | "lineArt" | "lcd";

export const KIT_IDS: readonly KitId[] = ["vintage", "eurorack", "thinRing", "flatModern", "lineArt", "lcd"];

export interface KitMeta {
  id: KitId;
  label: string;
  /** The CATALOG.md family this kit generalises from. */
  family: string;
  /** What a person sees that tells the kits apart at a glance. */
  blurb: string;
}

export const KIT_META: Readonly<Record<KitId, KitMeta>> = {
  vintage: {
    id: "vintage",
    label: "Vintage Wood",
    family: "Warm vintage wood",
    blurb: "Chrome 3D knobs with a pointer line, wood-grain end-cheeks, mechanical rockers.",
  },
  eurorack: {
    id: "eurorack",
    label: "Eurorack White",
    family: "Flat white Eurorack",
    blurb: "Flat-colour knobs on a white panel, panel-printed tick marks, chunky hardware jacks.",
  },
  thinRing: {
    id: "thinRing",
    label: "Thin Ring",
    family: "Thin-ring dark GUI",
    blurb: "Dark plugin GUI, arc-progress knobs with no filled body, pill toggles.",
  },
  flatModern: {
    id: "flatModern",
    label: "Flat Modern",
    family: "Flat modern / neon",
    blurb: "Flat sliders and thin knobs on charcoal, amber/neon accent, engineering-flat labels.",
  },
  lineArt: {
    id: "lineArt",
    label: "Line Art",
    family: "Line-art engineering",
    blurb: "Pure black-on-white line drawing — open-circle knobs, hex-nut jacks, no fill anywhere.",
  },
  lcd: {
    id: "lcd",
    label: "Hardware LCD",
    family: "Hardware LCD",
    blurb: "Monochrome blue LCD surface, bitmap-scale glyphs, low-resolution deliberate.",
  },
};

/** Every control a complete kit renders. The catalog's other observations —
 * section headers, tab strips, step grids, signal-flow diagrams, keyboards,
 * mod matrices, preset lists — are *layouts* assembled from these
 * primitives rather than primitives themselves, and live in `layout.tsx`. */
export interface KnobProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  label?: string;
  unit?: string;
  disabled?: boolean;
  /** Diameter in px. Kits should stay legible from 28 (inline) to 64 (hero). */
  size?: number;
  onChange: (value: number) => void;
}

export interface SliderProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  label?: string;
  disabled?: boolean;
  orientation?: "vertical" | "horizontal";
  /** Track length in px, along the slider's own axis. */
  length?: number;
  onChange: (value: number) => void;
}

export interface ToggleProps {
  value: boolean;
  label?: string;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}

export interface ButtonProps {
  label: string;
  pressed?: boolean;
  disabled?: boolean;
  onClick: () => void;
}

export interface JackProps {
  label?: string;
  direction: "in" | "out";
  connected?: boolean;
}

export interface LedProps {
  on: boolean;
  /** `ok`/`warn` are semantic states; `accent` follows the theme's own
   * accent colour rather than a fixed meaning — matching Behringer EDGE's
   * amber-vs-red POWER LED, where colour itself carries the message. */
  tone?: "ok" | "warn" | "accent";
}

export interface StepperProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}

/**
 * A mixer channel fader: a wide finger pad on a scaled track.
 *
 * Deliberately not a long `slider`. K.O. II's hardware fader and
 * drumcomputer's mixer strip both give the handle a broad flat face you push
 * with a fingertip, print a scale beside the track, and notch the travel at
 * a meaningful value — three things a compact parameter slider does none of.
 */
export interface FaderProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  label?: string;
  disabled?: boolean;
  /** Track length in px. Faders run long; 120 is a typical channel strip. */
  length?: number;
  /** A value the handle notches onto — unity on a level fader, centre on a
   * pan. Omitted means the travel is smooth end to end. */
  detent?: number;
  /** How close, in value units, the handle has to get before the detent
   * takes it. Ignored without a `detent`. */
  detentTolerance?: number;
  /** Overrides the accent for this channel's level line. drumcomputer gives
   * each of eight tracks a hue and repeats it across every element of that
   * track; this is where a caller passes that hue in. */
  tint?: string;
  onChange: (value: number) => void;
}

/**
 * A trigger pad: momentary, lit, twice-labelled, and built to tile.
 *
 * Distinct from `button` on all four counts. Every pad grid in the catalog
 * carries both a musical identity (`C1`) and a human one (`Kick`), lights to
 * show it is sounding or selected, and is sized to sit shoulder to shoulder
 * with fifteen others.
 */
export interface PadProps {
  label: string;
  /** The secondary line — a note name, a key letter, a step number. */
  sublabel?: string;
  /** Lit: selected, or currently sounding. */
  active?: boolean;
  /** Held down right now. A pad is momentary, so this is transient state,
   * not a setting. */
  pressed?: boolean;
  /** Sound-class or track colour. The ADSR Drum Machine tints pad labels by
   * class (Kick, Snare, Hihat…) so a grid is scannable without reading. */
  tint?: string;
  disabled?: boolean;
  size?: number;
  onTrigger: () => void;
}

export interface SelectorOption {
  value: string;
  label: string;
}

/**
 * One of n options, cycling rather than clamping.
 *
 * That cycling is the whole difference from `stepper`: pressing past the end
 * returns to the start. `variant` picks which of the catalog's three
 * renderings a kit draws — they are the same control, and every kit
 * implements all three, because the choice belongs to the panel designer
 * (how much room is there?) rather than to the kit.
 */
export interface SelectorProps {
  options: readonly SelectorOption[];
  value: string;
  label?: string;
  disabled?: boolean;
  /**
   * - `cycle`: shows only the active option, advances on click. The most
   *   compact — K.O. II's dual-label keys, the drumDING's 2-position
   *   switches.
   * - `segmented`: all options in a row, active one filled. Nepheton's
   *   `NORMAL | FLAM | SUB S.`, Mimic's mode row.
   * - `list`: options stacked, each with its own indicator. Nepheton's
   *   `COMP.`/`VCA`, Mimic's `POLY`/`MONO RETRIG`/`MONO LEGATO`.
   */
  variant?: "cycle" | "segmented" | "list";
  onChange: (value: string) => void;
}

/**
 * A segmented readout of a live signal.
 *
 * `levels` carries one entry per channel — one for mono, two for stereo —
 * rather than a single number plus a stereo flag, so a kit draws however
 * many channels it is given without a special case for each count.
 */
export interface MeterProps {
  /** Per-channel level, `0..1`. */
  levels: readonly number[];
  /** Per-channel peak-hold marker, `0..1`. Shorter than `levels` is fine;
   * channels past its end simply show no marker. */
  peaks?: readonly number[];
  segments?: number;
  orientation?: "vertical" | "horizontal";
  /** Length along the meter's own axis, in px. */
  length?: number;
  label?: string;
}

/**
 * A readout of a value someone set: label, number, unit.
 *
 * `value` accepts a string as well as a number because half the readouts in
 * the catalog are not numeric at all — `Choke None`, `ROOT G3`,
 * `1/16 FULL`. Formatting only applies to the numeric case.
 */
export interface DisplayProps {
  label?: string;
  value: number | string;
  unit?: string;
  /** Fixed decimal places. Omitted lets the value decide, which is right for
   * a readout that shows whatever it is handed and wrong for a parameter
   * with a fixed precision — pass it for anything that shouldn't flicker
   * between "2" and "1.5" as it crosses a whole number. */
  decimals?: number;
  /**
   * - `field`: the boxed, recessed LCD readout (Nepheton's velocity boxes).
   * - `inline`: a label/value pair on one line (Bitwig's `ROOT C3`).
   * - `chip`: a small badge beside a label (CR8's `[12]`).
   */
  variant?: "field" | "inline" | "chip";
  tone?: "normal" | "accent";
}

/**
 * An ADSR shape, drawn.
 *
 * Read-only by design. The catalog shows envelopes edited three ways — a
 * knob row, a slider bank, or draggable breakpoints — and the first two are
 * just an `AdsrGroup` of existing controls (see `layout.tsx`). Making this
 * the *picture* of an envelope, with the editing done by controls beside it,
 * keeps one obvious way to change the value and leaves every kit free to
 * draw the picture however it likes.
 */
export interface EnvelopeProps {
  value: EnvelopeShape;
  width?: number;
  height?: number;
  label?: string;
}

/**
 * Sampled audio, drawn, with the markers a sample editor puts on it.
 *
 * Every position is normalised `0..1` across the whole buffer rather than
 * given in samples or seconds, so the control needs to know nothing about
 * sample rates and a caller can hand it peaks from any source.
 */
export interface WaveformProps {
  /** Peak magnitudes, `0..1`, one per horizontal pixel column or coarser. */
  peaks: readonly number[];
  width?: number;
  height?: number;
  /** A highlighted selection, as normalised start/end. */
  region?: { start: number; end: number };
  /** Normalised playhead position. */
  playhead?: number;
  /** Normalised slice points or cue markers. */
  markers?: readonly number[];
  label?: string;
}

/** Pointer handlers a drag-capable face must spread onto whatever element
 * should capture the gesture — usually the SVG root. */
export interface DragHandlers {
  onPointerDown: (event: PointerEvent) => void;
  onPointerMove: (event: PointerEvent) => void;
  onPointerUp: (event: PointerEvent) => void;
  onPointerCancel: (event: PointerEvent) => void;
}

/** Drag state and handlers, added to the public props for the two controls
 * that are dragged rather than clicked. Computed once by the shared
 * `Knob`/`Slider` shells (`controls/`) via `useDragValue`, so a face never
 * computes drag math itself — only draws the state it is handed. */
export interface DragRenderProps {
  dragging: boolean;
  dragHandlers: DragHandlers;
}

export type KnobFaceProps = KnobProps & DragRenderProps;
export type SliderFaceProps = SliderProps & DragRenderProps;
export type FaderFaceProps = FaderProps & DragRenderProps;

/**
 * A kit's complete face: one renderer per control, all pure functions of
 * props to a `ReactElement` — no interaction logic lives here. Interaction
 * (drag-to-adjust, click) is the same for every kit and lives in the shared
 * control components under `controls/`; a face only decides how a given
 * state (this value, this hover, this disabled flag) is drawn.
 *
 * All fourteen are required. A kit missing one is not a kit that degrades
 * gracefully — it is a theme that cannot be swapped to without breaking
 * whatever panel used the control it lacks, which is the entire thing this
 * system exists to prevent. `registry.ts` asserts the set is complete.
 */
export interface KitFace {
  knob: (props: KnobFaceProps) => ReactElement;
  slider: (props: SliderFaceProps) => ReactElement;
  fader: (props: FaderFaceProps) => ReactElement;
  toggle: (props: ToggleProps) => ReactElement;
  button: (props: ButtonProps) => ReactElement;
  pad: (props: PadProps) => ReactElement;
  selector: (props: SelectorProps) => ReactElement;
  stepper: (props: StepperProps) => ReactElement;
  jack: (props: JackProps) => ReactElement;
  led: (props: LedProps) => ReactElement;
  meter: (props: MeterProps) => ReactElement;
  display: (props: DisplayProps) => ReactElement;
  envelope: (props: EnvelopeProps) => ReactElement;
  waveform: (props: WaveformProps) => ReactElement;
}
