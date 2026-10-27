// The dynamics in the Graph-first style, after the AG Controller compressor and
// the MOTM-300 in CleanRoom, as MultiGrainLive's compressor is: black on cream,
// the curve large, faders for its shape beside it, times and switches beneath.
//
// Each curve is the level the effect settles at for a level held steady
// (plots.ts): the gate's opening, Amp fit's gain, the Maximizer's threshold,
// reduction, makeup and ceiling, and one band of Spectral Dynamics.

import type { PanelControl, PanelLayout } from "../layout";
import { fill, knob, mute, toggle, type Cell } from "./grid";

const INSET = { top: 19, pad: 5, gap: 3 };

const fader = (param: string, label: string, x: number): PanelControl =>
  ({ param, kind: "vslider", label, x, y: 22, w: 38, h: 214 });
const slider = (param: string, label: string): Cell => ({ param, label, kind: "hslider" });

/** The curve, two faders for its shape, and a row beneath: the compressor's own plan. */
function curveFirst(id: string, display: string, shape: [string, string][], below: { label: string; rows: Cell[][] }): PanelLayout {
  const { groups, controls } = fill([
    { id: "below", label: below.label, x: 0, y: 240, w: 240, h: 60, rows: below.rows },
    { id: "out", label: "Out", x: 240, y: 240, w: 90, h: 60, rows: [[mute()]] },
  ], INSET);
  return {
    moduleType: `m.prism-${id}`,
    style: "graph",
    readout: { figures: 3 },
    width: 330,
    height: 300,
    groups: [{ id: "curve", label: "Curve", x: 240, y: 0, w: 90, h: 240 }, ...groups],
    controls: [fader(shape[0][0], shape[0][1], 246), fader(shape[1][0], shape[1][1], 286), ...controls],
    displays: [{ kind: display, x: 0, y: 0, w: 240, h: 240 }],
  };
}

function spectralDynamics(): PanelLayout {
  const { groups, controls } = fill([
    {
      id: "process", label: "Process", x: 240, y: 0, w: 180, h: 150,
      rows: [[{ param: "mode", label: "Type", kind: "select", span: 2 }], [knob("bands", "Bands"), mute()]],
      heights: [40, 83],
    },
    {
      id: "bands", label: "Bands", x: 420, y: 0, w: 180, h: 150,
      rows: [[slider("lowHz", "Low")], [slider("highHz", "High")], [toggle("thirdOctave", "Third-octave groups")]],
      heights: [38, 38, 44],
    },
    {
      id: "amount", label: "Amount", x: 240, y: 150, w: 180, h: 150,
      rows: [[slider("ratio", "Ratio")], [slider("reductionDb", "Gain")], [slider("timeMs", "Time")], [toggle("smoothed", "Smoothed")]],
    },
    {
      id: "threshold", label: "Threshold", x: 420, y: 150, w: 180, h: 150,
      rows: [
        [slider("thresholdDb", "Level")],
        [{ param: "affect", label: "Affect", kind: "switch", states: ["Below", "Above"] }, toggle("relativeToPeak", "Re peak")],
        [toggle("useSound", "Use sound")],
        [{ param: "asset-id", label: "Threshold sound", kind: "asset" }],
      ],
    },
  ], INSET);
  return {
    moduleType: "m.prism-spectral-dynamics",
    style: "graph",
    readout: { figures: 3 },
    width: 600,
    height: 300,
    groups,
    controls,
    displays: [
      { kind: "spectral-curve", x: 0, y: 0, w: 240, h: 240 },
      { kind: "spectral-bands", x: 0, y: 240, w: 240, h: 60 },
    ],
  };
}

export const GRAPH_PANELS: readonly PanelLayout[] = [
  curveFirst("gate", "gate-curve", [["thresholdDb", "Thresh"], ["depth", "Depth"]],
    { label: "Time", rows: [[slider("attackMs", "Attack")], [slider("releaseMs", "Release")]] }),
  curveFirst("fit", "fit-curve", [["amount", "Amount"], ["floorDb", "Floor"]],
    { label: "Time", rows: [[slider("grainMs", "Grain")]] }),
  curveFirst("maximizer", "maximizer-curve", [["amount", "Amount"], ["ceilingDb", "Ceiling"]],
    { label: "Auto", rows: [[toggle("autoLevel", "Auto level"), toggle("autoComp", "Auto comp")]] }),
  spectralDynamics(),
];
