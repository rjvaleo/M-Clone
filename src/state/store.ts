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
  type ProjectDocumentV1,
  decodeDocument,
  encodeDocument,
} from "../engine/document";
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
  QUANTIZE_VALUES,
  applySnapshot,
  captureSnapshot,
} from "../engine/snapshot";
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
  s: { project: ProjectState; positions: VariablePositions },
  snap: Snapshot,
): { project: ProjectState; positions: VariablePositions; arrows: Record<string, ArrowState>; patternGroup: number } {
  let positions = s.positions;
  for (const id of POSITION_VARS) {
    const active = snap.actives[id];
    if (active === undefined) continue;
    positions = { ...positions, [id]: { ...positions[id], active } };
  }
  const project = applySnapshot(s.project, snap);
  return {
    project: { ...project, voices: applyActivePositions(project.voices, positions) },
    positions,
    arrows: Object.fromEntries(
      Object.entries(snap.arrows).map(([k, v]) => [k, { ...v }]),
    ),
    patternGroup: snap.patternGroup,
  };
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
  exportDocument: () => ProjectDocumentV1;
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
  recallSnapshot: (index: number) => void;
  /** Erase Snapshot, from the Edit menu. */
  eraseSnapshot: (index: number) => void;
  /** Undo the changes brought about by the most recently executed Snapshot. */
  restoreFromSnapshot: () => void;
  setSnapshotQuantize: (value: number) => void;
  setArrow: (id: string, next: ArrowState) => void;
  setPatternGroup: (index: number) => void;

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
    patternGroup,
    project: {
      ...s.project,
      tempo,
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
  arrows: {},
  patternGroup: 0,
  clipboard: [],
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

  setTempo: (bpm) => set((s) => ({ project: { ...s.project, tempo: bpm } })),

  setPlaying: (playing) => set({ isPlaying: playing }),

  selectVoice: (index) => set({ selectedVoice: index }),

  toggleVoiceEnabled: (index) =>
    set((s) => ({
      project: {
        ...s.project,
        voices: s.project.voices.map((v, i) =>
          i === index ? { ...v, playEnabled: !v.playEnabled } : v,
        ),
      },
    })),

  setVoiceParam: (index, key, value) =>
    set((s) => {
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
    set((s) => ({
      project: {
        ...s.project,
        patterns: s.project.patterns.map((p, pi) =>
          pi !== patternIndex
            ? p
            : { ...p, outputLength: Math.max(0, Math.min(p.steps.length, length)) },
        ),
      },
    })),

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
      // Playback and everything derived from the old piece has to go: the
      // transport is stopped, and undo/clipboard/monitor state belonged to a
      // project that no longer exists.
      isPlaying: false,
      isPaused: false,
      restorePoint: null,
      clipboard: [],
      editingVar: null,
      midiViewEvents: [],
      midiViewNextId: 0,
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
      currentSnapshot: null,
      restorePoint: null,
      snapshotQuantize: 0,
      arrows: {},
      patternGroup: 0,
      clipboard: [],
      selectedVoice: 0,
      isPlaying: false,
      isPaused: false,
      editingVar: null,
      midiViewEvents: [],
      midiViewNextId: 0,
    }));
  },

  setClipboard: (steps) => set({ clipboard: steps.map((s) => ({ pitches: [...s.pitches] })) }),

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
      return {
        activeCyclicPositions: { ...s.activeCyclicPositions, [kind]: pos },
        project: {
          ...s.project,
          cyclic: { ...s.project.cyclic, [kind]: s.cyclicPositions[kind][pos].map((v) => [...v]) },
          cyclicLengths: { ...s.project.cyclicLengths, [kind]: [...s.cyclicLengths[kind][pos]] },
        },
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
      };
    }),
  clearMidiView: () => set({ midiViewEvents: [], midiViewNextId: 0 }),

  activatePosition: (id, posIndex) =>
    set((s) => {
      const positions = {
        ...s.positions,
        [id]: { ...s.positions[id], active: posIndex },
      };
      const voices = applyPosition(
        s.project.voices,
        id,
        positions[id].slots[posIndex],
      );
      return { positions, project: { ...s.project, voices } };
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
      snapshots[index] = captureSnapshot(
        s.project, s.positions, s.arrows, s.patternGroup,
      );
      return { snapshots, currentSnapshot: index };
    }),

  recallSnapshot: (index) =>
    set((s) => {
      if (index < 0 || index >= SNAPSHOT_COUNT) return {};
      const snap = s.snapshots[index];
      if (!snap) return {};
      // Arm Restore From Snapshot with where we were a moment ago.
      const restorePoint = captureSnapshot(
        s.project, s.positions, s.arrows, s.patternGroup,
      );
      return { ...executeSnapshot(s, snap), restorePoint, currentSnapshot: index };
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
    set((s) => ({ arrows: { ...s.arrows, [id]: { ...next } } })),

  setPatternGroup: (index) =>
    set(() =>
      index >= 0 && index < POSITION_COUNT ? { patternGroup: index } : {},
    ),

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
  "arrows", "patternGroup", "cyclicPositions", "cyclicLengths",
  "activeCyclicPositions", "tempoRange", "syncRatio", "syncRatioDirection",
  "robotRange", "robotTimeBase",
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
