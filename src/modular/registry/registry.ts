import type {
  GraphPoint,
  JsonValue,
  ModuleDescriptor,
  ModuleTypeId,
  NodeId,
  NodeInstance,
  ParameterDescriptor,
} from "../model/graph";
import { CLASSIC_MODULES } from "./classicModules";
import { AUDIO_MODULES } from "./audioModules";
import { PLAYER_MODULES } from "./playerModules";
import { PRESET_SLOTS } from "./descriptorKit";

const numberParameter = (
  id: string,
  label: string,
  defaultValue: number,
  minimum: number,
  maximum: number,
  step: number,
  unit?: string,
): ParameterDescriptor => ({
  id,
  label,
  kind: "number",
  defaultValue,
  minimum,
  maximum,
  step,
  unit,
  smoothing: "linear",
  morph: "linear",
  automation: "record",
});

/**
 * The pattern a Note Editor opens with: one note every fourth step.
 *
 * Shared with the Pattern Editor compound so the two cannot drift into showing
 * different starting material for the same thing.
 */
const NOTE_PATTERN_DEFAULT = Array.from({ length: 8 }, (_, position) =>
  position === 0
    ? Array.from({ length: 16 }, (_, step) => (step % 4 === 0 ? [60 + (step / 4) * 2] : []))
    : Array.from({ length: 16 }, () => []));

const TRANSPORT: ModuleDescriptor = {
  type: "m.transport-clock",
  version: 1,
  label: "Transport Clock",
  family: "clock",
  layout: "utility",
  colorToken: "clock",
  ports: [
    { id: "tempo-in", label: "Tempo", direction: "input", signal: { kind: "control", value: "number" }, cardinality: "one" },
    { id: "transport-out", label: "Transport", direction: "output", signal: { kind: "transport", resolution: 960 }, cardinality: "many" },
    { id: "reset-out", label: "Reset", direction: "output", signal: { kind: "reset" }, cardinality: "many" },
  ],
  parameters: [
    numberParameter("tempo", "Tempo", 120, 1, 999, 1, "BPM"),
    { id: "time-signature", label: "Time signature", kind: "enum", defaultValue: "4/4", options: ["2/4", "3/4", "4/4", "5/4", "6/8", "7/8"], smoothing: "none", morph: "step-end", automation: "record" },
    { id: "metronome", label: "Metronome", kind: "boolean", defaultValue: false, smoothing: "none", morph: "step-end", automation: "record" },
    { id: "midi-clock", label: "MIDI clock", kind: "boolean", defaultValue: false, smoothing: "none", morph: "step-end", automation: "record" },
    numberParameter("sync-ratio", "Sync ratio", 1, 1, 16, 1),
  ],
  commands: [
    { id: "play", label: "Play" },
    { id: "pause", label: "Pause" },
    { id: "stop", label: "Stop" },
    { id: "sync", label: "Sync" },
    { id: "tap", label: "Tap tempo" },
  ],
  face: [
    { id: "transport", label: "Transport", elements: [
      { kind: "command", id: "play", label: "Play" },
      { kind: "command", id: "pause", label: "Pause" },
      { kind: "command", id: "stop", label: "Stop" },
      { kind: "command", id: "sync", label: "Sync" },
      { kind: "status", id: "position", label: "Bar / beat" },
    ] },
    { id: "clock", label: "Clock", elements: [
      { kind: "parameter", parameterId: "tempo" },
      { kind: "command", id: "tap", label: "Tap tempo" },
      { kind: "parameter", parameterId: "time-signature" },
      { kind: "parameter", parameterId: "sync-ratio" },
      { kind: "parameter", parameterId: "metronome" },
      { kind: "parameter", parameterId: "midi-clock" },
    ] },
  ],
};

// Time Base and Phase are the clock-domain half of one stream: Time Base turns
// the shared transport into that stream's step pulses, Phase offsets where
// those pulses land. Both are single-stream nodes with eight embedded presets,
// like every other Classic Variable.
const TIME_BASE: ModuleDescriptor = {
  type: "m.time-base",
  version: 2,
  label: "Time Base",
  family: "clock",
  layout: "compact",
  colorToken: "clock",
  ports: [
    { id: "transport-in", label: "Transport", direction: "input", signal: { kind: "transport", resolution: 960 }, cardinality: "one", required: true },
    {
      id: "reset-in",
      label: "Reset",
      direction: "input",
      signal: { kind: "reset" },
      cardinality: "many",
      mergePolicy: "first-wins",
    },
    { id: "position-in", label: "Preset position", direction: "input", signal: { kind: "control", value: "index" }, cardinality: "one" },
    { id: "clock-out", label: "Step clock", direction: "output", signal: { kind: "step-clock" }, cardinality: "many" },
  ],
  parameters: [
    numberParameter("numerator", "Numerator", 1, 1, 64, 1),
    // Zero is Classic's `sa`: the stream advances only from a Step Advance
    // module, never from the transport.
    numberParameter("denominator", "Denominator", 16, 0, 64, 1),
    { id: "preset-values", label: "Time Base presets", kind: "json",
      defaultValue: [
        { numerator: 1, denominator: 16 },
        { numerator: 1, denominator: 8 },
        { numerator: 1, denominator: 4 },
        { numerator: 1, denominator: 2 },
        { numerator: 3, denominator: 16 },
        { numerator: 3, denominator: 8 },
        { numerator: 1, denominator: 32 },
        { numerator: 1, denominator: 16 },
      ],
      smoothing: "none", morph: "step-end", automation: "record" },
    numberParameter("active-position", "Active preset", 0, 0, PRESET_SLOTS - 1, 1),
  ],
  commands: [{ id: "reset-clock", label: "Reset clock" }],
  face: [
    { id: "rate", label: "Step rate", elements: [
      { kind: "custom", id: "time-base-rate", label: "Numerator over denominator",
        parameterIds: ["numerator", "denominator"] },
      { kind: "command", id: "reset-clock", label: "Reset" },
      { kind: "status", id: "step-rate", label: "Steps per bar" },
    ] },
    { id: "presets", label: "Presets", elements: [
      { kind: "custom", id: "embedded-time-base-presets", label: "Time Base presets",
        parameterIds: ["preset-values", "active-position"],
        captures: ["numerator", "denominator"], placement: "bottom" },
    ] },
  ],
};

const PHASE: ModuleDescriptor = {
  type: "m.phase",
  version: 2,
  label: "Phase",
  family: "clock",
  layout: "compact",
  colorToken: "clock",
  ports: [
    { id: "clock-in", label: "Step clock", direction: "input", signal: { kind: "step-clock" }, cardinality: "one", required: true },
    {
      id: "reset-in",
      label: "Reset",
      direction: "input",
      signal: { kind: "reset" },
      cardinality: "many",
      mergePolicy: "first-wins",
    },
    { id: "position-in", label: "Preset position", direction: "input", signal: { kind: "control", value: "index" }, cardinality: "one" },
    { id: "clock-out", label: "Delayed clock", direction: "output", signal: { kind: "step-clock" }, cardinality: "many" },
  ],
  parameters: [
    // Phase is expressed in ticks, not in Classic's 96ths of a beat, because
    // ticks are the only canonical musical time in Modular.
    numberParameter("offset-ticks", "Offset", 0, 0, 15360, 1, "ticks"),
    { id: "preset-values", label: "Phase presets", kind: "json",
      defaultValue: [0, 120, 240, 360, 480, 600, 720, 840],
      smoothing: "none", morph: "step-end", automation: "record" },
    numberParameter("active-position", "Active preset", 0, 0, PRESET_SLOTS - 1, 1),
  ],
  commands: [{ id: "clear-offset", label: "Clear offset" }],
  face: [
    { id: "offset", label: "Start offset", elements: [
      { kind: "custom", id: "phase-offset", label: "Offset in ticks", parameterIds: ["offset-ticks"] },
      { kind: "command", id: "clear-offset", label: "Clear" },
      { kind: "status", id: "pending", label: "Pending pulses" },
    ] },
    { id: "presets", label: "Presets", elements: [
      { kind: "custom", id: "embedded-phase-presets", label: "Phase presets",
        parameterIds: ["preset-values", "active-position"],
        captures: ["offset-ticks"], placement: "bottom" },
    ] },
  ],
};

// The explicit converter the signal rules call for: a Note Order emits chosen
// steps, while every note-domain processor downstream consumes note events.
// Rather than blurring the two types, the boundary is a visible node with the
// controls that decide how a step becomes sounding notes. It is a utility, not
// a Classic Variable, so it carries no preset strip.
const STEP_TO_NOTES: ModuleDescriptor = {
  type: "m.step-to-notes",
  version: 2,
  label: "Step Notes",
  family: "routing",
  layout: "utility",
  colorToken: "order",
  ports: [
    { id: "steps-in", label: "Steps", direction: "input", signal: { kind: "step-event" }, cardinality: "one", required: true },
    { id: "velocity-in", label: "Velocity", direction: "input", signal: { kind: "control", value: "number" }, cardinality: "one" },
    { id: "gate-in", label: "Gate", direction: "input", signal: { kind: "control", value: "number" }, cardinality: "one" },
    { id: "notes-out", label: "Notes", direction: "output", signal: { kind: "note-event" }, cardinality: "many" },
  ],
  parameters: [
    numberParameter("velocity", "Velocity", 100, 1, 127, 1),
    numberParameter("gate", "Gate", 90, 1, 400, 1, "%"),
    numberParameter("channel", "Channel", 1, 1, 16, 1),
  ],
  commands: [],
  face: [
    { id: "shaping", label: "Note shaping", elements: [
      { kind: "parameter", parameterId: "velocity" },
      { kind: "parameter", parameterId: "gate" },
      { kind: "parameter", parameterId: "channel" },
      { kind: "status", id: "rate", label: "Notes per step" },
    ] },
  ],
};

const NOTE_EDITOR: ModuleDescriptor = {
  type: "m.note-editor",
  version: 2,
  label: "Note Editor",
  family: "source",
  layout: "editor",
  colorToken: "pattern",
  ports: [
    { id: "clock-in", label: "Step clock", direction: "input", signal: { kind: "step-clock" }, cardinality: "one" },
    { id: "position-in", label: "Preset position", direction: "input", signal: { kind: "control", value: "index" }, cardinality: "one" },
    { id: "record-in", label: "Record notes", direction: "input", signal: { kind: "note-event" }, cardinality: "one" },
    { id: "pattern-out", label: "Pattern", direction: "output", signal: { kind: "pattern-data" }, cardinality: "many" },
    { id: "audition-out", label: "Audition", direction: "output", signal: { kind: "note-event" }, cardinality: "many" },
  ],
  parameters: [
    { id: "preset-values", label: "Pattern presets", kind: "json",
      defaultValue: NOTE_PATTERN_DEFAULT,
      smoothing: "none", morph: "immediate", automation: "none" },
    numberParameter("active-position", "Active position", 0, 0, 7, 1),
    numberParameter("output-length", "Output length", 16, 0, 999, 1, "steps"),
    numberParameter("maximum-size", "Maximum size", 64, 1, 999, 1, "steps"),
    { id: "chord-mode", label: "Chord mode", kind: "enum", defaultValue: "single", options: ["single", "chord", "build"], smoothing: "none", morph: "step-end", automation: "none" },
    { id: "insert-mode", label: "Insert mode", kind: "enum", defaultValue: "insert", options: ["insert", "replace", "overdub"], smoothing: "none", morph: "step-end", automation: "none" },
    { id: "drum-machine", label: "Drum machine", kind: "boolean", defaultValue: false, smoothing: "none", morph: "step-end", automation: "none" },
    { id: "play-enabled", label: "Play enabled", kind: "boolean", defaultValue: true, smoothing: "none", morph: "step-end", automation: "record" },
    numberParameter("time-base-numerator", "Time base numerator", 1, 1, 64, 1),
    numberParameter("time-base-denominator", "Time base denominator", 16, 0, 64, 1),
    numberParameter("phase", "Phase", 0, 0, 999, 1, "ticks"),
    { id: "source-channel", label: "Source channel", kind: "enum", defaultValue: "all", options: ["all", ...Array.from({ length: 16 }, (_, index) => String(index + 1))], smoothing: "none", morph: "step-end", automation: "none" },
    { id: "input-use", label: "Input use", kind: "enum", defaultValue: "record", options: ["disabled", "record", "control", "keyboard-transpose", "echo-map"], smoothing: "none", morph: "step-end", automation: "none" },
    { id: "echo-input", label: "Echo input", kind: "boolean", defaultValue: false, smoothing: "none", morph: "step-end", automation: "record" },
    { id: "mouse-advance", label: "Mouse advance", kind: "boolean", defaultValue: false, smoothing: "none", morph: "step-end", automation: "record" },
  ],
  commands: [
    { id: "tool-region", label: "Region" },
    { id: "tool-eraser", label: "Eraser" },
    { id: "tool-plunger", label: "Plunger" },
    { id: "tool-scissors", label: "Scissors" },
    { id: "copy", label: "Copy" },
    { id: "paste", label: "Paste" },
    { id: "reverse", label: "Reverse" },
    { id: "rescramble", label: "ReScramble" },
  ],
  face: [
    { id: "positions", label: "Pattern positions", elements: [
      { kind: "custom", id: "position-cells", label: "Pattern position",
        parameterIds: ["preset-values", "active-position"],
        // The patterns *are* the presets, so a slot selects rather than stores.
        captures: [], placement: "top" },
    ] },
    { id: "editor", label: "Notes", elements: [
      { kind: "custom", id: "piano-roll", label: "Piano roll", parameterIds: ["preset-values"] },
      { kind: "command", id: "tool-region", label: "Region" },
      { kind: "command", id: "tool-eraser", label: "Eraser" },
      { kind: "command", id: "tool-plunger", label: "Plunger" },
      { kind: "command", id: "tool-scissors", label: "Scissors" },
      { kind: "status", id: "edit-range", label: "Edit range and counter" },
    ] },
    { id: "pattern", label: "Pattern", elements: [
      { kind: "parameter", parameterId: "output-length" },
      { kind: "parameter", parameterId: "maximum-size" },
      { kind: "parameter", parameterId: "play-enabled" },
      { kind: "parameter", parameterId: "time-base-numerator" },
      { kind: "parameter", parameterId: "time-base-denominator" },
      { kind: "parameter", parameterId: "phase" },
    ] },
    { id: "record", label: "Record / input", elements: [
      { kind: "parameter", parameterId: "chord-mode" },
      { kind: "parameter", parameterId: "insert-mode" },
      { kind: "parameter", parameterId: "drum-machine" },
      { kind: "parameter", parameterId: "source-channel" },
      { kind: "parameter", parameterId: "input-use" },
      { kind: "parameter", parameterId: "echo-input" },
      { kind: "parameter", parameterId: "mouse-advance" },
    ] },
    { id: "commands", label: "Pattern commands", elements: [
      { kind: "command", id: "copy", label: "Copy" },
      { kind: "command", id: "paste", label: "Paste" },
      { kind: "command", id: "reverse", label: "Reverse" },
      { kind: "command", id: "rescramble", label: "ReScramble" },
    ] },
  ],
};

const NOTE_DENSITY: ModuleDescriptor = {
  type: "m.note-density",
  version: 2,
  label: "Note Density",
  family: "transform",
  layout: "compact",
  colorToken: "density",
  ports: [
    { id: "notes-in", label: "Notes", direction: "input", signal: { kind: "note-event" }, cardinality: "one" },
    { id: "density-in", label: "Density", direction: "input",
      signal: { kind: "control", value: "number" }, cardinality: "one" },
    { id: "position-in", label: "Preset position", direction: "input",
      signal: { kind: "control", value: "index" }, cardinality: "one" },
    { id: "notes-out", label: "Accepted notes", direction: "output", signal: { kind: "note-event" }, cardinality: "many" },
    { id: "rejected-telemetry", label: "Rejected", direction: "output",
      signal: { kind: "telemetry", schema: "density-rejections-v1" }, cardinality: "many" },
  ],
  parameters: [
    numberParameter("density", "Note density", 57, 0, 100, 1, "%"),
    numberParameter("seed", "Random seed", 1, 0, 2147483647, 1),
    { id: "preset-values", label: "Density presets", kind: "json",
      defaultValue: [57, 55, 30, 45, 100, 35, 100, 100],
      smoothing: "none", morph: "step-end", automation: "record" },
    numberParameter("active-position", "Active preset", 0, 0, PRESET_SLOTS - 1, 1),
  ],
  commands: [
    { id: "reseed", label: "New deterministic seed" },
  ],
  face: [
    { id: "probability", label: "Probability gate", elements: [
      { kind: "custom", id: "density-slider", label: "Note density slider", parameterIds: ["density"] },
      { kind: "parameter", parameterId: "seed" },
      { kind: "command", id: "reseed", label: "Reseed" },
      { kind: "status", id: "activity", label: "Accepted / rejected" },
    ] },
    { id: "presets", label: "Presets", elements: [
      { kind: "custom", id: "embedded-number-presets", label: "Density presets",
        parameterIds: ["preset-values", "active-position"],
        captures: ["density"], placement: "bottom" },
    ] },
  ],
};

const NOTE_ORDER: ModuleDescriptor = {
  type: "m.note-order",
  version: 2,
  label: "Note Order",
  family: "transform",
  layout: "compact",
  colorToken: "order",
  ports: [
    { id: "pattern-in", label: "Pattern", direction: "input", signal: { kind: "pattern-data" }, cardinality: "one", required: true },
    { id: "clock-in", label: "Step clock", direction: "input", signal: { kind: "step-clock" }, cardinality: "one", required: true },
    {
      id: "reset-in",
      label: "Reset",
      direction: "input",
      signal: { kind: "reset" },
      cardinality: "many",
      mergePolicy: "first-wins",
    },
    { id: "position-in", label: "Preset position", direction: "input",
      signal: { kind: "control", value: "index" }, cardinality: "one" },
    { id: "steps-out", label: "Steps", direction: "output", signal: { kind: "step-event" }, cardinality: "many" },
    { id: "cursor-telemetry", label: "Cursor", direction: "output",
      signal: { kind: "telemetry", schema: "note-order-cursor-v1" }, cardinality: "many" },
  ],
  parameters: [
    numberParameter("original", "Original", 50, 0, 100, 1, "%"),
    numberParameter("cyclic", "Cyclic", 4, 0, 100, 1, "%"),
    numberParameter("utterly", "Utterly", 46, 0, 100, 1, "%"),
    { id: "preset-values", label: "Note Order presets", kind: "json",
      defaultValue: [
        { original: 100, cyclic: 0, utterly: 0 },
        { original: 0, cyclic: 100, utterly: 0 },
        { original: 0, cyclic: 0, utterly: 100 },
        { original: 50, cyclic: 50, utterly: 0 },
        { original: 50, cyclic: 4, utterly: 46 },
        { original: 0, cyclic: 50, utterly: 50 },
        { original: 100, cyclic: 0, utterly: 0 },
        { original: 100, cyclic: 0, utterly: 0 },
      ],
      smoothing: "none", morph: "step-end", automation: "record" },
    numberParameter("active-position", "Active preset", 4, 0, 7, 1),
  ],
  commands: [
    { id: "rescramble", label: "ReScramble Cyclic" },
    { id: "reset-cursor", label: "Reset cursor" },
  ],
  face: [
    { id: "mix", label: "Order mix", elements: [
      { kind: "custom", id: "note-order-mix", label: "Original, Cyclic, Utterly mix",
        parameterIds: ["original", "cyclic", "utterly"] },
      { kind: "command", id: "rescramble", label: "ReScramble" },
      { kind: "command", id: "reset-cursor", label: "Reset" },
      { kind: "status", id: "cursor", label: "Current source / step" },
    ] },
    { id: "presets", label: "Presets", elements: [
      { kind: "custom", id: "embedded-note-order-presets", label: "Note Order presets",
        parameterIds: ["preset-values", "active-position"],
        captures: ["original", "cyclic", "utterly"], placement: "bottom" },
    ] },
  ],
};

const CYCLIC_PRESETS_DEFAULT = Array.from({ length: 8 }, (_, position) =>
  Array.from({ length: 16 }, (_, step) => (step + position) % 5),
);

const CYCLIC_ACCENT: ModuleDescriptor = {
  type: "m.cyclic-accent",
  version: 1,
  label: "Cyclic Accent",
  family: "control",
  layout: "editor",
  colorToken: "order",
  ports: [
    { id: "clock-in", label: "Step clock", direction: "input", signal: { kind: "step-clock" }, cardinality: "one", required: true },
    {
      id: "reset-in",
      label: "Reset",
      direction: "input",
      signal: { kind: "reset" },
      cardinality: "many",
      mergePolicy: "first-wins",
    },
    { id: "position-in", label: "Preset position", direction: "input", signal: { kind: "control", value: "index" }, cardinality: "one" },
    { id: "accent-out", label: "Accent", direction: "output", signal: { kind: "control", value: "number" }, cardinality: "many" },
    { id: "grid-telemetry", label: "Grid telemetry", direction: "output", signal: { kind: "telemetry", schema: "cyclic-grid-v1" }, cardinality: "many" },
  ],
  parameters: [
    numberParameter("sequence-length", "Length", 16, 1, 16, 1, "steps"),
    {
      id: "preset-values",
      label: "Accent presets",
      kind: "json",
      defaultValue: CYCLIC_PRESETS_DEFAULT,
      smoothing: "none",
      morph: "step-end",
      automation: "record",
    },
    numberParameter("active-position", "Active preset", 0, 0, PRESET_SLOTS - 1, 1),
  ],
  commands: [],
  face: [
    {
      id: "grid",
      label: "Accent grid",
      elements: [
        { kind: "custom", id: "cyclic-grid", label: "16-step accent grid", parameterIds: ["preset-values", "active-position"] },
        { kind: "parameter", parameterId: "sequence-length" },
        { kind: "status", id: "cursor", label: "Current step" },
      ],
    },
  ],
};

const CYCLIC_LEGATO: ModuleDescriptor = {
  type: "m.cyclic-legato",
  version: 1,
  label: "Cyclic Legato",
  family: "control",
  layout: "editor",
  colorToken: "density",
  ports: [
    { id: "clock-in", label: "Step clock", direction: "input", signal: { kind: "step-clock" }, cardinality: "one", required: true },
    {
      id: "reset-in",
      label: "Reset",
      direction: "input",
      signal: { kind: "reset" },
      cardinality: "many",
      mergePolicy: "first-wins",
    },
    { id: "position-in", label: "Preset position", direction: "input", signal: { kind: "control", value: "index" }, cardinality: "one" },
    { id: "legato-out", label: "Legato", direction: "output", signal: { kind: "control", value: "number" }, cardinality: "many" },
    { id: "grid-telemetry", label: "Grid telemetry", direction: "output", signal: { kind: "telemetry", schema: "cyclic-grid-v1" }, cardinality: "many" },
  ],
  parameters: [
    numberParameter("sequence-length", "Length", 16, 1, 16, 1, "steps"),
    {
      id: "preset-values",
      label: "Legato presets",
      kind: "json",
      defaultValue: CYCLIC_PRESETS_DEFAULT,
      smoothing: "none",
      morph: "step-end",
      automation: "record",
    },
    numberParameter("active-position", "Active preset", 0, 0, PRESET_SLOTS - 1, 1),
  ],
  commands: [],
  face: [
    {
      id: "grid",
      label: "Legato grid",
      elements: [
        { kind: "custom", id: "cyclic-grid", label: "16-step legato grid", parameterIds: ["preset-values", "active-position"] },
        { kind: "parameter", parameterId: "sequence-length" },
        { kind: "status", id: "cursor", label: "Current step" },
      ],
    },
  ],
};

const CYCLIC_RHYTHM: ModuleDescriptor = {
  type: "m.cyclic-rhythm",
  version: 1,
  label: "Cyclic Rhythm",
  family: "clock",
  layout: "editor",
  colorToken: "clock",
  ports: [
    { id: "clock-in", label: "Step clock", direction: "input", signal: { kind: "step-clock" }, cardinality: "one", required: true },
    {
      id: "reset-in",
      label: "Reset",
      direction: "input",
      signal: { kind: "reset" },
      cardinality: "many",
      mergePolicy: "first-wins",
    },
    { id: "position-in", label: "Preset position", direction: "input", signal: { kind: "control", value: "index" }, cardinality: "one" },
    { id: "clock-out", label: "Warped clock", direction: "output", signal: { kind: "step-clock" }, cardinality: "many" },
    { id: "grid-telemetry", label: "Grid telemetry", direction: "output", signal: { kind: "telemetry", schema: "cyclic-grid-v1" }, cardinality: "many" },
  ],
  parameters: [
    numberParameter("sequence-length", "Length", 16, 1, 16, 1, "steps"),
    {
      id: "preset-values",
      label: "Rhythm presets",
      kind: "json",
      defaultValue: CYCLIC_PRESETS_DEFAULT,
      smoothing: "none",
      morph: "step-end",
      automation: "record",
    },
    numberParameter("active-position", "Active preset", 0, 0, PRESET_SLOTS - 1, 1),
  ],
  commands: [],
  face: [
    {
      id: "grid",
      label: "Rhythm grid",
      elements: [
        { kind: "custom", id: "cyclic-grid", label: "16-step rhythm grid", parameterIds: ["preset-values", "active-position"] },
        { kind: "parameter", parameterId: "sequence-length" },
        { kind: "status", id: "cursor", label: "Current step" },
      ],
    },
  ],
};

const VELOCITY_RANGE: ModuleDescriptor = {
  type: "m.velocity-range",
  version: 1,
  label: "Velocity Range",
  family: "transform",
  layout: "compact",
  colorToken: "density",
  ports: [
    { id: "notes-in", label: "Notes", direction: "input", signal: { kind: "note-event" }, cardinality: "one" },
    { id: "accent-in", label: "Accent", direction: "input", signal: { kind: "control", value: "number" }, cardinality: "one" },
    { id: "position-in", label: "Preset position", direction: "input", signal: { kind: "control", value: "index" }, cardinality: "one" },
    { id: "notes-out", label: "Notes", direction: "output", signal: { kind: "note-event" }, cardinality: "many" },
  ],
  parameters: [
    numberParameter("low", "Low velocity", 60, 1, 127, 1),
    numberParameter("high", "High velocity", 100, 1, 127, 1),
    numberParameter("accent-level", "Default accent level", 2, 0, 4, 1),
    {
      id: "preset-values",
      label: "Velocity presets",
      kind: "json",
      defaultValue: [
        { low: 30, high: 90, accent: 2 },
        { low: 40, high: 100, accent: 2 },
        { low: 50, high: 110, accent: 2 },
        { low: 60, high: 120, accent: 2 },
        { low: 45, high: 95, accent: 3 },
        { low: 55, high: 105, accent: 1 },
        { low: 35, high: 127, accent: 2 },
        { low: 70, high: 120, accent: 2 },
      ],
      smoothing: "none",
      morph: "step-end",
      automation: "record",
    },
    numberParameter("active-position", "Active preset", 0, 0, PRESET_SLOTS - 1, 1),
  ],
  commands: [],
  face: [
    {
      id: "range",
      label: "Velocity",
      elements: [
        { kind: "parameter", parameterId: "low" },
        { kind: "parameter", parameterId: "high" },
        { kind: "parameter", parameterId: "accent-level" },
      ],
    },
    {
      id: "presets",
      label: "Presets",
      elements: [
        { kind: "custom", id: "embedded-velocity-presets", label: "Velocity presets",
        parameterIds: ["preset-values", "active-position"],
        captures: ["low", "high", "accent-level"], placement: "bottom" },
      ],
    },
  ],
};

const LEGATO_PROCESSOR: ModuleDescriptor = {
  type: "m.legato-processor",
  version: 1,
  label: "Legato Processor",
  family: "transform",
  layout: "compact",
  colorToken: "order",
  ports: [
    { id: "notes-in", label: "Notes", direction: "input", signal: { kind: "note-event" }, cardinality: "one" },
    { id: "legato-in", label: "Legato", direction: "input", signal: { kind: "control", value: "number" }, cardinality: "one" },
    { id: "position-in", label: "Preset position", direction: "input", signal: { kind: "control", value: "index" }, cardinality: "one" },
    { id: "notes-out", label: "Notes", direction: "output", signal: { kind: "note-event" }, cardinality: "many" },
  ],
  parameters: [
    numberParameter("base-multiplier", "Base legato", 100, 1, 400, 1, "%"),
    numberParameter("legato-level", "Default legato level", 2, 0, 4, 1),
    {
      id: "preset-values",
      label: "Legato presets",
      kind: "json",
      defaultValue: [
        { base: 75, level: 2 },
        { base: 90, level: 2 },
        { base: 100, level: 2 },
        { base: 110, level: 2 },
        { base: 125, level: 3 },
        { base: 140, level: 3 },
        { base: 160, level: 4 },
        { base: 180, level: 4 },
      ],
      smoothing: "none",
      morph: "step-end",
      automation: "record",
    },
    numberParameter("active-position", "Active preset", 0, 0, PRESET_SLOTS - 1, 1),
  ],
  commands: [],
  face: [
    {
      id: "legato",
      label: "Legato",
      elements: [
        { kind: "parameter", parameterId: "base-multiplier" },
        { kind: "parameter", parameterId: "legato-level" },
        { kind: "status", id: "overlap", label: "Overlap" },
      ],
    },
    {
      id: "presets",
      label: "Presets",
      elements: [
        { kind: "custom", id: "embedded-legato-presets", label: "Legato presets",
        parameterIds: ["preset-values", "active-position"],
        captures: ["base-multiplier", "legato-level"], placement: "bottom" },
      ],
    },
  ],
};

const PLAY_ENABLE: ModuleDescriptor = {
  type: "m.play-enable",
  version: 1,
  label: "Play Enable",
  family: "routing",
  layout: "compact",
  colorToken: "order",
  ports: [
    { id: "notes-in", label: "Notes", direction: "input", signal: { kind: "note-event" }, cardinality: "one" },
    { id: "play-enabled-in", label: "Play enabled", direction: "input", signal: { kind: "control", value: "boolean" }, cardinality: "one" },
    { id: "position-in", label: "Preset position", direction: "input", signal: { kind: "control", value: "index" }, cardinality: "one" },
    { id: "notes-out", label: "Notes", direction: "output", signal: { kind: "note-event" }, cardinality: "many" },
  ],
  parameters: [
    { id: "play-enabled", label: "Play enabled", kind: "boolean", defaultValue: true, smoothing: "none", morph: "step-end", automation: "record" },
    {
      id: "preset-values",
      label: "Play Enable presets",
      kind: "json",
      defaultValue: [true, true, true, true, true, false, false, false],
      smoothing: "none",
      morph: "step-end",
      automation: "record",
    },
    numberParameter("active-position", "Active preset", 0, 0, PRESET_SLOTS - 1, 1),
  ],
  commands: [],
  face: [
    {
      id: "gate",
      label: "Play gate",
      elements: [
        { kind: "parameter", parameterId: "play-enabled" },
        { kind: "status", id: "muted", label: "Muted notes" },
      ],
    },
    {
      id: "presets",
      label: "Presets",
      elements: [
        { kind: "custom", id: "embedded-play-enable-presets", label: "Play Enable presets",
        parameterIds: ["preset-values", "active-position"],
        captures: ["play-enabled"], placement: "bottom" },
      ],
    },
  ],
};

const TRANSPOSITION: ModuleDescriptor = {
  type: "m.transposition",
  version: 1,
  label: "Transposition",
  family: "transform",
  layout: "compact",
  colorToken: "order",
  ports: [
    { id: "notes-in", label: "Notes", direction: "input", signal: { kind: "note-event" }, cardinality: "one" },
    { id: "transposition-in", label: "Transposition", direction: "input", signal: { kind: "control", value: "number" }, cardinality: "one" },
    { id: "scale-context-in", label: "Scale context", direction: "input", signal: { kind: "control", value: "index" }, cardinality: "one" },
    { id: "position-in", label: "Preset position", direction: "input", signal: { kind: "control", value: "index" }, cardinality: "one" },
    { id: "notes-out", label: "Notes", direction: "output", signal: { kind: "note-event" }, cardinality: "many" },
  ],
  parameters: [
    { id: "mode", label: "Mode", kind: "enum", defaultValue: "semitone", options: ["semitone", "scale-degree"], smoothing: "none", morph: "step-end", automation: "record" },
    numberParameter("semitones", "Semitones", 0, -48, 48, 1),
    numberParameter("degrees", "Scale degrees", 0, -14, 14, 1),
    numberParameter("scale-root", "Scale root", 0, 0, 11, 1),
    { id: "scale-mode", label: "Scale", kind: "enum", defaultValue: "major", options: ["major", "minor"], smoothing: "none", morph: "step-end", automation: "record" },
    {
      id: "preset-values",
      label: "Transposition presets",
      kind: "json",
      defaultValue: [
        { mode: "semitone", semitones: 0, degrees: 0, root: 0, scale: "major" },
        { mode: "semitone", semitones: 12, degrees: 0, root: 0, scale: "major" },
        { mode: "semitone", semitones: -12, degrees: 0, root: 0, scale: "major" },
        { mode: "scale-degree", semitones: 0, degrees: 1, root: 0, scale: "major" },
        { mode: "scale-degree", semitones: 0, degrees: -1, root: 0, scale: "major" },
        { mode: "semitone", semitones: 7, degrees: 0, root: 0, scale: "major" },
        { mode: "scale-degree", semitones: 0, degrees: 2, root: 9, scale: "minor" },
        { mode: "semitone", semitones: -5, degrees: 0, root: 0, scale: "major" },
      ],
      smoothing: "none",
      morph: "step-end",
      automation: "record",
    },
    numberParameter("active-position", "Active preset", 0, 0, PRESET_SLOTS - 1, 1),
  ],
  commands: [],
  face: [
    {
      id: "transpose",
      label: "Transposition",
      elements: [
        { kind: "parameter", parameterId: "mode" },
        { kind: "parameter", parameterId: "semitones" },
        { kind: "parameter", parameterId: "degrees" },
        { kind: "parameter", parameterId: "scale-root" },
        { kind: "parameter", parameterId: "scale-mode" },
      ],
    },
    {
      id: "presets",
      label: "Presets",
      elements: [
        { kind: "custom", id: "embedded-transposition-presets", label: "Transposition presets",
        parameterIds: ["preset-values", "active-position"],
        captures: ["mode", "semitones", "degrees", "scale-root", "scale-mode"], placement: "bottom" },
      ],
    },
  ],
};

const STREAM: ModuleDescriptor = {
  type: "m.stream",
  version: 1,
  label: "Stream",
  family: "routing",
  layout: "utility",
  colorToken: "clock",
  ports: [
    { id: "transport-in", label: "Transport", direction: "input", signal: { kind: "transport", resolution: 960 }, cardinality: "one", required: true },
    { id: "reset-in", label: "Reset", direction: "input", signal: { kind: "reset" }, cardinality: "many", mergePolicy: "first-wins" },
    { id: "pattern-in", label: "Pattern", direction: "input", signal: { kind: "pattern-data" }, cardinality: "one" },
    { id: "position-in", label: "Preset position", direction: "input", signal: { kind: "control", value: "index" }, cardinality: "one" },
    { id: "notes-out", label: "Notes", direction: "output", signal: { kind: "note-event" }, cardinality: "many" },
    { id: "stream-telemetry", label: "Stream telemetry", direction: "output", signal: { kind: "telemetry", schema: "stream-v1" }, cardinality: "many" },
  ],
  parameters: [
    numberParameter("active-position", "Active preset", 0, 0, PRESET_SLOTS - 1, 1),
  ],
  commands: [
    { id: "expand-stream", label: "Expand" },
  ],
  face: [
    {
      id: "stream",
      label: "Stream",
      elements: [
        { kind: "parameter", parameterId: "active-position" },
        { kind: "command", id: "expand-stream", label: "Expand" },
        { kind: "status", id: "nodes", label: "Nested modules" },
      ],
    },
  ],
};

const MIDI_OUTPUT: ModuleDescriptor = {
  type: "m.midi-output",
  version: 2,
  label: "MIDI Output",
  family: "routing",
  layout: "utility",
  colorToken: "midi",
  ports: [
    {
      id: "notes-in",
      label: "Notes",
      direction: "input",
      signal: { kind: "note-event" },
      cardinality: "many",
      mergePolicy: "ordered-by-tick",
    },
    {
      id: "midi-in",
      label: "MIDI",
      direction: "input",
      signal: { kind: "midi", protocol: "midi1" },
      cardinality: "many",
      mergePolicy: "ordered-by-tick",
    },
    { id: "monitor-telemetry", label: "Monitor", direction: "output", signal: { kind: "telemetry", schema: "midi-events-v1" }, cardinality: "many" },
  ],
  parameters: [
    { id: "device-id", label: "Device", kind: "string", defaultValue: "", smoothing: "none", morph: "immediate", automation: "none" },
    numberParameter("channel", "Channel", 1, 1, 16, 1),
    numberParameter("latency-ms", "Latency", 0, 0, 999, 1, "ms"),
    { id: "program-base", label: "Program display", kind: "enum", defaultValue: "0", options: ["0", "1"], smoothing: "none", morph: "immediate", automation: "none" },
  ],
  commands: [
    { id: "enable-midi", label: "Enable MIDI" },
    { id: "panic", label: "Panic" },
  ],
  face: [
    { id: "destination", label: "Destination", elements: [
      { kind: "parameter", parameterId: "device-id" },
      { kind: "parameter", parameterId: "channel" },
      { kind: "parameter", parameterId: "latency-ms" },
      { kind: "parameter", parameterId: "program-base" },
      { kind: "command", id: "enable-midi", label: "Enable MIDI" },
      { kind: "command", id: "panic", label: "Panic" },
      { kind: "status", id: "connection", label: "Connection state" },
    ] },
  ],
};

/**
 * The Pattern Editor: Time Base, Phase, the three Cyclic editors and the Note
 * Editor as one module.
 *
 * A compound, not a new engine — it expands at compile time into exactly the
 * nodes it stands for, wired the only way they are ever wired. Every one of
 * those modules is still available on its own; this is the shorthand for the
 * arrangement people always build.
 *
 * The one behavioural difference is the presets. Separately each part had its
 * own bank, so a stream carried five of them and no way to move between whole
 * musical ideas. Here there is a single bank, and a slot holds the pattern, all
 * three grids and their lengths, the step rate and the phase together.
 */
const PATTERN_EDITOR: ModuleDescriptor = {
  type: "m.pattern-editor",
  version: 1,
  label: "Pattern Editor",
  family: "source",
  layout: "editor",
  colorToken: "pattern",
  ports: [
    { id: "transport-in", label: "Transport", direction: "input", signal: { kind: "transport", resolution: 960 }, cardinality: "one", required: true },
    { id: "reset-in", label: "Reset", direction: "input", signal: { kind: "reset" }, cardinality: "many", mergePolicy: "first-wins" },
    { id: "position-in", label: "Preset position", direction: "input", signal: { kind: "control", value: "index" }, cardinality: "one" },
    { id: "record-in", label: "Record notes", direction: "input", signal: { kind: "note-event" }, cardinality: "one" },
    { id: "notes-out", label: "Notes", direction: "output", signal: { kind: "note-event" }, cardinality: "many" },
    { id: "clock-out", label: "Step clock", direction: "output", signal: { kind: "step-clock" }, cardinality: "many" },
    { id: "audition-out", label: "Audition", direction: "output", signal: { kind: "note-event" }, cardinality: "many" },
  ],
  parameters: [
    numberParameter("numerator", "Numerator", 1, 1, 64, 1),
    numberParameter("denominator", "Denominator", 16, 0, 64, 1),
    numberParameter("offset-ticks", "Phase", 0, 0, 15360, 1, "ticks"),
    { id: "accent-grid", label: "Accent grid", kind: "json", defaultValue: CYCLIC_PRESETS_DEFAULT, smoothing: "none", morph: "step-end", automation: "record" },
    numberParameter("accent-length", "Accent length", 16, 1, 16, 1, "steps"),
    { id: "legato-grid", label: "Legato grid", kind: "json", defaultValue: CYCLIC_PRESETS_DEFAULT, smoothing: "none", morph: "step-end", automation: "record" },
    numberParameter("legato-length", "Legato length", 16, 1, 16, 1, "steps"),
    { id: "rhythm-grid", label: "Rhythm grid", kind: "json", defaultValue: CYCLIC_PRESETS_DEFAULT, smoothing: "none", morph: "step-end", automation: "record" },
    numberParameter("rhythm-length", "Rhythm length", 16, 1, 16, 1, "steps"),
    { id: "preset-values", label: "Pattern presets", kind: "json", defaultValue: NOTE_PATTERN_DEFAULT, smoothing: "none", morph: "step-end", automation: "record" },
    numberParameter("active-position", "Active preset", 0, 0, PRESET_SLOTS - 1, 1),
    numberParameter("output-length", "Output length", 16, 1, 64, 1, "steps"),
    numberParameter("maximum-size", "Maximum size", 64, 1, 256, 1, "steps"),
    numberParameter("velocity", "Velocity", 100, 1, 127, 1),
    numberParameter("gate", "Gate", 90, 1, 200, 1, "%"),
    numberParameter("channel", "Channel", 1, 1, 16, 1),
  ],
  commands: [],
  // Six sections, no headings. Every one of them is already named by the
  // controls inside it — "Accent" above a field labelled *Accent length* — and
  // on the tallest face in the app six redundant rows are worth reclaiming.
  face: [
    { id: "presets", label: "Presets", showHeading: false, elements: [
      { kind: "custom", id: "pattern-editor-presets", label: "Pattern presets",
        parameterIds: ["preset-values", "active-position"],
        captures: [], placement: "top" },
    ] },
    { id: "clock", label: "Clock", showHeading: false, elements: [
      { kind: "parameter", parameterId: "numerator" },
      { kind: "parameter", parameterId: "denominator" },
      { kind: "parameter", parameterId: "offset-ticks" },
    ] },
    { id: "notes", label: "Notes", showHeading: false, elements: [
      { kind: "custom", id: "note-roll", label: "Piano roll", parameterIds: ["preset-values"] },
      { kind: "parameter", parameterId: "output-length" },
      { kind: "parameter", parameterId: "maximum-size" },
      { kind: "parameter", parameterId: "velocity" },
      { kind: "parameter", parameterId: "gate" },
      { kind: "parameter", parameterId: "channel" },
    ] },
    { id: "accent", label: "Accent", showHeading: false, elements: [
      { kind: "parameter", parameterId: "accent-length" },
      { kind: "custom", id: "embedded-accent-grid", label: "Accent grid", parameterIds: ["accent-grid", "active-position"] },
    ] },
    { id: "legato", label: "Legato", showHeading: false, elements: [
      { kind: "parameter", parameterId: "legato-length" },
      { kind: "custom", id: "embedded-legato-grid", label: "Legato grid", parameterIds: ["legato-grid", "active-position"] },
    ] },
    { id: "rhythm", label: "Rhythm", showHeading: false, elements: [
      { kind: "parameter", parameterId: "rhythm-length" },
      { kind: "custom", id: "embedded-rhythm-grid", label: "Rhythm grid", parameterIds: ["rhythm-grid", "active-position"] },
    ] },
  ],
};

export type ModuleRegistry = ReadonlyMap<ModuleTypeId, ModuleDescriptor>;

export const moduleRegistry: ModuleRegistry = new Map(
  [...CLASSIC_MODULES,
    ...AUDIO_MODULES,
    ...PLAYER_MODULES,
    PATTERN_EDITOR,
    TRANSPORT,
    TIME_BASE,
    PHASE,
    NOTE_EDITOR,
    NOTE_ORDER,
    STEP_TO_NOTES,
    NOTE_DENSITY,
    CYCLIC_ACCENT,
    CYCLIC_LEGATO,
    CYCLIC_RHYTHM,
    VELOCITY_RANGE,
    LEGATO_PROCESSOR,
    PLAY_ENABLE,
    TRANSPOSITION,
    STREAM,
    MIDI_OUTPUT,
  ]
    .map((descriptor) => [descriptor.type, descriptor]),
);

export function validateModuleDescriptor(descriptor: ModuleDescriptor): string[] {
  const errors: string[] = [];
  const parameterIds = new Set(descriptor.parameters.map((parameter) => parameter.id));
  const commandIds = new Set(descriptor.commands.map((command) => command.id));
  const faceParameters = new Set<string>();
  const faceCommands = new Set<string>();
  for (const section of descriptor.face) {
    for (const element of section.elements) {
      if (element.kind === "parameter") {
        if (!parameterIds.has(element.parameterId)) errors.push(`Unknown face parameter: ${element.parameterId}`);
        faceParameters.add(element.parameterId);
      }
      if (element.kind === "command") {
        if (!commandIds.has(element.id)) errors.push(`Unknown face command: ${element.id}`);
        faceCommands.add(element.id);
      }
      if (element.kind === "custom") {
        for (const parameterId of element.parameterIds ?? []) {
          if (!parameterIds.has(parameterId)) errors.push(`Unknown custom-face parameter: ${parameterId}`);
          faceParameters.add(parameterId);
        }
      }
    }
  }
  for (const parameter of parameterIds) {
    if (!faceParameters.has(parameter)) errors.push(`Parameter is hidden from node face: ${parameter}`);
  }
  for (const command of commandIds) {
    if (!faceCommands.has(command)) errors.push(`Command is hidden from node face: ${command}`);
  }
  // A feedback break that does not actually advance time, or that can boost,
  // is worse than no break at all: it turns a rejected patch into a hang or a
  // runaway. Enforce both bounds where the claim is made.
  if (descriptor.feedbackBreak) {
    const { minDelayTicks, maxGain } = descriptor.feedbackBreak;
    if (!Number.isInteger(minDelayTicks) || minDelayTicks < 1) {
      errors.push("Feedback break must delay at least one whole tick");
    }
    if (maxGain !== undefined && !(maxGain > 0 && maxGain <= 1)) {
      errors.push("Feedback break gain must be bounded to (0, 1]");
    }
  }
  const portIds = descriptor.ports.map((port) => port.id);
  for (const port of descriptor.ports) {
    if (port.cardinality === "many" && port.direction === "input" && !port.mergePolicy) {
      errors.push(`Many-input port missing merge policy: ${port.id}`);
    }
    if (port.cardinality !== "many" && port.mergePolicy) {
      errors.push(`Only many-cardinality ports may declare merge policy: ${port.id}`);
    }
    if (port.signal.kind === "telemetry" && !port.id.endsWith("-telemetry")) {
      errors.push(`Telemetry port id must end with -telemetry: ${port.id}`);
    }
    if (port.signal.kind !== "telemetry" && port.id.endsWith("-telemetry")) {
      errors.push(`Only telemetry ports may use -telemetry suffix: ${port.id}`);
    }
  }
  if (new Set(portIds).size !== portIds.length) errors.push("Duplicate port id");
  if (parameterIds.size !== descriptor.parameters.length) errors.push("Duplicate parameter id");
  if (commandIds.size !== descriptor.commands.length) errors.push("Duplicate command id");
  return errors;
}

export function createNode(
  moduleType: ModuleTypeId,
  id: NodeId,
  position: GraphPoint,
  values: Record<string, JsonValue> = {},
): NodeInstance {
  const descriptor = moduleRegistry.get(moduleType);
  if (!descriptor) throw new Error(`Unknown module type: ${moduleType}`);
  const parameters = Object.fromEntries(
    descriptor.parameters.map((parameter) => [
      parameter.id,
      structuredClone(values[parameter.id] ?? parameter.defaultValue),
    ]),
  );
  // The pad has sixteen slots and modules declare the handful they ship with,
  // so the store is padded here rather than in sixteen descriptors. Empty slots
  // are `null` and stay that way until one is shift-clicked.
  const stored = parameters["preset-values"];
  if (Array.isArray(stored) && stored.length < PRESET_SLOTS) {
    parameters["preset-values"] = Array.from({ length: PRESET_SLOTS },
      (_, index) => stored[index] ?? null) as JsonValue;
  }
  return {
    id,
    moduleType,
    moduleVersion: descriptor.version,
    label: descriptor.label,
    position: { ...position },
    parameters,
    enabled: true,
  };
}
