// The utilities, shapers and stereo tools in the Cabinet style, after the
// Minimoog and Diva panels in CleanRoom, as the Grain Engine is: wood cheeks,
// black panel, cream lettering under bracketed titles, and an amber screen.
//
// The screens: the stereo tools show where hard left, the centre, hard right
// and an out-of-phase signal land (their matrix, curves.ts `matrixFor`); the
// others their response, sweep, read or steps (plots.ts).

import type { PanelDisplay, PanelLayout } from "../layout";
import { big, cells, fill, knob, mute, toggle, type GroupSpec } from "./grid";

const CHEEK = 14;
const INSET = { top: 20, pad: 6, gap: 4 };

/** A screen inside its group, below the group's title. */
const screen = (kind: string, g: { x: number; y: number; w: number; h: number }): PanelDisplay =>
  ({ kind, x: g.x + INSET.pad, y: g.y + INSET.top, w: g.w - 2 * INSET.pad, h: g.h - INSET.top - INSET.pad });

/**
 * A Cabinet: cheeks either side, the screen's group, then the control
 * groups. A group given no rows is the screen's.
 */
function cabinet(id: string, width: number, height: number, display: string, groups: (Omit<GroupSpec, "rows"> & { rows?: GroupSpec["rows"] })[]): PanelLayout {
  const shown = groups.find((g) => !g.rows);
  const filled = fill(groups.filter((g) => g.rows).map((g) => ({ ...g, rows: g.rows ?? [] })), INSET);
  return {
    moduleType: `m.prism-${id}`,
    style: "cabinet",
    readout: { figures: 3 },
    width,
    height,
    groups: groups.map(({ rows: _rows, heights: _heights, ...g }) => g),
    controls: filled.controls,
    displays: [
      { kind: "cheek", x: 0, y: 0, w: CHEEK, h: height },
      { kind: "cheek", x: width - CHEEK, y: 0, w: CHEEK, h: height },
      ...(shown ? [screen(display, shown)] : []),
    ],
  };
}

/** One group holding the screen above and its control below: the tools with nothing to set but Mute. */
function single(id: string, display: string, label: string, width = 200, height = 210): PanelLayout {
  const group = { id: "main", label, x: CHEEK, y: 0, w: width - 2 * CHEEK, h: height };
  const inner = { x: group.x + INSET.pad, w: group.w - 2 * INSET.pad };
  const below = height - INSET.pad - 40;
  return {
    moduleType: `m.prism-${id}`,
    style: "cabinet",
    readout: { figures: 3 },
    width,
    height,
    groups: [group],
    controls: cells({ ...inner, y: below, h: 40 }, [[mute()]]).controls,
    displays: [
      { kind: "cheek", x: 0, y: 0, w: CHEEK, h: height },
      { kind: "cheek", x: width - CHEEK, y: 0, w: CHEEK, h: height },
      { kind: display, ...inner, y: INSET.top, h: below - INSET.gap - INSET.top },
    ],
  };
}

/** The screen's group and one group of controls: the shapers' plan. */
const pair = (id: string, display: string, title: string, label: string, rows: GroupSpec["rows"], w: number, heights = [100, 40]) =>
  cabinet(id, CHEEK + 170 + w + CHEEK, 170, display, [
    { id: "screen", label: title, x: CHEEK, y: 0, w: 170, h: 170 },
    { id: "controls", label, x: CHEEK + 170, y: 0, w, h: 170, rows, heights },
  ]);

export const CABINET_PANELS: readonly PanelLayout[] = [
  single("invert", "field-invert", "Polarity"),
  single("swap", "field-swap", "Channels"),
  pair("width", "field-width", "Field", "Width", [[big("width", "Width")], [mute()]], 132),
  pair("dc", "dc-response", "Response", "Filter", [[big("hz", "Below")], [mute()]], 132),
  pair("gain", "gain-factor", "Factor", "Level", [[big("db", "Level")], [mute()]], 132),
  pair("ring", "ring-sweep", "Carrier", "Oscillator", [[big("hz", "Frequency"), knob("sweep", "Sweep"), knob("mix", "Mix")], [mute(3)]], 222),
  pair("rappify", "rappify-response", "Response", "Filter", [[knob("amount", "Amount"), big("hz", "Centre"), knob("speed", "Speed")], [mute(3)]], 222),
  pair("boomerang", "boomerang-read", "Read", "Reverse", [[big("throwMs", "Throw"), knob("mix", "Mix")], [mute(2)]], 182),

  cabinet("decimator", 460, 170, "quantizer", [
    { id: "screen", label: "Steps", x: CHEEK, y: 0, w: 170, h: 170 },
    { id: "resolution", label: "Resolution", x: CHEEK + 170, y: 0, w: 152, h: 170,
      rows: [[big("rate", "Rate")], [{ param: "bits", label: "Bits", kind: "readout" }]], heights: [96, 44] },
    { id: "output", label: "Output", x: CHEEK + 322, y: 0, w: 110, h: 170, rows: [[knob("mix", "Mix")], [mute()]], heights: [100, 40] },
  ]),

  cabinet("utility", 560, 300, "field-utility", [
    { id: "screen", label: "Field", x: CHEEK, y: 0, w: 200, h: 150 },
    { id: "level", label: "Level", x: CHEEK + 200, y: 0, w: 170, h: 150,
      rows: [[big("gainDb", "Gain", { span: 2 })], [toggle("invert", "Invert"), mute()]], heights: [84, 36] },
    { id: "stereo", label: "Stereo", x: CHEEK + 370, y: 0, w: 162, h: 150,
      rows: [[big("width", "Width")], [toggle("swap", "Swap")]], heights: [84, 36] },
    { id: "fit", label: "Amp fit", x: CHEEK, y: 150, w: 532, h: 150,
      rows: [[knob("grainMs", "Grain"), knob("amount", "Amount"), knob("floorDb", "Floor")], [toggle("ampFit", "Amp fit", { span: 3 })]], heights: [84, 36] },
  ]),

  cabinet("stereo-matrix", 640, 300, "field-matrix", [
    { id: "screen", label: "Field", x: CHEEK, y: 0, w: 240, h: 300 },
    { id: "width", label: "Width", x: CHEEK + 240, y: 0, w: 186, h: 150,
      rows: [[knob("midGain", "Mid"), knob("sideGain", "Side")], [knob("monoBelowHz", "Mono below", { span: 2 })]], heights: [62, 58] },
    { id: "position", label: "Position", x: CHEEK + 426, y: 0, w: 186, h: 150, rows: [[big("rotate", "Position")]] },
    { id: "balance", label: "Balance", x: CHEEK + 240, y: 150, w: 372, h: 150,
      rows: [[knob("pan", "Pan"), knob("gainDb", "Gain")], [mute(2)]], heights: [84, 36] },
  ]),
];
