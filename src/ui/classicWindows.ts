// The Classic windows' content sizes, in points, as the original M 2.8 defines
// them in its window resources. A window's body is exactly this size at 1x;
// the title bar sits above it, as on the Mac. At 2x everything doubles.
//
// These are dimensions only. The artwork inside each window is this build's
// own; nothing here copies the original's pictures.

import type { PositionVarId } from "../engine/variables";

export type ClassicWindowId =
  | "patterns" | "conducting" | "snapshot" | "variables" | "cyclicVariables"
  | "midi" | "midiAssignment" | "noteOrder" | "velocityRange" | "noteDensity"
  | "cyclicEditor" | "orchestration" | "transposition" | "timeDistortion"
  | "patternEditor";

export type ClassicWindowSize = { width: number; height: number };

export const CLASSIC_WINDOW_SIZES: Readonly<Record<ClassicWindowId, ClassicWindowSize>> = {
  patterns: { width: 216, height: 104 },
  conducting: { width: 226, height: 104 },
  snapshot: { width: 57, height: 315 },
  variables: { width: 216, height: 158 },
  cyclicVariables: { width: 226, height: 158 },
  midi: { width: 446, height: 44 },
  midiAssignment: { width: 468, height: 300 },
  noteOrder: { width: 199, height: 137 },
  velocityRange: { width: 217, height: 87 },
  noteDensity: { width: 183, height: 100 },
  cyclicEditor: { width: 273, height: 212 },
  orchestration: { width: 203, height: 96 },
  transposition: { width: 168, height: 96 },
  timeDistortion: { width: 245, height: 260 },
  /** The original's default; this window can be resized larger. */
  patternEditor: { width: 297, height: 149 },
};

const VARIABLE_EDITORS: Readonly<Record<PositionVarId, ClassicWindowId>> = {
  density: "noteDensity",
  velocityRange: "velocityRange",
  noteOrderMix: "noteOrder",
  transposition: "transposition",
  timeDistort: "timeDistortion",
  outputChannels: "orchestration",
};

export function variableEditorWindow(id: PositionVarId): ClassicWindowId {
  return VARIABLE_EDITORS[id];
}

/** The body style that pins a window to its original size. */
export function classicWindowSize(id: ClassicWindowId): ClassicWindowSize {
  return { ...CLASSIC_WINDOW_SIZES[id] };
}
