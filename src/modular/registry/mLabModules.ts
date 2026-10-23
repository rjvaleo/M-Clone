/**
 * The M modules: M built from Numerology 4's modules.
 *
 * Each is a Numerology module type carrying one of M's windows:
 *
 *   M NoteSeq    — a MonoNote/PolyNote sequencer that is one voice of M:
 *                  its Pattern, Cyclic Variables, Note Order and randomness
 *   M Time Warp  — a CV Sequencer drawing one voice's Time Distortion
 *   M Variables  — M's own Variables window: every Variable's six
 *                  Positions in miniature, its arrow, and snapshots a–z
 *   M Conductor  — M's Conducting window: the transport, the tempo range,
 *                  Tap and Sync, and the baton pad (plus two more X-Y pads)
 *   M Orchestra  — MatrixSeq rows of channels against voices, and Sound Choice
 *
 * As in Numerology there is one sequencer per voice: four voices of M are four
 * M NoteSeqs. Each keeps its own Time Distortion as a Warp lane; an M Time
 * Warp cabled into Warp In takes over from it.
 *
 * Every face is custom (src/modular/ui/mlab), drawn with the Numerology kit in
 * src/modular/ui/n4; every parameter a face edits is listed on its custom
 * element so validation can see it.
 */

import type { ModuleDescriptor, ParameterDescriptor } from "../model/graph";
import {
  boolParam,
  custom,
  defineModule,
  enumParam,
  input,
  jsonParam,
  noteSignal,
  numberParam,
  numberSignal,
  output,
  resetSignal,
  section,
  stringParam,
  timeMapSignal,
  transportSignal,
} from "./descriptorKit";
import { SCALES } from "../../engine/music";
import { createDefaultProject } from "../../engine/project";
import { defaultCyclePositions, defaultCycleValues, defaultOrchestration, defaultPrograms } from "../mlab/model";
import { defaultVariables } from "../mlab/variables";
import { MAX_SEQ_STEPS, SEQ_DIRECTIONS, defaultCellLengths, defaultCells, defaultNoteSeqPatterns } from "../mlab/noteSeq";
import { GENERATORS } from "../mlab/generate";
import { DEFAULT_EVOLVE } from "../mlab/evolve";
import { defaultWarpBanks } from "../mlab/warpSteps";

export const M_LAB_TYPES = {
  noteSeq: "m.lab-noteseq",
  timeWarp: "m.lab-time-warp",
  variables: "m.lab-variables",
  conductor: "m.lab-conductor",
  orchestra: "m.lab-orchestra",
} as const;

const project = createDefaultProject();
const QUANTIZE = ["now", "beat", "bar"] as const;

/** The header every Numerology module has: a comment, and its minimize state. */
const headerParams = (): ParameterDescriptor[] => [
  stringParam("comment", "Comment", "..."),
  boolParam("collapsed", "Minimized", false),
  boolParam("advanced", "Advanced settings open", false),
  // The preset manager: up to 99 snapshots; the first six are slots a–f.
  jsonParam("presets", "Presets", []),
  numberParam("preset-slot", "Preset slot in play", -1, -1, 5, 1),
];
const HEADER_IDS = ["comment", "collapsed", "advanced", "presets", "preset-slot"];

/** A module whose whole face is one custom Numerology panel. */
const panel = (id: string, label: string, parameters: ParameterDescriptor[], commands: string[] = []) => [
  { ...section("panel", label, [custom(id, label, [...HEADER_IDS, ...parameters.map((p) => p.id)], commands)]), showHeading: false },
];

/* ===== M NoteSeq ===== */

const NOTESEQ_PARAMS = [
  numberParam("voice", "Voice", 1, 1, 8, 1),
  numberParam("channel", "MIDI Channel", 1, 1, 16, 1),
  jsonParam("patterns", "Patterns a–f", defaultNoteSeqPatterns() as never),
  numberParam("group", "Pattern Group", 0, 0, 5, 1),
  numberParam("start", "Start Step", 0, 0, MAX_SEQ_STEPS - 1, 1),
  jsonParam("skip", "Skip", []),
  jsonParam("select", "Select", []),
  jsonParam("mute", "Mute", []),
  jsonParam("rnd-jump", "Random Jump", []),
  jsonParam("velocity", "Velocity", []),
  jsonParam("cells", "Cyclic cells", defaultCells() as never),
  jsonParam("cycle-lengths", "Cycle lengths", defaultCellLengths() as never),
  jsonParam("cycle-positions", "Cycle positions", defaultCyclePositions() as never),
  jsonParam("cycle-values", "Level values", defaultCycleValues() as never),
  numberParam("rate-num", "Rate numerator", 1, 1, 64, 1),
  numberParam("rate-den", "Rate denominator", 8, 1, 64, 1),
  enumParam("dir", "Dir", SEQ_DIRECTIONS, "fwd"),
  enumParam("h-sync", "H.Sync", ["none", "1", "2", "4", "8", "16"], "none"),
  enumParam("run-mode", "Run Mode", ["normal", "manual", "cv-gated", "cv-step"], "normal"),
  boolParam("play", "Play", true),
  boolParam("mute-all", "Mute", false),
  jsonParam("note-order", "Note Order", { original: 100, cyclic: 0, utterly: 0 }),
  numberParam("density", "Density", 1, 0, 1, 0.01),
  numberParam("vel-low", "Velocity Low", 48, 1, 127, 1),
  numberParam("vel-high", "Velocity High", 110, 1, 127, 1),
  numberParam("transposition", "Transposition", 0, -48, 48, 1),
  numberParam("octave", "Octave", 0, -4, 4, 1),
  numberParam("legato", "Gate Adj (Legato)", 1, 0, 2, 0.01),
  numberParam("key", "Key", project.root, 0, 11, 1),
  enumParam("scale", "Scale", Object.keys(SCALES), project.scale),
  boolParam("scale-snap", "Scale Snap", project.scaleSnap),
  boolParam("diatonic", "Diatonic Transpose", project.diatonicTranspose ?? false),
  boolParam("chord-tones", "Chord Tones", project.chordTones ?? false),
  enumParam("generate", "Generate", GENERATORS.map((g) => g.id), "rescramble"),
  boolParam("preserve-rests", "Don't Scramble Rests", false),
  jsonParam("evolve", "Evolve", DEFAULT_EVOLVE as never),
  boolParam("evolve-auto", "Auto Evolve", false),
  enumParam("pitch-view", "Pitch list", ["orig", "scram"], "orig"),
  numberParam("scroll", "First step shown", 0, 0, MAX_SEQ_STEPS - 1, 1),
  // The Warp lane: this voice's own Time Distortion, used when no M Time Warp
  // is cabled into Warp In.
  jsonParam("warp", "Time Distortion a–f", defaultWarpBanks() as never),
  numberParam("warp-position", "Time Distortion position", 0, 0, 5, 1),
  numberParam("warp-amount", "Time Distortion amount", 1, 0, 1, 0.01),
];

const M_NOTESEQ = defineModule({
  type: M_LAB_TYPES.noteSeq,
  label: "M NoteSeq",
  family: "m",
  layout: "editor",
  colorToken: "pattern",
  ports: [
    input("clock-in", "Clock In", transportSignal(), { required: true }),
    input("sync-in", "Sync In", resetSignal(), { merge: "first-wins" }),
    input("trig-in", "Trig In", numberSignal()),
    input("warp-in", "Warp In", timeMapSignal()),
    input("interval-in", "Interval In", numberSignal()),
    input("velocity-in", "Velocity In", numberSignal()),
    output("notes-out", "MIDI Out", noteSignal()),
    output("gate-out", "Gate Out", numberSignal()),
    output("velocity-out", "Velocity Out", numberSignal()),
    output("interval-out", "Interval Out", numberSignal()),
  ],
  parameters: [...headerParams(), ...NOTESEQ_PARAMS],
  face: panel("m-lab-noteseq", "M Note Sequencer", NOTESEQ_PARAMS),
});

/* ===== M Time Warp (CV Sequencer) ===== */

const WARP_PARAMS = [
  jsonParam("banks", "Time Distortion a–f", defaultWarpBanks() as never),
  numberParam("position", "Time Distortion position", 0, 0, 5, 1),
  numberParam("amount", "Amount", 1, 0, 1, 0.01),
];

const M_TIME_WARP = defineModule({
  type: M_LAB_TYPES.timeWarp,
  label: "M Time Warp",
  family: "m",
  layout: "editor",
  colorToken: "clock",
  // State, not events: a NoteSeq reads the curve through its Warp In.
  ports: [output("warp-out", "Warp Out", timeMapSignal())],
  parameters: [...headerParams(), ...WARP_PARAMS],
  face: panel("m-lab-time-warp", "Time Warp", WARP_PARAMS),
});

/* ===== M Variables (M's Variables window) ===== */

const VARIABLES_PARAMS = [
  jsonParam("tables", "Position values", defaultVariables().tables as never),
  jsonParam("active", "Active positions", defaultVariables().active as never),
  jsonParam("arrows", "Conducting arrows", defaultVariables().arrows as never),
  jsonParam("marks", "Marks", defaultVariables().marks as never),
  jsonParam("snapshots", "Snapshots", defaultVariables().snapshots as never),
  enumParam("snapshot-quantize", "Quantize", QUANTIZE, "now"),
];

const M_VARIABLES_MODULE = defineModule({
  type: M_LAB_TYPES.variables,
  label: "M Variables",
  family: "m",
  layout: "editor",
  colorToken: "density",
  // No cables: it writes each variable's current position into the modules
  // that hold it, which is how M's Variables window works.
  ports: [],
  parameters: [...headerParams(), ...VARIABLES_PARAMS],
  face: panel("m-lab-variables", "Variables", VARIABLES_PARAMS),
});

/* ===== M Conductor (M's Conducting window) ===== */

const ARROWS = ["off", "right", "down", "left", "up"] as const;

const CONDUCTOR_PARAMS = [
  numberParam("tempo", "Tempo", project.tempo, 20, 300, 1, "BPM"),
  numberParam("tempo-low", "Tempo low", 110, 20, 300, 1, "BPM"),
  numberParam("tempo-high", "Tempo high", 130, 20, 300, 1, "BPM"),
  enumParam("tempo-arrow", "Conduct tempo", ARROWS, "off"),
  numberParam("bar-length", "Bar Length", 4, 1, 16, 1),
  enumParam("tap-conduct", "Tap Conduct", ["off", "held"], "off"),
  enumParam("sync-quantize", "Sync On", QUANTIZE, "now"),
  jsonParam("pads", "X-Y pads", Array.from({ length: 3 }, () => ({ x: 0, y: 0, glide: 0 }))),
  boolParam("extra-pads", "Show pads 2 and 3", false),
];

const M_CONDUCTOR = defineModule({
  type: M_LAB_TYPES.conductor,
  label: "M Conductor",
  family: "m",
  layout: "editor",
  colorToken: "clock",
  ports: [
    output("transport-out", "Transport", transportSignal()),
    output("sync-out", "Sync", resetSignal()),
    output("run-out", "Run", numberSignal()),
    ...[1, 2, 3].flatMap((n) => [
      output(`x${n}-out`, `X ${n}`, numberSignal()),
      output(`y${n}-out`, `Y ${n}`, numberSignal()),
    ]),
  ],
  parameters: [...headerParams(), ...CONDUCTOR_PARAMS],
  commands: [
    { id: "play", label: "Play" },
    { id: "stop", label: "Stop" },
    { id: "sync", label: "Sync" },
    { id: "tap", label: "Tap" },
  ],
  face: panel("m-lab-conductor", "Conductor", CONDUCTOR_PARAMS, ["play", "stop", "sync", "tap"]),
});

/* ===== M Orchestra (Matrix rows) ===== */

const ORCHESTRA_PARAMS = [
  jsonParam("orchestration", "Orchestration", defaultOrchestration() as never),
  jsonParam("programs", "Sound Choice", defaultPrograms() as never),
  numberParam("position", "Orchestration position", 0, 0, 5, 1),
  numberParam("sound-position", "Sound Choice position", 0, 0, 5, 1),
  enumParam("program-numbering", "Program numbers", ["0-127", "1-128"], "1-128"),
  jsonParam("muted", "Channel mutes", Array(16).fill(false)),
];

const M_ORCHESTRA = defineModule({
  type: M_LAB_TYPES.orchestra,
  label: "M Orchestra",
  family: "m",
  layout: "editor",
  colorToken: "midi",
  ports: [
    // Every voice's NoteSeq cables in here; notes from all of them interleave by time.
    input("notes-in", "MIDI In", noteSignal(), { required: true, merge: "ordered-by-tick" }),
    ...Array.from({ length: 16 }, (_, i) => output(`channel-${i + 1}-out`, `Ch ${i + 1}`, noteSignal())),
  ],
  parameters: [...headerParams(), ...ORCHESTRA_PARAMS],
  face: panel("m-lab-orchestra", "Orchestration", ORCHESTRA_PARAMS),
});

export const M_LAB_MODULES: ModuleDescriptor[] = [
  M_CONDUCTOR, M_NOTESEQ, M_TIME_WARP, M_VARIABLES_MODULE, M_ORCHESTRA,
];
