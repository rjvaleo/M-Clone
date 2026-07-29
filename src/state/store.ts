// Central app state (zustand). Holds the project document, the Variable
// Positions layer, snapshots, and a bit of UI state. All mutations are
// immutable so React and the engine read consistent snapshots. The engine
// reads `project` live, which is what makes "ride the sliders while it plays"
// work — positions apply by writing into the live voice fields.

import { create } from "zustand";
import type { ProjectState, VoiceState } from "../engine/types";
import type { ScaleName } from "../engine/music";
import { createDefaultProject } from "../engine/project";
import {
  makeDefaultPositions,
  applyPosition,
  setSlot,
  POSITION_VARS,
  type VariablePositions,
  type PositionVarId,
  type PositionValue,
} from "../engine/variables";

export const SNAPSHOT_COUNT = 6;

function isPositionVar(key: keyof VoiceState): key is PositionVarId {
  return (POSITION_VARS as string[]).includes(key as string);
}

function freshPositions(): VariablePositions {
  return makeDefaultPositions(createDefaultProject().voices);
}

export type MStore = {
  project: ProjectState;
  positions: VariablePositions;
  snapshots: (ProjectState | null)[];
  selectedVoice: number;
  isPlaying: boolean;
  editingVar: PositionVarId | null;
  midiConduct: boolean;
  robotConductor: boolean;

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
  setOutputLength: (patternIndex: number, length: number) => void;
  setScaleSnap: (on: boolean) => void;
  setScale: (scale: ScaleName) => void;
  setRoot: (root: number) => void;
  setSeed: (seed: number) => void;

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

  setMidiConduct: (on: boolean) => void;
  setRobot: (on: boolean) => void;
};

export const useM = create<MStore>((set) => ({
  project: createDefaultProject(),
  positions: freshPositions(),
  snapshots: Array<ProjectState | null>(SNAPSHOT_COUNT).fill(null),
  selectedVoice: 0,
  isPlaying: false,
  editingVar: null,
  midiConduct: false,
  robotConductor: false,

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
            : {
                ...p,
                steps: p.steps.map((st, si) =>
                  si !== stepIndex
                    ? st
                    : {
                        pitches: st.pitches.includes(pitch)
                          ? st.pitches.filter((x) => x !== pitch)
                          : [...st.pitches, pitch].sort((a, b) => a - b),
                      },
                ),
              },
        ),
      },
    })),

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

  setScaleSnap: (on) => set((s) => ({ project: { ...s.project, scaleSnap: on } })),
  setScale: (scale) => set((s) => ({ project: { ...s.project, scale } })),
  setRoot: (root) => set((s) => ({ project: { ...s.project, root } })),
  setSeed: (seed) => set((s) => ({ project: { ...s.project, seed } })),

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
      const snapshots = [...s.snapshots];
      snapshots[index] = structuredClone(s.project);
      return { snapshots };
    }),

  recallSnapshot: (index) =>
    set((s) => {
      const snap = s.snapshots[index];
      if (!snap) return {};
      const project = structuredClone(snap);
      return { project, positions: makeDefaultPositions(project.voices) };
    }),

  setMidiConduct: (on) => set({ midiConduct: on }),
  setRobot: (on) => set({ robotConductor: on }),
}));
