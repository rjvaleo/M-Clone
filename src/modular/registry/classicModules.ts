/**
 * The rest of Classic M, decomposed into modules.
 *
 * Everything here comes from the catalogue in `MODULAR_IMPLEMENTATION_PLAN.md`
 * §7.4–§7.6. Each one is a single-stream node with its complete working face
 * and, where the original workflow used preset views, eight embedded positions.
 *
 * Grouped by signal domain rather than by Classic screen, because that is how
 * they are wired: clock modules decide *when*, step modules decide *which*,
 * control modules decide *how much*, and note modules shape the note itself.
 */

import type { ModuleDescriptor } from "../model/graph";
import {
  boolParam,
  command,
  custom,
  defineModule,
  enumParam,
  indexSignal,
  input,
  jsonParam,
  midiSignal,
  noteSignal,
  numberParam,
  numberSignal,
  output,
  param,
  patternSignal,
  positionInput,
  presetParams,
  presetSection,
  resetInput,
  resetSignal,
  section,
  status,
  stepClockSignal,
  stepEventSignal,
  stringParam,
  telemetryOutput,
  transportSignal,
} from "./descriptorKit";

const CHANNELS = ["all", ...Array.from({ length: 16 }, (_, i) => String(i + 1))];
const SCALES = ["major", "minor", "dorian", "phrygian", "lydian", "mixolydian", "locrian", "chromatic"];
const ROOTS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

// ---- clock and transport ---------------------------------------------------

/**
 * Classic's Sync Ratio and restart relationships. Divides the transport and
 * emits a reset every N units, which is how independent streams are brought
 * back into agreement without stopping.
 */
const SYNC_DIVIDER = defineModule({
  type: "m.sync-divider",
  label: "Sync Divider",
  family: "clock",
  colorToken: "clock",
  ports: [
    input("transport-in", "Transport", transportSignal(), { required: true }),
    output("reset-out", "Reset", resetSignal()),
    output("transport-out", "Transport", transportSignal()),
    telemetryOutput("cycle-telemetry", "Cycle", "sync-cycle-v1"),
  ],
  parameters: [
    numberParam("ratio", "Ratio", 4, 1, 64),
    enumParam("unit", "Unit", ["bars", "beats", "steps"], "bars"),
    boolParam("enabled", "Enabled", true),
  ],
  commands: [{ id: "restart", label: "Restart now" }],
  face: [
    section("sync", "Sync", [
      param("ratio"), param("unit"), param("enabled"),
      command("restart", "Restart now"), status("cycle", "Next reset"),
    ]),
  ],
});

/** Classic's `sa`: a stream advanced by hand, key or MIDI rather than by tempo. */
const STEP_ADVANCE = defineModule({
  type: "m.step-advance",
  label: "Step Advance",
  family: "clock",
  colorToken: "clock",
  ports: [
    input("trigger-in", "Trigger", numberSignal()),
    resetInput(),
    output("clock-out", "Step clock", stepClockSignal()),
    telemetryOutput("advance-telemetry", "Advance", "step-advance-v1"),
  ],
  parameters: [
    numberParam("step-ticks", "Step length", 240, 1, 15360, 1, "ticks"),
    boolParam("from-keyboard", "Keyboard advance", true),
  ],
  commands: [{ id: "advance", label: "Advance" }],
  face: [
    section("advance", "Manual advance", [
      command("advance", "Advance"), param("step-ticks"), param("from-keyboard"),
      status("count", "Steps advanced"),
    ]),
  ],
});

/** Tap four times and the transport takes the tempo you tapped. */
const TAP_TEMPO = defineModule({
  type: "m.tap-tempo",
  label: "Tap Tempo",
  family: "clock",
  layout: "utility",
  colorToken: "clock",
  ports: [
    input("trigger-in", "Tap", numberSignal()),
    output("tempo-out", "Tempo", numberSignal()),
  ],
  parameters: [
    numberParam("taps", "Taps to average", 4, 2, 16),
    numberParam("timeout-ms", "Reset after", 2000, 250, 8000, 50, "ms"),
  ],
  commands: [{ id: "tap", label: "Tap" }],
  face: [
    section("tap", "Tap", [
      command("tap", "Tap"), param("taps"), param("timeout-ms"),
      status("tempo", "Detected tempo"),
    ]),
  ],
});

/** Classic's hardware clock output, as its own node rather than a checkbox. */
const MIDI_CLOCK_ENCODER = defineModule({
  type: "m.midi-clock-encoder",
  label: "MIDI Clock",
  family: "clock",
  layout: "utility",
  colorToken: "midi",
  ports: [
    input("transport-in", "Transport", transportSignal(), { required: true }),
    output("midi-out", "MIDI", midiSignal()),
  ],
  parameters: [
    boolParam("send-clock", "Send clock", true),
    boolParam("send-transport", "Send start/stop", true),
    numberParam("ratio", "Sync ratio", 1, 1, 16),
  ],
  commands: [],
  face: [
    section("clock", "Clock output", [
      param("send-clock"), param("send-transport"), param("ratio"),
      status("pulses", "Pulses sent"),
    ]),
  ],
});

/** One named reset shared by every cyclic module that should restart together. */
const RESET_TRIGGER = defineModule({
  type: "m.reset-trigger",
  label: "Reset Trigger",
  family: "clock",
  layout: "utility",
  colorToken: "clock",
  ports: [
    input("transport-in", "Transport", transportSignal()),
    input("trigger-in", "Trigger", numberSignal()),
    output("reset-out", "Reset", resetSignal()),
  ],
  parameters: [
    enumParam("source", "Source", ["manual", "transport-start", "every-bar"], "manual"),
    stringParam("name", "Group name", "reset"),
  ],
  commands: [{ id: "fire", label: "Reset now" }],
  face: [
    section("reset", "Reset", [
      command("fire", "Reset now"), param("source"), param("name"),
      status("last", "Last reset"),
    ]),
  ],
});

/**
 * Classic's Time Distortion map: eight stored curves that pull a stream's steps
 * away from even time without changing how many there are.
 */
const TIME_DISTORTION = defineModule({
  type: "m.time-distortion",
  label: "Time Distortion",
  family: "clock",
  layout: "editor",
  colorToken: "clock",
  ports: [
    input("clock-in", "Step clock", stepClockSignal(), { required: true }),
    resetInput(),
    positionInput(),
    output("clock-out", "Warped clock", stepClockSignal()),
    telemetryOutput("map-telemetry", "Map", "time-distortion-v1"),
  ],
  parameters: [
    ...presetParams(
      "Distortion maps",
      Array.from({ length: 8 }, () => Array.from({ length: 16 }, () => 1)),
    ),
    numberParam("depth", "Depth", 100, 0, 200, 1, "%"),
  ],
  commands: [{ id: "flatten", label: "Flatten map" }],
  face: [
    section("map", "Distortion map", [
      custom("time-distortion-map", "16-point time map", ["preset-values", "active-position"]),
      param("depth"), command("flatten", "Flatten map"), status("cursor", "Current point"),
    ]),
  ],
});

// ---- note-domain variables -------------------------------------------------

/** Classic Orchestration: which destinations a stream's notes are sent to. */
const ORCHESTRATION = defineModule({
  type: "m.orchestration",
  label: "Orchestration",
  family: "transform",
  colorToken: "density",
  ports: [
    input("notes-in", "Notes", noteSignal()),
    positionInput(),
    output("notes-out", "Notes", noteSignal()),
  ],
  parameters: [
    ...presetParams(
      "Destination presets",
      Array.from({ length: 8 }, () => [1]),
    ),
    jsonParam("channels", "Channels", [1]),
    enumParam("spread", "Spread", ["all", "round-robin", "random"], "all"),
  ],
  commands: [],
  face: [
    section("destinations", "Destinations", [
      custom("orchestration-channels", "Sixteen destinations", ["channels"]),
      param("spread"), status("active", "Active destinations"),
    ]),
    presetSection("embedded-orchestration-presets", "Orchestration presets", ["channels", "spread"]),
  ],
});

/** Classic Sound / Program Choice: the instrument each stream asks for. */
const SOUND_CHOICE = defineModule({
  type: "m.sound-choice",
  label: "Sound Choice",
  family: "transform",
  colorToken: "midi",
  ports: [
    input("notes-in", "Notes", noteSignal()),
    positionInput(),
    output("notes-out", "Notes", noteSignal()),
    output("midi-out", "Program", midiSignal()),
  ],
  parameters: [
    ...presetParams("Program presets", Array.from({ length: 8 }, (_, i) => i)),
    numberParam("program", "Program", 0, 0, 127),
    numberParam("bank", "Bank", 0, 0, 127),
    boolParam("send-on-recall", "Send on recall", true),
  ],
  commands: [{ id: "send-program", label: "Send program" }],
  face: [
    section("sound", "Sound", [
      param("program"), param("bank"), param("send-on-recall"),
      command("send-program", "Send program"), status("current", "Current program"),
    ]),
    presetSection("embedded-sound-presets", "Sound presets", ["program", "bank"]),
  ],
});

// ---- harmony ---------------------------------------------------------------

/** The shared key and scale other harmony modules read. */
const SCALE_CONTEXT = defineModule({
  type: "m.scale-context",
  label: "Scale Context",
  family: "control",
  layout: "utility",
  colorToken: "order",
  ports: [
    input("root-in", "Root", numberSignal()),
    positionInput(),
    output("scale-out", "Scale context", indexSignal()),
  ],
  parameters: [
    enumParam("root", "Root", ROOTS, "C"),
    enumParam("scale", "Scale", SCALES, "major"),
  ],
  commands: [],
  face: [
    section("key", "Key", [param("root"), param("scale"), status("notes", "Scale notes")]),
  ],
});

/** Classic Scale Snap: pull every note onto the current scale. */
const SCALE_QUANTIZER = defineModule({
  type: "m.scale-quantizer",
  label: "Scale Quantizer",
  family: "transform",
  colorToken: "order",
  ports: [
    input("notes-in", "Notes", noteSignal()),
    input("scale-in", "Scale context", indexSignal()),
    output("notes-out", "Notes", noteSignal()),
  ],
  parameters: [
    enumParam("root", "Root", ROOTS, "C"),
    enumParam("scale", "Scale", SCALES, "major"),
    enumParam("direction", "Snap direction", ["nearest", "down", "up"], "nearest"),
    boolParam("enabled", "Enabled", true),
  ],
  commands: [],
  face: [
    section("snap", "Scale snap", [
      param("root"), param("scale"), param("direction"), param("enabled"),
      status("snapped", "Notes moved"),
    ]),
  ],
});

/** Classic Chord Tones: pull notes onto the tonic triad rather than the scale. */
const CHORD_QUANTIZER = defineModule({
  type: "m.chord-quantizer",
  label: "Chord Tones",
  family: "transform",
  colorToken: "order",
  ports: [
    input("notes-in", "Notes", noteSignal()),
    input("scale-in", "Scale context", indexSignal()),
    output("notes-out", "Notes", noteSignal()),
  ],
  parameters: [
    enumParam("root", "Root", ROOTS, "C"),
    enumParam("chord", "Chord", ["triad", "seventh", "power", "sus4"], "triad"),
    boolParam("enabled", "Enabled", true),
  ],
  commands: [],
  face: [
    section("chord", "Chord tones", [
      param("root"), param("chord"), param("enabled"), status("snapped", "Notes moved"),
    ]),
  ],
});

/**
 * Classic Second-Order Transpose, without the fixed four lanes: each stream
 * adds the transpositions of the streams before it, building implied chords.
 */
const CUMULATIVE_TRANSPOSE = defineModule({
  type: "m.cumulative-transpose",
  label: "Cumulative Transpose",
  family: "control",
  layout: "utility",
  colorToken: "order",
  ports: [
    input("transposition-in", "Incoming", numberSignal()),
    output("transposition-out", "Accumulated", numberSignal()),
  ],
  parameters: [
    numberParam("semitones", "This stage", 0, -48, 48),
    boolParam("enabled", "Accumulate", true),
  ],
  commands: [{ id: "clear", label: "Clear chain" }],
  face: [
    section("stack", "Transpose stack", [
      param("semitones"), param("enabled"), command("clear", "Clear chain"),
      status("total", "Accumulated"),
    ]),
  ],
});

// ---- routing ---------------------------------------------------------------

/** Fan one note stream out to several destinations. */
const EVENT_SPLITTER = defineModule({
  type: "m.event-splitter",
  label: "Event Splitter",
  family: "routing",
  layout: "utility",
  colorToken: "midi",
  ports: [
    input("notes-in", "Notes", noteSignal()),
    output("a-out", "A", noteSignal()),
    output("b-out", "B", noteSignal()),
    output("c-out", "C", noteSignal()),
    output("d-out", "D", noteSignal()),
  ],
  parameters: [
    enumParam("mode", "Mode", ["copy", "round-robin", "by-pitch"], "copy"),
    numberParam("split-point", "Split point", 60, 0, 127),
  ],
  commands: [],
  face: [
    section("split", "Split", [
      param("mode"), param("split-point"), status("routed", "Routed"),
    ]),
  ],
});

/**
 * The explicit cross-lane merge. Fan-in is only legal where a module declares
 * how to combine, and this is that module: everything is ordered by tick so the
 * result is deterministic regardless of which stream arrived first.
 */
const EVENT_MERGER = defineModule({
  type: "m.event-merger",
  label: "Event Merger",
  family: "routing",
  layout: "utility",
  colorToken: "midi",
  ports: [
    input("notes-in", "Notes", noteSignal(), { merge: "ordered-by-tick" }),
    output("notes-out", "Notes", noteSignal()),
  ],
  parameters: [
    enumParam("collision", "On collision", ["keep-both", "highest-velocity", "first"], "keep-both"),
  ],
  commands: [],
  face: [
    section("merge", "Merge", [param("collision"), status("merged", "Streams merged")]),
  ],
});

/** Channel reassignment independent of Orchestration's preset destinations. */
const CHANNEL_MAPPER = defineModule({
  type: "m.channel-mapper",
  label: "Channel Mapper",
  family: "routing",
  layout: "utility",
  colorToken: "midi",
  ports: [
    input("notes-in", "Notes", noteSignal()),
    output("notes-out", "Notes", noteSignal()),
  ],
  parameters: [
    numberParam("from-channel", "From", 1, 1, 16),
    numberParam("to-channel", "To", 1, 1, 16),
    boolParam("pass-others", "Pass others", true),
  ],
  commands: [],
  face: [
    section("map", "Channel map", [
      param("from-channel"), param("to-channel"), param("pass-others"),
      status("mapped", "Notes mapped"),
    ]),
  ],
});

// ---- MIDI input side -------------------------------------------------------

/** The live Web MIDI source. Device selection is per node, not global. */
const MIDI_INPUT = defineModule({
  type: "m.midi-input",
  label: "MIDI Input",
  family: "routing",
  layout: "utility",
  colorToken: "midi",
  ports: [
    output("midi-out", "MIDI", midiSignal()),
    telemetryOutput("monitor-telemetry", "Monitor", "midi-events-v1"),
  ],
  parameters: [
    stringParam("device-id", "Device", ""),
    boolParam("enabled", "Enabled", true),
  ],
  commands: [{ id: "enable-midi", label: "Enable MIDI" }],
  face: [
    section("source", "Source", [
      param("device-id"), param("enabled"), command("enable-midi", "Enable MIDI"),
      status("connection", "Connection state"),
    ]),
  ],
});

/** Classic's per-path Source setting: which channel this stream listens to. */
const SOURCE_CHANNEL_FILTER = defineModule({
  type: "m.source-channel-filter",
  label: "Source Channel",
  family: "routing",
  layout: "utility",
  colorToken: "midi",
  ports: [
    input("midi-in", "MIDI", midiSignal(), { merge: "ordered-by-tick" }),
    output("midi-out", "MIDI", midiSignal()),
  ],
  parameters: [enumParam("channel", "Channel", CHANNELS, "all")],
  commands: [],
  face: [
    section("filter", "Filter", [param("channel"), status("passed", "Messages passed")]),
  ],
});

/** Turns incoming MIDI performance into the normalized note events everything else speaks. */
const MIDI_NOTE_DECODER = defineModule({
  type: "m.midi-note-decoder",
  label: "MIDI Note Decoder",
  family: "routing",
  layout: "utility",
  colorToken: "midi",
  ports: [
    input("midi-in", "MIDI", midiSignal(), { merge: "ordered-by-tick" }),
    output("notes-out", "Notes", noteSignal()),
    telemetryOutput("held-telemetry", "Held notes", "midi-held-v1"),
  ],
  parameters: [
    boolParam("use-sustain", "Follow sustain", true),
    numberParam("default-length", "Default length", 240, 1, 15360, 1, "ticks"),
  ],
  commands: [],
  face: [
    section("decode", "Decode", [
      param("use-sustain"), param("default-length"), status("held", "Notes held"),
    ]),
  ],
});

/** Program change and the supported channel-mode messages. */
const PROGRAM_MESSAGE = defineModule({
  type: "m.program-message",
  label: "Program Message",
  family: "routing",
  layout: "utility",
  colorToken: "midi",
  ports: [
    input("trigger-in", "Trigger", numberSignal()),
    output("midi-out", "MIDI", midiSignal()),
  ],
  parameters: [
    numberParam("program", "Program", 0, 0, 127),
    numberParam("channel", "Channel", 1, 1, 16),
    enumParam("mode", "Channel mode", ["none", "all-notes-off", "reset-controllers", "omni-on", "omni-off"], "none"),
  ],
  commands: [{ id: "send", label: "Send" }],
  face: [
    section("message", "Message", [
      param("program"), param("channel"), param("mode"),
      command("send", "Send"), status("sent", "Last sent"),
    ]),
  ],
});

/** Classic's Midi View: a bounded window on what is actually flowing. */
const MIDI_MONITOR = defineModule({
  type: "m.midi-monitor",
  label: "MIDI Monitor",
  family: "routing",
  layout: "editor",
  colorToken: "midi",
  ports: [
    input("midi-in", "MIDI", midiSignal(), { merge: "ordered-by-tick" }),
    input("notes-in", "Notes", noteSignal(), { merge: "ordered-by-tick" }),
  ],
  parameters: [
    numberParam("capacity", "Rows", 200, 20, 2000, 10),
    boolParam("paused", "Paused", false),
  ],
  commands: [{ id: "clear", label: "Clear" }],
  face: [
    section("monitor", "Monitor", [
      custom("midi-monitor-list", "Event list"),
      param("capacity"), param("paused"), command("clear", "Clear"),
      status("rate", "Events per second"),
    ]),
  ],
});

// ---- conducting ------------------------------------------------------------

/** Classic's Conducting Grid and Baton, as a control source. */
const CONDUCTING_XY = defineModule({
  type: "m.conducting-xy",
  label: "Conducting Surface",
  family: "control",
  layout: "editor",
  colorToken: "order",
  ports: [
    input("x-in", "X", numberSignal()),
    input("y-in", "Y", numberSignal()),
    output("x-out", "X", numberSignal()),
    output("y-out", "Y", numberSignal()),
    telemetryOutput("baton-telemetry", "Baton", "conducting-baton-v1"),
  ],
  parameters: [
    enumParam("polarity", "Polarity", ["unipolar", "bipolar"], "bipolar"),
    numberParam("smoothing-ms", "Smoothing", 80, 0, 1000, 10, "ms"),
    boolParam("hold", "Hold position", false),
  ],
  commands: [{ id: "centre", label: "Centre" }],
  face: [
    section("surface", "Surface", [
      custom("conducting-surface", "Six by six grid"),
      param("polarity"), param("smoothing-ms"), param("hold"),
      command("centre", "Centre"), status("position", "X / Y"),
    ]),
  ],
});

/** Turns a conducting coordinate into an a–h slot for every preset module. */
const POSITION_CONDUCTOR = defineModule({
  type: "m.position-conductor",
  label: "Position Conductor",
  family: "control",
  layout: "utility",
  colorToken: "order",
  ports: [
    input("value-in", "Value", numberSignal()),
    output("position-out", "Position", indexSignal()),
  ],
  parameters: [
    numberParam("low", "Lowest slot", 0, 0, 7),
    numberParam("high", "Highest slot", 7, 0, 7),
    enumParam("direction", "Direction", ["forward", "reverse"], "forward"),
  ],
  commands: [],
  face: [
    section("mapping", "Slot mapping", [
      param("low"), param("high"), param("direction"), status("slot", "Current slot"),
    ]),
  ],
});

/** Shapes a raw control into the range and curve a parameter wants. */
const CONTINUOUS_MAPPER = defineModule({
  type: "m.continuous-mapper",
  label: "Continuous Mapper",
  family: "control",
  layout: "utility",
  colorToken: "order",
  ports: [
    input("value-in", "Value", numberSignal()),
    output("value-out", "Value", numberSignal()),
  ],
  parameters: [
    numberParam("out-low", "Output low", 0, -1000, 1000),
    numberParam("out-high", "Output high", 100, -1000, 1000),
    enumParam("curve", "Curve", ["linear", "exponential", "logarithmic"], "linear"),
    boolParam("invert", "Invert", false),
  ],
  commands: [],
  face: [
    section("shape", "Shape", [
      param("out-low"), param("out-high"), param("curve"), param("invert"),
      status("value", "Current value"),
    ]),
  ],
});

/** Conducted tempo: a control becomes BPM for the Transport Clock. */
const TEMPO_CONDUCTOR = defineModule({
  type: "m.tempo-conductor",
  label: "Tempo Conductor",
  family: "control",
  layout: "utility",
  colorToken: "clock",
  ports: [
    input("value-in", "Value", numberSignal()),
    output("tempo-out", "Tempo", numberSignal()),
  ],
  parameters: [
    numberParam("min-bpm", "Slowest", 60, 1, 999),
    numberParam("max-bpm", "Fastest", 180, 1, 999),
    numberParam("smoothing-ms", "Smoothing", 200, 0, 2000, 10, "ms"),
  ],
  commands: [],
  face: [
    section("range", "Tempo range", [
      param("min-bpm"), param("max-bpm"), param("smoothing-ms"),
      status("tempo", "Conducted tempo"),
    ]),
  ],
});

/** Any MIDI controller becomes a control signal for any compatible input. */
const CC_MAPPER = defineModule({
  type: "m.cc-mapper",
  label: "CC Mapper",
  family: "control",
  layout: "utility",
  colorToken: "midi",
  ports: [
    input("midi-in", "MIDI", midiSignal(), { merge: "ordered-by-tick" }),
    output("value-out", "Value", numberSignal()),
    output("gate-out", "Gate", indexSignal()),
  ],
  parameters: [
    numberParam("controller", "Controller", 1, 0, 127),
    enumParam("channel", "Channel", CHANNELS, "all"),
    numberParam("out-low", "Output low", 0, -1000, 1000),
    numberParam("out-high", "Output high", 100, -1000, 1000),
  ],
  commands: [{ id: "learn", label: "Learn" }],
  face: [
    section("controller", "Controller", [
      param("controller"), param("channel"), param("out-low"), param("out-high"),
      command("learn", "Learn"), status("value", "Current value"),
    ]),
  ],
});

// ---- pattern ---------------------------------------------------------------

/** Classic's Single / Chord / Build recording, and the Insert / Replace / Overdub modes. */
const PATTERN_RECORDER = defineModule({
  type: "m.pattern-recorder",
  label: "Pattern Recorder",
  family: "source",
  colorToken: "pattern",
  ports: [
    input("notes-in", "Notes", noteSignal()),
    input("transport-in", "Transport", transportSignal()),
    resetInput(),
    output("pattern-out", "Pattern", patternSignal()),
    telemetryOutput("record-telemetry", "Recording", "pattern-record-v1"),
  ],
  parameters: [
    enumParam("chord-mode", "Chord mode", ["single", "chord", "build"], "single"),
    enumParam("insert-mode", "Insert mode", ["insert", "replace", "overdub"], "insert"),
    boolParam("armed", "Armed", false),
    numberParam("length", "Length", 16, 1, 999, 1, "steps"),
  ],
  commands: [
    { id: "record", label: "Record" },
    { id: "clear", label: "Clear" },
  ],
  face: [
    section("record", "Record", [
      command("record", "Record"), command("clear", "Clear"),
      param("armed"), param("chord-mode"), param("insert-mode"), param("length"),
      status("state", "Recorder state"),
    ]),
  ],
});

/** Scramble, reverse, rotate and the region commands, applied to pattern material. */
const PATTERN_COMMANDS = defineModule({
  type: "m.pattern-commands",
  label: "Pattern Commands",
  family: "source",
  colorToken: "pattern",
  ports: [
    input("pattern-in", "Pattern", patternSignal(), { required: true }),
    output("pattern-out", "Pattern", patternSignal()),
  ],
  parameters: [
    numberParam("rotate-by", "Rotate by", 1, -64, 64),
    numberParam("region-start", "Region start", 1, 1, 999),
    numberParam("region-end", "Region end", 16, 1, 999),
  ],
  commands: [
    { id: "scramble", label: "Scramble" },
    { id: "reverse", label: "Reverse" },
    { id: "rotate", label: "Rotate" },
    { id: "swap", label: "Swap original" },
  ],
  face: [
    section("commands", "Commands", [
      command("scramble", "Scramble"), command("reverse", "Reverse"),
      command("rotate", "Rotate"), command("swap", "Swap original"),
      param("rotate-by"), param("region-start"), param("region-end"),
      status("applied", "Last command"),
    ]),
  ],
});

/** Classic's Play Enable as a step-domain gate, before notes are ever built. */
const STEP_GATE = defineModule({
  type: "m.step-gate",
  label: "Step Gate",
  family: "routing",
  colorToken: "order",
  ports: [
    input("steps-in", "Steps", stepEventSignal(), { required: true }),
    input("enabled-in", "Enabled", numberSignal()),
    positionInput(),
    output("steps-out", "Steps", stepEventSignal()),
  ],
  parameters: [
    ...presetParams("Gate presets", Array.from({ length: 8 }, () => true)),
    boolParam("enabled", "Enabled", true),
  ],
  commands: [],
  face: [
    section("gate", "Step gate", [param("enabled"), status("passed", "Steps passed")]),
    presetSection("embedded-step-gate-presets", "Step Gate presets", ["enabled"]),
  ],
});

export const CLASSIC_MODULES: ModuleDescriptor[] = [
  SYNC_DIVIDER,
  STEP_ADVANCE,
  TAP_TEMPO,
  MIDI_CLOCK_ENCODER,
  RESET_TRIGGER,
  TIME_DISTORTION,
  ORCHESTRATION,
  SOUND_CHOICE,
  SCALE_CONTEXT,
  SCALE_QUANTIZER,
  CHORD_QUANTIZER,
  CUMULATIVE_TRANSPOSE,
  EVENT_SPLITTER,
  EVENT_MERGER,
  CHANNEL_MAPPER,
  MIDI_INPUT,
  SOURCE_CHANNEL_FILTER,
  MIDI_NOTE_DECODER,
  PROGRAM_MESSAGE,
  MIDI_MONITOR,
  CONDUCTING_XY,
  POSITION_CONDUCTOR,
  CONTINUOUS_MAPPER,
  TEMPO_CONDUCTOR,
  CC_MAPPER,
  PATTERN_RECORDER,
  PATTERN_COMMANDS,
  STEP_GATE,
];
