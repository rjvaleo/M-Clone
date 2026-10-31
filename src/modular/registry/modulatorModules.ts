// Modulators: modules with no audio of their own that move other modules'
// knobs. See ../modulation.ts for how a mapping works.

import type { ModuleDescriptor, SignalType } from "../model/graph";
import {
  ADSR_TYPE,
  ENV_FOLLOWER_TYPE,
  LFO_COLORS,
  LFO_SHAPES,
  LFO_TYPE,
  MODULATOR_TYPE_LIST,
  SYNC_NOTES,
} from "../modulation";
import {
  boolParam,
  custom,
  defineModule,
  enumParam,
  input,
  jsonParam,
  noteSignal,
  numberParam,
  param,
  section,
} from "./descriptorKit";

/** Stereo, as every audio port in the rack is. */
const audioSignal = (): SignalType => ({ kind: "audio", channels: 2 });

/** Every modulator wears a colour and keeps the knobs it moves. */
const mapping = () => [
  enumParam("color", "Colour", LFO_COLORS.map((c) => c.name), LFO_COLORS[0].name),
  jsonParam("targets", "Mapped to", []),
];

const LFO = defineModule({
  type: LFO_TYPE,
  label: "LFO",
  family: "control",
  colorToken: "audio",
  ports: [],
  parameters: [
    numberParam("rate", "Rate", 1, 0.01, 20, 0.01, "Hz"),
    enumParam("shape", "Shape", LFO_SHAPES, "Sine"),
    // The amount sits beside the LFO and scales everything it moves.
    numberParam("amount", "Amount", 0.5, 0, 1, 0.01),
    numberParam("phase", "Phase", 0, 0, 360, 1, "°"),
    ...mapping(),
    // Off by default, so an LFO saved before Sync existed keeps its rate.
    boolParam("sync", "Sync"),
    enumParam("note", "Note", SYNC_NOTES.map((n) => n.label), "1/4"),
  ],
  face: [
    section("lfo", "LFO", [
      custom("lfo-map", "Map", ["color", "targets"]),
      param("rate"),
      param("sync"),
      param("note"),
      param("shape"),
      param("amount"),
      param("phase"),
    ]),
  ],
});

/**
 * The envelope of what is patched into it. Attack and release are the
 * compressor's, range and default, since its detector is the compressor's.
 */
const ENV_FOLLOWER = defineModule({
  type: ENV_FOLLOWER_TYPE,
  label: "Envelope follower",
  family: "control",
  colorToken: "audio",
  ports: [input("audio-in", "Audio", audioSignal(), { merge: "sum" })],
  parameters: [
    numberParam("attack-seconds", "Attack", 0.003, 0, 1, 0.001, "s"),
    // Up to four seconds, past the compressor's one, for slow swells.
    numberParam("release-seconds", "Release", 0.25, 0, 4, 0.005, "s"),
    numberParam("amount", "Amount", 0.5, 0, 1, 0.01),
    ...mapping(),
  ],
  face: [
    section("follower", "Follower", [
      custom("lfo-map", "Map", ["color", "targets"]),
      param("attack-seconds"),
      param("release-seconds"),
      param("amount"),
    ]),
  ],
});

/**
 * An ADSR on a gate: notes open it. Attack, decay, sustain and release take the
 * synth's amp envelope's ranges and defaults.
 */
const ADSR = defineModule({
  type: ADSR_TYPE,
  label: "ADSR",
  family: "control",
  colorToken: "audio",
  ports: [input("notes-in", "Notes", noteSignal(), { merge: "ordered-by-tick" })],
  parameters: [
    numberParam("attack-ms", "Attack", 10, 0, 4000, 1, "ms"),
    numberParam("decay-ms", "Decay", 150, 0, 4000, 1, "ms"),
    numberParam("sustain", "Sustain", 0.7, 0, 1, 0.01),
    numberParam("release-ms", "Release", 250, 0, 8000, 1, "ms"),
    numberParam("amount", "Amount", 0.5, 0, 1, 0.01),
    // Up: the envelope. Down: its negative. Both: centred, −amount at rest to +amount at the top.
    enumParam("polarity", "Polarity", ["Up", "Down", "Both"], "Up"),
    // How much velocity sets the peak, by the synth's squared law; 0 ignores it.
    numberParam("velocity", "Velocity", 0, 0, 1, 0.01),
    ...mapping(),
  ],
  face: [
    section("adsr", "ADSR", [
      custom("lfo-map", "Map", ["color", "targets"]),
      param("attack-ms"),
      param("decay-ms"),
      param("sustain"),
      param("release-ms"),
      param("amount"),
      param("polarity"),
      param("velocity"),
    ]),
  ],
});

export const MODULATOR_MODULES: ModuleDescriptor[] = [LFO, ENV_FOLLOWER, ADSR];

/** The modulators the audio plan carries, so the engine can build them. */
export const MODULATOR_TYPES: ReadonlySet<string> = new Set(MODULATOR_TYPE_LIST);
