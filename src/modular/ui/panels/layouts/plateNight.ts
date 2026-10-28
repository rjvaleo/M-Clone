// The Dattorro plate in the Night console style, after Omnisphere and KULT in
// CleanRoom: dark cells, a live display in the middle, each group its colour.
//
// The tail display in the centre is the tank's decay at low and high
// frequencies (see displays.ts `plateEnvelope`), with the predelay marked.

import type { PanelLayout } from "../layout";

const knob = (param: string, label: string, x: number, y: number, w: number, h: number) =>
  ({ param, kind: "knob" as const, label, x, y, w, h });

export const PLATE_NIGHT: PanelLayout = {
  moduleType: "m.prism-dattorro-plate",
  style: "night",
  width: 560,
  height: 280,
  groups: [
    { id: "input", label: "Input", x: 0, y: 0, w: 170, h: 140, tint: "input" },
    { id: "tank", label: "Tank", x: 0, y: 140, w: 170, h: 140, tint: "tank" },
    { id: "mod", label: "Modulation", x: 390, y: 0, w: 170, h: 140, tint: "mod" },
    { id: "out", label: "Output", x: 390, y: 140, w: 170, h: 140, tint: "out" },
  ],
  controls: [
    knob("predelayMs", "Predelay", 4, 20, 81, 58),
    knob("bandwidth", "Bandwidth", 85, 20, 81, 58),
    knob("inputDiffusion1", "In diff 1", 4, 80, 81, 58),
    knob("inputDiffusion2", "In diff 2", 85, 80, 81, 58),

    knob("decay", "Decay", 4, 160, 81, 58),
    knob("damping", "Damping", 85, 160, 81, 58),
    knob("decayDiffusion1", "Dec diff 1", 4, 220, 81, 58),
    knob("decayDiffusion2", "Dec diff 2", 85, 220, 81, 58),

    knob("modRateHz", "Mod rate", 394, 24, 80, 110),
    knob("modDepth", "Mod depth", 476, 24, 80, 110),

    knob("wet", "Wet", 394, 162, 54, 74),
    knob("dry", "Dry", 450, 162, 54, 74),
    knob("crossfeed", "Width", 506, 162, 50, 74),
    { param: "mute", kind: "switch", label: "Mute", x: 394, y: 242, w: 162, h: 32 },
  ],
  displays: [{ kind: "plate-tail", x: 170, y: 0, w: 220, h: 280 }],
};
