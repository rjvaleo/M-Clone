// Every module drawn as a panel rather than as the generic face.

import type { PanelLayout } from "../layout";
import { BANK_STRIP } from "./bankStrip";
import { COMP_GRAPH } from "./compGraph";
import { GRAIN_CABINET } from "./grainCabinet";
import { PLATE_NIGHT } from "./plateNight";
import { SH_DELAY } from "./shDelay";
import { HYPERPRISM_PANELS } from "./hyperprism";
import { LEXICON_PANELS } from "./lexicon";
import { SOUNDHACK_PANELS } from "./soundhack";

export const PANEL_LAYOUTS: readonly PanelLayout[] = [GRAIN_CABINET, PLATE_NIGHT, COMP_GRAPH, BANK_STRIP, SH_DELAY, ...SOUNDHACK_PANELS, ...LEXICON_PANELS, ...HYPERPRISM_PANELS];

const BY_TYPE = new Map(PANEL_LAYOUTS.map((layout) => [layout.moduleType, layout]));

/** The panel a module type is drawn with, if it has one. */
export const panelFor = (moduleType: string): PanelLayout | undefined => BY_TYPE.get(moduleType);
