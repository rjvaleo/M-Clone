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
import {
  DEFAULT_OPTIONS,
  setOption as setOptionValue,
  type OptionId,
  type Options,
} from "../engine/options";
import {
  makePresetPositions,
  applyActivePositions,
  applyPosition,
  setSlot,
  POSITION_COUNT,
  POSITION_VARS,
  type VariablePositions,
  type PositionVarId,
  type PositionValue,
} from "../engine/variables";
import {
  type ArrowState,
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
  normalizeTempoRange,
  positionFromBaton,
  robotMove,
  type BatonPoint,
  type TempoRange,
} from "../engine/conductor";
import { normalizeCyclicStep } from "../engine/cyclic";
import {
  eventsForPlannedNotes,
  mergeMidiViewEvents,
  type MidiViewEvent,
} from "../engine/midiview";
import type { PlannedNote } from "../engine/planner";
import {
  EMPTY_MOVIE_RECORDER,
  armMovie,
  captureMovieNotes,
  finishMovie,
  type MovieRecorder,
} from "../engine/movie";

/** 26 Snapshot locations, one per letter key A-Z. */
export const SNAPSHOT_COUNT = 26;
/**
 * Hard ceiling the Pattern Size Numerical can be raised to — "You can have
 * up to 999 notes in a Pattern."
 */
export const MAX_PATTERN_STEPS = 999;

function isPositionVar(key: keyof VoiceState): key is PositionVarId {
  return (POSITION_VARS as string[]).includes(key as string);
}

/** Keep M's stored Cyclic Random copy coherent after an Original-list edit. */
function withRegeneratedScramble(
  pattern: Pattern,
  steps: StepEvent[],
  projectSeed: number,
  patternIndex: number,
): Pattern {
  const generation = pattern.scrambleGeneration + 1;
  const seed = projectSeed + patternIndex * 997 + generation * 7919;
  return {
    ...pattern,
    steps,
    scrambledSteps: scrambleSteps(steps, seed),
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
  let project = applySnapshot(s.project, snap);
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
    patternGroup: snapshotIncludes(snap, "patternGroup")
      ? snap.patternGroup
      : (s as MStore).patternGroup,
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
  cyclicPositions: CyclicPositionBanks;
  cyclicLengths: CyclicPositionLengths;
  activeCyclicPositions: Record<CyclicVariable, number>;
  midiViewEvents: MidiViewEvent[];
  midiViewNextId: number;
  movieRecorder: MovieRecorder;

  setTempo: (bpm: number) => void;
  setPlaying: (playing: boolean) => void;
  selectVoice: (index: number) => void;
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
  newDocument: () => void;
  /** The Edit menu clipboard, holding copied steps. */
  clipboard: StepEvent[];
  setClipboard: (steps: StepEvent[]) => void;
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
  clearMidiView: () => void;
  toggleMovieRecording: () => void;
  stopMovieRecording: () => void;

  activatePosition: (id: PositionVarId, posIndex: number) => void;
  setSlotValue: (
    id: PositionVarId,
    posIndex: number,
    voiceIndex: number,
    value: PositionValue,
  ) => void;
  openEditor: (id: PositionVarId) => void;
  closeEditor: () => void;

  storeSnapshot: (index: number) => void;
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
  conductAt: (x: number, y: number) => void;
  setTempoRange: (low: number, high: number) => void;
  setSyncRatio: (value: number) => void;
  setSyncRatioDirection: (direction: "out" | "in") => void;
  setRobotRange: (axis: "x" | "y", value: number) => void;
  setRobotTimeBase: (value: number) => void;
  robotStep: (signedX: number, signedY: number) => void;
};

const CONDUCTOR_RATIOS = [1, 2, 4, 8, 16] as const;

function conductUpdate(s: MStore, rawPoint: BatonPoint) {
  const baton = clampBaton(rawPoint);
  let positions = s.positions;
  for (const id of POSITION_VARS) {
    const arrow = s.arrows[id];
    if (!arrow?.on) continue;
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

  return {
    baton,
    positions,
    activeCyclicPositions,
    patternGroup,
    project: {
      ...s.project,
      tempo,
      cyclic,
      cyclicLengths,
      voices: applyActivePositions(s.project.voices, positions),
    },
  };
}

export const useM = create<MStore>((set, get) => ({
  ...freshDocument(),
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
  options: { ...DEFAULT_OPTIONS },
  editorRegion: null,
  documentName: null,
  isDirty: false,
  documentEpoch: 0,
  selectedVoice: 0,
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
  midiViewNextId: 0,
  movieRecorder: EMPTY_MOVIE_RECORDER,

  setTempo: (bpm) => set((s) => ({ project: { ...s.project, tempo: bpm } })),

  setPlaying: (playing) => {
    set((s) => ({
      isPlaying: playing,
      slideshowTransport: playing
        ? resumeSlideshowState(s.slideshowTransport, nowSeconds())
        : pauseSlideshowState(s.slideshowTransport, nowSeconds()),
    }));
  },

  selectVoice: (index) => set({ selectedVoice: index }),

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
      let positions = s.positions;
      if (isPositionVar(key)) {
        const active = positions[key].active;
        positions = setSlot(positions, key, active, index, value as PositionValue);
      }
      return { project: { ...s.project, voices }, positions };
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
              ...withRegeneratedScramble(p, steps, s.project.seed, pi),
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
            ...withRegeneratedScramble(p, steps, s.project.seed, pi),
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
            ...withRegeneratedScramble(p, steps, s.project.seed, pi),
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
      project: d.project,
      positions: d.positions,
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
      editorRegion: null,
      editingVar: null,
      midiViewEvents: [],
      midiViewNextId: 0,
      movieRecorder: EMPTY_MOVIE_RECORDER,
    }));
    return result;
  },

  newDocument: () => {
    const blank = freshDocument();
    set((s) => ({
      documentName: null,
      isDirty: false,
      documentEpoch: s.documentEpoch + 1,
      ...blank,
      snapshots: Array<Snapshot | null>(SNAPSHOT_COUNT).fill(null),
      slideshows: Array.from({ length: 9 }, () => ({ ...EMPTY_SLIDESHOW, events: [] })),
      currentSnapshot: null,
      restorePoint: null,
      snapshotMode: "idle",
      snapshotDraft: null,
      slideshowTransport: IDLE_SLIDESHOW_TRANSPORT,
      snapshotQuantize: 0,
      arrows: {},
      patternGroup: 0,
      clipboard: [],
      editorRegion: null,
      options: { ...DEFAULT_OPTIONS },
      selectedVoice: 0,
      isPlaying: false,
      isPaused: false,
      editingVar: null,
      midiViewEvents: [],
      midiViewNextId: 0,
      movieRecorder: EMPTY_MOVIE_RECORDER,
    }));
  },

  setClipboard: (steps) => set({ clipboard: steps.map((s) => ({ pitches: [...s.pitches] })) }),

  setOption: (id, on) => set((s) => ({ options: setOptionValue(s.options, id, on) })),

  setEditorRegion: (region) => set({ editorRegion: region }),

  runPatternCommand: (patternIndex, command) =>
    set((s) => ({
      project: {
        ...s.project,
        patterns: s.project.patterns.map((p, pi) => {
          if (pi !== patternIndex) return p;
          const steps = command(p.steps, p.maxSize);
          return {
            ...withRegeneratedScramble(p, steps, s.project.seed, pi),
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
    set((s) => ({ project: { ...s.project, secondOrderTranspose: on } })),
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
  recordMidiNotes: (notes) =>
    set((s) => {
      const incoming = eventsForPlannedNotes(notes, s.midiViewNextId);
      return {
        midiViewEvents: mergeMidiViewEvents(s.midiViewEvents, incoming),
        midiViewNextId: s.midiViewNextId + incoming.length,
        movieRecorder: captureMovieNotes(s.movieRecorder, notes, s.project.tempo),
      };
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

  setSlotValue: (id, posIndex, voiceIndex, value) =>
    set((s) => {
      const positions = setSlot(s.positions, id, posIndex, voiceIndex, value);
      if (posIndex === positions[id].active) {
        const voices = applyPosition(s.project.voices, id, positions[id].slots[posIndex]);
        return { positions, project: { ...s.project, voices } };
      }
      return { positions };
    }),

  openEditor: (id) => set({ editingVar: id }),
  closeEditor: () => set({ editingVar: null }),

  storeSnapshot: (index) =>
    set((s) => {
      if (index < 0 || index >= SNAPSHOT_COUNT) return {};
      const snapshots = [...s.snapshots];
      snapshots[index] = s.snapshotDraft
        ? structuredClone(s.snapshotDraft)
        : captureSnapshot(
          s.project, s.positions, s.arrows, s.patternGroup,
          undefined, s.activeCyclicPositions,
        );
      return {
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
      return { patternGroup: index };
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

  conductAt: (x, y) => set((s) => conductUpdate(s, { x, y })),

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
  "project", "positions", "snapshots", "currentSnapshot", "snapshotQuantize",
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
