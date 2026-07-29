import type { ScaleName } from "./music";

/** A single step of a Pattern. An empty `pitches` array is a rest. */
export type StepEvent = {
  pitches: number[];
};

/** How a Voice traverses the steps of its Pattern. */
export type NoteOrder = "original" | "reverse" | "random" | "random-walk";

/** A Pattern is the raw note material (M's core unit). */
export type Pattern = {
  id: string;
  steps: StepEvent[];
  /** Number of steps actually played; <= steps.length. */
  outputLength: number;
};

/** Live state of one of the four Voices (a "path" through the program). */
export type VoiceState = {
  patternIndex: number; // which of the 4 patterns this voice reads
  playEnabled: boolean;
  transposition: number; // semitones (per-voice harmony)
  noteOrder: NoteOrder;
  density: number; // 0..1 probability a step sounds
  velocity: number; // base MIDI velocity 0..127
  timeBaseNumerator: number; // multiplier (slows the voice)
  timeBaseDenominator: number; // division of a whole note (4=quarter, 8=eighth)
  legato: number; // gate length as a fraction of the step (0..~1.5)
  channel: number; // 1..16 MIDI output channel
  program: number; // 0..127 program/patch
};

/** The whole project (document) state. */
export type ProjectState = {
  tempo: number; // BPM
  patterns: Pattern[]; // exactly 4
  voices: VoiceState[]; // exactly 4
  root: number; // 0..11 key root pitch class
  scale: ScaleName;
  scaleSnap: boolean; // key-quantization guardrail
  seed: number; // RNG seed for reproducible performances
};

/** Per-voice traversal bookkeeping used while playing. */
export type NoteOrderCursor = {
  pos: number; // logical position counter
  last: number; // last index read (for no-repeat / walk)
};
