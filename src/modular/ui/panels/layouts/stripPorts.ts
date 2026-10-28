// The filters, the EQ and the noise generators in the Engineering-strip style,
// after the Panharmonium and the MOTM-300 in CleanRoom, as the filter bank is:
// white on black, the response or spectrum across the top, the stages beneath
// in signal order, each with its colour.
//
// Drawn dimmed: the notch's and the resonator's gain. MultiGrainLive's
// MusicalFilter has a gain control in every mode, but it acts only in the
// Regalia-Mitra's; prism-fx keeps it as an inert control for the documents
// that store it, and idMLab has no parameter for it.

import type { PanelControl, PanelLayout } from "../layout";
import { big, fill, knob, mute, toggle, type GroupSpec } from "./grid";

const INSET = { top: 22, pad: 4, gap: 2 };

/** A strip: the display across the top, the groups left to right beneath it. */
function strip(id: string, display: string, groups: (Omit<GroupSpec, "x" | "y" | "h">)[], { top = 96, height = 250 } = {}): PanelLayout {
  let x = 0;
  const placed = groups.map((group) => {
    const at = { ...group, x, y: top, h: height - top };
    x += group.w;
    return at;
  });
  const { groups: boxes, controls, inert } = fill(placed, INSET);
  return {
    moduleType: `m.prism-${id}`,
    style: "strip",
    readout: { figures: 3 },
    width: x,
    height,
    groups: boxes,
    controls,
    ...(inert.length > 0 ? { inert } : {}),
    displays: [{ kind: display, x: 0, y: 0, w: x, h: top }],
  };
}

const out = (rows: GroupSpec["rows"], w: number, heights?: number[]) => ({ id: "out", label: "Mix", tint: "out", w, rows, heights });

/** Dattorro's MusicalFilter: a notch, a resonator or the Regalia-Mitra boost and cut. */
function musical(id: string, display: string, gainActs: boolean): PanelLayout {
  const gain = gainActs ? knob("gainDb", "Gain")
    : knob("gainDb", "Gain", { inert: "acts only in the Regalia-Mitra mode; prism-fx keeps it inert here, as MultiGrainLive's did nothing" });
  return strip(id, display, [
    { id: "filter", label: "Filter", tint: gainActs ? "regalia" : id === "dattorro-notch" ? "notch" : "resonator", w: 240,
      rows: [[big("frequency", "Freq"), knob("bandwidth", "Bandwidth"), gain]] },
    out([[knob("mix", "Dry/wet")], [mute()]], 120, [92, 34]),
  ]);
}

/** A noise generator: its clock, level and seed, then the mix. */
const noise = (id: string, display: string) => strip(id, display, [
  { id: "noise", label: "Noise", tint: "noise", w: 240,
    rows: [[big("clockHz", "Clock"), knob("level", "Level")], [{ param: "seed", label: "Seed", kind: "field", span: 2 }]], heights: [84, 42] },
  out([[knob("mix", "Mix")], [mute()]], 120, [92, 34]),
]);

/** The Chamberlin's four state-variable filters, laid as the filter bank's stages are. */
const STAGES = [["low", "Low"], ["band", "Band"], ["high", "High"], ["notch", "Notch"]] as const;

function chamberlin(): PanelLayout {
  const drive = 80;
  const stage = 150;
  const top = 96;
  const controls: PanelControl[] = [
    { param: "drive", kind: "knob", label: "Drive", size: "big", x: 4, y: 118, w: drive - 8, h: 100 },
    ...STAGES.flatMap(([id]): PanelControl[] => {
      const x0 = drive + stage * STAGES.findIndex(([s]) => s === id);
      return [
        { param: `${id}On`, kind: "switch", label: "On", x: x0 + 4, y: 118, w: 22, h: 44 },
        { param: `${id}Freq`, kind: "knob", label: "Freq", size: "big", x: x0 + 28, y: 114, w: 64, h: 100 },
        { param: `${id}Q`, kind: "knob", label: "Q", x: x0 + 94, y: 114, w: 52, h: 64 },
        { param: `${id}Amp`, kind: "knob", label: "Amp", x: x0 + 94, y: 180, w: 52, h: 64 },
      ];
    }),
  ];
  const width = drive + stage * 4 + 40;
  return {
    moduleType: "m.prism-chamberlin",
    style: "strip",
    readout: { figures: 3 },
    width,
    height: 250,
    groups: [
      { id: "drive", label: "Drive", x: 0, y: top, w: drive, h: 250 - top, tint: "drive" },
      ...STAGES.map(([id, label], i) => ({ id, label, x: drive + stage * i, y: top, w: stage, h: 250 - top, tint: `sv-${id}` })),
      { id: "out", label: "Out", x: width - 40, y: top, w: 40, h: 250 - top },
    ],
    controls: [...controls, { param: "mute", kind: "switch", label: "Mute", x: width - 36, y: 118, w: 32, h: 60 }],
    displays: [{ kind: "chamberlin-response", x: 0, y: 0, w: width, h: top }],
  };
}

/** The rack EQ's eight nodes, each its type, its switch, its frequency, and in the middle six its Q and gain. */
function eq(): PanelLayout {
  const node = (band: number): Omit<GroupSpec, "x" | "y" | "h"> => {
    const head = [[{ param: `band.${band}.mode`, label: "Type", kind: "select" as const, menu: true, span: 2 }], [toggle(`band.${band}.enabled`, "On", { span: 2 })]];
    const end = band === 0 || band === 7;
    return {
      id: `band${band}`, label: `${band + 1}`, tint: `eq${band}`, w: end ? 84 : 104,
      rows: end ? [...head, [big(`band.${band}.freq`, "Freq", { span: 2 })]]
        : [...head, [big(`band.${band}.freq`, "Freq", { span: 2 })], [knob(`band.${band}.q`, "Q"), knob(`band.${band}.gainDb`, "Gain")]],
      heights: end ? [32, 22, 146] : [32, 22, 82, 62],
    };
  };
  return strip("eq", "eq-response", [
    ...Array.from({ length: 8 }, (_, band) => node(band)),
    { id: "mute", label: "", tint: "out", w: 44, rows: [[mute()]], heights: [60] },
  ], { top: 110, height: 340 });
}

export const STRIP_PANELS: readonly PanelLayout[] = [
  eq(),
  musical("dattorro-notch", "notch-response", false),
  musical("dattorro-resonator", "resonator-response", false),
  musical("regalia", "regalia-response", true),
  chamberlin(),
  strip("damping-filter", "damping-response", [
    { id: "filter", label: "Filter", tint: "damping", w: 120, rows: [[big("cutoffHz", "Cutoff")]] },
    out([[knob("wet", "Wet"), knob("dry", "Dry")], [mute(2)]], 160, [92, 34]),
  ]),
  noise("pn-noise", "pn-spectrum"),
  noise("pn-noise-eq", "pn-eq-spectrum"),
  noise("single-bit-pn", "pn-bit-spectrum"),
];
