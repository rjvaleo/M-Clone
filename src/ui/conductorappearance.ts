import type { CSSProperties } from "react";

export type ConductorControl = "start" | "stop" | "pause" | "sync" | "movie" | "sequence";
export type ConductorTone = ConductorControl;

const CONTROL_TONES: Record<ConductorControl, ConductorTone> = {
  start: "start",
  stop: "stop",
  pause: "pause",
  sync: "sync",
  movie: "movie",
  sequence: "sequence",
};

export function conductorControlTone(control: ConductorControl): ConductorTone {
  return CONTROL_TONES[control];
}

export function classicConductorLayout() {
  return {
    // Laid out at twice the original's 226 x 104 and shown at half size.
    width: 452,
    height: 208,
    leftWidth: 260,
    gridWidth: 192,
    topHeight: 154,
    bottomHeight: 54,
    bottomColumns: [37, 185, 38, 38, 54, 28, 28, 44] as const,
    tempoNumericalWidth: 43,
  };
}

type ConductorLayoutStyle = CSSProperties & Record<`--conductor-${string}`, string>;

export function classicConductorLayoutStyle(): ConductorLayoutStyle {
  const layout = classicConductorLayout();
  return {
    "--conductor-width": `${layout.width}px`,
    "--conductor-height": `${layout.height}px`,
    "--conductor-left-width": `${layout.leftWidth}px`,
    "--conductor-grid-width": `${layout.gridWidth}px`,
    "--conductor-top-height": `${layout.topHeight}px`,
    "--conductor-bottom-height": `${layout.bottomHeight}px`,
    "--conductor-bottom-columns": layout.bottomColumns.map((width) => `${width}px`).join(" "),
    "--conductor-tempo-numerical": `${layout.tempoNumericalWidth}px`,
  };
}
