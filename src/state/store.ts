// Central app state (zustand). Holds the project document, the Variable
// Positions layer, snapshots, and a bit of UI state. All mutations are
// immutable so React and the engine read consistent snapshots. The engine
// reads `project` live, which is what makes "ride the sliders while it plays"
// work — positions apply by writing into the live voice fields.

import { create } from "zustand";
import type {
  CyclicVariable,
  CyclicPositionBanks,
  CyclicPositionLengths,
  Pattern,
  ProjectState,
  StepEvent,
  VoiceState,
} from "../engine/types";
import type { ScaleName } from "../engine/music";
import { createDefaultProject } from "../engine/project";
import {
  type DecodeResult,
  type ProjectDocumentV2,
  decodeDocument,
  encodeDocument,
} from "../engine/document";
import { mergeStartupState } from "../engine/startup";
import { applyPatternGroup } from "../engine/patterngroup";
import {
  DEFAULT_OPTIONS,
  setOption as setOptionValue,
  type OptionId,
  type Options,
} from "../engine/options";
import {
  makePresetPositions,
  makeEmptyVariableMarks,
  applyActivePositions,
  applyPosition,
  setSlot,
  transferPosition,
  transferPositionVoice,
  POSITION_COUNT,
  POSITION_VARS,
  type VariablePositions,
  type VariableMarks,
  type PositionVarId,
  type PositionValue,
} from "../engine/variables";
import {
  type ArrowState,
  type ArrowDir,
  type Snapshot,
  type SnapshotInclusion,
  QUANTIZE_VALUES,
  applySnapshot,
  captureSnapshot,
  snapshotIncludes,
} from "../engine/snapshot";
import {
  EMPTY_SLIDESHOW,
  IDLE_SLIDESHOW_TRANSPORT,
  addSlideshowAction,
  addSlideshowLoop,
  advanceSlideshow as advanceSlideshowState,
  beginSlideshowPlayback,
  beginSlideshowRecording,
  finishSlideshowRecording,
  pauseSlideshow as pauseSlideshowState,
  resumeSlideshow as resumeSlideshowState,
  type Slideshow,
  type SlideshowTransport,
} from "../engine/slideshow";
import { scrambleSteps } from "../engine/patterncmd";
import {
  axisValue,
  clampBaton,
  conductedTempo,
  continuousLegato,
  continuousVelocityRange,
  normalizeTempoRange,
  positionFromBaton,
  robotMove,
  type BatonPoint,
  type TempoRange,
} from "../engine/conductor";
import { normalizeCyclicStep } from "../engine/cyclic";
import {
  eventsForPlannedNotes,
  MIDI_VIEW_LIMIT,
  mergeMidiViewEvents,
  type MidiViewEvent,
  type MidiViewTransport,
} from "../engine/midiview";
import type { PlannedNote, PlannedStep } from "../engine/planner";
import type { ChannelMidiMessage, MidiInputVoice } from "../engine/midiinput";
import { applyRecordedNotes, routeMidiNote } from "../engine/midiinput";
import {
  decodeInputControl,
  inputControlCode,
  whiteKeyValue,
  type InputControlCode,
} from "../engine/inputcontrol";
import {
  EMPTY_MOVIE_RECORDER,
  armMovie,
  captureMovieNotes,
  finishMovie,
  type MovieRecorder,
} from "../engine/movie";
import {
  createDefaultSynthSettings,
  normalizeSynthSettings,
  type SynthSettings,
} from "../engine/synth";

/** 26 Snapshot locations, one per letter key A-Z. */
export const SNAPSHOT_COUNT = 26;
/**
 * Hard ceiling the Pattern Size Numerical can be raised to — "You can have
 * up to 999 notes in a Pattern."
 */
export const MAX_PATTERN_STEPS = 999;

export type MidiInputResponse =
  | { type: "echo"; voice: number; note: number; velocity: number; channels?: number[] }
  | { type: "start" | "stop" | "sync" }
  | { type: "step"; voice: number; note: number; velocity: number };

function isPositionVar(key: keyof VoiceState): key is PositionVarId {
  return (POSITION_VARS as string[]).includes(key as string);
}

/** Keep M's stored Cyclic Random copy coherent after an Original-list edit. */
function withRegeneratedScramble(
  pattern: Pattern,
  steps: StepEvent[],
  projectSeed: number,
  patternIndex: number,
  preserveRests = false,
): Pattern {
  const generation = pattern.scrambleGeneration + 1;
  const seed = projectSeed + patternIndex * 997 + generation * 7919;
  return {
    ...pattern,
    steps,
    scrambledSteps: scrambleSteps(steps, seed, preserveRests),
    scrambleGeneration: generation,
  };
}

/**
 * The document the app opens with: the shipped Variable Positions, with each
 * Variable's active Position already pushed into the live voice fields so the
 * windows, the Variables miniatures and the engine all agree from the first
 * frame.
 */
function freshDocument(): { project: ProjectState; positions: VariablePositions } {
  const project = createDefaultProject();
  const positions = makePresetPositions();
  return {
    project: { ...project, voices: applyActivePositions(project.voices, positions) },
    positions,
  };
}

/**
 * Put a Snapshot back onto the state. Variable Positions are re-activated by
 * index, so each one reads whatever lives there *now* — the manual is explicit
 * that a Snapshot stores the Position, not its contents.
 */
function executeSnapshot(
  s: MStore,
  snap: Snapshot,
): Partial<MStore> {
  let positions = s.positions;
  for (const id of POSITION_VARS) {
    if (!snapshotIncludes(snap, "actives", id)) continue;
    const active = snap.actives[id];
    if (active === undefined) continue;
    positions = { ...positions, [id]: { ...positions[id], active } };
  }
  const nextGroup = snapshotIncludes(snap, "patternGroup")
    ? snap.patternGroup : s.patternGroup;
  let project = applySnapshot(applyPatternGroup(s.project, nextGroup), snap);
  let activeCyclicPositions = s.activeCyclicPositions;
  for (const kind of ["accent", "legato", "rhythm"] as CyclicVariable[]) {
    if (!snapshotIncludes(snap, "cyclicActives", kind)) continue;
    const active = snap.cyclicActives?.[kind];
    if (active === undefined) continue;
    activeCyclicPositions = { ...activeCyclicPositions, [kind]: active };
    project = {
      ...project,
      cyclic: {
        ...project.cyclic,
        [kind]: s.cyclicPositions[kind][active].map((voice) => [...voice]),
      },
      cyclicLengths: {
        ...project.cyclicLengths,
        [kind]: [...s.cyclicLengths[kind][active]],
      },
    };
  }
  return {
    project: { ...project, voices: applyActivePositions(project.voices, positions) },
    selectedPatternIndices: [project.voices[s.selectedVoice].patternIndex],
    positions,
    activeCyclicPositions,
    arrows: snap.included
      ? Object.fromEntries([
          ...Object.entries((s as MStore).arrows),
          ...Object.entries(snap.arrows)
            .filter(([id]) => snapshotIncludes(snap, "arrows", id))
            .map(([id, value]) => [id, { ...value }]),
        ])
      : Object.fromEntries(Object.entries(snap.arrows).map(([k, v]) => [k, { ...v }])),
    patternGroup: nextGroup,
  };
}

const nowSeconds = () => performance.now() / 1000;
const emptyInclusion = (): SnapshotInclusion => ({
  actives: [], cyclicActives: [], arrows: [], playEnabled: [], timeBase: [], outputLength: [],
  patternGroup: false,
});
const everythingInclusion = (): SnapshotInclusion => ({
  actives: [...POSITION_VARS],
  cyclicActives: ["accent", "legato", "rhythm"],
  arrows: [],
  playEnabled: [0, 1, 2, 3],
  timeBase: [0, 1, 2, 3],
  outputLength: [0, 1, 2, 3],
  patternGroup: true,
});

function toggleIncluded<T extends string | number>(values: T[], value: T): T[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

export type MStore = {
  project: ProjectState;
  positions: VariablePositions;
  snapshots: (Snapshot | null)[];
  /** The Snapshot most recently stored or executed — the "black mark in the sun". */
  currentSnapshot: number | null;
  /** State captured just before the last execution, for Restore From Snapshot. */
  restorePoint: Snapshot | null;
  /** Snapshot Quantization: 0 is the wave, meaning no quantization. */
  snapshotQuantize: number;
  snapshotMode: "idle" | "holding" | "editing";
  snapshotDraft: Snapshot | null;
  slideshows: Slideshow[];
  slideshowTransport: SlideshowTransport;
  /** Which Variables are armed for Conducting; captured by Snapshots. */
  arrows: Record<string, ArrowState>;
  /** The active Pattern Group (a-f); captured by Snapshots. */
  patternGroup: number;
  selectedVoice: number;
  isPlaying: boolean;
  editingVar: PositionVarId | null;
  midiConduct: boolean;
  robotConductor: boolean;
  isPaused: boolean;
  baton: BatonPoint;
  tempoRange: TempoRange;
  syncRatio: 1 | 2 | 4 | 8 | 16;
  syncRatioDirection: "out" | "in";
  robotRange: BatonPoint;
  robotTimeBase: 1 | 2 | 4 | 8 | 16;
  continuousConducting: ContinuousConducting;
  setContinuousConducting: (
    kind: ContinuousKind, voice: number, enabled: boolean, direction?: ArrowDir,
  ) => void;
  clearContinuousConducting: () => void;
  cyclicPositions: CyclicPositionBanks;
  cyclicLengths: CyclicPositionLengths;
  activeCyclicPositions: Record<CyclicVariable, number>;
  midiViewEvents: MidiViewEvent[];
  /** Transport messages in either direction, shown alongside the notes. */
  midiViewTransport: MidiViewTransport[];
  recordMidiTransport: (
    type: "start" | "stop" | "continue", direction: "out" | "in", atSec: number,
  ) => void;
  midiViewNextId: number;
  movieRecorder: MovieRecorder;
  synthSettings: SynthSettings[];
  cyclicResetEpochs: number[];
  signalCyclicReset: (voices: readonly number[]) => void;
  midiEditRange: { from: number; to: number };
  midiEditCounter: number;
  midiHeldNotes: number[][];
  midiChordNotes: number[][];
  inputControlCode: InputControlCode | null;
  inputControlTapAt: number | null;
  stepAdvanceCounters: number[];
  setMidiEditState: (range: { from: number; to: number }, counter: number) => void;
  setVoiceInput: (voice: number, values: Partial<Pick<VoiceState,
    "sourceChannel" | "inputUse" | "echoInput" | "mouseAdvance">>) => void;
  setMidiAssignment: (
    side: "inputs" | "outputs", row: number,
    value: { deviceId: string | null; channel: number },
  ) => void;
  setMidiAssignmentConfig: (value: Partial<ProjectState["midiAssignments"]>) => void;
  toggleEchoMapChannel: (channel: number) => void;
  receiveMidi: (message: ChannelMidiMessage) => MidiInputResponse[];
  advanceMouseVoices: (velocity: number) => MidiInputResponse[];

  setTempo: (bpm: number) => void;
  setPlaying: (playing: boolean) => void;
  selectVoice: (index: number) => void;
  selectedPatternIndices: number[];
  selectPattern: (patternIndex: number, additive?: boolean) => void;
  toggleVoiceEnabled: (index: number) => void;
  setVoiceParam: <K extends keyof VoiceState>(
    index: number,
    key: K,
    value: VoiceState[K],
  ) => void;
  toggleStepPitch: (patternIndex: number, stepIndex: number, pitch: number) => void;
  paintStep: (patternIndex: number, stepIndex: number, pitch: number, on: boolean) => void;
  setOutputLength: (patternIndex: number, length: number) => void;
  setPatternMaxSize: (patternIndex: number, size: number) => void;
  /** Eraser: turn every step in [from, to] into a rest, keeping the length. */
  eraseRegion: (patternIndex: number, from: number, to: number) => void;
  /** Plunger: push `count` blank steps in ahead of `at`. */
  insertSteps: (patternIndex: number, at: number, count: number) => void;
  /** Scissors: cut [from, to] out, shortening the Pattern. */
  deleteRegion: (patternIndex: number, from: number, to: number) => void;
  setPatternMode: <K extends "chordMode" | "insertMode" | "drumMachine">(
    patternIndex: number,
    key: K,
    value: Pattern[K],
  ) => void;
  /**
   * Run a Pattern or Edit menu command over a Pattern's steps. The command
   * itself is a pure function from the patterncmd module; this just applies it
   * and keeps the Output Length honest afterwards.
   */
  runPatternCommand: (
    patternIndex: number,
    command: (steps: StepEvent[], maxSize: number) => StepEvent[],
  ) => void;
  /** Run a command that intentionally transforms Original and Scrambled. */
  runPatternDocumentCommand: (
    patternIndex: number,
    command: (pattern: Pattern) => Pattern,
  ) => void;
  /** File name the piece was last saved or opened as, or null if untitled. */
  documentName: string | null;
  /** Whether the music has changed since the last save, open, or New. */
  isDirty: boolean;
  /** Bumped whenever the document is wholesale replaced. */
  documentEpoch: number;
  /** Record a successful save under `name`. */
  markSaved: (name: string) => void;
  /** Capture the whole musical document for saving. */
  exportDocument: () => ProjectDocumentV2;
  /**
   * Replace the live musical state from a document. Returns the decode result
   * so the caller can report a bad file or surface repair warnings.
   */
  importDocument: (raw: unknown, name?: string) => DecodeResult;
  /** Discard the piece and start again from the shipped defaults. */
  newDocument: (startup?: unknown) => void;
  /** The Edit menu clipboard, holding copied steps. */
  clipboard: StepEvent[];
  setClipboard: (steps: StepEvent[]) => void;
  patternClipboard: Pattern | null;
  setPatternClipboard: (pattern: Pattern | null) => void;
  /** The Options menu, chapter 22. Saved with the document. */
  options: Options;
  setOption: (id: OptionId, on: boolean) => void;
  /**
   * The Region selected in the Pattern Editor's grid.
   *
   * This lives in the store rather than in the editor window because M's Edit
   * and Pattern menus are global but act on the current selection — the menu
   * bar has to be able to see it. `point` marks a Pointwise Selection, the
   * click-without-drag that only Insert Paste accepts.
   */
  editorRegion: { from: number; to: number; point: boolean } | null;
  setEditorRegion: (region: { from: number; to: number; point: boolean } | null) => void;
  setScaleSnap: (on: boolean) => void;
  setScale: (scale: ScaleName) => void;
  setRoot: (root: number) => void;
  setSeed: (seed: number) => void;
  setDiatonicTranspose: (on: boolean) => void;
  setSecondOrderTranspose: (on: boolean) => void;
  setChordTones: (on: boolean) => void;
  setCyclicLevel: (
    kind: CyclicVariable,
    voiceIndex: number,
    stepIndex: number,
    level: number,
  ) => void;
  setCyclicPositionLevel: (
    kind: CyclicVariable, position: number, voice: number, step: number, level: number,
  ) => void;
  setCyclicPositionRange: (
    kind: CyclicVariable, position: number, voice: number, step: number,
    fromLevel: number, toLevel: number,
  ) => void;
  activateCyclicPosition: (kind: CyclicVariable, position: number) => void;
  setCyclicLength: (
    kind: CyclicVariable, position: number, voice: number, length: number,
  ) => void;
  setCyclicValue: (kind: CyclicVariable, level: number, value: number) => void;
  recordMidiNotes: (notes: readonly PlannedNote[]) => void;
  followDrumMachine: (steps: readonly PlannedStep[]) => void;
  clearMidiView: () => void;
  toggleMovieRecording: () => void;
  stopMovieRecording: () => void;
  setSynthParam: <K extends keyof SynthSettings>(
    voice: number, key: K, value: SynthSettings[K]
  ) => void;

  activatePosition: (id: PositionVarId, posIndex: number) => void;
  variableMarks: VariableMarks;
  toggleVariableMark: (id: PositionVarId, posIndex: number) => void;
  setSlotValue: (
    id: PositionVarId,
    posIndex: number,
    voiceIndex: number,
    value: PositionValue,
  ) => void;
  transferVariablePosition: (
    id: PositionVarId, source: number, destination: number, copy: boolean,
  ) => void;
  transferVariableVoice: (
    id: PositionVarId, position: number, sourceVoice: number,
    destinationVoice: number, copy: boolean,
  ) => void;
  openEditor: (id: PositionVarId) => void;
  closeEditor: () => void;

  storeSnapshot: (index: number, applyHeld?: boolean) => void;
  recallSnapshot: (index: number, nowSec?: number) => void;
  /** Erase Snapshot, from the Edit menu. */
  eraseSnapshot: (index: number) => void;
  /** Undo the changes brought about by the most recently executed Snapshot. */
  restoreFromSnapshot: () => void;
  setSnapshotQuantize: (value: number) => void;
  setArrow: (id: string, next: ArrowState) => void;
  setPatternGroup: (index: number) => void;
  beginHold: () => void;
  doHold: () => void;
  editCurrentSnapshot: () => void;
  blinkEverything: () => void;
  recordSlideshow: (index: number, nowSec?: number) => void;
  playSlideshow: (index: number, nowSec?: number, delaySec?: number) => void;
  stopSlideshow: (nowSec?: number) => void;
  pauseSlideshow: (nowSec?: number) => void;
  toggleSlideshowLoop: (nowSec?: number, remove?: boolean) => void;
  advanceSlideshow: (nowSec?: number) => void;

  setMidiConduct: (on: boolean) => void;
  setRobot: (on: boolean) => void;
  setPaused: (paused: boolean) => void;
  conductAt: (
    x: number, y: number, options?: { snapshots?: boolean; record?: boolean },
  ) => void;
  setTempoRange: (low: number, high: number) => void;
  setSyncRatio: (value: number) => void;
  setSyncRatioDirection: (direction: "out" | "in") => void;
  setRobotRange: (axis: "x" | "y", value: number) => void;
  setRobotTimeBase: (value: number) => void;
  robotStep: (signedX: number, signedY: number) => void;
};

const CONDUCTOR_RATIOS = [1, 2, 4, 8, 16] as const;

type ContinuousKind = "velocityRange" | "legato";
type ContinuousConducting = Record<ContinuousKind, {
  enabled: boolean[];
  directions: ArrowDir[];
  applied: boolean[];
}>;
const freshContinuousConducting = (): ContinuousConducting => ({
  velocityRange: { enabled: [false, false, false, false],
    directions: ["right", "right", "right", "right"], applied: [false, false, false, false] },
  legato: { enabled: [false, false, false, false],
    directions: ["right", "right", "right", "right"], applied: [false, false, false, false] },
});

type ConductUpdate = Pick<
  MStore, "baton" | "positions" | "activeCyclicPositions" | "patternGroup" | "project"
> & Partial<Pick<MStore, "slideshowTransport" | "slideshows" | "continuousConducting">>;

function conductUpdate(
  s: MStore,
  rawPoint: BatonPoint,
  options: { snapshots?: boolean; record?: boolean } = {},
) {
  const baton = clampBaton(rawPoint);
  let positions = s.positions;
  for (const id of POSITION_VARS) {
    const arrow = s.arrows[id];
    if (!arrow?.on) continue;
    if (id === "velocityRange" && s.continuousConducting.velocityRange.enabled.some(Boolean)) continue;
    positions = {
      ...positions,
      [id]: {
        ...positions[id],
        active: positionFromBaton(baton, arrow.dir),
      },
    };
  }

  let activeCyclicPositions = s.activeCyclicPositions;
  let cyclic = s.project.cyclic;
  let cyclicLengths = s.project.cyclicLengths;
  for (const kind of ["accent", "legato", "rhythm"] as CyclicVariable[]) {
    const arrow = s.arrows[kind];
    if (!arrow?.on) continue;
    if (kind === "legato" && s.continuousConducting.legato.enabled.some(Boolean)) continue;
    const active = positionFromBaton(baton, arrow.dir);
    activeCyclicPositions = { ...activeCyclicPositions, [kind]: active };
    cyclic = {
      ...cyclic,
      [kind]: s.cyclicPositions[kind][active].map((voice) => [...voice]),
    };
    cyclicLengths = {
      ...cyclicLengths,
      [kind]: [...s.cyclicLengths[kind][active]],
    };
  }

  const tempoArrow = s.arrows.tempo;
  const tempo = tempoArrow?.on
    ? conductedTempo(s.tempoRange, axisValue(baton, tempoArrow.dir))
    : s.project.tempo;
  const groupArrow = s.arrows.patternGroup;
  const patternGroup = groupArrow?.on
    ? positionFromBaton(baton, groupArrow.dir)
    : s.patternGroup;

  let conductedVoices = applyActivePositions(s.project.voices, positions);
  const continuousConducting = structuredClone(s.continuousConducting);
  for (let voice = 0; voice < conductedVoices.length; voice++) {
    if (continuousConducting.velocityRange.enabled[voice]) {
      conductedVoices[voice] = {
        ...conductedVoices[voice],
        velocityRange: continuousVelocityRange(
          conductedVoices[voice].velocityRange,
          axisValue(baton, continuousConducting.velocityRange.directions[voice]),
        ),
      };
      continuousConducting.velocityRange.applied[voice] = true;
    }
    if (continuousConducting.legato.enabled[voice]) {
      conductedVoices[voice] = {
        ...conductedVoices[voice],
        legato: continuousLegato(
          axisValue(baton, continuousConducting.legato.directions[voice]),
        ),
      };
      continuousConducting.legato.applied[voice] = true;
    }
  }
  const conductedProject = {
    ...s.project,
    tempo,
    cyclic,
    cyclicLengths,
    voices: conductedVoices,
  };
  let update: ConductUpdate = {
    baton,
    positions,
    activeCyclicPositions,
    patternGroup,
    project: groupArrow?.on
      ? applyPatternGroup(conductedProject, patternGroup) : conductedProject,
    continuousConducting,
  };

  if (options.record && s.slideshowTransport.mode === "recording"
    && s.slideshowTransport.slot !== null) {
    const slot = s.slideshowTransport.slot;
    let transport = s.slideshowTransport;
    let slideshow = s.slideshows[slot];
    const atSec = nowSeconds();
    const choices: Array<{ variable: PositionVarId | CyclicVariable; position: number }> = [];
    for (const id of POSITION_VARS) {
      const arrow = s.arrows[id];
      if (arrow?.on) choices.push({ variable: id, position: positionFromBaton(baton, arrow.dir) });
    }
    for (const kind of ["accent", "legato", "rhythm"] as CyclicVariable[]) {
      const arrow = s.arrows[kind];
      if (arrow?.on) choices.push({ variable: kind, position: positionFromBaton(baton, arrow.dir) });
    }
    for (const choice of choices) {
      const result = addSlideshowAction(
        transport, slideshow, { type: "position", ...choice }, atSec,
      );
      transport = result.state;
      slideshow = result.slideshow;
    }
    update = {
      ...update,
      slideshowTransport: transport,
      slideshows: s.slideshows.map((show, index) => index === slot ? slideshow : show),
    };
  }

  const snapshotArrow = s.arrows.snapshot;
  if (options.snapshots === false || !snapshotArrow?.on) return update;
  const snapshotIndex = positionFromBaton(baton, snapshotArrow.dir);
  const snap = s.snapshots[snapshotIndex];
  if (!snap || snapshotIndex === s.currentSnapshot) return update;
  const combined = { ...s, ...update };
  const restorePoint = captureSnapshot(
    combined.project,
    combined.positions,
    combined.arrows,
    combined.patternGroup,
    undefined,
    combined.activeCyclicPositions,
  );
  return {
    ...update,
    ...executeSnapshot(combined, snap),
    currentSnapshot: snapshotIndex,
    restorePoint,
  };
}

export const useM = create<MStore>((set, get) => ({
  ...freshDocument(),
  variableMarks: makeEmptyVariableMarks(),
  snapshots: Array<Snapshot | null>(SNAPSHOT_COUNT).fill(null),
  currentSnapshot: null,
  restorePoint: null,
  snapshotQuantize: 0,
  snapshotMode: "idle",
  snapshotDraft: null,
  slideshows: Array.from({ length: 9 }, () => ({ ...EMPTY_SLIDESHOW, events: [] })),
  slideshowTransport: IDLE_SLIDESHOW_TRANSPORT,
  arrows: {},
  patternGroup: 0,
  clipboard: [],
  patternClipboard: null,
  options: { ...DEFAULT_OPTIONS },
  editorRegion: null,
  documentName: null,
  isDirty: false,
  documentEpoch: 0,
  selectedVoice: 0,
  selectedPatternIndices: [0],
  isPlaying: false,
  editingVar: null,
  midiConduct: false,
  robotConductor: false,
  isPaused: false,
  baton: { x: 0.5, y: 0.5 },
  tempoRange: { low: 80, high: 160 },
  syncRatio: 4,
  syncRatioDirection: "out",
  robotRange: { x: 0.15, y: 0.15 },
  robotTimeBase: 4,
  continuousConducting: freshContinuousConducting(),
  cyclicPositions: (() => {
    const project = createDefaultProject();
    return Object.fromEntries(
      (["accent", "legato", "rhythm"] as CyclicVariable[]).map((kind) => [
        kind,
        Array.from({ length: 6 }, () =>
          project.cyclic[kind].map((voice) => [...voice]),
        ),
      ]),
    ) as CyclicPositionBanks;
  })(),
  cyclicLengths: Object.fromEntries(
    (["accent", "legato", "rhythm"] as CyclicVariable[]).map((kind) => [
      kind, Array.from({ length: 6 }, () => Array(4).fill(16)),
    ]),
  ) as CyclicPositionLengths,
  activeCyclicPositions: { accent: 0, legato: 0, rhythm: 0 },
  midiViewEvents: [],
  midiViewTransport: [],
  midiViewNextId: 0,
  movieRecorder: EMPTY_MOVIE_RECORDER,
  synthSettings: createDefaultSynthSettings(),
  cyclicResetEpochs: [0, 0, 0, 0],
  midiEditRange: { from: 0, to: 15 },
  midiEditCounter: 0,
  midiHeldNotes: [[], [], [], []],
  midiChordNotes: [[], [], [], []],
  inputControlCode: null,
  inputControlTapAt: null,
  stepAdvanceCounters: [0, 0, 0, 0],

  setMidiEditState: (range, counter) => set({
    midiEditRange: {
      from: Math.max(0, Math.min(range.from, range.to)),
      to: Math.max(0, Math.max(range.from, range.to)),
    },
    midiEditCounter: Math.max(0, Math.round(counter)),
  }),

  setVoiceInput: (voice, values) => set((s) => ({
    project: {
      ...s.project,
      voices: s.project.voices.map((entry, index) =>
        index === voice ? { ...entry, ...values } : entry),
    },
  })),

  setMidiAssignment: (side, row, value) => set((s) => ({
    project: {
      ...s.project,
      midiAssignments: {
        ...s.project.midiAssignments,
        [side]: s.project.midiAssignments[side].map((entry, index) =>
          index === row ? {
            deviceId: value.deviceId,
            channel: Math.max(1, Math.min(16, Math.round(value.channel))),
          } : entry),
      },
    },
  })),

  setMidiAssignmentConfig: (value) => set((s) => ({
    project: {
      ...s.project,
      midiAssignments: { ...s.project.midiAssignments, ...value },
    },
  })),

  toggleEchoMapChannel: (channel) => set((s) => ({ project: {
    ...s.project,
    echoMapChannels: s.project.echoMapChannels.includes(channel)
      ? s.project.echoMapChannels.filter((entry) => entry !== channel)
      : [...s.project.echoMapChannels, channel].sort((a, b) => a - b),
  } })),

  advanceMouseVoices: (velocity) => {
    const responses: MidiInputResponse[] = [];
    const state = get();
    const counters = [...state.stepAdvanceCounters];
    for (let voiceIndex = 0; voiceIndex < state.project.voices.length; voiceIndex++) {
      const voice = state.project.voices[voiceIndex];
      if (!voice.mouseAdvance || !voice.playEnabled) continue;
      const pattern = state.project.patterns[voice.patternIndex];
      const at = counters[voiceIndex] % Math.max(1, pattern.outputLength);
      counters[voiceIndex] = at + 1;
      for (const note of pattern.steps[at]?.pitches ?? []) responses.push({
        type: "step", voice: voiceIndex, note: note + voice.transposition,
        velocity: Math.max(1, Math.min(127, Math.round(velocity))),
      });
    }
    set({ stepAdvanceCounters: counters });
    return responses;
  },

  receiveMidi: (message) => {
    if (message.type === "control") {
      const current = get();
      if (current.options.midiConduct) {
        const assignments = current.project.midiAssignments;
        if (message.controller === assignments.conductXController
          || message.controller === assignments.conductYController) {
          const axis = message.value / 127;
          set((s) => conductUpdate(s, {
            x: message.controller === assignments.conductXController ? axis : s.baton.x,
            y: message.controller === assignments.conductYController ? axis : s.baton.y,
          }));
        }
      }
      if (message.controller === 64 && message.value >= 64 && current.options.sustainEntersRests) {
        set((s) => {
          let patterns = s.project.patterns;
          for (const voice of s.project.voices) {
            if (voice.inputUse !== "record"
              || (voice.sourceChannel !== "all" && voice.sourceChannel !== message.channel)) continue;
            const pattern = patterns[voice.patternIndex];
            const steps = applyRecordedNotes(
              pattern.steps, [], s.midiEditCounter, pattern.insertMode, pattern.maxSize,
            );
            const next = withRegeneratedScramble(
              pattern, steps, s.project.seed, voice.patternIndex, s.options.dontScrambleRests,
            );
            patterns = patterns.map((entry, index) => index === voice.patternIndex
              ? { ...next, outputLength: Math.max(next.outputLength, s.midiEditCounter + 1) }
              : entry);
          }
          const { from, to } = s.midiEditRange;
          return {
            project: { ...s.project, patterns },
            midiEditCounter: s.midiEditCounter >= to ? from : s.midiEditCounter + 1,
          };
        });
      }
      return [];
    }
    const state = get();
    const targets = routeMidiNote(state.project.voices.map((voice): MidiInputVoice => ({
      sourceChannel: voice.sourceChannel,
      use: voice.inputUse,
      echo: voice.echoInput,
    })), message.channel);
    const responses: MidiInputResponse[] = [];
    if (message.type === "note-on" && targets.some((voice) =>
      state.project.voices[voice].inputUse === "echo-map")) {
      responses.push({
        type: "echo", voice: state.selectedVoice, note: message.note,
        velocity: message.velocity, channels: state.project.echoMapChannels,
      });
    }
    if (message.type === "note-on"
      && targets.some((voice) => state.project.voices[voice].inputUse === "control")) {
      const code = inputControlCode(message.note);
      if (code) {
        set({ inputControlCode: code });
        return [];
      }
      const pending = state.inputControlCode;
      const value = whiteKeyValue(message.note);
      if (pending && value !== null) {
        set({ inputControlCode: null });
        const position = value - 1;
        const variableMap: Partial<Record<InputControlCode, PositionVarId>> = {
          ordering: "noteOrderMix", orchestration: "outputChannels",
          transposition: "transposition", "velocity-range": "velocityRange",
          density: "density",
        };
        const variable = variableMap[pending];
        if (variable && position >= 0 && position < POSITION_COUNT) get().activatePosition(variable, position);
        else if (["accent", "legato"].includes(pending) && position >= 0 && position < POSITION_COUNT) {
          get().activateCyclicPosition(pending as CyclicVariable, position);
        } else if (pending === "pattern-group" && position >= 0 && position < 6) get().setPatternGroup(position);
        else if (pending === "snapshot" && position >= 0 && position < SNAPSHOT_COUNT) get().recallSnapshot(position);
        else if (pending === "play-slideshow" && value >= 1 && value <= 9) get().playSlideshow(value - 1);
        else if (pending === "record-slideshow" && value >= 1 && value <= 9) get().recordSlideshow(value - 1);
        else if (pending === "duration" && position >= 0 && position < POSITION_COUNT) {
          get().activateCyclicPosition("rhythm", position);
        }
        else if (pending.startsWith("time-base-") && value >= 0) {
          const voice = Number(pending.slice(-1)) - 1;
          if (value === 0) get().setVoiceParam(voice, "timeBaseDenominator", 0);
          else get().setVoiceParam(voice, "timeBaseDenominator", value);
        }
        return [];
      }
      const action = decodeInputControl(message.note);
      if (action) {
        const advance = (voiceIndex: number) => {
          const live = get();
          const voice = live.project.voices[voiceIndex];
          if (!voice.playEnabled || voice.timeBaseDenominator !== 0) return;
          const pattern = live.project.patterns[voice.patternIndex];
          const at = live.stepAdvanceCounters[voiceIndex] % Math.max(1, pattern.outputLength);
          const nextCounters = [...live.stepAdvanceCounters];
          nextCounters[voiceIndex] = at + 1;
          set({ stepAdvanceCounters: nextCounters });
          for (const note of pattern.steps[at]?.pitches ?? []) responses.push({
            type: "step", voice: voiceIndex, note: note + voice.transposition,
            velocity: message.velocity,
          });
        };
        if (action.type === "start" || action.type === "stop" || action.type === "sync") {
          responses.push({ type: action.type });
        } else if (action.type === "toggle-voice") get().toggleVoiceEnabled(action.voice);
        else if (action.type === "clear-pattern") {
          const patternIndex = get().project.voices[action.voice].patternIndex;
          get().eraseRegion(patternIndex, 0, get().project.patterns[patternIndex].steps.length - 1);
        } else if (action.type === "hold-do") {
          if (get().snapshotMode === "idle") get().beginHold(); else get().doHold();
        } else if (action.type === "stop-slideshow") get().stopSlideshow();
        else if (action.type === "edit-snapshot") get().editCurrentSnapshot();
        else if (action.type === "accelerando") get().setTempo(Math.min(999, get().project.tempo + 1));
        else if (action.type === "decelerando") get().setTempo(Math.max(1, get().project.tempo - 1));
        else if (action.type === "tap-tempo" || action.type === "tap-conduct") {
          const now = nowSeconds();
          const previous = get().inputControlTapAt;
          if (previous !== null && now > previous) get().setTempo(Math.max(1, Math.min(999, 60 / (now - previous))));
          set({ inputControlTapAt: now });
          if (action.type === "tap-conduct") responses.push({ type: "start" });
          if (get().options.tapAffectsVelocity) {
            const scale = Math.max(0.1, message.velocity / 64);
            set((s) => ({ project: { ...s.project, voices: s.project.voices.map((voice) => ({
              ...voice, velocityRange: {
                low: Math.min(127, Math.round(voice.velocityRange.low * scale)),
                high: Math.min(127, Math.round(voice.velocityRange.high * scale)),
              },
            })) } }));
          }
        } else if (action.type === "step-all") {
          for (let voice = 0; voice < 4; voice++) advance(voice);
        } else if (action.type === "step-voice") {
          advance(action.voice);
        }
        return responses;
      }
    }
    set((s) => {
      let project = s.project;
      let counter = s.midiEditCounter;
      const held = s.midiHeldNotes.map((notes) => [...notes]);
      const chordNotes = s.midiChordNotes.map((notes) => [...notes]);
      for (const voiceIndex of targets) {
        const voice = project.voices[voiceIndex];
        if (voice.echoInput && message.type === "note-on") {
          responses.push({ type: "echo", voice: voiceIndex, note: message.note, velocity: message.velocity });
        }
        if (voice.inputUse === "keyboard-transpose" && message.type === "note-on") {
          project = { ...project, voices: project.voices.map((entry, index) =>
            index === voiceIndex ? { ...entry, transposition: message.note - 60 } : entry) };
          continue;
        }
        if (voice.inputUse !== "record") continue;
        const patternIndex = voice.patternIndex;
        const pattern = project.patterns[patternIndex];
        if (message.type === "note-on") {
          held[voiceIndex] = [...new Set([...held[voiceIndex], message.note])];
          chordNotes[voiceIndex] = [...new Set([...chordNotes[voiceIndex], message.note])];
        }
        const recordNow = pattern.chordMode === "single" && message.type === "note-on"
          ? [message.note]
          : pattern.chordMode === "build" && message.type === "note-on"
            ? held[voiceIndex]
            : pattern.chordMode === "chord" && message.type === "note-off"
              && held[voiceIndex].length === 1 && held[voiceIndex][0] === message.note
              ? chordNotes[voiceIndex] : null;
        if (recordNow) {
          const nextSteps = applyRecordedNotes(
            pattern.steps, recordNow, counter,
            pattern.chordMode === "build" && chordNotes[voiceIndex].length > 1
              ? "overdub" : pattern.insertMode,
            pattern.maxSize,
          );
          const nextPattern = withRegeneratedScramble(
            pattern, nextSteps, project.seed, patternIndex, s.options.dontScrambleRests,
          );
          project = { ...project, patterns: project.patterns.map((entry, index) =>
            index === patternIndex ? {
              ...nextPattern, outputLength: Math.max(nextPattern.outputLength, counter + 1),
            } : entry) };
          if (pattern.chordMode !== "build") {
            const { from, to } = s.midiEditRange;
            counter = counter >= to ? from : counter + 1;
          }
        }
        if (message.type === "note-off") {
          held[voiceIndex] = held[voiceIndex].filter((note) => note !== message.note);
          if (pattern.chordMode === "build" && held[voiceIndex].length === 0) {
            const { from, to } = s.midiEditRange;
            counter = counter >= to ? from : counter + 1;
          }
          if (held[voiceIndex].length === 0) chordNotes[voiceIndex] = [];
        }
      }
      return { project, midiEditCounter: counter, midiHeldNotes: held, midiChordNotes: chordNotes };
    });
    return responses;
  },

  setTempo: (bpm) => set((s) => ({ project: { ...s.project, tempo: bpm } })),

  setPlaying: (playing) => {
    set((s) => ({
      isPlaying: playing,
      slideshowTransport: playing
        ? resumeSlideshowState(s.slideshowTransport, nowSeconds())
        : pauseSlideshowState(s.slideshowTransport, nowSeconds()),
    }));
  },

  selectVoice: (index) => set((s) => ({
    selectedVoice: index,
    selectedPatternIndices: [s.project.voices[index]?.patternIndex ?? 0],
  })),

  selectPattern: (patternIndex, additive = false) => set((s) => {
    if (patternIndex < 0 || patternIndex >= s.project.patterns.length) return {};
    const selected = additive
      ? s.selectedPatternIndices.includes(patternIndex)
        ? s.selectedPatternIndices.filter((index) => index !== patternIndex)
        : [...s.selectedPatternIndices, patternIndex]
      : [patternIndex];
    const voice = s.project.voices.findIndex((item) => item.patternIndex === patternIndex);
    return {
      selectedPatternIndices: selected.length > 0 ? selected : [patternIndex],
      selectedVoice: voice >= 0 ? voice : s.selectedVoice,
    };
  }),

  toggleVoiceEnabled: (index) =>
    set((s) => {
      if (s.snapshotMode !== "idle" && s.snapshotDraft) {
        const included = s.snapshotDraft.included!;
        const selected = s.snapshotMode === "editing"
          ? toggleIncluded(included.playEnabled!, index)
          : [...new Set([...included.playEnabled!, index])];
        const playEnabled = [...s.snapshotDraft.playEnabled];
        playEnabled[index] = !playEnabled[index];
        return { snapshotDraft: {
          ...s.snapshotDraft, playEnabled,
          included: { ...included, playEnabled: selected },
        } };
      }
      return { project: {
        ...s.project,
        voices: s.project.voices.map((v, i) => i === index ? { ...v, playEnabled: !v.playEnabled } : v),
      } };
    }),

  setVoiceParam: (index, key, value) =>
    set((s) => {
      if (
        s.snapshotMode !== "idle" && s.snapshotDraft &&
        (key === "timeBaseNumerator" || key === "timeBaseDenominator")
      ) {
        const included = s.snapshotDraft.included!;
        const selected = s.snapshotMode === "editing"
          ? toggleIncluded(included.timeBase!, index)
          : [...new Set([...included.timeBase!, index])];
        const timeBase = s.snapshotDraft.timeBase.map((entry, voice) =>
          voice !== index ? entry : {
            ...entry,
            [key === "timeBaseNumerator" ? "numerator" : "denominator"]: Number(value),
          });
        return { snapshotDraft: {
          ...s.snapshotDraft, timeBase,
          included: { ...included, timeBase: selected },
        } };
      }
      const voices = s.project.voices.map((v, i) =>
        i === index ? { ...v, [key]: value } : v,
      );
      const timingKey = key === "timeBaseNumerator" || key === "timeBaseDenominator"
        || key === "phase";
      const patterns = timingKey ? s.project.patterns.map((pattern, patternIndex) =>
        patternIndex === voices[index].patternIndex
          ? { ...pattern, [key]: Number(value) } : pattern) : s.project.patterns;
      let positions = s.positions;
      if (isPositionVar(key)) {
        const active = positions[key].active;
        positions = setSlot(positions, key, active, index, value as PositionValue);
      }
      return { project: { ...s.project, voices, patterns }, positions };
    }),

  toggleStepPitch: (patternIndex, stepIndex, pitch) =>
    set((s) => ({
      project: {
        ...s.project,
        patterns: s.project.patterns.map((p, pi) =>
          pi !== patternIndex
            ? p
            : withRegeneratedScramble(
                p,
                p.steps.map((st, si) =>
                  si !== stepIndex
                    ? st
                    : {
                        pitches: st.pitches.includes(pitch)
                          ? st.pitches.filter((x) => x !== pitch)
                          : [...st.pitches, pitch].sort((a, b) => a - b),
                      },
                ),
                s.project.seed,
                pi,
                s.options.dontScrambleRests,
              ),
        ),
      },
    })),

  paintStep: (patternIndex, stepIndex, pitch, on) =>
    set((s) => {
      if (stepIndex < 0) return {};
      if (stepIndex >= s.project.patterns[patternIndex].maxSize) return {};
      return {
        project: {
          ...s.project,
          patterns: s.project.patterns.map((p, pi) => {
            if (pi !== patternIndex) return p;
            // Nothing to erase out past the end of the pattern.
            if (!on && stepIndex >= p.steps.length) return p;
            let steps = p.steps;
            if (stepIndex >= steps.length) {
              steps = steps.concat(
                Array.from({ length: stepIndex + 1 - steps.length }, () => ({ pitches: [] })),
              );
            }
            steps = steps.map((st, si) =>
              si !== stepIndex
                ? st
                : {
                    pitches: on
                      ? st.pitches.includes(pitch)
                        ? st.pitches
                        : [...st.pitches, pitch].sort((a, b) => a - b)
                      : st.pitches.filter((x) => x !== pitch),
                  },
            );
            // Painting further out extends the length to that step; erasing
            // never shrinks it (the extension remains).
            const outputLength = on
              ? Math.max(p.outputLength, stepIndex + 1)
              : p.outputLength;
            return {
              ...withRegeneratedScramble(
                p, steps, s.project.seed, pi, s.options.dontScrambleRests,
              ),
              outputLength,
            };
          }),
        },
      };
    }),

  setOutputLength: (patternIndex, length) =>
    set((s) => {
      if (s.snapshotMode !== "idle" && s.snapshotDraft) {
        const included = s.snapshotDraft.included!;
        const selected = s.snapshotMode === "editing"
          ? toggleIncluded(included.outputLength!, patternIndex)
          : [...new Set([...included.outputLength!, patternIndex])];
        const outputLength = [...s.snapshotDraft.outputLength];
        outputLength[patternIndex] = Math.max(0, Math.min(s.project.patterns[patternIndex].steps.length, length));
        return { snapshotDraft: {
          ...s.snapshotDraft, outputLength,
          included: { ...included, outputLength: selected },
        } };
      }
      return { project: {
        ...s.project,
        patterns: s.project.patterns.map((p, pi) =>
          pi !== patternIndex
            ? p
            : { ...p, outputLength: Math.max(0, Math.min(p.steps.length, length)) },
        ),
      } };
    }),

  // The Size Numerical is a ceiling, so it can never be pulled below the
  // material the Pattern already holds.
  setPatternMaxSize: (patternIndex, size) =>
    set((s) => ({
      project: {
        ...s.project,
        patterns: s.project.patterns.map((p, pi) =>
          pi !== patternIndex
            ? p
            : {
                ...p,
                maxSize: Math.max(
                  p.steps.length,
                  Math.min(MAX_PATTERN_STEPS, Math.round(size) || 0),
                ),
              },
        ),
      },
    })),

  eraseRegion: (patternIndex, from, to) =>
    set((s) => ({
      project: {
        ...s.project,
        patterns: s.project.patterns.map((p, pi) =>
          pi !== patternIndex
            ? p
            : withRegeneratedScramble(
                p,
                p.steps.map((st, si) =>
                  si >= from && si <= to ? { pitches: [] } : st,
                ),
                s.project.seed,
                pi,
                s.options.dontScrambleRests,
              ),
        ),
      },
    })),

  insertSteps: (patternIndex, at, count) =>
    set((s) => ({
      project: {
        ...s.project,
        patterns: s.project.patterns.map((p, pi) => {
          if (pi !== patternIndex) return p;
          // Never push the Pattern past its Size Numerical.
          const room = Math.max(0, p.maxSize - p.steps.length);
          const n = Math.min(count, room);
          if (n <= 0) return p;
          const blanks = Array.from({ length: n }, () => ({ pitches: [] as number[] }));
          const steps = [...p.steps.slice(0, at), ...blanks, ...p.steps.slice(at)];
          return {
            ...withRegeneratedScramble(
              p, steps, s.project.seed, pi, s.options.dontScrambleRests,
            ),
            outputLength: Math.min(steps.length, p.outputLength + n),
          };
        }),
      },
    })),

  deleteRegion: (patternIndex, from, to) =>
    set((s) => ({
      project: {
        ...s.project,
        patterns: s.project.patterns.map((p, pi) => {
          if (pi !== patternIndex) return p;
          const steps = p.steps.filter((_, si) => si < from || si > to);
          const removed = p.steps.length - steps.length;
          if (removed === 0) return p;
          return {
            ...withRegeneratedScramble(
              p, steps, s.project.seed, pi, s.options.dontScrambleRests,
            ),
            outputLength: Math.max(0, Math.min(steps.length, p.outputLength - removed)),
          };
        }),
      },
    })),

  exportDocument: () => encodeDocument(get()),

  markSaved: (name) => set({ documentName: name, isDirty: false }),

  importDocument: (raw, name) => {
    const result = decodeDocument(raw);
    if (!result.ok) return result;
    const d = result.document;
    // One atomic update: a two-phase write would look like a user edit to the
    // dirty-tracking subscription and immediately re-dirty the fresh document.
    set((s) => ({
      documentName: name ?? s.documentName,
      isDirty: false,
      documentEpoch: s.documentEpoch + 1,
      project: applyPatternGroup(d.project, d.patternGroup),
      positions: d.positions,
      variableMarks: d.variableMarks,
      snapshots: d.snapshots,
      slideshows: d.slideshows,
      currentSnapshot: d.currentSnapshot,
      snapshotQuantize: d.snapshotQuantize,
      arrows: d.arrows,
      patternGroup: d.patternGroup,
      selectedVoice: d.selectedVoice,
      tempoRange: d.tempoRange,
      syncRatio: d.syncRatio as MStore["syncRatio"],
      syncRatioDirection: d.syncRatioDirection,
      robotRange: d.robotRange,
      robotTimeBase: d.robotTimeBase as MStore["robotTimeBase"],
      cyclicPositions: d.cyclicPositions,
      cyclicLengths: d.cyclicLengths,
      activeCyclicPositions: d.activeCyclicPositions,
      options: d.options,
      // Playback and everything derived from the old piece has to go: the
      // transport is stopped, and undo/clipboard/monitor state belonged to a
      // project that no longer exists.
      isPlaying: false,
      isPaused: false,
      restorePoint: null,
      snapshotMode: "idle",
      snapshotDraft: null,
      slideshowTransport: IDLE_SLIDESHOW_TRANSPORT,
      clipboard: [],
      patternClipboard: null,
      selectedPatternIndices: [d.project.voices[d.selectedVoice].patternIndex],
      editorRegion: null,
      editingVar: null,
      midiViewEvents: [],
      midiViewTransport: [],
      midiViewNextId: 0,
      movieRecorder: EMPTY_MOVIE_RECORDER,
      synthSettings: createDefaultSynthSettings(),
      continuousConducting: freshContinuousConducting(),
    }));
    return result;
  },

  newDocument: (startup) => {
    const blank = freshDocument();
    const blankState = encodeDocument({
      ...get(), ...blank,
      variableMarks: makeEmptyVariableMarks(),
      snapshots: Array<Snapshot | null>(SNAPSHOT_COUNT).fill(null),
      slideshows: Array.from({ length: 9 }, () => ({ ...EMPTY_SLIDESHOW, events: [] })),
      currentSnapshot: null, snapshotQuantize: 0, arrows: {}, patternGroup: 0,
      selectedVoice: 0, options: { ...DEFAULT_OPTIONS },
    });
    const decoded = startup === undefined ? null : decodeDocument(startup);
    const initial = decoded?.ok ? mergeStartupState(blankState, decoded.document) : blankState;
    set((s) => ({
      documentName: null,
      isDirty: false,
      documentEpoch: s.documentEpoch + 1,
      project: applyPatternGroup(initial.project, initial.patternGroup),
      positions: initial.positions,
      variableMarks: initial.variableMarks,
      snapshots: initial.snapshots,
      slideshows: initial.slideshows,
      currentSnapshot: initial.currentSnapshot,
      restorePoint: null,
      snapshotMode: "idle",
      snapshotDraft: null,
      slideshowTransport: IDLE_SLIDESHOW_TRANSPORT,
      snapshotQuantize: initial.snapshotQuantize,
      arrows: initial.arrows,
      patternGroup: initial.patternGroup,
      clipboard: [],
      patternClipboard: null,
      selectedPatternIndices: [initial.project.voices[initial.selectedVoice].patternIndex],
      editorRegion: null,
      options: initial.options,
      selectedVoice: initial.selectedVoice,
      isPlaying: false,
      isPaused: false,
      editingVar: null,
      midiViewEvents: [],
      midiViewTransport: [],
      midiViewNextId: 0,
      movieRecorder: EMPTY_MOVIE_RECORDER,
      synthSettings: createDefaultSynthSettings(),
      continuousConducting: freshContinuousConducting(),
    }));
  },

  setClipboard: (steps) => set({ clipboard: steps.map((s) => ({ pitches: [...s.pitches] })) }),
  setPatternClipboard: (pattern) => set({
    patternClipboard: pattern ? structuredClone(pattern) : null,
  }),

  setOption: (id, on) => set((s) => ({
    options: setOptionValue(s.options, id, on),
    project: id === "secondOrderTranspose"
      ? { ...s.project, secondOrderTranspose: on }
      : s.project,
  })),

  setEditorRegion: (region) => set({ editorRegion: region }),

  runPatternCommand: (patternIndex, command) =>
    set((s) => ({
      project: {
        ...s.project,
        patterns: s.project.patterns.map((p, pi) => {
          if (pi !== patternIndex) return p;
          const steps = command(p.steps, p.maxSize);
          return {
            ...withRegeneratedScramble(
              p, steps, s.project.seed, pi, s.options.dontScrambleRests,
            ),
            // Output Length can never point past the material that remains.
            outputLength: Math.min(p.outputLength, steps.length),
          };
        }),
      },
    })),

  runPatternDocumentCommand: (patternIndex, command) =>
    set((s) => ({
      project: {
        ...s.project,
        patterns: s.project.patterns.map((pattern, index) =>
          index === patternIndex ? command(pattern) : pattern,
        ),
      },
    })),

  setPatternMode: (patternIndex, key, value) =>
    set((s) => ({
      project: {
        ...s.project,
        patterns: s.project.patterns.map((p, pi) =>
          pi !== patternIndex ? p : { ...p, [key]: value },
        ),
      },
    })),

  setScaleSnap: (on) => set((s) => ({ project: { ...s.project, scaleSnap: on } })),
  setScale: (scale) => set((s) => ({ project: { ...s.project, scale } })),
  setRoot: (root) => set((s) => ({ project: { ...s.project, root } })),
  setSeed: (seed) => set((s) => ({ project: { ...s.project, seed } })),
  setDiatonicTranspose: (on) =>
    set((s) => ({ project: { ...s.project, diatonicTranspose: on } })),
  setSecondOrderTranspose: (on) =>
    set((s) => ({
      project: { ...s.project, secondOrderTranspose: on },
      options: setOptionValue(s.options, "secondOrderTranspose", on),
    })),
  setChordTones: (on) => set((s) => ({ project: { ...s.project, chordTones: on } })),
  setCyclicLevel: (kind, voiceIndex, stepIndex, level) =>
    set((s) => {
      const position = s.activeCyclicPositions[kind];
      const clamped = Math.max(0, Math.min(4, Math.round(level)));
      const values = s.project.cyclic[kind].map((voice, vi) =>
        vi === voiceIndex
          ? voice.map((value, si) =>
              si === stepIndex ? clamped : value,
            )
          : voice,
      );
      const banks = s.cyclicPositions[kind].map((bank, pi) =>
        pi !== position ? bank : values.map((voice) => [...voice]),
      );
      return {
        cyclicPositions: { ...s.cyclicPositions, [kind]: banks },
        project: {
          ...s.project,
          cyclic: { ...s.project.cyclic, [kind]: values },
        },
      };
    }),
  setCyclicPositionLevel: (kind, position, voiceIndex, stepIndex, level) =>
    set((s) => {
      const pos = Math.max(0, Math.min(5, Math.round(position)));
      const clamped = Math.max(0, Math.min(4, Math.round(level)));
      const banks = s.cyclicPositions[kind].map((bank, pi) =>
        pi !== pos ? bank : bank.map((voice, vi) =>
          vi !== voiceIndex ? voice : voice.map((old, si) => si === stepIndex ? clamped : old),
        ),
      );
      const active = s.activeCyclicPositions[kind] === pos;
      return {
        cyclicPositions: { ...s.cyclicPositions, [kind]: banks },
        project: active ? {
          ...s.project,
          cyclic: { ...s.project.cyclic, [kind]: banks[pos].map((voice) => [...voice]) },
        } : s.project,
      };
    }),
  setCyclicPositionRange: (kind, position, voiceIndex, stepIndex, fromLevel, toLevel) =>
    set((s) => {
      const pos = Math.max(0, Math.min(5, Math.round(position)));
      const range = normalizeCyclicStep({ min: fromLevel, max: toLevel });
      const banks = s.cyclicPositions[kind].map((bank, pi) =>
        pi !== pos ? bank : bank.map((voice, vi) =>
          vi !== voiceIndex ? voice : voice.map((old, si) => si === stepIndex ? range : old),
        ),
      );
      const active = s.activeCyclicPositions[kind] === pos;
      return {
        cyclicPositions: { ...s.cyclicPositions, [kind]: banks },
        project: active ? {
          ...s.project,
          cyclic: { ...s.project.cyclic, [kind]: banks[pos].map((voice) => [...voice]) },
        } : s.project,
      };
    }),
  activateCyclicPosition: (kind, position) =>
    set((s) => {
      const pos = Math.max(0, Math.min(5, Math.round(position)));
      if (s.snapshotMode !== "idle" && s.snapshotDraft) {
        const included = s.snapshotDraft.included!;
        const cyclicActives = s.snapshotMode === "editing"
          ? toggleIncluded(included.cyclicActives!, kind)
          : [...new Set([...included.cyclicActives!, kind])];
        return {
          snapshotDraft: {
            ...s.snapshotDraft,
            cyclicActives: { ...s.snapshotDraft.cyclicActives!, [kind]: pos },
            included: { ...included, cyclicActives },
          },
        };
      }
      let slideshowTransport = s.slideshowTransport;
      let slideshows = s.slideshows;
      if (slideshowTransport.mode === "recording" && slideshowTransport.slot !== null) {
        const result = addSlideshowAction(
          slideshowTransport, slideshows[slideshowTransport.slot],
          { type: "position", variable: kind, position: pos }, nowSeconds(),
        );
        slideshowTransport = result.state;
        slideshows = slideshows.map((show, i) => i === slideshowTransport.slot ? result.slideshow : show);
      }
      return {
        activeCyclicPositions: { ...s.activeCyclicPositions, [kind]: pos },
        project: {
          ...s.project,
          cyclic: { ...s.project.cyclic, [kind]: s.cyclicPositions[kind][pos].map((v) => [...v]) },
          cyclicLengths: { ...s.project.cyclicLengths, [kind]: [...s.cyclicLengths[kind][pos]] },
        },
        slideshowTransport,
        slideshows,
      };
    }),
  setCyclicLength: (kind, position, voiceIndex, length) =>
    set((s) => {
      const pos = Math.max(0, Math.min(5, Math.round(position)));
      const clamped = Math.max(1, Math.min(16, Math.round(length)));
      const lengths = s.cyclicLengths[kind].map((row, pi) =>
        pi !== pos ? row : row.map((old, vi) => vi === voiceIndex ? clamped : old),
      );
      const active = s.activeCyclicPositions[kind] === pos;
      return {
        cyclicLengths: { ...s.cyclicLengths, [kind]: lengths },
        project: active ? {
          ...s.project,
          cyclicLengths: { ...s.project.cyclicLengths, [kind]: [...lengths[pos]] },
        } : s.project,
      };
    }),
  setCyclicValue: (kind, level, value) =>
    set((s) => {
      if (kind === "accent") return {};
      const at = Math.max(0, Math.min(4, Math.round(level)));
      return {
        project: {
          ...s.project,
          cyclicValues: {
            ...s.project.cyclicValues,
            [kind]: s.project.cyclicValues[kind].map((old, i) => i === at ? value : old),
          },
        },
      };
    }),
  recordMidiTransport: (type, direction, atSec) =>
    set((s) => ({
      midiViewTransport: [
        ...s.midiViewTransport.slice(-(MIDI_VIEW_LIMIT - 1)),
        { id: s.midiViewNextId, atSec, type, direction },
      ],
      midiViewNextId: s.midiViewNextId + 1,
    })),

  recordMidiNotes: (notes) =>
    set((s) => {
      const incoming = eventsForPlannedNotes(notes, s.midiViewNextId, s.project.scale);
      return {
        midiViewEvents: mergeMidiViewEvents(s.midiViewEvents, incoming),
        midiViewNextId: s.midiViewNextId + incoming.length,
        movieRecorder: captureMovieNotes(s.movieRecorder, notes, s.project.tempo),
      };
    }),
  followDrumMachine: (steps) => set((s) => {
    const followed = [...steps].reverse().find(({ voice }) => {
      const state = s.project.voices[voice];
      return state.inputUse === "record" && s.project.patterns[state.patternIndex].drumMachine;
    });
    return followed ? { midiEditCounter: followed.step } : {};
  }),
  clearMidiView: () => set({ midiViewEvents: [], midiViewNextId: 0 }),
  toggleMovieRecording: () => set((s) => ({
    movieRecorder: s.movieRecorder.mode === "idle"
      ? armMovie(s.movieRecorder)
      : finishMovie(s.movieRecorder),
  })),
  stopMovieRecording: () => set((s) => ({
    movieRecorder: finishMovie(s.movieRecorder),
  })),
  setSynthParam: (voice, key, value) => set((s) => ({
    synthSettings: s.synthSettings.map((patch, index) => index === voice
      ? normalizeSynthSettings({ ...patch, [key]: value }) : patch),
  })),
  signalCyclicReset: (voices) => set((s) => ({
    cyclicResetEpochs: s.cyclicResetEpochs.map((epoch, voice) =>
      voices.includes(voice) ? epoch + 1 : epoch),
  })),

  activatePosition: (id, posIndex) =>
    set((s) => {
      if (s.snapshotMode !== "idle" && s.snapshotDraft) {
        const included = s.snapshotDraft.included!;
        const actives = s.snapshotMode === "editing"
          ? toggleIncluded(included.actives!, id)
          : [...new Set([...included.actives!, id])];
        return {
          snapshotDraft: {
            ...s.snapshotDraft,
            actives: { ...s.snapshotDraft.actives, [id]: posIndex },
            included: { ...included, actives },
          },
        };
      }
      const positions = {
        ...s.positions,
        [id]: { ...s.positions[id], active: posIndex },
      };
      const voices = applyPosition(
        s.project.voices,
        id,
        positions[id].slots[posIndex],
      );
      let slideshowTransport = s.slideshowTransport;
      let slideshows = s.slideshows;
      if (slideshowTransport.mode === "recording" && slideshowTransport.slot !== null) {
        const result = addSlideshowAction(
          slideshowTransport, slideshows[slideshowTransport.slot],
          { type: "position", variable: id, position: posIndex }, nowSeconds(),
        );
        slideshowTransport = result.state;
        slideshows = slideshows.map((show, i) => i === slideshowTransport.slot ? result.slideshow : show);
      }
      return { positions, project: { ...s.project, voices }, slideshows, slideshowTransport };
    }),

  toggleVariableMark: (id, posIndex) => set((s) => {
    if (posIndex < 0 || posIndex >= POSITION_COUNT) return {};
    return { variableMarks: {
      ...s.variableMarks,
      [id]: s.variableMarks[id].map((marked, index) => index === posIndex ? !marked : marked),
    } };
  }),

  setSlotValue: (id, posIndex, voiceIndex, value) =>
    set((s) => {
      if (s.options.lockedMarkedVariables && s.variableMarks[id][posIndex]) return {};
      const positions = setSlot(s.positions, id, posIndex, voiceIndex, value);
      if (posIndex === positions[id].active) {
        const voices = applyPosition(s.project.voices, id, positions[id].slots[posIndex]);
        return { positions, project: { ...s.project, voices } };
      }
      return { positions };
    }),

  transferVariablePosition: (id, source, destination, copy) => set((s) => {
    if (source < 0 || source >= POSITION_COUNT || destination < 0
      || destination >= POSITION_COUNT) return {};
    if (s.options.lockedMarkedVariables
      && (s.variableMarks[id][source] || s.variableMarks[id][destination])) return {};
    const positions = transferPosition(s.positions, id, source, destination, copy);
    const voices = applyPosition(
      s.project.voices, id, positions[id].slots[positions[id].active],
    );
    return { positions, project: { ...s.project, voices } };
  }),

  transferVariableVoice: (id, position, sourceVoice, destinationVoice, copy) => set((s) => {
    if (position < 0 || position >= POSITION_COUNT || sourceVoice < 0 || sourceVoice >= 4
      || destinationVoice < 0 || destinationVoice >= 4) return {};
    if (s.options.lockedMarkedVariables && s.variableMarks[id][position]) return {};
    const positions = transferPositionVoice(
      s.positions, id, position, sourceVoice, destinationVoice, copy,
    );
    const voices = applyPosition(
      s.project.voices, id, positions[id].slots[positions[id].active],
    );
    return { positions, project: { ...s.project, voices } };
  }),

  openEditor: (id) => set({ editingVar: id }),
  closeEditor: () => set({ editingVar: null }),

  storeSnapshot: (index, applyHeld = true) =>
    set((s) => {
      if (index < 0 || index >= SNAPSHOT_COUNT) return {};
      const snapshots = [...s.snapshots];
      snapshots[index] = s.snapshotDraft
        ? structuredClone(s.snapshotDraft)
        : captureSnapshot(
          s.project, s.positions, s.arrows, s.patternGroup,
          undefined, s.activeCyclicPositions,
        );
      const held = applyHeld && s.snapshotMode === "holding" && s.snapshotDraft
        ? executeSnapshot(s, s.snapshotDraft)
        : {};
      return {
        ...held,
        snapshots, currentSnapshot: index,
        snapshotMode: "idle", snapshotDraft: null,
      };
    }),

  recallSnapshot: (index, atSec = nowSeconds()) =>
    set((s) => {
      if (index < 0 || index >= SNAPSHOT_COUNT) return {};
      const snap = s.snapshots[index];
      if (!snap) return {};
      // Arm Restore From Snapshot with where we were a moment ago.
      const restorePoint = captureSnapshot(
        s.project, s.positions, s.arrows, s.patternGroup,
        undefined, s.activeCyclicPositions,
      );
      let slideshowTransport = s.slideshowTransport;
      let slideshows = s.slideshows;
      if (slideshowTransport.mode === "recording" && slideshowTransport.slot !== null) {
        const slot = slideshowTransport.slot;
        const result = addSlideshowAction(
          slideshowTransport, slideshows[slot], { type: "snapshot", index }, atSec,
        );
        slideshowTransport = result.state;
        slideshows = slideshows.map((show, i) => i === slot ? result.slideshow : show);
      }
      return {
        ...executeSnapshot(s, snap), restorePoint, currentSnapshot: index,
        slideshowTransport, slideshows,
      };
    }),

  eraseSnapshot: (index) =>
    set((s) => {
      if (index < 0 || index >= SNAPSHOT_COUNT) return {};
      const snapshots = [...s.snapshots];
      snapshots[index] = null;
      return {
        snapshots,
        currentSnapshot: s.currentSnapshot === index ? null : s.currentSnapshot,
      };
    }),

  restoreFromSnapshot: () =>
    set((s) => (s.restorePoint ? executeSnapshot(s, s.restorePoint) : {})),

  // Only the values actually on the Picture Numerical are accepted.
  setSnapshotQuantize: (value) =>
    set(() =>
      (QUANTIZE_VALUES as readonly number[]).includes(value)
        ? { snapshotQuantize: value }
        : {},
    ),

  setArrow: (id, next) =>
    set((s) => {
      if (s.snapshotMode !== "idle" && s.snapshotDraft) {
        const included = s.snapshotDraft.included!;
        const selected = s.snapshotMode === "editing"
          ? toggleIncluded(included.arrows!, id)
          : [...new Set([...included.arrows!, id])];
        return { snapshotDraft: {
          ...s.snapshotDraft,
          arrows: { ...s.snapshotDraft.arrows, [id]: { ...next } },
          included: { ...included, arrows: selected },
        } };
      }
      if ((id === "velocityRange" || id === "legato") && !next.on) {
        const kind = id as ContinuousKind;
        const continuousConducting = structuredClone(s.continuousConducting);
        continuousConducting[kind].enabled.fill(false);
        continuousConducting[kind].applied.fill(false);
        let voices = s.project.voices;
        if (kind === "velocityRange") {
          voices = applyPosition(
            voices, "velocityRange",
            s.positions.velocityRange.slots[s.positions.velocityRange.active],
          );
        } else voices = voices.map((voice) => ({ ...voice, legato: 1 }));
        return {
          arrows: { ...s.arrows, [id]: { ...next } }, continuousConducting,
          project: { ...s.project, voices },
        };
      }
      return { arrows: { ...s.arrows, [id]: { ...next } } };
    }),

  setPatternGroup: (index) =>
    set((s) => {
      if (index < 0 || index >= POSITION_COUNT) return {};
      if (s.snapshotMode !== "idle" && s.snapshotDraft) {
        const included = s.snapshotDraft.included!;
        return { snapshotDraft: {
          ...s.snapshotDraft, patternGroup: index,
          included: { ...included, patternGroup: s.snapshotMode === "editing" ? !included.patternGroup : true },
        } };
      }
      const project = applyPatternGroup(s.project, index);
      return {
        patternGroup: index,
        project,
        selectedPatternIndices: [project.voices[s.selectedVoice].patternIndex],
      };
    }),

  beginHold: () => set((s) => ({
    snapshotMode: "holding",
    snapshotDraft: captureSnapshot(
      s.project, s.positions, s.arrows, s.patternGroup, emptyInclusion(),
      s.activeCyclicPositions,
    ),
  })),

  doHold: () => set((s) => {
    if (s.snapshotMode === "editing") return { snapshotMode: "idle", snapshotDraft: null };
    if (s.snapshotMode !== "holding" || !s.snapshotDraft) return {};
    return { ...executeSnapshot(s, s.snapshotDraft), snapshotMode: "idle", snapshotDraft: null };
  }),

  editCurrentSnapshot: () => set((s) => {
    if (s.currentSnapshot === null || !s.snapshots[s.currentSnapshot]) return {};
    const source = structuredClone(s.snapshots[s.currentSnapshot]!);
    source.included = source.included ? {
      actives: source.included.actives ?? [],
      cyclicActives: source.included.cyclicActives ?? [],
      arrows: source.included.arrows ?? [],
      playEnabled: source.included.playEnabled ?? [],
      timeBase: source.included.timeBase ?? [],
      outputLength: source.included.outputLength ?? [],
      patternGroup: source.included.patternGroup ?? false,
    } : { ...everythingInclusion(), arrows: Object.keys(source.arrows) };
    return { snapshotMode: "editing", snapshotDraft: source };
  }),

  blinkEverything: () => set((s) => ({
    snapshotMode: "holding",
    snapshotDraft: captureSnapshot(s.project, s.positions, s.arrows, s.patternGroup, {
      ...everythingInclusion(), arrows: Object.keys(s.arrows),
    }, s.activeCyclicPositions),
  })),

  recordSlideshow: (index, atSec = nowSeconds()) => set((s) => {
    if (index < 0 || index >= s.slideshows.length) return {};
    const slideshows = s.slideshows.map((show, i) =>
      i === index ? { ...EMPTY_SLIDESHOW, events: [] } : show);
    return {
      slideshows,
      slideshowTransport: beginSlideshowRecording(index, atSec, s.options.slideshowRecordWait),
    };
  }),

  playSlideshow: (index, atSec = nowSeconds(), delaySec = 0) => set((s) => {
    if (index < 0 || index >= s.slideshows.length || s.slideshows[index].events.length === 0) return {};
    return { slideshowTransport: beginSlideshowPlayback(index, atSec, delaySec, s.isPlaying) };
  }),

  stopSlideshow: (atSec = nowSeconds()) => set((s) => {
    if (s.slideshowTransport.mode !== "recording" || s.slideshowTransport.slot === null) {
      return { slideshowTransport: IDLE_SLIDESHOW_TRANSPORT };
    }
    const slot = s.slideshowTransport.slot;
    const result = finishSlideshowRecording(
      s.slideshowTransport, s.slideshows[slot], atSec, false,
    );
    return {
      slideshowTransport: result.state,
      slideshows: s.slideshows.map((show, i) => i === slot ? result.slideshow : show),
    };
  }),

  pauseSlideshow: (atSec = nowSeconds()) => set((s) => ({
    slideshowTransport: s.slideshowTransport.paused
      ? resumeSlideshowState(s.slideshowTransport, atSec)
      : pauseSlideshowState(s.slideshowTransport, atSec),
  })),

  toggleSlideshowLoop: (atSec = nowSeconds(), remove = false) => set((s) => {
    const transport = s.slideshowTransport;
    if (transport.slot === null || transport.mode === "idle") return {};
    const slot = transport.slot;
    if (transport.mode === "recording") {
      const result = finishSlideshowRecording(transport, s.slideshows[slot], atSec, true);
      return {
        slideshowTransport: result.state,
        slideshows: s.slideshows.map((show, i) => i === slot ? result.slideshow : show),
      };
    }
    const elapsed = Math.max(0, atSec - transport.startedAtSec);
    return { slideshows: s.slideshows.map((show, i) => i === slot
      ? remove ? { ...show, loopAtSec: null } : addSlideshowLoop(show, elapsed)
      : show) };
  }),

  advanceSlideshow: (atSec = nowSeconds()) => {
    const before = get();
    const transport = before.slideshowTransport;
    if (transport.mode !== "playing" || transport.slot === null) return;
    const result = advanceSlideshowState(transport, before.slideshows[transport.slot], atSec);
    set({ slideshowTransport: result.state });
    for (const action of result.actions) {
      if (action.type === "snapshot") get().recallSnapshot(action.index, atSec);
      else if (["accent", "legato", "rhythm"].includes(action.variable)) {
        get().activateCyclicPosition(action.variable as CyclicVariable, action.position);
      } else {
        get().activatePosition(action.variable as PositionVarId, action.position);
      }
    }
  },

  setMidiConduct: (on) => set({ midiConduct: on }),
  setRobot: (on) => set({ robotConductor: on }),
  setPaused: (paused) => set({ isPaused: paused }),

  setContinuousConducting: (kind, voice, enabled, direction) => set((s) => {
    if (voice < 0 || voice >= 4) return {};
    const continuousConducting = structuredClone(s.continuousConducting);
    continuousConducting[kind].enabled[voice] = enabled;
    if (direction) continuousConducting[kind].directions[voice] = direction;
    if (!enabled) continuousConducting[kind].applied[voice] = false;
    let voices = s.project.voices;
    if (!enabled && kind === "velocityRange") {
      const slot = s.positions.velocityRange.slots[s.positions.velocityRange.active];
      voices = applyPosition(voices, "velocityRange", slot);
    } else if (!enabled && kind === "legato") {
      voices = voices.map((item, index) => index === voice ? { ...item, legato: 1 } : item);
    }
    return {
      continuousConducting,
      arrows: { ...s.arrows, [kind]: {
        ...(s.arrows[kind] ?? { dir: direction ?? "right" }), on: enabled
          || continuousConducting[kind].enabled.some(Boolean),
      } },
      project: { ...s.project, voices },
    };
  }),

  clearContinuousConducting: () => set((s) => {
    const continuousConducting = structuredClone(s.continuousConducting);
    continuousConducting.velocityRange.applied.fill(false);
    continuousConducting.legato.applied.fill(false);
    let voices = applyPosition(
      s.project.voices, "velocityRange",
      s.positions.velocityRange.slots[s.positions.velocityRange.active],
    );
    voices = voices.map((voice) => ({ ...voice, legato: 1 }));
    return { continuousConducting, project: { ...s.project, voices } };
  }),

  conductAt: (x, y, options) => set((s) => conductUpdate(s, { x, y }, options)),

  setTempoRange: (low, high) =>
    set((s) => {
      const tempoRange = normalizeTempoRange(low, high);
      return {
        tempoRange,
        project: {
          ...s.project,
          tempo: conductedTempo(tempoRange, 0.5),
        },
      };
    }),

  setSyncRatio: (value) =>
    set(() =>
      (CONDUCTOR_RATIOS as readonly number[]).includes(value)
        ? { syncRatio: value as MStore["syncRatio"] }
        : {},
    ),
  setSyncRatioDirection: (direction) => set({ syncRatioDirection: direction }),
  setRobotRange: (axis, value) =>
    set((s) => ({
      robotRange: {
        ...s.robotRange,
        [axis]: Math.max(0, Math.min(1, value)),
      },
    })),
  setRobotTimeBase: (value) =>
    set(() =>
      (CONDUCTOR_RATIOS as readonly number[]).includes(value)
        ? { robotTimeBase: value as MStore["robotTimeBase"] }
        : {},
    ),
  robotStep: (signedX, signedY) =>
    set((s) =>
      conductUpdate(
        s,
        robotMove(s.baton, { x: signedX, y: signedY }, s.robotRange),
      ),
    ),
}));

/**
 * The musical slices of the store — the same ground the project document
 * covers. Every mutation is immutable, so a reference comparison is enough to
 * notice a real edit without walking the data.
 */
const MUSICAL_SLICES = [
  "project", "positions", "variableMarks", "snapshots", "currentSnapshot", "snapshotQuantize",
  "slideshows",
  "arrows", "patternGroup", "cyclicPositions", "cyclicLengths",
  "activeCyclicPositions", "tempoRange", "syncRatio", "syncRatioDirection",
  "robotRange", "robotTimeBase", "options",
] as const satisfies readonly (keyof MStore)[];

/**
 * Mark the document dirty when the music changes. Transport, selection and
 * editor state deliberately don't count. A wholesale replace — Open or New —
 * bumps `documentEpoch`, which is how this tells "the user edited something"
 * apart from "the document was swapped out underneath us".
 */
useM.subscribe((state, previous) => {
  if (state.documentEpoch !== previous.documentEpoch) return;
  if (state.isDirty) return;
  if (MUSICAL_SLICES.some((key) => state[key] !== previous[key])) {
    useM.setState({ isDirty: true });
  }
});
