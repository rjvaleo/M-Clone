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
import { GRAIN_SCALES } from "./grainTuning";
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
import { DELAY_NOTES, LFO_TARGETS, LFO_WAVES, TAPE_SPEEDS } from "../audio/synthLaws";

const audioSignal = (): SignalType => ({ kind: "audio", channels: 2 });
const noteSignal = (): SignalType => ({ kind: "note-event" });

const notesIn = () => input("notes-in", "Notes", noteSignal(), { merge: "ordered-by-tick" });
const audioOut = () => output("audio-out", "Audio", audioSignal());

const levelParam = (): ParameterDescriptor => numberParam("level", "Level", 0.8, 0, 2, 0.01);
const muteParam = (): ParameterDescriptor => boolParam("mute", "Mute");

/**
 * Where the module sits in the field.
 *
 * Ramped, never structural: moving a source across the image is the most
 * ordinary thing a mix does, and a rebuild for it would be a crossfade in the
 * middle of a gesture.
 */
const panParam = (): ParameterDescriptor => numberParam("pan", "Pan", 0, -1, 1, 0.01);

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
  // Kick and snare centred, the two hats slightly right — the ordinary
  // placement of a kit heard from behind it, and enough of a default that a
  // fresh module sounds like a room rather than a point.
  defaultValue: [
    { note: 36, assetId: syntheticAssetId("kick"), chokeGroup: 0, gain: 1, pan: 0 },
    { note: 38, assetId: syntheticAssetId("snare"), chokeGroup: 0, gain: 1, pan: -0.1 },
    { note: 42, assetId: syntheticAssetId("hihat"), chokeGroup: 1, gain: 1, pan: 0.35 },
    { note: 46, assetId: syntheticAssetId("hihat"), chokeGroup: 1, gain: 0.9, pan: 0.35 },
    { note: 48, assetId: "", chokeGroup: 0, gain: 1, pan: 0 },
    { note: 50, assetId: "", chokeGroup: 0, gain: 1, pan: 0 },
    { note: 52, assetId: "", chokeGroup: 0, gain: 1, pan: 0 },
    { note: 53, assetId: "", chokeGroup: 0, gain: 1, pan: 0 },
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
    panParam(),
    numberParam("pitch-semitones", "Pitch", 0, -24, 24, 1, "st"),
    numberParam("decay-seconds", "Decay", 0.5, 0.02, 4, 0.01, "s"),
    muteParam(),
  ],
  face: [
    section("slots", "Slots", [custom("percussion-slots", "Note to sample", ["slots"])]),
    section("voice", "Voice", [
      param("level"),
      param("pan"),
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
    panParam(),
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
    section("sample", "Sample", [custom("asset-slot", "Sample", ["asset-id"]), param("level"), param("pan"), status("voices", "Sounding")]),
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
    panParam(),
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
    section("sample", "Sample", [custom("asset-slot", "Sample", ["asset-id"]), param("level"), param("pan"), status("voices", "Grains")]),
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

const oscillatorParams = (index: 1 | 2 | 3, defaults: {
  wave: string;
  detune: number;
  level: number;
}) => ({
  parameters: [
    enumParam(`osc${index}-wave`, `Osc ${index} wave`, SYNTH_WAVES, defaults.wave),
    numberParam(`osc${index}-detune`, `Osc ${index} detune`, defaults.detune, -2400, 2400, 1, "¢"),
    numberParam(`osc${index}-level`, `Osc ${index} level`, defaults.level, 0, 1, 0.01),
    numberParam(`osc${index}-width`, `Osc ${index} width`, 0.5, 0.05, 0.95, 0.01),
  ],
});

const OSC1 = oscillatorParams(1, { wave: "sawtooth", detune: 0, level: 0.8 });
const OSC2 = oscillatorParams(2, { wave: "sawtooth", detune: 7, level: 0.5 });
const OSC3 = oscillatorParams(3, { wave: "sine", detune: -1200, level: 0.3 });

/**
 * The scale sequencer's three LFOs, each with one target.
 *
 * Separate from the matrix's two (`lfo1`, `lfo2`) and from the LFO modules
 * that map to knobs: these are the original's own, free-running, shared by
 * every note, and each drives exactly what the original's menu offers. Rates,
 * depths and targets start where the original's page does (20 % on the
 * filter, 25 % on the pulse width, the third off); a patch saved before the
 * depths existed is given zero, so it sounds as it did.
 */
const synthLfoParams = (id: "a" | "b" | "c", n: number, rate: number, target: string, depth: number) => [
  numberParam(`lfo-${id}-rate`, `LFO ${n} rate`, rate, 0.05, 20, 0.01, "Hz"),
  { ...numberParam(`lfo-${id}-depth`, `LFO ${n} depth`, depth, 0, 1, 0.01), missingValue: 0 },
  enumParam(`lfo-${id}-wave`, `LFO ${n} wave`, LFO_WAVES, "sine"),
  enumParam(`lfo-${id}-target`, `LFO ${n} target`, LFO_TARGETS, target),
];

const SYNTH_LFOS = [
  ...synthLfoParams("a", 1, 1, "filter", 0.2),
  ...synthLfoParams("b", 2, 0.05 * 400 ** 0.4, "pw", 0.25),
  ...synthLfoParams("c", 3, 0.05 * 400 ** 0.4, "none", 0),
];

/**
 * The original's ping-pong delay, after the voices: tempo-synced, with a
 * hi-cut in its feedback and a tape transport that glides when it is retimed.
 * Wet starts at the original's 25 %; a patch saved before it existed is given
 * zero, so it has no echo it did not ask for.
 * Tempo is the synth's own until the transport reaches the audio plan.
 */
const SYNTH_DELAY = [
  enumParam("delay-note", "Delay time", DELAY_NOTES.map((note) => note.label), "1/8"),
  numberParam("delay-feedback", "Feedback", 0.35, 0, 0.95, 0.01),
  { ...numberParam("delay-wet", "Delay wet", 0.25, 0, 1, 0.01), missingValue: 0 },
  numberParam("delay-spread", "Spread", 1, 0, 1, 0.01),
  numberParam("delay-hicut", "Hi-cut", 200 * 100 ** 0.75, 200, 20000, 1, "Hz"),
  enumParam("tape", "Tape speed", TAPE_SPEEDS.map((speed) => speed.label), "7.5 IPS"),
  numberParam("tempo", "Tempo", 120, 20, 300, 1, "BPM"),
];

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
    // The original's envelope amount, −100…+100 %, linear in hertz.
    numberParam("filter-env", "Env amount", 0, -1, 1, 0.01),
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
    // The master after the delay: the original's `volume · 0.3` is 0.21 here.
    numberParam("volume", "Volume", 1, 0, 1, 0.001),
    // One filter shared by every note, its envelope retriggered by each — the
    // scale sequencer's structure, so its sound can be had exactly.
    boolParam("classic", "Classic"),
    ...SYNTH_LFOS,
    ...SYNTH_DELAY,
    // How long a morph to a library preset takes. The face's, not the voice's.
    numberParam("morph-time", "Morph time", 5, 0.5, 30, 0.5, "s"),
    // Counts the face's preset loads and morph frames, each of which touches
    // the original's LFOs (see `LFO_TOUCH` in synthPresets.ts). Not a control.
    numberParam("lfo-touch", "LFO touch", 0, 0, Number.MAX_SAFE_INTEGER, 1),
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
      "cutoff", "resonance", "key-follow", "filter-amount", "filter-env",
      "amp-attack", "amp-decay", "amp-sustain", "amp-release",
      "level", "pan", "volume", "classic",
      ...SYNTH_LFOS.map((parameter) => parameter.id),
      ...SYNTH_DELAY.map((parameter) => parameter.id),
    ], "top"),
    // One tight panel: oscillators, filter, both envelopes drawn as curves
    // with handles, and the output. See ui/mlab/SynthFace.tsx.
    { ...section("synth", "Synth", [custom("synth-panel", "Synth", [
      ...OSC1.parameters, ...OSC2.parameters, ...OSC3.parameters,
    ].map((parameter) => parameter.id).concat([
      "cutoff", "resonance", "key-follow", "filter-amount", "filter-env",
      "filter-attack", "filter-decay", "filter-sustain", "filter-release",
      "amp-attack", "amp-decay", "amp-sustain", "amp-release",
      "level", "pan", "max-voices", "volume", "classic", "morph-time", "lfo-touch", "mute", "matrix",
      ...SYNTH_LFOS.map((parameter) => parameter.id),
      ...SYNTH_DELAY.map((parameter) => parameter.id),
    ]))]), showHeading: false },
  ],
});

export const PLAYER_STRUCTURE_PARAMS: Readonly<Record<string, readonly string[]>> = {
  "m.grain-engine": ["asset-id"],
  "m.percussion": ["slots"],
  "m.looper": ["asset-id"],
  "m.granular": ["asset-id"],
  // The waves are strings, so they travel as structure or not at all — the
  // compiler carries only numbers and booleans in `parameters`. Changing one
  // rebuilds the module, which is the same trade `asset-id` makes: the wave
  // decides what the oscillator *is*.
  "m.synth": ["matrix", "osc1-wave", "osc2-wave", "osc3-wave"],
};

/**
 * MultiGrainLive's sound engine — the `prism-grain` crate both programs share
 * — as an instrument: a sample played by any of its five engines, with every
 * control of MultiGrainLive's granular tray. A note sets the pitch in
 * semitones from Root; gated, each note is a voice that starts the file and
 * fades out on its release, and with Free run on it plays continuously,
 * looping, and notes only retune it.
 *
 * Ranges, steps and defaults are the tray's own (`ui/app.js`
 * `renderStretchParams` and `renderGrainParams`, and its `*_DEFAULTS`
 * tables), which are the crate's defaults; a patch saved before a control was
 * here is given that default and sounds as it did. Labels are the tray's.
 * `grainEngineParity.test.ts` holds the inventory.
 *
 * It runs on the Rust engine. On Web Audio the simpler Granular player stands
 * in, reading the same sample and the same Free run.
 */
const GRAIN_ENGINE = defineModule({
  type: "m.grain-engine",
  label: "Grain Engine",
  family: "instrument",
  colorToken: "audio",
  ports: [notesIn(), audioOut()],
  parameters: [
    assetParam("Source"),
    levelParam(),
    // In the order of `prism_grain::stretch::Algorithm`, which is the wire value.
    enumParam("engine", "Engine", ["WSOLA", "Vocoder", "Grains", "PVSOLA", "Hybrid"], "Grains"),
    // Time and pitch.
    numberParam("stretch", "Stretch", 1, 0.01, 100, 0.01, "×"),
    // Continuous, as the tray's is with no tuning chosen.
    numberParam("semitones", "Pitch", 0, -48, 48, 0.001, "st"),
    // The tuning Pitch snaps to: one of `prism_grain::tuning`'s scales, or
    // with "free" a grid in semitones (0 for none). The scale's place here,
    // the crate's order, is its wire value.
    enumParam("scale", "Tuning", ["free", ...GRAIN_SCALES.map((s) => s.name)], "free"),
    numberParam("pitch-step", "Pitch grid", 0, 0, 12, 0.5, "st"),
    numberParam("window-ms", "Window", 40, 5, 2000, 1, "ms"),
    // Grain shape.
    numberParam("position", "Position", 0, -1, 1, 0.001),
    // Zero takes the rate from the window and the overlap, as MultiGrainLive does.
    numberParam("grain-rate", "Rate", 0, 0, 500, 1, "/s"),
    numberParam("density", "Density", 0, 0, 500, 1, "/s"),
    numberParam("layers", "Layers", 1, 1, 64, 1, "×"),
    numberParam("overlap", "Overlap", 2, 1, 8, 0.1, "×"),
    numberParam("size-jitter", "Size jitter", 0, 0, 1, 0.01),
    numberParam("position-jitter", "Position jitter", 0, 0, 500, 1, "ms"),
    // Pitch movement.
    numberParam("pitch-jitter", "Pitch jitter", 0, 0, 24, 0.1, "st"),
    numberParam("pitch-drift", "Pitch drift", 0, 0, 24, 0.1, "st"),
    numberParam("drift-rate", "Drift rate", 0.5, 0.01, 10, 0.01, "Hz"),
    // Scan.
    numberParam("scan", "Scan", 1, -2, 2, 0.01, "×"),
    boolParam("reverse", "Reverse grains"),
    boolParam("wrap", "Wrap positions"),
    // Shape.
    numberParam("envelope", "Envelope", 0.5, 0, 1, 0.01),
    numberParam("size-range", "Size range", 1, 1, 8, 0.05, "×"),
    numberParam("layer-spread", "Layer spread", 1, 0, 4, 0.01, "×"),
    numberParam("pan-spread", "Pan spread", 0, 0, 1, 0.01),
    // Layer scatter.
    numberParam("layer-scatter", "Scatter", 0, 0, 1, 0.01),
    numberParam("layer-scatter-ms", "Range", 120, 1, 2000, 1, "ms"),
    // Randomness. The seed is what Re-roll deals: `(seed·1664525 + 1013904223) % 2147483647`.
    boolParam("link-jitter", "Link jitter"),
    boolParam("drift-step", "Step the drift"),
    numberParam("seed", "Seed", 1, 0, 2147483646, 1),
    // WSOLA: its switch, its detector, Splice and Transients.
    boolParam("preserve-transients", "Preserve transients"),
    numberParam("detector", "Detector", 0.5, 0, 1, 0.01),
    numberParam("search-ms", "Search", 10, 0, 200, 0.5, "ms"),
    // The tray's own words for similar, different and loudest.
    enumParam("splice", "Pick", ["best", "worst", "loud"], "best"),
    enumParam("window-shape", "Window", ["hann", "tri", "rect"], "hann"),
    numberParam("stride", "Stride", 4, 1, 128, 1, "fr"),
    numberParam("floor", "Floor", 1, 0, 2, 0.01, "×"),
    numberParam("guard", "Guard", 3, 1, 16, 0.1, "hop"),
    // The vocoder: its window and switch, Spectrum and Phase. PVSOLA and the
    // hybrid run it too.
    numberParam("analysis-ms", "Analysis window", 46, 5, 500, 1, "ms"),
    boolParam("phase-lock", "Phase lock", true),
    numberParam("freeze", "Freeze", 0, 0, 1, 0.01),
    numberParam("blur", "Blur", 0, 0, 1, 0.01),
    numberParam("gate", "Gate", 0, 0, 1, 0.01),
    numberParam("freq-trust", "Freq trust", 1, 0, 4, 0.01, "×"),
    numberParam("phase-spread", "Phase spread", 1, 0, 4, 0.01, "×"),
    numberParam("peak-width", "Peak width", 2, 1, 16, 1, "bin"),
    numberParam("lock-width", "Lock width", 1, 0, 4, 0.01, "×"),
    boolParam("link-stereo", "Link stereo"),
    // PVSOLA: Re-anchor and Anchor.
    numberParam("re-anchor", "Re-anchor", 6, 1, 64, 1, "fr"),
    numberParam("anchor-search-ms", "Search", 10, 0, 200, 0.5, "ms"),
    numberParam("blend", "Blend", 0.5, 0, 1, 0.01),
    // The hybrid: its three levels, Remake noise and Separation.
    numberParam("tone", "Tone", 1, 0, 2, 0.01, "×"),
    numberParam("hits", "Hits", 1, 0, 2, 0.01, "×"),
    numberParam("air", "Air", 1, 0, 2, 0.01, "×"),
    boolParam("remake-noise", "Remake noise", true),
    numberParam("hold", "Hold", 17, 3, 101, 2, "fr"),
    numberParam("spread", "Spread", 17, 3, 101, 2, "bin"),
    numberParam("margin", "Margin", 2, 1, 8, 0.05, "×"),
    numberParam("resolution", "Resolution", 2048, 256, 8192, 256),
    // The grain cloud over another engine.
    boolParam("cloud", "Grain cloud"),
    numberParam("cloud-mix", "Cloud", 0.5, 0, 1, 0.01),
    numberParam("root", "Root", 60, 0, 127, 1),
    boolParam("free-run", "Free run"),
    muteParam(),
  ],
  face: [
    section("sample", "Sample", [custom("asset-slot", "Sample", ["asset-id"]), param("level")]),
    section("time", "Time and pitch", [param("engine"), param("stretch"), param("semitones"), param("scale"), param("pitch-step"), param("window-ms")]),
    section("grain-shape", "Grain shape", [
      param("position"), param("grain-rate"), param("density"), param("layers"), param("overlap"),
      param("size-jitter"), param("position-jitter"),
    ]),
    section("pitch", "Pitch movement", [param("pitch-jitter"), param("pitch-drift"), param("drift-rate")]),
    section("scan", "Scan", [param("scan"), param("reverse"), param("wrap")]),
    section("shape", "Shape", [param("envelope"), param("size-range"), param("layer-spread"), param("pan-spread")]),
    section("scatter", "Layer scatter", [param("layer-scatter"), param("layer-scatter-ms")]),
    section("random", "Randomness", [param("link-jitter"), param("drift-step"), param("seed")]),
    section("wsola", "WSOLA", [
      param("preserve-transients"), param("detector"), param("search-ms"), param("splice"), param("window-shape"),
      param("stride"), param("floor"), param("guard"),
    ]),
    section("vocoder", "Vocoder", [
      param("analysis-ms"), param("phase-lock"), param("freeze"), param("blur"), param("gate"),
      param("freq-trust"), param("phase-spread"), param("peak-width"), param("lock-width"), param("link-stereo"),
    ]),
    section("pvsola", "PVSOLA", [param("re-anchor"), param("anchor-search-ms"), param("blend")]),
    section("hybrid", "Hybrid", [
      param("tone"), param("hits"), param("air"), param("remake-noise"),
      param("hold"), param("spread"), param("margin"), param("resolution"),
    ]),
    section("cloud", "Cloud", [param("cloud"), param("cloud-mix")]),
    section("play", "Play", [param("root"), param("free-run"), param("mute")]),
  ],
});

export const PLAYER_MODULES: ModuleDescriptor[] = [PERCUSSION, LOOPER, GRANULAR, SYNTH, GRAIN_ENGINE];
