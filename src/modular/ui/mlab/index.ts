/** The M module faces, by the custom element id each descriptor names, and each one's Numerology type title. */

import type { ComponentType } from "react";
import type { MLabFaceProps } from "./common";
import { ConductorFace } from "./ConductorFace";
import { NoteSeqFace } from "./NoteSeqFace";
import { OrchestraFace } from "./OrchestraFace";
import { TimeWarpFace } from "./TimeWarpFace";
import { VariablesFace } from "./VariablesFace";

export { MLabHostContext, type MLabHost } from "./common";

export const MLAB_FACES: Record<string, ComponentType<MLabFaceProps>> = {
  "m-lab-noteseq": NoteSeqFace,
  "m-lab-time-warp": TimeWarpFace,
  "m-lab-variables": VariablesFace,
  "m-lab-conductor": ConductorFace,
  "m-lab-orchestra": OrchestraFace,
};

/** The type name at the right of each module's header, as Numerology shows "MonoNote Sequencer". */
export const N4_TITLES: Record<string, string> = {
  "m.lab-noteseq": "M Note Sequencer",
  "m.lab-time-warp": "CV Sequencer",
  "m.lab-variables": "M Variables",
  "m.lab-conductor": "M Conductor",
  "m.lab-orchestra": "Orchestra Matrix",
};
