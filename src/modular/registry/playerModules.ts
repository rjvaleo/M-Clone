/**
 * The sample players.
 *
 * These are sources: they have no audio input, they produce sound from the pool
 * rather than shaping something arriving on a cable, and they are driven by
 * note events from the graph. That last point is the significant departure from
 * the app these designs came from, where a percussion engine owned its own
 * 16-step grid. Here the sequencing already exists — the cyclic editors, Note
 * Order, Note Density, the whole event side — so a player's job is to turn a
 * note into a sound and nothing else.
 *
 * `asset-id` is structural for the same reason a convolver's impulse is: the
 * sample decides what the module *is*, and swapping it is closer to changing
 * instruments than to turning a knob. Everything else ramps.
 */

import type { ModuleDescriptor, ParameterDescriptor, SignalType } from "../model/graph";
import {
  boolParam,
  custom,
  defineModule,
  enumParam,
  input,
  numberParam,
  output,
  param,
  presetParams,
  presetSection,
  section,
  status,
  stringParam,
} from "./descriptorKit";
import { syntheticAssetId } from "../audio/assets";

const audioSignal = (): SignalType => ({ kind: "audio", channels: 2 });
const noteSignal = (): SignalType => ({ kind: "note-event" });

const notesIn = () => input("notes-in", "Notes", noteSignal(), { merge: "ordered-by-tick" });
const audioOut = () => output("audio-out", "Audio", audioSignal());

const levelParam = (): ParameterDescriptor => numberParam("level", "Level", 0.8, 0, 2, 0.01);
const muteParam = (): ParameterDescriptor => boolParam("mute", "Mute");

/** Structural: read once when the subgraph is built, so it cannot be ramped. */
const assetParam = (label = "Sample"): ParameterDescriptor => ({
  ...stringParam("asset-id", label),
  smoothing: "none",
  morph: "step-end",
});

const slotsParam = (): ParameterDescriptor => ({
  id: "slots",
  label: "Slots",
  kind: "json",
  // Four voices wired to the starter kit, so a fresh module makes sound with
  // nothing patched into it. Both hihats share choke group 1 — striking one
  // silences the other, which is the rule this feature exists for.
  defaultValue: [
    { note: 36, assetId: syntheticAssetId("kick"), chokeGroup: 0, gain: 1 },
    { note: 38, assetId: syntheticAssetId("snare"), chokeGroup: 0, gain: 1 },
    { note: 42, assetId: syntheticAssetId("hihat"), chokeGroup: 1, gain: 1 },
    { note: 46, assetId: syntheticAssetId("hihat"), chokeGroup: 1, gain: 0.9 },
    { note: 48, assetId: "", chokeGroup: 0, gain: 1 },
    { note: 50, assetId: "", chokeGroup: 0, gain: 1 },
    { note: 52, assetId: "", chokeGroup: 0, gain: 1 },
    { note: 53, assetId: "", chokeGroup: 0, gain: 1 },
  ],
  smoothing: "none",
  morph: "step-end",
  automation: "record",
});

const PERCUSSION = defineModule({
  type: "m.percussion",
  label: "Percussion",
  family: "instrument",
  colorToken: "audio",
  layout: "editor",
  ports: [notesIn(), audioOut()],
  parameters: [
    slotsParam(),
    levelParam(),
    numberParam("pitch-semitones", "Pitch", 0, -24, 24, 1, "st"),
    numberParam("decay-seconds", "Decay", 0.5, 0.02, 4, 0.01, "s"),
    muteParam(),
  ],
  face: [
    section("slots", "Slots", [custom("percussion-slots", "Note to sample", ["slots"])]),
    section("voice", "Voice", [
      param("level"),
      param("pitch-semitones"),
      param("decay-seconds"),
      param("mute"),
      status("voices", "Sounding"),
    ]),
  ],
});

const LOOPER = defineModule({
  type: "m.looper",
  label: "Looper",
  family: "instrument",
  colorToken: "audio",
  ports: [notesIn(), audioOut()],
  parameters: [
    assetParam("Loop"),
    levelParam(),
    numberParam("rate", "Rate", 1, 0.05, 4, 0.01, "×"),
    // Only meaningful in time-stretch mode, where pitch stops following rate.
    numberParam("pitch-shift", "Pitch", 0, -24, 24, 1, "st"),
    numberParam("loop-start", "Start", 0, 0, 1, 0.001),
    numberParam("loop-end", "End", 1, 0, 1, 0.001),
    boolParam("loop", "Loop", true),
    boolParam("reverse", "Reverse"),
    boolParam("time-stretch", "Time stretch"),
    boolParam("gate", "Stop on note off"),
    muteParam(),
  ],
  face: [
    section("sample", "Sample", [custom("asset-slot", "Sample", ["asset-id"]), param("level"), status("voices", "Sounding")]),
    section("playback", "Playback", [
      param("rate"),
      param("pitch-shift"),
      param("loop-start"),
      param("loop-end"),
    ]),
    section("mode", "Mode", [
      param("loop"),
      param("reverse"),
      param("time-stretch"),
      param("gate"),
      param("mute"),
    ]),
  ],
});

const GRANULAR = defineModule({
  type: "m.granular",
  label: "Granular",
  family: "instrument",
  colorToken: "audio",
  ports: [notesIn(), audioOut()],
  parameters: [
    assetParam("Source"),
    levelParam(),
    numberParam("grain-size", "Grain", 0.2, 0.005, 2, 0.005, "s"),
    // Shorter than the grain size means grains overlap, which is what makes a
    // cloud rather than a stutter.
    numberParam("grain-spacing", "Spacing", 0.08, 0.005, 1, 0.005, "s"),
    numberParam("position", "Position", 0.5, 0, 1, 0.001),
    numberParam("jitter", "Jitter", 0.1, 0, 1, 0.01),
    numberParam("stretch", "Stretch", 1, 0.05, 8, 0.01, "×"),
    boolParam("freeze", "Freeze"),
    boolParam("free-run", "Free run"),
    muteParam(),
  ],
  face: [
    section("sample", "Sample", [custom("asset-slot", "Sample", ["asset-id"]), param("level"), status("voices", "Grains")]),
    section("cloud", "Cloud", [
      param("grain-size"),
      param("grain-spacing"),
      param("position"),
      param("jitter"),
      param("stretch"),
    ]),
    section("mode", "Mode", [param("freeze"), param("free-run"), param("mute")]),
  ],
});

/**
 * What a player reads once, when its subgraph is built.
 *
 * Anything not listed here and not a number or a boolean never reaches the
 * audio layer at all — `compileAudioPlan` has nowhere to put it, because
 * `parameters` is numeric by definition. A player whose sample assignment went
 * missing this way builds perfectly and is silent, which is why
 * `audioModules.test.ts` asserts that every non-numeric parameter in the rack
 * is declared structural.
 */
/**
 * The synth: the only module here that generates a pitch rather than replaying
 * one.
 *
 * Three oscillators, a filter with its own envelope, and the modulation matrix
 * that ties them together. The matrix is structural because it is a list of
 * routings rather than a number — changing one rebuilds the module, the way
 * swapping a sample does; everything else ramps.
 *
 * Envelope times are milliseconds on the face because that is how an envelope
 * is talked about, and seconds inside the voice because that is what the clock
 * speaks. `readSynthSettings` is the one place that converts.
 */
const SYNTH_WAVES = ["sawtooth", "square", "triangle", "sine", "pulse"] as const;

const oscillatorSection = (index: 1 | 2 | 3, defaults: {
  wave: string;
  detune: number;
  level: number;
}) => ({
  parameters: [
    enumParam(`osc${index}-wave`, `Osc ${index} wave`, SYNTH_WAVES, defaults.wave),
    numberParam(`osc${index}-detune`, `Osc ${index} detune`, defaults.detune, -2400, 2400, 1, "¢"),
    numberParam(`osc${index}-level`, `Osc ${index} level`, defaults.level, 0, 1, 0.01),
    numberParam(`osc${index}-width`, `Osc ${index} width`, 0.5, 0.1, 0.9, 0.01),
  ],
  face: section(`osc${index}`, `Oscillator ${index}`, [
    param(`osc${index}-wave`),
    param(`osc${index}-detune`),
    param(`osc${index}-level`),
    param(`osc${index}-width`),
  ]),
});

const OSC1 = oscillatorSection(1, { wave: "sawtooth", detune: 0, level: 0.8 });
const OSC2 = oscillatorSection(2, { wave: "sawtooth", detune: 7, level: 0.5 });
const OSC3 = oscillatorSection(3, { wave: "sine", detune: -1200, level: 0.3 });

const SYNTH = defineModule({
  type: "m.synth",
  label: "Synth",
  family: "instrument",
  colorToken: "audio",
  layout: "editor",
  ports: [notesIn(), audioOut()],
  parameters: [
    ...OSC1.parameters,
    ...OSC2.parameters,
    ...OSC3.parameters,
    numberParam("cutoff", "Cutoff", 2000, 20, 20000, 1, "Hz"),
    numberParam("resonance", "Resonance", 1, 0.1, 30, 0.1, "Q"),
    numberParam("key-follow", "Key follow", 0.25, 0, 1, 0.01),
    numberParam("filter-amount", "Filter amount", 1.5, -8, 8, 0.1, "oct"),
    numberParam("filter-attack", "Filter attack", 10, 0, 4000, 1, "ms"),
    numberParam("filter-decay", "Filter decay", 250, 0, 4000, 1, "ms"),
    numberParam("filter-sustain", "Filter sustain", 0.4, 0, 1, 0.01),
    numberParam("filter-release", "Filter release", 300, 0, 8000, 1, "ms"),
    numberParam("amp-attack", "Attack", 10, 0, 4000, 1, "ms"),
    numberParam("amp-decay", "Decay", 150, 0, 4000, 1, "ms"),
    numberParam("amp-sustain", "Sustain", 0.7, 0, 1, 0.01),
    numberParam("amp-release", "Release", 250, 0, 8000, 1, "ms"),
    levelParam(),
    numberParam("pan", "Pan", 0, -1, 1, 0.01),
    numberParam("max-voices", "Voices", 16, 1, 32, 1),
    muteParam(),
    {
      id: "matrix",
      label: "Modulation",
      kind: "json",
      // Empty by default: a synth that modulates nothing is still a synth, and
      // a routing nobody asked for is a patch that will not sit still.
      defaultValue: [],
      smoothing: "none",
      morph: "step-end",
      automation: "record",
    },
    ...presetParams("Synth presets", []),
  ],
  face: [
    presetSection("synth-presets", "Synth presets", [
      "cutoff", "resonance", "key-follow", "filter-amount",
      "amp-attack", "amp-decay", "amp-sustain", "amp-release",
      "level", "pan",
    ], "top"),
    OSC1.face,
    OSC2.face,
    OSC3.face,
    section("filter", "Filter", [
      param("cutoff"),
      param("resonance"),
      param("key-follow"),
      param("filter-amount"),
      param("filter-attack"),
      param("filter-decay"),
      param("filter-sustain"),
      param("filter-release"),
    ]),
    section("amp", "Amplitude", [
      param("amp-attack"),
      param("amp-decay"),
      param("amp-sustain"),
      param("amp-release"),
    ]),
    section("out", "Output", [
      param("level"),
      param("pan"),
      param("max-voices"),
      param("mute"),
      status("voices", "Sounding"),
    ]),
    section("modulation", "Modulation", [custom("mod-matrix", "Modulation matrix", ["matrix"])]),
  ],
});

export const PLAYER_STRUCTURE_PARAMS: Readonly<Record<string, readonly string[]>> = {
  "m.percussion": ["slots"],
  "m.looper": ["asset-id"],
  "m.granular": ["asset-id"],
  // The waves are strings, so they travel as structure or not at all — the
  // compiler carries only numbers and booleans in `parameters`. Changing one
  // rebuilds the module, which is the same trade `asset-id` makes: the wave
  // decides what the oscillator *is*.
  "m.synth": ["matrix", "osc1-wave", "osc2-wave", "osc3-wave"],
};

export const PLAYER_MODULES: ModuleDescriptor[] = [PERCUSSION, LOOPER, GRANULAR, SYNTH];
