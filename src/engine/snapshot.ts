// Snapshots — M's 26 stores of screen-control settings, one per letter A-Z.
//
// The critical detail, and the one that makes Snapshots a performance tool
// rather than a save format: "a Snapshot only stores the Position (1-6) of the
// Variable, not the contents at that Position." Edit what lives at Position c
// and every Snapshot pointing at c plays the new thing. So this captures
// indices and switch settings, never musical material.
//
// Chapter 18 lists what a Snapshot holds:
//   • All Variable Positions.
//   • Settings of all Conducting Arrows.
//   • Per Voice in the Patterns Window: Src Channel, Play-Enable,
//     Echo-Thru-Orchestration, Mouse Advance, Output Length, Time Base, Phase.
//   • Sync.
//   • Play-Enabling the MIDI File Sequence.
//
// Of those, this captures the ones the rebuild actually has: Variable
// Positions, Conducting Arrows, Play-Enable, Time Base and Output Length. Src
// Channel, Echo-Thru, Mouse Advance, Phase and the Sequence don't exist yet.

import type { ProjectState } from "./types";
import { POSITION_VARS, type PositionVarId, type VariablePositions } from "./variables";

/** The four Conducting Grid axes a Conducting Arrow can point along. */
export const ARROW_DIRS = ["right", "down", "left", "up"] as const;
export type ArrowDir = (typeof ARROW_DIRS)[number];

/** A Conducting Arrow: whether it's armed, and which Grid axis it reads. */
export type ArrowState = { on: boolean; dir: ArrowDir };

/** Controls selected while Hold/Do or Edit Snapshot is active. */
export type SnapshotInclusion = {
  actives?: PositionVarId[];
  arrows?: string[];
  playEnabled?: number[];
  timeBase?: number[];
  outputLength?: number[];
  patternGroup?: boolean;
};

export type Snapshot = {
  /** Active Position per Variable — the index, deliberately not the contents. */
  actives: Record<PositionVarId, number>;
  /** Which Variables are armed for Conducting, and along which Grid axis. */
  arrows: Record<string, ArrowState>;
  playEnabled: boolean[];
  timeBase: { numerator: number; denominator: number }[];
  outputLength: number[];
  /** The active Pattern Group (a-f). */
  patternGroup: number;
  /** Absent on legacy Snapshots, which include every captured control. */
  included?: SnapshotInclusion;
};

export function snapshotIncludes(
  snap: Snapshot,
  kind: keyof SnapshotInclusion,
  id?: string | number,
): boolean {
  if (!snap.included) return true;
  const value = snap.included[kind];
  if (kind === "patternGroup") return value === true;
  return Array.isArray(value) && id !== undefined && value.includes(id as never);
}

/** Take the picture. */
export function captureSnapshot(
  project: ProjectState,
  positions: VariablePositions,
  arrows: Record<string, ArrowState>,
  patternGroup: number,
  included?: SnapshotInclusion,
): Snapshot {
  const actives = {} as Record<PositionVarId, number>;
  for (const id of POSITION_VARS) actives[id] = positions[id].active;
  const snapshot: Snapshot = {
    actives,
    arrows: Object.fromEntries(
      Object.entries(arrows).map(([k, v]) => [k, { ...v }]),
    ),
    playEnabled: project.voices.map((v) => v.playEnabled),
    timeBase: project.voices.map((v) => ({
      numerator: v.timeBaseNumerator,
      denominator: v.timeBaseDenominator,
    })),
    outputLength: project.patterns.map((p) => p.outputLength),
    patternGroup,
  };
  if (included) {
    snapshot.included = {
      ...included,
      actives: included.actives ? [...included.actives] : undefined,
      arrows: included.arrows ? [...included.arrows] : undefined,
      playEnabled: included.playEnabled ? [...included.playEnabled] : undefined,
      timeBase: included.timeBase ? [...included.timeBase] : undefined,
      outputLength: included.outputLength ? [...included.outputLength] : undefined,
    };
  }
  return snapshot;
}

/**
 * Put a captured Snapshot back onto the project. Variable Positions are
 * returned as indices for the caller to activate, because activating a Position
 * reads whatever lives there now — which is the whole point.
 */
export function applySnapshot(project: ProjectState, snap: Snapshot): ProjectState {
  return {
    ...project,
    voices: project.voices.map((v, i) => ({
      ...v,
      playEnabled: snapshotIncludes(snap, "playEnabled", i)
        ? snap.playEnabled[i] ?? v.playEnabled
        : v.playEnabled,
      timeBaseNumerator: snapshotIncludes(snap, "timeBase", i)
        ? snap.timeBase[i]?.numerator ?? v.timeBaseNumerator
        : v.timeBaseNumerator,
      timeBaseDenominator: snapshotIncludes(snap, "timeBase", i)
        ? snap.timeBase[i]?.denominator ?? v.timeBaseDenominator
        : v.timeBaseDenominator,
    })),
    patterns: project.patterns.map((p, i) => ({
      ...p,
      outputLength: snapshotIncludes(snap, "outputLength", i)
        ? Math.min(p.steps.length, snap.outputLength[i] ?? p.outputLength)
        : p.outputLength,
    })),
  };
}

/** The 26 letters the Snapshot locations are labelled and keyed with. */
export const SNAPSHOT_LETTERS = Array.from({ length: 26 }, (_, i) =>
  String.fromCharCode(65 + i),
);

/**
 * Snapshot Quantization: the rhythmic value executions are rounded off to.
 * 0 is the wave, which "means that no quantization is performed"; the rest are
 * note divisions of a whole note.
 */
export const QUANTIZE_VALUES = [0, 1, 2, 4, 8, 16] as const;

/** Seconds from `now` until the next quantization point, or 0 for none. */
export function quantizeDelay(
  quantize: number,
  tempo: number,
  elapsedSec: number,
): number {
  if (quantize <= 0 || tempo <= 0) return 0;
  const unitSec = (60 / tempo) * (4 / quantize);
  const into = elapsedSec % unitSec;
  // Landing exactly on a point means there is nothing to wait for.
  return into === 0 ? 0 : unitSec - into;
}
