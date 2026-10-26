// MultiGrainLive's compressor in the Graph-first style, after the AG
// Controller compressor and the MOTM-300 in CleanRoom: black on cream, the
// curve large, faders for its shape beside it, times and level beneath.

import type { PanelLayout } from "../layout";

export const COMP_GRAPH: PanelLayout = {
  moduleType: "m.prism-compressor",
  style: "graph",
  width: 460,
  height: 300,
  groups: [
    { id: "curve", label: "Curve", x: 240, y: 0, w: 130, h: 240 },
    { id: "time", label: "Time", x: 0, y: 240, w: 240, h: 60 },
    { id: "level", label: "Level", x: 240, y: 240, w: 130, h: 60 },
  ],
  controls: [
    { param: "thresholdDb", kind: "vslider", label: "Thresh", x: 246, y: 20, w: 38, h: 216 },
    { param: "ratio", kind: "vslider", label: "Ratio", x: 287, y: 20, w: 38, h: 216 },
    { param: "kneeDb", kind: "vslider", label: "Knee", x: 328, y: 20, w: 38, h: 216 },
    { param: "attackMs", kind: "hslider", label: "Attack", x: 6, y: 258, w: 228, h: 18 },
    { param: "releaseMs", kind: "hslider", label: "Release", x: 6, y: 278, w: 228, h: 18 },
    { param: "makeupDb", kind: "hslider", label: "Makeup", x: 246, y: 258, w: 118, h: 18 },
    { param: "mute", kind: "switch", label: "Mute", x: 246, y: 278, w: 118, h: 18 },
  ],
  displays: [
    { kind: "transfer", x: 0, y: 0, w: 240, h: 240 },
    { kind: "levels", x: 370, y: 0, w: 90, h: 300 },
  ],
};
