// The Dattorro filter bank in the Engineering-strip style, after the
// Panharmonium and the MOTM-300 in CleanRoom: white on black, the combined
// response across the top, then the four stages in series, each with its
// switch and lamp at its edge.

import type { PanelControl, PanelGroup, PanelLayout } from "../layout";

const STAGES = [
  ["notch", "Notch"],
  ["resonator", "Resonator"],
  ["regalia", "Regalia-Mitra"],
  ["damping", "Damping"],
] as const;

const groups: PanelGroup[] = STAGES.map(([id, label], i) => ({ id, label, x: 150 * i, y: 96, w: 150, h: 154, tint: id }));

const controls: PanelControl[] = STAGES.flatMap(([id], i) => {
  const x0 = 150 * i;
  return [
    { param: `${id}On`, kind: "switch" as const, label: "On", x: x0 + 4, y: 118, w: 22, h: 44 },
    { param: `${id}Hz`, kind: "knob" as const, label: id === "damping" ? "Cutoff" : "Freq", size: "big" as const, x: x0 + 28, y: 114, w: 64, h: 100 },
    { param: `${id}Q`, kind: "knob" as const, label: "Q", x: x0 + 94, y: 114, w: 52, h: 64 },
    { param: `${id}Amp`, kind: "knob" as const, label: "Amp", x: x0 + 94, y: 180, w: 52, h: 64 },
  ];
});

export const BANK_STRIP: PanelLayout = {
  moduleType: "m.prism-dattorro-filter-bank",
  style: "strip",
  width: 640,
  height: 250,
  groups: [...groups, { id: "out", label: "Out", x: 600, y: 96, w: 40, h: 154 }],
  controls: [...controls, { param: "mute", kind: "switch", label: "Mute", x: 604, y: 118, w: 32, h: 60 }],
  displays: [{ kind: "bank-response", x: 0, y: 0, w: 640, h: 96 }],
};
