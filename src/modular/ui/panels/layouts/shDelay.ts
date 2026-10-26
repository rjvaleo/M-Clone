// SoundHack ++delay, as its editor laid it out: `resized()` in the plug-in's
// x86_64 slice, 474 × 302 (docs/effects/soundhack.md in MultiGrainLive).
//
// Every dial sits where the original put it and turns as its JUCE skew did.
// The labels are the on-screen strings. The tints are added only to show the
// groups: delay, modulation, filter. Two switches and the colour dot have no
// parameter in this port: delaylock and lfolock follow a host's tempo, and
// the colour only tinted the window. They are drawn, dimmed, where they were.

import type { PanelLayout } from "../layout";

export const SH_DELAY: PanelLayout = {
  moduleType: "m.prism-sh-delay",
  style: "soundhack",
  width: 474,
  height: 302,
  groups: [
    { id: "head", label: "++delay", x: 0, y: 0, w: 474, h: 46 },
    { id: "delay", label: "delay", x: 0, y: 46, w: 240, h: 118, tint: "delay" },
    { id: "lfo", label: "modulation", x: 240, y: 46, w: 234, h: 118, tint: "modulation" },
    { id: "lfo-2", label: "modulation", x: 0, y: 164, w: 236, h: 86, tint: "modulation" },
    { id: "filter", label: "filter", x: 236, y: 164, w: 238, h: 86, tint: "filter" },
    { id: "switches", label: "", x: 0, y: 250, w: 474, h: 52 },
  ],
  controls: [
    { param: "mix", kind: "knob", label: "wet/dry", size: "small", x: 336, y: 6, w: 36, h: 36 },
    { param: "inDb", kind: "knob", label: "in", size: "small", x: 390, y: 6, w: 36, h: 36 },
    { param: "outDb", kind: "knob", label: "out", size: "small", x: 432, y: 6, w: 36, h: 36 },

    { param: "delayMs", kind: "knob", label: "time", size: "big", travel: { skew: 0.3 }, x: 6, y: 48, w: 102, h: 102 },
    { param: "feedback", kind: "knob", label: "feedback", size: "big", travel: "linear", x: 126, y: 48, w: 102, h: 102 },
    { param: "rateHz", kind: "knob", label: "lfofreq", size: "big", travel: { skew: 0.3 }, x: 246, y: 48, w: 102, h: 102 },
    { param: "depth", kind: "knob", label: "lfodepth", size: "big", travel: { skew: 0.2 }, x: 366, y: 48, w: 102, h: 102 },

    { param: "shape", kind: "knob", label: "lfoshape", x: 6, y: 166, w: 72, h: 72 },
    { param: "phaseDeg", kind: "knob", label: "lfophase", travel: "linear", x: 84, y: 166, w: 72, h: 72 },
    { param: "envMod", kind: "knob", label: "autotime", travel: "linear", x: 162, y: 166, w: 72, h: 72 },
    { param: "lowpassHz", kind: "knob", label: "lpf-freq", travel: { skew: 0.3 }, x: 240, y: 166, w: 72, h: 72 },
    { param: "highpassHz", kind: "knob", label: "hpf-freq", travel: { skew: 0.3 }, x: 318, y: 166, w: 72, h: 72 },
    { param: "resonance", kind: "knob", label: "resonance", travel: "linear", x: 396, y: 166, w: 72, h: 72 },

    { param: "invert", kind: "switch", states: ["feedback +", "feedback −"], x: 6, y: 256, w: 84, h: 18 },
    { param: "freeze", kind: "switch", label: "freeze", x: 108, y: 256, w: 78, h: 18 },
    { param: "twoHead", kind: "switch", states: ["onehead", "twohead"], x: 390, y: 256, w: 78, h: 18 },
    { param: "mute", kind: "switch", label: "mute", x: 390, y: 280, w: 78, h: 18 },
  ],
  displays: [],
  inert: [
    { label: "delaylock", kind: "switch", x: 204, y: 256, w: 78, h: 18, why: "locks the time to a host's tempo, which this port does not follow" },
    { label: "lfolock", kind: "switch", x: 300, y: 256, w: 78, h: 18, why: "locks the LFO to a host's tempo, which this port does not follow" },
    { label: "colour", kind: "knob", x: 6, y: 280, w: 18, h: 18, why: "only tinted the plug-in's window" },
  ],
};
