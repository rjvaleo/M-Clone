import type { ScaleName } from "./music";
import type { TimeMap } from "./timemap";

/** A single step of a Pattern. An empty `pitches` array is a rest. */
export type StepEvent = {
  pitches: number[];
};

/** How a Voice traverses the steps of its Pattern. */
export type NoteOrder =
  | "original"
  | "reverse"
  | "random"
  | "random-walk"
  | "brownian";

export type NoteOrderMix = {
  original: number;
  cyclic: number;
  utterly: number;
};

export type VelocityRange = {
  low: number;
  high: number;
};

/**
 * How incoming MIDI is turned into steps (M's "Chd" Picture Matrix).
 * single — every note becomes its own step; chord — a played chord becomes one
 * step; build — a step accrues notes for as long as one of them is held.
 */
export type ChordMode = "single" | "chord" | "build";

/**
 * Where incoming MIDI lands relative to the MIDI Edit Counter (M's "Ins"
 * Picture Matrix). insert — new steps pushed in; replace — the step under the
 * counter is overwritten; overdub — notes accrue onto the existing step.
 */
export type InsertMode = "insert" | "replace" | "overdub";

/** A Pattern is the raw note material (M's core unit). */
export type Pattern = {
  id: string;
  steps: StepEvent[];
  /**
   * M's stored Cyclic Random "copy" of the Original list. This is musical
   * material, not playback cursor state: Pattern commands can copy, scramble,
   * and exchange it with `steps`.
   */
  scrambledSteps: StepEvent[];
  /** Advances whenever an explicit command replaces or rearranges the copy. */
  scrambleGeneration: number;
  /** Number of steps actually played; <= steps.length. */
  outputLength: number;
  /**
   * The Pattern Size Numerical: the ceiling the Pattern may grow to, which is
   * a storage budget rather than a length. It can never be set below the
   * number of steps the Pattern already holds.
   */
  maxSize: number;
  chordMode: ChordMode;
  insertMode: InsertMode;
  /** Drum Machine Record: the MIDI Edit Counter follows the output counter. */
  drumMachine: boolean;
};

/** Live state of one of the four Voices (a "path" through the program). */
export type VoiceState = {
  patternIndex: number; // which of the 4 patterns this voice reads
  playEnabled: boolean;
  transposition: number; // semitones (per-voice harmony)
  noteOrderMix: NoteOrderMix;
  density: number; // 0..1 probability a step sounds
  velocityRange: VelocityRange; // Accent levels 1..4 span low..high; 0 is silent
  timeBaseNumerator: number; // multiplier (slows the voice)
  timeBaseDenominator: number; // division of a whole note (4=quarter, 8=eighth)
  /** Time Distortion Map: this Voice's re-mapping of clock time to real time. */
  timeDistort: TimeMap;
  legato: number; // per-Voice multiplier over the Cyclic Legato onset percentage
  channel: number; // 1..16 MIDI output channel
  outputChannels: number[]; // Orchestration: any combination of channels 1..16
  program: number; // 0..127 program/patch
};

export type CyclicVariable = "accent" | "legato" | "rhythm";
export type CyclicLevelRange = { min: number; max: number };
/** Numbers are accepted for backward-compatible loading of existing documents. */
export type CyclicStep = number | CyclicLevelRange;
export type CyclicVariables = Record<CyclicVariable, CyclicStep[][]>;
export type CyclicPositionBanks = Record<CyclicVariable, CyclicStep[][][]>;
export type CyclicPositionLengths = Record<CyclicVariable, number[][]>;

/** The whole project (document) state. */
export type ProjectState = {
  tempo: number; // BPM
  patterns: Pattern[]; // exactly 4
  voices: VoiceState[]; // exactly 4
  root: number; // 0..11 key root pitch class
  scale: ScaleName;
  scaleSnap: boolean; // key-quantization guardrail
  seed: number; // RNG seed for reproducible performances
  diatonicTranspose?: boolean; // interpret transposition as scale steps
  secondOrderTranspose?: boolean; // stack voice transpositions cumulatively
  chordTones?: boolean; // snap final pitches to the tonic triad
  /** Five-level (0..4), 16-step modulation cycles for each voice. */
  cyclic: CyclicVariables;
  cyclicLengths: Record<CyclicVariable, number[]>;
  cyclicValues: {
    legato: number[];
    rhythm: number[];
  };
};

/** Per-voice traversal bookkeeping used while playing. */
export type NoteOrderCursor = {
  pos: number; // logical position counter
  last: number; // last index read (for no-repeat / walk)
  bval: number; // 0..1 Brownian walk position (for the "brownian" order)
};
