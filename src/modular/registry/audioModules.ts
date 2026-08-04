/**
 * The audio rack.
 *
 * These are the first modules whose signal is sound rather than events, and the
 * descriptors carry one convention the event modules do not need: a parameter
 * is either **structural** or **movable**, and which one it is decides what
 * happens when the user touches it.
 *
 * A movable parameter is an `AudioParam` behind the scenes and changing it is a
 * scheduled ramp — no construction, no reconnection, nothing audible but the
 * intended change. A structural parameter decides the shape of the compiled
 * subgraph: a delay line's maximum length, a reverb's impulse, a crusher's
 * transfer curve. Those cannot be ramped, so changing one rebuilds the node
 * behind a crossfade. Declaring which is which here — rather than leaving the
 * builder to decide — is what lets `compileAudioPlan` sort them into the two
 * halves of an `AudioNodeSpec` and lets a test assert that a knob move produces
 * a diff with no topology in it.
 *
 * Two ids are reserved across the whole rack. `mix` is the dry/wet balance and
 * becomes the spec's `wet`; `mute` removes a module from the mix and becomes
 * its `bypass`. Neither is an ordinary parameter, because both are handled by
 * the shell rather than by the topology.
 */

import type { ModuleDescriptor, ParameterDescriptor, SignalType } from "../model/graph";
import {
  boolParam,
  defineModule,
  input,
  numberParam,
  output,
  param,
  section,
} from "./descriptorKit";

const audioSignal = (channels: 1 | 2 = 2): SignalType => ({ kind: "audio", channels });

/** The reserved ids, named once so the compiler and the descriptors agree. */
export const AUDIO_MIX_PARAM = "mix";
export const AUDIO_MUTE_PARAM = "mute";

/**
 * Audio inputs are never `required`.
 *
 * A required input is a *compile error* when nothing is patched into it, and
 * that is the wrong reading for audio: an effect with nothing arriving is not
 * a broken patch, it is an idle one, and half-built racks are how people build
 * racks. Marking these required would also stop the whole graph compiling until
 * a sound source module exists, which would take the event side down with it.
 */
const audioIn = () => input("audio-in", "Audio", audioSignal(), { merge: "sum" });
const audioOut = () => output("audio-out", "Audio", audioSignal());

/**
 * A parameter that cannot be ramped.
 *
 * `none` smoothing and `step-end` morph are not stylistic choices: a structural
 * value is read once when the subgraph is built, so any request to interpolate
 * it would be a promise the audio layer cannot keep.
 */
const structuralParam = (
  id: string,
  label: string,
  defaultValue: number,
  minimum: number,
  maximum: number,
  step = 1,
  unit?: string,
): ParameterDescriptor => ({
  ...numberParam(id, label, defaultValue, minimum, maximum, step, unit),
  smoothing: "none",
  morph: "step-end",
});

const mixParam = (defaultValue: number): ParameterDescriptor =>
  numberParam(AUDIO_MIX_PARAM, "Mix", defaultValue, 0, 1, 0.01);

const muteParam = (): ParameterDescriptor => boolParam(AUDIO_MUTE_PARAM, "Mute");

/**
 * Which parameters rebuild rather than ramp.
 *
 * Kept as data rather than as a flag on each descriptor so the compiler can
 * consult it without walking the registry, and so a test can assert the two
 * agree instead of trusting that they do.
 */
export const AUDIO_STRUCTURE_PARAMS: Readonly<Record<string, readonly string[]>> = {
  "m.audio-delay": ["max-delay-seconds"],
  "m.audio-reverb": ["tail-seconds", "decay-rate", "impulse-seed"],
  "m.audio-bitcrusher": ["bit-depth"],
};

const AUDIO_OUTPUT = defineModule({
  type: "m.audio-output",
  label: "Audio Output",
  family: "audio",
  colorToken: "audio",
  ports: [audioIn()],
  parameters: [numberParam("volume", "Volume", 0.8, 0, 1.5, 0.01), muteParam()],
  face: [section("output", "Output", [param("volume"), param(AUDIO_MUTE_PARAM)])],
});

const AUDIO_GAIN = defineModule({
  type: "m.audio-gain",
  label: "Gain",
  family: "audio",
  colorToken: "audio",
  ports: [audioIn(), audioOut()],
  parameters: [numberParam("gain", "Gain", 1, 0, 2, 0.01), muteParam()],
  face: [section("level", "Level", [param("gain"), param(AUDIO_MUTE_PARAM)])],
});

const AUDIO_DELAY = defineModule({
  type: "m.audio-delay",
  label: "Delay",
  family: "audio",
  colorToken: "audio",
  ports: [audioIn(), audioOut()],
  parameters: [
    numberParam("delay-seconds", "Time", 0.3, 0.001, 8, 0.001, "s"),
    // Bounded below unity because the loop is a multiplier: at 1.0 it never
    // decays, and above it the patch is a runaway with a friendly label.
    numberParam("feedback", "Feedback", 0.4, 0, 0.95, 0.01),
    mixParam(0.4),
    structuralParam("max-delay-seconds", "Max time", 2, 0.05, 8, 0.05, "s"),
    muteParam(),
  ],
  face: [
    section("delay", "Delay", [param("delay-seconds"), param("feedback"), param(AUDIO_MIX_PARAM)]),
    section("build", "Line", [param("max-delay-seconds"), param(AUDIO_MUTE_PARAM)]),
  ],
  // A delay line is the one audio module that may legally close a loop: it
  // advances time by construction and its feedback gain is bounded.
  feedbackBreak: { minDelayTicks: 1, maxGain: 0.95 },
});

const AUDIO_REVERB = defineModule({
  type: "m.audio-reverb",
  label: "Reverb",
  family: "audio",
  colorToken: "audio",
  ports: [audioIn(), audioOut()],
  parameters: [
    numberParam("damping-hz", "Damping", 8000, 200, 20000, 10, "Hz"),
    mixParam(0.35),
    structuralParam("tail-seconds", "Tail", 1.8, 0.05, 8, 0.05, "s"),
    structuralParam("decay-rate", "Decay", 2.5, 0.1, 20, 0.1),
    // The tail is noise, but reproducibly so: this is what makes a saved
    // project sound the way it sounded when it was saved.
    structuralParam("impulse-seed", "Seed", 1, 1, 9999),
    muteParam(),
  ],
  face: [
    section("reverb", "Reverb", [param("damping-hz"), param(AUDIO_MIX_PARAM)]),
    section("build", "Impulse", [
      param("tail-seconds"),
      param("decay-rate"),
      param("impulse-seed"),
      param(AUDIO_MUTE_PARAM),
    ]),
  ],
});

const AUDIO_EQ = defineModule({
  type: "m.audio-eq",
  label: "EQ",
  family: "audio",
  colorToken: "audio",
  ports: [audioIn(), audioOut()],
  parameters: [
    numberParam("low-gain-db", "Low", 0, -24, 24, 0.1, "dB"),
    numberParam("low-frequency", "Low freq", 200, 40, 1000, 1, "Hz"),
    numberParam("mid-gain-db", "Mid", 0, -24, 24, 0.1, "dB"),
    numberParam("mid-frequency", "Mid freq", 1000, 200, 8000, 1, "Hz"),
    numberParam("mid-q", "Mid Q", 1, 0.1, 18, 0.1),
    numberParam("high-gain-db", "High", 0, -24, 24, 0.1, "dB"),
    numberParam("high-frequency", "High freq", 5000, 1000, 16000, 1, "Hz"),
    muteParam(),
  ],
  face: [
    section("bands", "Bands", [
      param("low-gain-db"),
      param("low-frequency"),
      param("mid-gain-db"),
      param("mid-frequency"),
      param("mid-q"),
      param("high-gain-db"),
      param("high-frequency"),
    ]),
    section("state", "State", [param(AUDIO_MUTE_PARAM)]),
  ],
});

const AUDIO_COMPRESSOR = defineModule({
  type: "m.audio-compressor",
  label: "Compressor",
  family: "audio",
  colorToken: "audio",
  ports: [audioIn(), audioOut()],
  parameters: [
    numberParam("threshold-db", "Threshold", -24, -60, 0, 0.5, "dB"),
    numberParam("knee-db", "Knee", 30, 0, 40, 0.5, "dB"),
    numberParam("ratio", "Ratio", 12, 1, 20, 0.1),
    numberParam("attack-seconds", "Attack", 0.003, 0, 1, 0.001, "s"),
    numberParam("release-seconds", "Release", 0.25, 0, 1, 0.005, "s"),
    numberParam("makeup-gain", "Makeup", 1, 0, 4, 0.01),
    muteParam(),
  ],
  face: [
    section("dynamics", "Dynamics", [
      param("threshold-db"),
      param("knee-db"),
      param("ratio"),
      param("attack-seconds"),
      param("release-seconds"),
    ]),
    section("output", "Output", [param("makeup-gain"), param(AUDIO_MUTE_PARAM)]),
  ],
});

const AUDIO_LIMITER = defineModule({
  type: "m.audio-limiter",
  label: "Limiter",
  family: "audio",
  colorToken: "audio",
  ports: [audioIn(), audioOut()],
  parameters: [
    numberParam("ceiling-db", "Ceiling", -0.1, -24, 0, 0.1, "dB"),
    numberParam("release-seconds", "Release", 0.1, 0.01, 1, 0.005, "s"),
    muteParam(),
  ],
  // Knee, ratio and attack are fixed at brick-wall values inside the topology:
  // a limiter with a soft knee and a slow attack is a compressor wearing the
  // wrong name, and this module has a job to do.
  face: [section("limit", "Limit", [
    param("ceiling-db"),
    param("release-seconds"),
    param(AUDIO_MUTE_PARAM),
  ])],
});

const AUDIO_BITCRUSHER = defineModule({
  type: "m.audio-bitcrusher",
  label: "Bit Crusher",
  family: "audio",
  colorToken: "audio",
  ports: [audioIn(), audioOut()],
  parameters: [
    numberParam("tone-hz", "Tone", 8000, 200, 20000, 10, "Hz"),
    mixParam(1),
    structuralParam("bit-depth", "Bits", 8, 1, 16),
    muteParam(),
  ],
  face: [
    section("crush", "Crush", [param("bit-depth"), param("tone-hz"), param(AUDIO_MIX_PARAM)]),
    section("state", "State", [param(AUDIO_MUTE_PARAM)]),
  ],
});

export const AUDIO_MODULES: ModuleDescriptor[] = [
  AUDIO_OUTPUT,
  AUDIO_GAIN,
  AUDIO_DELAY,
  AUDIO_REVERB,
  AUDIO_EQ,
  AUDIO_COMPRESSOR,
  AUDIO_LIMITER,
  AUDIO_BITCRUSHER,
];
