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
  enumParam,
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
  "m.audio-blackhole": ["line-count"],
  "m.audio-dp4-reverb": ["algorithm"],
  "m.audio-dp4-nonlin": ["variant"],
  "m.audio-dp4": [
    "source-config",
    "ab-routing",
    "cd-routing",
    "abcd-routing",
    "unit-a-algorithm",
    "unit-b-algorithm",
    "unit-c-algorithm",
    "unit-d-algorithm",
  ],
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

// ---- the two machines --------------------------------------------------------
//
// Both descriptors reproduce their manual's parameter *names* and *ranges*
// rather than inventing tidier ones. That is deliberate: the ranges are the
// part of a vintage machine that carries its character — a shelf fixed at
// 350 Hz, a decay that reaches 250 seconds, a pre-delay that stops at 2000 ms —
// and a normalised 0–1 knob in place of any of them would be a different
// instrument wearing the name.

/**
 * Blackhole — the H90's reverb.
 *
 * `[DOC]` Ten controls, and the two that are not ordinary are worth naming
 * here because the face has to explain them:
 *
 *   - **Gravity** is bipolar. Right of centre it sweeps forward decay from
 *     dense to long-and-smooth; left of centre the manual says it enters
 *     "inverse mode". This build approximates the left half — see the note in
 *     `blackhole.ts` for what that does and does not deliver.
 *   - **Feedback** carries two discrete states past its top: Infinite (endless
 *     tail, input still enters) and Freeze (endless tail, input blocked). The
 *     top 8% of the knob is divided between them.
 */
const AUDIO_BLACKHOLE = defineModule({
  type: "m.audio-blackhole",
  label: "Blackhole",
  family: "audio",
  colorToken: "audio",
  ports: [audioIn(), audioOut()],
  parameters: [
    numberParam("gravity", "Gravity", 0.5, -1, 1, 0.01),
    numberParam("size", "Size", 0.5, 0, 1, 0.01),
    // `[DOC]` "this ranges from 0 ms to 2000 ms".
    numberParam("pre-delay-seconds", "Pre delay", 0, 0, 2, 0.001, "s"),
    // `[DOC]` shelving filters with corners at 350 Hz and 2000 Hz.
    numberParam("low-level-db", "Low level", 0, -24, 12, 0.1, "dB"),
    numberParam("high-level-db", "High level", 0, -24, 12, 0.1, "dB"),
    numberParam("mod-depth", "Mod depth", 0.3, 0, 1, 0.01),
    numberParam("mod-rate", "Mod rate", 0.3, 0, 1, 0.01),
    numberParam("feedback", "Feedback", 0, 0, 1, 0.01),
    numberParam("resonance", "Resonance", 0, 0, 1, 0.01),
    mixParam(0.35),
    structuralParam("line-count", "Lines", 8, 4, 8),
    muteParam(),
  ],
  face: [
    section("space", "Space", [
      param("gravity"),
      param("size"),
      param("pre-delay-seconds"),
      param(AUDIO_MIX_PARAM),
    ]),
    section("tone", "Tone", [param("low-level-db"), param("high-level-db"), param("resonance")]),
    section("motion", "Motion", [param("mod-depth"), param("mod-rate"), param("feedback")]),
    section("build", "Network", [param("line-count"), param(AUDIO_MUTE_PARAM)]),
  ],
});

/**
 * One DP/4 reverb tank.
 *
 * `[DOC]` The decay maximum is per algorithm — 100 s for the small plate and
 * rooms, 140 s for the large plate, 150 s for the large room, **250 s for the
 * hall**. The descriptor advertises the widest of them and the core clamps to
 * whichever algorithm is loaded, because a parameter range that changes shape
 * when a structural value changes is not something the registry can express.
 */
const AUDIO_DP4_REVERB = defineModule({
  type: "m.audio-dp4-reverb",
  label: "DP/4 Reverb",
  family: "audio",
  colorToken: "audio",
  ports: [audioIn(), audioOut()],
  parameters: [
    numberParam("decay-seconds", "Decay", 2, 0.2, 250, 0.1, "s"),
    numberParam("pre-delay-seconds", "Pre delay", 0, 0, 0.5, 0.001, "s"),
    // `[DOC]` bipolar: positive lengthens the low-frequency decay, negative shortens it.
    numberParam("lf-decay", "LF decay", 0, -1, 1, 0.01),
    // `[DOC]` Damping is inside the loop; Bandwidth is on the way in. Opposite senses.
    numberParam("hf-damping", "HF damping", 0.2, 0, 1, 0.01),
    numberParam("hf-bandwidth", "HF bandwidth", 0.8, 0, 1, 0.01),
    numberParam("diffusion-1", "Diffusion 1", 0.5, 0, 1, 0.01),
    numberParam("diffusion-2", "Diffusion 2", 0.5, 0, 1, 0.01),
    numberParam("decay-definition", "Definition", 0.4, 0, 1, 0.01),
    numberParam("detune-rate", "Detune rate", 0.3, 0, 1, 0.01),
    numberParam("detune-depth", "Detune depth", 0.3, 0, 1, 0.01),
    numberParam("primary-send", "Primary send", 0.8, -1, 1, 0.01),
    numberParam("ref-1-level", "Ref 1 level", 0.3, 0, 1, 0.01),
    numberParam("ref-1-send", "Ref 1 send", 0.2, 0, 1, 0.01),
    numberParam("ref-2-level", "Ref 2 level", 0.25, 0, 1, 0.01),
    numberParam("ref-2-send", "Ref 2 send", 0.15, 0, 1, 0.01),
    numberParam("early-refs", "Early refs", 0.3, 0, 1, 0.01),
    mixParam(0.35),
    enumParam(
      "algorithm",
      "Algorithm",
      ["small-plate", "large-plate", "small-room", "large-room", "hall"],
      "large-plate",
    ),
    muteParam(),
  ],
  face: [
    section("tank", "Tank", [
      param("algorithm"),
      param("decay-seconds"),
      param("pre-delay-seconds"),
      param(AUDIO_MIX_PARAM),
    ]),
    section("tone", "Tone", [param("lf-decay"), param("hf-damping"), param("hf-bandwidth")]),
    section("diffusion", "Diffusion", [
      param("diffusion-1"),
      param("diffusion-2"),
      param("decay-definition"),
      param("detune-rate"),
      param("detune-depth"),
    ]),
    section("reflections", "Reflections", [
      param("primary-send"),
      param("ref-1-level"),
      param("ref-1-send"),
      param("ref-2-level"),
      param("ref-2-send"),
      param("early-refs"),
      param(AUDIO_MUTE_PARAM),
    ]),
  ],
});

/**
 * Non Lin — the DP/4's single-pass reverb.
 *
 * `[DOC]` "Non Lin 1, 2, and 3 pass the input signal through the reverb
 * diffusers **only once**." No feedback, so no decay parameter: the nine
 * Envelope Levels are the decay, drawn by hand. Set them descending for a gate,
 * ascending for a reverse swell, humped for a bloom.
 *
 * `[DOC]` "We recommend the average Envelope Level not to exceed a value of
 * 45" — hence the modest defaults below.
 */
const AUDIO_DP4_NONLIN = defineModule({
  type: "m.audio-dp4-nonlin",
  label: "DP/4 Non Lin",
  family: "audio",
  colorToken: "audio",
  ports: [audioIn(), audioOut()],
  parameters: [
    numberParam("envelope-1", "Env 1", 0.5, 0, 1, 0.01),
    numberParam("envelope-2", "Env 2", 0.45, 0, 1, 0.01),
    numberParam("envelope-3", "Env 3", 0.45, 0, 1, 0.01),
    numberParam("envelope-4", "Env 4", 0.4, 0, 1, 0.01),
    numberParam("envelope-5", "Env 5", 0.4, 0, 1, 0.01),
    numberParam("envelope-6", "Env 6", 0.35, 0, 1, 0.01),
    numberParam("envelope-7", "Env 7", 0.3, 0, 1, 0.01),
    // `[DOC]` "Envelope Levels 8 and 9 are positioned at the very end of the
    // Density; setting these too high can cause excessive ringing."
    numberParam("envelope-8", "Env 8", 0.2, 0, 1, 0.01),
    numberParam("envelope-9", "Env 9", 0.15, 0, 1, 0.01),
    numberParam("hf-damping", "HF damping", 0.2, 0, 1, 0.01),
    numberParam("hf-bandwidth", "HF bandwidth", 0.8, 0, 1, 0.01),
    numberParam("diffusion-1", "Diffusion 1", 0.5, 0, 1, 0.01),
    numberParam("diffusion-2", "Diffusion 2", 0.5, 0, 1, 0.01),
    numberParam("density-1", "Density 1", 0.6, 0, 1, 0.01),
    numberParam("density-2", "Density 2", 0.45, 0, 1, 0.01),
    mixParam(0.4),
    enumParam("variant", "Variant", ["non-lin-1", "non-lin-2", "non-lin-3"], "non-lin-1"),
    muteParam(),
  ],
  face: [
    section("envelope", "Envelope", [
      param("envelope-1"),
      param("envelope-2"),
      param("envelope-3"),
      param("envelope-4"),
      param("envelope-5"),
      param("envelope-6"),
      param("envelope-7"),
      param("envelope-8"),
      param("envelope-9"),
    ]),
    section("density", "Density", [
      param("variant"),
      param("density-1"),
      param("density-2"),
      param("diffusion-1"),
      param("diffusion-2"),
    ]),
    section("tone", "Tone", [
      param("hf-damping"),
      param("hf-bandwidth"),
      param(AUDIO_MIX_PARAM),
      param(AUDIO_MUTE_PARAM),
    ]),
  ],
});

/**
 * The DP/4+ itself — four units, four ins, four outs.
 *
 * The only module in the rack with more than one audio port on a side, which is
 * why `ManagedAudioNode` grew `inputFor`/`outputFor`. `[DOC]` In a 4-source
 * Config those four inputs are four independent mono paths; summing them would
 * delete the machine.
 *
 * `[DOC]` The routing matrix is 4 (AB) × 4 (CD) × 2 (AB↔CD) = **32
 * combinations**, and the two feedback modes differ only in where the dry
 * signal rejoins — which is why the manual draws 18 of the 32 and says so.
 *
 * Every routing choice and every unit's algorithm is structural: each one is a
 * different graph, so changing one rebuilds the machine behind the adapter's
 * crossfade rather than trying to ramp a topology.
 */
const AUDIO_DP4 = defineModule({
  type: "m.audio-dp4",
  label: "DP/4+",
  family: "audio",
  colorToken: "audio",
  // The only module wide enough to need the editor layout: four unit strips
  // plus a routing matrix does not fit a compact face.
  layout: "editor",
  ports: [
    input("audio-in-1", "In 1", audioSignal(1), { merge: "sum" }),
    input("audio-in-2", "In 2", audioSignal(1), { merge: "sum" }),
    input("audio-in-3", "In 3", audioSignal(1), { merge: "sum" }),
    input("audio-in-4", "In 4", audioSignal(1), { merge: "sum" }),
    output("audio-out-1", "Out 1", audioSignal(1)),
    output("audio-out-2", "Out 2", audioSignal(1)),
    output("audio-out-3", "Out 3", audioSignal(1)),
    output("audio-out-4", "Out 4", audioSignal(1)),
  ],
  parameters: [
    structuralParam("source-config", "Sources", 1, 1, 4),
    enumParam("ab-routing", "A→B", ["serial", "parallel", "feedback1", "feedback2"], "serial"),
    enumParam("cd-routing", "C→D", ["serial", "parallel", "feedback1", "feedback2"], "parallel"),
    enumParam("abcd-routing", "AB→CD", ["serial", "parallel"], "serial"),

    ...(["a", "b", "c", "d"] as const).flatMap((unit) => [
      enumParam(
        `unit-${unit}-algorithm`,
        `${unit.toUpperCase()} algorithm`,
        ["small-plate", "large-plate", "small-room", "large-room", "hall"],
        unit === "a" ? "large-plate" : unit === "b" ? "small-room" : unit === "c" ? "hall" : "small-plate",
      ),
      numberParam(`unit-${unit}-mix`, `${unit.toUpperCase()} mix`, 0.4, 0, 1, 0.01),
      numberParam(`unit-${unit}-volume`, `${unit.toUpperCase()} volume`, 0.8, 0, 1, 0.01),
      numberParam(`unit-${unit}-decay-seconds`, `${unit.toUpperCase()} decay`, 2, 0.2, 250, 0.1, "s"),
      numberParam(`unit-${unit}-pre-delay-seconds`, `${unit.toUpperCase()} pre delay`, 0, 0, 0.5, 0.001, "s"),
      numberParam(`unit-${unit}-hf-damping`, `${unit.toUpperCase()} damping`, 0.2, 0, 1, 0.01),
      numberParam(`unit-${unit}-hf-bandwidth`, `${unit.toUpperCase()} bandwidth`, 0.8, 0, 1, 0.01),
    ]),

    muteParam(),
  ],
  face: [
    section("config", "Config", [
      param("source-config"),
      param("ab-routing"),
      param("cd-routing"),
      param("abcd-routing"),
    ]),
    ...(["a", "b", "c", "d"] as const).map((unit) =>
      section(`unit-${unit}`, `Unit ${unit.toUpperCase()}`, [
        param(`unit-${unit}-algorithm`),
        param(`unit-${unit}-mix`),
        param(`unit-${unit}-volume`),
        param(`unit-${unit}-decay-seconds`),
        param(`unit-${unit}-pre-delay-seconds`),
        param(`unit-${unit}-hf-damping`),
        param(`unit-${unit}-hf-bandwidth`),
      ]),
    ),
    section("state", "State", [param(AUDIO_MUTE_PARAM)]),
  ],
});

/**
 * Stereo Widener — `MODULAR_IMPLEMENTATION_PLAN.md` §9.2 tier 5.
 *
 * Both controls ramp. `crossover` moves a filter corner rather than deciding a
 * topology, so unlike a convolver's impulse or a delay's maximum length there
 * is nothing here that has to be structural.
 */
const AUDIO_WIDENER = defineModule({
  type: "m.audio-widener",
  label: "Stereo Widener",
  family: "audio",
  colorToken: "audio",
  ports: [audioIn(), audioOut()],
  parameters: [
    numberParam("width", "Width", 1, 0, 2, 0.01, "×"),
    // Bass below here stays centred at every width. See `widener.ts` for why
    // this is not optional behaviour.
    numberParam("crossover", "Bass mono", 120, 20, 500, 1, "Hz"),
    muteParam(),
  ],
  face: [
    section("image", "Image", [param("width"), param("crossover"), param(AUDIO_MUTE_PARAM)]),
  ],
});

/**
 * Mixer — `MODULAR_IMPLEMENTATION_PLAN.md` §12 Phase 6, `AUDIO_ENGINE_SPEC.md` §15.
 *
 * Four independent inputs like the DP/4, and for the same reason: summing them
 * at one port would make the four faders decorative.
 */
const AUDIO_MIXER = defineModule({
  type: "m.audio-mixer",
  label: "Mixer",
  family: "audio",
  colorToken: "audio",
  layout: "editor",
  ports: [
    input("audio-in-1", "In 1", audioSignal(), { merge: "sum" }),
    input("audio-in-2", "In 2", audioSignal(), { merge: "sum" }),
    input("audio-in-3", "In 3", audioSignal(), { merge: "sum" }),
    input("audio-in-4", "In 4", audioSignal(), { merge: "sum" }),
    audioOut(),
  ],
  parameters: [
    ...[1, 2, 3, 4].flatMap((channel) => [
      numberParam(`level-${channel}`, `${channel} level`, 0.8, 0, 2, 0.01),
      numberParam(`pan-${channel}`, `${channel} pan`, 0, -1, 1, 0.01),
      boolParam(`mute-${channel}`, `${channel} mute`),
      boolParam(`solo-${channel}`, `${channel} solo`),
    ]),
    muteParam(),
  ],
  face: [
    ...[1, 2, 3, 4].map((channel) =>
      section(`channel-${channel}`, `Channel ${channel}`, [
        param(`level-${channel}`),
        param(`pan-${channel}`),
        param(`mute-${channel}`),
        param(`solo-${channel}`),
      ]),
    ),
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
  AUDIO_BLACKHOLE,
  AUDIO_DP4_REVERB,
  AUDIO_DP4_NONLIN,
  AUDIO_DP4,
  AUDIO_WIDENER,
  AUDIO_MIXER,
];
