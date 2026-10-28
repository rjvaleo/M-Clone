// The four LXP Native reverbs, in the window they share: `PlugBG.png`, 500 ×
// 410, measured to within a few pixels (MultiGrainLive docs/effects/lexicon.md).
//
// The wordmark and the blue title bar at the top; the category and preset bar;
// the IN and OUT meters, Store / Compare / Reload and the realtime display; six
// knobs in their inlays, 77.6 px apart; a page's name; the page buttons.
//
// Which control sits on which page is inferred, as the strings name the pages
// but not their contents. The soft row is every factory preset's: Predelay,
// Reverb Time, Rolloff, Diffusion, RT HiCut, Mix. It repeats them from their
// own pages (`alias`).
//
// What this port does not have is drawn dimmed: the category and preset
// menus and Store / Compare / Reload (idMLab keeps its own presets). The
// meters are drawn dark (no level meter yet), and the realtime display shows
// what the original's does when it is off, the algorithm's name.

import type { InertControl, PanelControl, PanelLayout, PanelPage } from "../layout";

/** The knob row's six inlays: centres 77.6 px apart from x ≈ 54. */
const slot = (i: number) => ({ x: Math.round(54 + 77.6 * i - 38), y: 206, w: 76, h: 107 });

const knob = (param: string, label: string, page: string, i: number, alias = false): PanelControl =>
  ({ param, kind: "knob", label, page, ...slot(i), ...(alias ? { alias: true } : {}) });

const inert = (label: string, x: number, y: number, w: number, h: number, why: string): InertControl =>
  ({ label, kind: "switch", x, y, w, h, why });

type Page = { id: string; label: string; knobs: [string, string][] };

function lxp(moduleType: string, pages: Page[]): PanelLayout {
  const list: PanelPage[] = [{ id: "soft", label: "SOFT ROW" }, ...pages.map(({ id, label }) => ({ id, label }))];
  const soft: [string, string][] = [
    ["predelayMs", "Predelay"], ["reverbTimeS", "Reverb Time"], ["rolloffHz", "Rolloff"],
    ["diffusion", "Diffusion"], ["rtHiCutHz", "RT HiCut"], ["mix", "Mix"],
  ];
  return {
    moduleType,
    style: "lexicon",
    width: 500,
    height: 410,
    pages: list,
    groups: [
      { id: "head", label: "", x: 0, y: 0, w: 500, h: 88 },
      { id: "meters", label: "", x: 0, y: 88, w: 127, h: 118 },
      { id: "store", label: "", x: 127, y: 88, w: 78, h: 118 },
      { id: "display", label: "", x: 205, y: 88, w: 295, h: 118 },
      { id: "knobs", label: "", x: 0, y: 206, w: 500, h: 107 },
      { id: "strip", label: "", x: 0, y: 313, w: 500, h: 39 },
      { id: "nav", label: "", x: 0, y: 352, w: 500, h: 58 },
    ],
    controls: [
      ...soft.map(([param, label], i) => knob(param, label, "soft", i, true)),
      ...pages.flatMap((page) => page.knobs.map(([param, label], i) => knob(param, label, page.id, i))),
      { param: "mute", kind: "switch", label: "MUTE", x: 410, y: 320, w: 72, h: 24 },
    ],
    displays: [
      { kind: "lxp-logo", x: 14, y: 18, w: 96, h: 30 },
      { kind: "lxp-title", x: 112, y: 26, w: 370, h: 22 },
      { kind: "lxp-meters", x: 14, y: 92, w: 109, h: 105 },
      { kind: "lxp-rtv", x: 205, y: 92, w: 277, h: 105 },
      { kind: "page-title", x: 14, y: 320, w: 380, h: 24 },
      { kind: "page-nav", x: 14, y: 356, w: 468, h: 35 },
    ],
    inert: [
      inert("CATEGORY ▾", 14, 58, 231, 22, "idMLab keeps its own presets"),
      inert("PRESET ▾", 251, 58, 231, 22, "idMLab keeps its own presets"),
      inert("STORE", 129, 92, 74, 32, "idMLab keeps its own presets"),
      inert("COMPARE", 129, 128, 74, 32, "idMLab keeps its own presets"),
      inert("RELOAD", 129, 164, 74, 32, "idMLab keeps its own presets"),
    ],
  };
}

const REVERB: Page = { id: "reverb", label: "REVERB", knobs: [
  ["sizeM", "Size"], ["reverbTimeS", "Reverb Time"], ["bassRt", "Bass RT"], ["bassXovHz", "Bass Xover"], ["rtHiCutHz", "RT HiCut"],
] };
const MODULATION: Page = { id: "modulation", label: "MODULATION", knobs: [
  ["shape", "Shape"], ["spread", "Spread"], ["spinHz", "Spin"], ["wanderMs", "Wander"], ["tapSlope", "Tap Slope"],
] };
const LEVELS: Page = { id: "levels", label: "LEVELS MIX EQ", knobs: [
  ["predelayMs", "Predelay"], ["diffusion", "Diffusion"], ["earlyDb", "Early Level"], ["reverbDb", "Reverb Level"], ["rolloffHz", "Rolloff"], ["mix", "Mix"],
] };

/** Hall and Room: four reflections, split over two pages as the strings name them. */
const fourReflections = (moduleType: string) => lxp(moduleType, [
  REVERB, MODULATION,
  { id: "refl-1", label: "REFLECTION 1", knobs: [
    ["rflTimeMaster", "Rfl Time"], ["llRflMs", "LL Time"], ["llRflDb", "LL Level"], ["lrRflMs", "LR Time"], ["lrRflDb", "LR Level"],
  ] },
  { id: "refl-2", label: "REFLECTION 2", knobs: [
    ["rrRflMs", "RR Time"], ["rrRflDb", "RR Level"], ["rlRflMs", "RL Time"], ["rlRflDb", "RL Level"],
  ] },
  LEVELS,
]);

/** Chamber and Plate: two reflections and the echoes, over two pages. */
const withEchoes = (moduleType: string) => lxp(moduleType, [
  REVERB, MODULATION,
  { id: "reflections", label: "REFLECTIONS", knobs: [
    ["rflTimeMaster", "Rfl Time"], ["lRflMs", "L Time"], ["lRflDb", "L Level"], ["rRflMs", "R Time"], ["rRflDb", "R Level"],
  ] },
  { id: "echoes-1", label: "ECHOES 1", knobs: [
    ["ekoTimeMaster", "Eko Time"], ["ekoFbMaster", "Eko Fbk"], ["lEkoMs", "L Time"], ["lEkoFbDb", "L Fbk"], ["lEkoPolarity", "L Polarity"],
  ] },
  { id: "echoes-2", label: "ECHOES 2", knobs: [
    ["rEkoMs", "R Time"], ["rEkoFbDb", "R Fbk"], ["rEkoPolarity", "R Polarity"],
  ] },
  LEVELS,
]);

export const LEXICON_PANELS: readonly PanelLayout[] = [
  fourReflections("m.prism-lxp-hall"),
  fourReflections("m.prism-lxp-room"),
  withEchoes("m.prism-lxp-chamber"),
  withEchoes("m.prism-lxp-plate"),
];
