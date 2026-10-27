// The reverbs, delays and modulation effects in the Night console style, after
// Omnisphere and KULT in CleanRoom, as the Dattorro plate is: dark cells in the
// effect's signal order, input on the left and output on the right, round a
// live display in the middle. Every display is worked from the kernel's own
// maths (plots.ts, curves.ts).

import type { PanelLayout } from "../layout";
import { big, fill, knob, mute, toggle, type GroupSpec } from "./grid";

const WIDTH = 560;
const HEIGHT = 280;
/** Each side column, and the display between them. */
const SIDE = 170;

type Column = (Omit<GroupSpec, "x" | "y" | "w" | "id"> & { id: string })[];

/** A Night panel: groups stacked down the left and right columns, the display between. */
function night(id: string, display: string, left: Column, right: Column): PanelLayout {
  const stack = (column: Column, x: number) => {
    let y = 0;
    return column.map((group) => {
      const placed = { ...group, x, y, w: SIDE };
      y += group.h;
      return placed;
    });
  };
  const { groups, controls, inert } = fill([...stack(left, 0), ...stack(right, WIDTH - SIDE)], { top: 20, pad: 4, gap: 2 });
  return {
    moduleType: `m.prism-${id}`,
    style: "night",
    readout: { figures: 3 },
    width: WIDTH,
    height: HEIGHT,
    groups,
    controls,
    ...(inert.length > 0 ? { inert } : {}),
    displays: [{ kind: display, x: SIDE, y: 0, w: WIDTH - 2 * SIDE, h: HEIGHT }],
  };
}

/** Three across: the value is printed smaller to stay inside the dial. */
const small = (param: string, label: string) => knob(param, label, { size: "small" });

const output = (id = "out", label = "Output"): Column[number] => ({
  id, label, tint: "out", h: 280,
  rows: [[big("wet", "Wet", { span: 2 })], [knob("dry", "Dry", { span: 2 })], [mute(2)]],
  heights: [110, 110, 32],
});

const mix = (h = 140): Column[number] => ({
  id: "out", label: "Mix", tint: "out", h,
  rows: [[knob("wet", "Wet"), knob("dry", "Dry")], [mute(2)]],
  heights: [h - 58, 32],
});

/** Schroeder's four combs and Moorer's six, after a predelay, through their all-passes. */
const reverb = (id: string, display: string, combs: GroupSpec["rows"], heights: number[]) => night(id, display, [
  { id: "space", label: "Space", tint: "input", h: 110, rows: [[knob("predelayMs", "Predelay"), knob("spread", "Spread")]] },
  { id: "combs", label: "Combs", tint: "tank", h: 170, rows: combs, heights },
], [
  { id: "allpass", label: "All-pass", tint: "mod", h: 110, rows: [[knob("diffusion", "Diffusion")]] },
  { id: "out", label: "Output", tint: "out", h: 170, rows: [[knob("wet", "Wet"), knob("dry", "Dry")], [mute(2)]], heights: [110, 34] },
]);

/** Dattorro's modulated delay: chorus, flanger and vibrato are one machine set three ways. */
const modDelay = (id: string) => night(id, "mod-sweep", [
  {
    id: "delay", label: "Delay", tint: "input", h: 280,
    rows: [[big("delayMs", "Delay", { span: 2 })], [knob("feedback", "Feedback", { span: 2 })], [toggle("allpass", "All-pass", { span: 2 })]],
    heights: [140, 80, 32],
  },
], [
  { id: "lfo", label: "LFO", tint: "mod", h: 140, rows: [[small("rateHz", "Rate"), small("depthMs", "Depth"), small("stereo", "Stereo")]] },
  mix(),
]);

export const NIGHT_PANELS: readonly PanelLayout[] = [
  reverb("schroeder-reverb", "schroeder-tail", [[knob("decay", "Decay"), knob("size", "Size")], [toggle("freeze", "Freeze", { span: 2 })]], [110, 34]),
  reverb("moorer-reverb", "moorer-tail", [[small("decay", "Decay"), small("damping", "Absorption"), small("size", "Size")], [toggle("freeze", "Freeze", { span: 3 })]], [110, 34]),

  modDelay("white-chorus"),
  modDelay("flanger"),
  modDelay("vibrato"),

  night("leslie", "rotor", [
    {
      id: "rotor", label: "Rotor", tint: "mod", h: 280,
      rows: [[knob("rateHz", "Rate"), knob("depthMs", "Doppler")], [knob("amDepth", "Amplitude"), knob("baseMs", "Distance")]],
    },
  ], [{
    id: "out", label: "Output", tint: "out", h: 280,
    rows: [[big("width", "Width", { span: 2 })], [knob("wet", "Wet"), knob("dry", "Dry")], [mute(2)]],
    heights: [110, 110, 32],
  }]),

  night("harmonizer", "pitch-taps", [
    { id: "pitch", label: "Pitch", tint: "input", h: 280, rows: [[big("semitones", "Pitch", { span: 2 })], [knob("windowMs", "Window", { span: 2 })]], heights: [150, 104] },
  ], [
    { id: "feedback", label: "Feedback", tint: "mod", h: 140, rows: [[knob("feedback", "Feedback")]] },
    mix(),
  ]),

  night("detune", "detune-taps", [
    { id: "detune", label: "Detune", tint: "input", h: 280, rows: [[big("cents", "Detune", { span: 2 })], [knob("windowMs", "Window", { span: 2 })]], heights: [150, 104] },
  ], [output()]),

  night("doubler", "doubler-sweep", [
    { id: "delay", label: "Delay", tint: "input", h: 140, rows: [[big("delayMs", "Delay")]] },
    { id: "variation", label: "Variation", tint: "mod", h: 140, rows: [[knob("variationMs", "Depth"), knob("rateHz", "Rate")]] },
  ], [output()]),

  night("doppler", "doppler-path", [
    {
      id: "source", label: "Source", tint: "input", h: 280,
      rows: [[knob("distanceMs", "Distance", { span: 2 })], [knob("velocityMps", "Velocity", { span: 2 })], [knob("speedMps", "Sound speed", { span: 2 })]],
    },
  ], [output()]),

  night("allpass-diffuser", "allpass-train", [
    { id: "allpass", label: "All-pass", tint: "input", h: 280, rows: [[big("delayMs", "Delay", { span: 2 })], [knob("coefficient", "Coefficient", { span: 2 })]] },
  ], [output()]),

  night("echo", "echo-train", [
    { id: "time", label: "Time", tint: "input", h: 140, rows: [[knob("delayMs", "Delay"), knob("glideMs", "Glide")]] },
    { id: "repeats", label: "Repeats", tint: "tank", h: 140, rows: [[knob("feedback", "Feedback"), knob("damping", "Damping")]] },
  ], [output("out", "Levels")]),

  night("multi-delay", "tap-train", [
    { id: "taps", label: "Taps", tint: "input", h: 170, rows: [[knob("delay1Ms", "Delay 1"), knob("delay2Ms", "Delay 2")], [knob("spread", "Spread", { span: 2 })]], heights: [86, 58] },
    { id: "repeats", label: "Repeats", tint: "tank", h: 110, rows: [[knob("feedback", "Feedback")]] },
  ], [output("out", "Levels")]),

  night("tremolo", "trem-cycle", [
    {
      id: "lfo", label: "LFO", tint: "mod", h: 280,
      rows: [[big("rateHz", "Rate", { span: 2 })], [{ param: "shape", label: "Shape", kind: "select", span: 2 }]],
      heights: [214, 40],
    },
  ], [{
    id: "amount", label: "Amount", tint: "out", h: 280,
    rows: [[big("depth", "Depth", { span: 2 })], [knob("stereo", "Stereo", { span: 2 })], [mute(2)]],
    heights: [110, 110, 32],
  }]),

  night("convolution", "impulse-window", [
    {
      id: "impulse", label: "Impulse", tint: "input", h: 140,
      rows: [[{ param: "asset-id", label: "Impulse", kind: "asset" }], [knob("lengthMs", "Length used")]],
      heights: [28, 86],
    },
    {
      id: "shape", label: "Shape", tint: "tank", h: 140,
      rows: [[{ param: "window", label: "Window", kind: "select", menu: true }], [toggle("brighten", "Brighten")]],
      heights: [62, 52],
    },
  ], [
    { id: "process", label: "Process", tint: "mod", h: 140, rows: [[toggle("ringModulate", "Ring mod")], [knob("mix", "Mix")]], heights: [32, 82] },
    // SoundHack's 0, 24 and 42 dB on top of the result: the output's level.
    { id: "out", label: "Output", tint: "out", h: 140, rows: [[knob("gainDb", "Gain")], [mute()]], heights: [82, 32] },
  ]),

  night("phaser", "phaser-response", [
    {
      id: "notches", label: "Notches", tint: "input", h: 280,
      rows: [[knob("notches", "Notches"), knob("centreHz", "Centre")], [knob("spread", "Spread"), knob("resonance", "Notch width")], [knob("depth", "Depth", { span: 2 })]],
    },
  ], [
    { id: "sweep", label: "Sweep", tint: "mod", h: 140, rows: [[small("rateHz", "Rate"), small("sweep", "Sweep"), small("stereo", "Stereo")]] },
    {
      id: "out", label: "Mix", tint: "out", h: 140,
      rows: [[small("feedback", "Feedback"), small("wet", "Wet"), small("dry", "Dry")], [mute(3)]],
      heights: [82, 32],
    },
  ]),
];
