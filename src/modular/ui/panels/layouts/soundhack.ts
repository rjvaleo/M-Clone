// SoundHack's ++ plug-ins, as their editors laid them out: every window is
// 474 px wide, and each control sits where `resized()` in the plug-in's
// x86_64 slice puts it (MultiGrainLive docs/effects/soundhack.md). Dials turn
// on the original's JUCE skews, and the labels are the on-screen strings.
//
// What the originals had and this port does not is drawn dimmed where it was:
// the tempo locks (this port does not follow a host's tempo) and the colour
// dot (it only tinted the window). Mute is idMLab's, set where the original
// left room.
//
// Badge colours are the manual screenshots' where there is one (compand pink,
// chebyshev teal, decimate red, matrix beige, phasor blue). The Delay Trio has
// no screenshot; it wears ++delay's orange.

import type { InertControl, PanelControl, PanelGroup, PanelLayout } from "../layout";
import type { Travel } from "../travel";
import type { Readout } from "../readout";

const WIDTH = 474;

/** Bare numbers to two places, as the plug-ins print them. */
const PLAIN: Readout = { decimals: 2 };

const dial = (param: string, label: string, x: number, y: number, size = 72, travel?: Travel): PanelControl => ({
  param, kind: "knob", label, x, y, w: size, h: size,
  ...(size >= 100 ? { size: "big" as const } : size <= 36 ? { size: "small" as const } : {}),
  ...(travel ? { travel } : {}),
});

/** The six-dial row the Freesound and Delay Trio windows share, at 6 + 78i. */
const row = (y: number, dials: [string, string, Travel?][]): PanelControl[] =>
  dials.map(([param, label, travel], i) => dial(param, label, 6 + 78 * i, y, 72, travel));

/** In and out, top right; wet/dry beside them where the plug-in has one. */
const levels = (wetX?: number): PanelControl[] => [
  ...(wetX !== undefined ? [dial("mix", "wet/dry", wetX, 6, 36)] : []),
  dial("inDb", "in", 390, 6, 36),
  dial("outDb", "out", 432, 6, 36),
];

const toggle = (param: string, x: number, y: number, w: number, label: string, states?: readonly [string, string]): PanelControl =>
  ({ param, kind: "switch", label, x, y, w, h: 18, ...(states ? { states } : {}) });

const slider = (param: string, label: string, y: number, travel?: Travel): PanelControl =>
  ({ param, kind: "hslider", label, x: 6, y, w: 462, h: 18, ...(travel ? { travel } : {}) });

const colour = (y: number): InertControl => ({ label: "colour", kind: "knob", x: 6, y, w: 18, h: 18, why: "only tinted the plug-in's window" });
const tempoLock = (label: string, x: number, y: number, w: number): InertControl =>
  ({ label, kind: "switch", x, y, w, h: 18, why: "locks to a host's tempo, which this port does not follow" });

/** The badge row, the bands between, and the foot. */
const bands = (name: string, ...rest: PanelGroup[]): PanelGroup[] => [{ id: "head", label: name, x: 0, y: 0, w: WIDTH, h: 46 }, ...rest];
const band = (id: string, y: number, h: number, x = 0, w = WIDTH, tint?: string): PanelGroup => ({ id, label: "", x, y, w, h, ...(tint ? { tint } : {}) });

const DELAY_TRIO = "#d9702a";

export const SH_BUBBLER: PanelLayout = {
  moduleType: "m.prism-sh-bubbler", style: "soundhack", width: WIDTH, readout: PLAIN, height: 324, accent: DELAY_TRIO,
  groups: bands("++bubbler",
    band("delay", 46, 91, 0, 238, "delay"), band("filter", 46, 91, 238, 156, "filter"), band("grain", 46, 91, 394, 80, "grain"),
    band("keys", 137, 46, 0, WIDTH, "pitch"),
    band("grain-2", 183, 92, 0, 238, "grain"), band("pitch", 183, 92, 238, 156, "pitch"), band("grain-3", 183, 92, 394, 80, "grain"),
    band("foot", 275, 49)),
  controls: [
    ...levels(336),
    ...row(48, [["delayMs", "time", { skew: 0.3 }], ["timeVar", "time vari"], ["feedback", "feedback"],
      ["lowpassHz", "filter freq", { skew: 0.3 }], ["resonance", "resonance"], ["panVar", "pan vari"]]),
    ...row(186, [["density", "density"], ["grainSize", "grain size"], ["startVar", "g start vari"],
      ["octave", "octave"], ["octaveVar", "oct vari"], ["reverse", "g reversal"]]),
    // The interval keyboard: black keys at y 141, white at 162, 60 × 18 each.
    // A key lit is an interval a grain may take; none lit is the root alone.
    ...([[1, 42], [3, 108], [6, 246], [8, 312], [10, 378]] as const)
      .map(([key, x]): PanelControl => ({ ...toggle(`key${key}`, x, 141, 60, "", ["", ""]), size: "small" })),
    ...([[0, 6], [2, 72], [4, 138], [5, 210], [7, 276], [9, 342], [11, 408]] as const)
      .map(([key, x]) => toggle(`key${key}`, x, 162, 60, "", ["", ""])),
    toggle("just", 6, 279, 72, "tuning", ["12tet", "just"]),
    toggle("mute", 390, 279, 78, "mute"),
  ],
  displays: [],
  inert: [tempoLock("timelock", 84, 279, 96), colour(300)],
};

export const SH_FLIPPER: PanelLayout = {
  moduleType: "m.prism-sh-flipper", style: "soundhack", width: WIDTH, readout: PLAIN, height: 120, accent: DELAY_TRIO,
  groups: bands("++flipper", band("flip", 46, 48, 0, WIDTH, "delay"), band("foot", 94, 26)),
  controls: [
    ...levels(),
    slider("flipS", "fliptime", 48, { skew: 0.3 }),
    slider("overlap", "overlap", 72),
    toggle("mute", 390, 96, 78, "mute"),
  ],
  displays: [],
  inert: [tempoLock("tempolock", 30, 96, 84), colour(96)],
};

export const SH_PITCHDELAY: PanelLayout = {
  moduleType: "m.prism-sh-pitchdelay", style: "soundhack", width: WIDTH, readout: PLAIN, height: 186, accent: DELAY_TRIO,
  groups: bands("++pitchdelay",
    band("delay", 46, 90, 0, 80, "delay"), band("pitch", 46, 90, 80, 234, "pitch"),
    band("delay-2", 46, 90, 314, 80, "delay"), band("pitch-2", 46, 90, 394, 80, "pitch"),
    band("foot", 136, 50)),
  controls: [
    ...levels(342),
    ...row(48, [["delayMs", "time", { skew: 0.25 }], ["semitones", "pitch"], ["cents", "cents"],
      ["octave", "octave"], ["feedback", "feedback"], ["depth", "depth"]]),
    toggle("just", 6, 138, 72, "tuning", ["12tet", "just"]),
    toggle("mute", 390, 162, 78, "mute"),
  ],
  displays: [],
  inert: [tempoLock("delaylock", 96, 138, 96), colour(162)],
};

export const SH_CHEBYSHEV: PanelLayout = {
  moduleType: "m.prism-sh-chebyshev", style: "soundhack", width: WIDTH, readout: PLAIN, height: 162, accent: "#2f8f8a",
  groups: bands("++chebyshev", band("partials", 46, 90, 0, WIDTH, "filter"), band("foot", 136, 26)),
  controls: [
    ...levels(),
    ...row(48, [["t1Db", "cp 1"], ["t2Db", "cp 2"], ["t3Db", "cp 3"], ["t4Db", "cp 4"], ["t5Db", "cp 5"], ["t7Db", "cp 7"]]),
    toggle("mute", 390, 138, 78, "mute"),
  ],
  displays: [],
  inert: [colour(138)],
};

export const SH_COMPAND: PanelLayout = {
  moduleType: "m.prism-sh-compand", style: "soundhack", width: WIDTH, readout: PLAIN, height: 186, accent: "#d4507e",
  groups: bands("++compand", band("curve", 46, 90, 0, 238, "delay"), band("detector", 46, 90, 238, 236, "modulation"), band("foot", 136, 50)),
  controls: [
    ...levels(),
    ...row(48, [["ratio", "ratio", { skew: 0.4 }], ["threshDb", "threshold"], ["attackMs", "attack", "linear"],
      ["releaseS", "release", "linear"], ["knee", "softknee"], ["response", "response", { skew: 0.3 }]])
      .map((c) => (c.param === "ratio" ? { ...c, readout: { ratio: true } } : c)),
    toggle("rms", 6, 138, 84, "detector", ["peak detect", "rms detect"]),
    toggle("linked", 108, 138, 84, "linked", ["not linked", "linked"]),
    toggle("mute", 390, 162, 78, "mute"),
  ],
  displays: [],
  inert: [colour(162)],
};

export const SH_DECIMATE: PanelLayout = {
  moduleType: "m.prism-sh-decimate", style: "soundhack", width: WIDTH, readout: PLAIN, height: 120, accent: "#c8473a",
  groups: bands("++decimate", band("decimate", 46, 48, 0, WIDTH, "delay"), band("foot", 94, 26)),
  controls: [
    ...levels(),
    slider("depth", "depth", 48, { skew: 0.3 }),
    slider("averaging", "averaging", 72),
    toggle("mute", 390, 96, 78, "mute"),
  ],
  displays: [],
  inert: [colour(96)],
};

export const SH_MATRIX: PanelLayout = {
  moduleType: "m.prism-sh-matrix", style: "soundhack", width: WIDTH, readout: PLAIN, height: 120, accent: "#c9b48a", accentInk: "#2a2418",
  groups: bands("++matrix", band("matrix", 46, 48, 0, WIDTH, "filter"), band("foot", 94, 26)),
  controls: [
    ...levels(),
    slider("midDb", "mid gain", 48),
    slider("sideDb", "side gain", 72),
    { param: "direction", kind: "switch", label: "direction", x: 30, y: 96, w: 84, h: 18 },
    toggle("mute", 390, 96, 78, "mute"),
  ],
  displays: [],
  inert: [colour(96)],
};

export const SH_PHASOR: PanelLayout = {
  moduleType: "m.prism-sh-phasor", style: "soundhack", width: WIDTH, readout: PLAIN, height: 186, accent: "#3c74c9",
  groups: bands("++phasor", band("filter", 46, 90, 0, 238, "filter"), band("lfo", 46, 90, 238, 236, "modulation"), band("foot", 136, 50)),
  controls: [
    ...levels(),
    ...row(48, [["freqHz", "frequency", { skew: 0.3 }], ["bandwidth", "width", { skew: 0.3 }], ["feedback", "feedback"],
      ["rateHz", "modfreq", { skew: 0.25 }], ["depth", "moddepth"], ["shape", "modshape"]])
      // The screenshot prints frequency to one place, and moddepth 0–100.
      .map((c) => c.param === "freqHz" ? { ...c, readout: { decimals: 1 } }
        : c.param === "depth" ? { ...c, readout: { decimals: 1, scale: 100 } } : c),
    // The screenshot's labels: the taps after 1, 2, 4 and 8 sections.
    toggle("out360", 6, 138, 72, "360out"),
    toggle("out720", 84, 138, 72, "720out"),
    toggle("out1080", 162, 138, 72, "1440out"),
    toggle("out1440", 240, 138, 72, "2880out"),
    toggle("mute", 390, 162, 78, "mute"),
  ],
  displays: [],
  inert: [tempoLock("tempolock", 384, 138, 84), colour(162)],
};

export const SOUNDHACK_PANELS: readonly PanelLayout[] = [
  SH_BUBBLER, SH_FLIPPER, SH_PITCHDELAY, SH_CHEBYSHEV, SH_COMPAND, SH_DECIMATE, SH_MATRIX, SH_PHASOR,
];
