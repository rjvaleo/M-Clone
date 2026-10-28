/**
 * The Drum Sequencer: Numerology 4's DrumSeq (manual p119) as an idMLab
 * module — a row per pad, each a note, against a step grid with per-step
 * velocity, probability, flam and ratchet, swing, and a length per row.
 *
 * It sends notes, so it plays anything with a notes input; its default rows
 * are m.percussion's notes and the TR-909 kit's pads (drums/drumKits.ts).
 * The model is drums/drumSeq.ts, the processor runtime/drumSeqProcessor.ts,
 * the face ui/mlab/DrumSeqFace.tsx.
 */

import type { ModuleDescriptor } from "../model/graph";
import {
  boolParam,
  defineModule,
  enumParam,
  input,
  jsonParam,
  noteSignal,
  numberParam,
  output,
  resetSignal,
  transportSignal,
} from "./descriptorKit";
import { headerParams, panel } from "./mLabModules";
import { DEFAULT_TRACKS, DRUM_LANES, MAX_DRUM_ROWS, MAX_DRUM_STEPS, defaultDrumRows } from "../drums/drumSeq";

export const DRUM_SEQ_TYPE = "m.drum-seq";

const DRUM_SEQ_PARAMS = [
  jsonParam("rows", "Rows", defaultDrumRows() as never),
  numberParam("tracks", "Tracks", DEFAULT_TRACKS, 1, MAX_DRUM_ROWS, 1),
  numberParam("length", "Pattern length", 16, 1, MAX_DRUM_STEPS, 1),
  numberParam("rate-num", "Rate numerator", 1, 1, 64, 1),
  numberParam("rate-den", "Rate denominator", 16, 1, 64, 1),
  numberParam("swing", "Swing", 50, 50, 75, 1, "%"),
  numberParam("flam-level", "Flam level", 0.6, 0, 1, 0.01),
  boolParam("free", "Rows run free", false),
  boolParam("play", "Play", true),
  numberParam("seed", "Seed", 0, 0, 9999, 1),
  numberParam("channel", "MIDI Channel", 10, 1, 16, 1),
  // What the face shows: the lane under the grid, the row it edits, the first step.
  enumParam("edit-lane", "Lane shown", DRUM_LANES, "vel"),
  numberParam("edit-row", "Row edited", 0, 0, MAX_DRUM_ROWS - 1, 1),
  numberParam("scroll", "First step shown", 0, 0, MAX_DRUM_STEPS - 16, 1),
];

const DRUM_SEQ = defineModule({
  type: DRUM_SEQ_TYPE,
  label: "Drum Sequencer",
  family: "source",
  layout: "editor",
  colorToken: "pattern",
  ports: [
    input("clock-in", "Clock In", transportSignal(), { required: true }),
    input("sync-in", "Sync In", resetSignal(), { merge: "first-wins" }),
    output("notes-out", "MIDI Out", noteSignal()),
  ],
  parameters: [...headerParams(), ...DRUM_SEQ_PARAMS],
  commands: [{ id: "reset", label: "Reset" }],
  face: panel("m-drum-seq", "Drum Sequencer", DRUM_SEQ_PARAMS, ["reset"]),
});

export const DRUM_MODULES: ModuleDescriptor[] = [DRUM_SEQ];
