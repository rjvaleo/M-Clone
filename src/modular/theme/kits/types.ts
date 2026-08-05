/**
 * The kit vocabulary: what a theme's *shape* is, as opposed to what its
 * *colour* is.
 *
 * `src/modular/theme/themes.ts` already lets a theme repaint the app —
 * writing new values onto the same `--mm-*` custom properties every control
 * already reads. That swaps colour; it cannot make a knob draw as a chrome
 * 3D dial in one theme and a thin arc-ring in another, because nothing about
 * "colour" says anything about "shape." A kit is that second axis: a
 * complete set of renderers for the same seven controls, keyed to the same
 * tokens, so switching a kit changes what a knob *is* without touching what
 * a theme has already decided its colours are.
 *
 * The six kits and the fourteen-item taxonomy they answer to come from
 * `reference/panels/CATALOG.md`, which found that no single reference image
 * covers more than nine of fourteen "kinds of things." A kit is complete
 * where a single photograph never was.
 */

import type { PointerEvent, ReactElement } from "react";

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

/** Every control a complete kit renders. Mirrors the taxonomy's seven
 * genuinely swappable widgets — the other seven items in CATALOG.md's
 * fourteen (section label, screw, waveform display, keyboard, sequencer
 * grid, mod matrix, preset list) are layout/structural patterns built from
 * these primitives rather than primitives themselves, and are out of scope
 * for this pass. */
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

/**
 * A kit's complete face: one renderer per control, all pure functions of
 * props to a `ReactElement` — no interaction logic lives here. Interaction
 * (drag-to-adjust, click) is the same for every kit and lives in the shared
 * control components under `controls/`; a face only decides how a given
 * state (this value, this hover, this disabled flag) is drawn.
 */
export interface KitFace {
  knob: (props: KnobFaceProps) => ReactElement;
  slider: (props: SliderFaceProps) => ReactElement;
  toggle: (props: ToggleProps) => ReactElement;
  button: (props: ButtonProps) => ReactElement;
  jack: (props: JackProps) => ReactElement;
  led: (props: LedProps) => ReactElement;
  stepper: (props: StepperProps) => ReactElement;
}
