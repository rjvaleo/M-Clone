// Every module drawn as a panel rather than as the generic face.

import type { JsonValue } from "../../../model/graph";
import type { PanelLayout } from "../layout";
import { BANK_STRIP } from "./bankStrip";
import { COMP_GRAPH } from "./compGraph";
import { grainFace } from "./grainCabinet";
import { PLATE_NIGHT } from "./plateNight";
import { SH_DELAY } from "./shDelay";
import { HYPERPRISM_PANELS } from "./hyperprism";
import { LEXICON_PANELS } from "./lexicon";
import { SOUNDHACK_PANELS } from "./soundhack";
import { NIGHT_PANELS } from "./nightPorts";
import { STRIP_PANELS } from "./stripPorts";
import { GRAPH_PANELS } from "./graphPorts";
import { CABINET_PANELS } from "./cabinetPorts";

/** The Grain Engine at its defaults; its face follows its engine and switches (`panelForNode`). */
const GRAIN_CABINET = grainFace({});

export const PANEL_LAYOUTS: readonly PanelLayout[] = [GRAIN_CABINET, PLATE_NIGHT, COMP_GRAPH, BANK_STRIP, SH_DELAY, ...SOUNDHACK_PANELS, ...LEXICON_PANELS, ...HYPERPRISM_PANELS,
  ...NIGHT_PANELS, ...STRIP_PANELS, ...GRAPH_PANELS, ...CABINET_PANELS];

const BY_TYPE = new Map(PANEL_LAYOUTS.map((layout) => [layout.moduleType, layout]));

/** The panel a module type is drawn with, if it has one. */
export const panelFor = (moduleType: string): PanelLayout | undefined => BY_TYPE.get(moduleType);

/**
 * The panel a module is drawn with now. The Grain Engine's banks are the
 * engine's own, as MultiGrainLive's tray rebuilds them for the engine chosen;
 * every other panel is fixed.
 */
export const panelForNode = (node: { moduleType: string; parameters: Record<string, JsonValue> }): PanelLayout | undefined =>
  node.moduleType === "m.grain-engine" ? grainFace(node.parameters) : panelFor(node.moduleType);
