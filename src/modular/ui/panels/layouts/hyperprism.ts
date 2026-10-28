// Hyperprism's controller window, one per process: the blue window, its top
// edge one setting and its left edge another, each with its low and high limit
// at the ends; the Presets pop-up and the process's additional settings, typed
// into boxes, beside it; Post-Roll under them (MultiGrainLive docs/HYPERPRISM.md).
//
// The pair is the one the crate's descriptors give the pad: the first control
// across, the second up, linear on both as the original's was. Every process
// is built from the catalogue, so a process's window always matches its
// controls.
//
// Drawn dimmed: the Presets pop-up (Hyperprism's 180 factory presets are not
// in idMLab yet) and Post-Roll (MultiGrainLive's transport has it; idMLab's
// modules do not). The limits show the controls' full ranges, as typing new
// ones is not kept by an idMLab module.

import { PRISM_CATALOG } from "../../../registry/prismCatalog.generated";
import type { PrismEffect } from "../../../registry/prismTypes";
import { prismType } from "../../../registry/prismModules";
import type { PanelControl, PanelLayout } from "../layout";

const WIDTH = 420;
const HEIGHT = 310;
/** The right-hand column of settings. */
const COLUMN = { x: 306, w: 108 };

/** A Hyperprism process's window, from its effect in the catalogue. */
export function hyperprismWindow(effect: PrismEffect): PanelLayout {
  const [x, y, ...rest] = effect.params;
  const settings: PanelControl[] = rest.map((p, i) => {
    const at = { x: COLUMN.x, y: 34 + 40 * i, w: COLUMN.w };
    const label = p.unit ? `${p.label} (${p.unit})` : p.label;
    if (p.kind === "toggle") return { param: p.key, kind: "switch", label, ...at, h: 22 };
    if (p.kind === "choice") return { param: p.key, kind: "select", menu: true, label, ...at, h: 36 };
    return { param: p.key, kind: "field", label, ...at, h: 36 };
  });
  const below = 34 + 40 * rest.length;
  return {
    moduleType: prismType(effect.id),
    style: "platinum",
    width: WIDTH,
    height: HEIGHT,
    groups: [
      { id: "pad", label: "", x: 0, y: 0, w: 300, h: HEIGHT },
      { id: "settings", label: "", x: 300, y: 0, w: WIDTH - 300, h: HEIGHT },
    ],
    controls: [
      { param: x.key, paramY: y.key, kind: "pad", x: 34, y: 26, w: 262, h: 260 },
      ...settings,
      { param: "mute", kind: "switch", label: "Mute", x: COLUMN.x, y: 282, w: COLUMN.w, h: 22 },
    ],
    displays: [
      { kind: "hp-x-axis", x: 34, y: 2, w: 262, h: 22 },
      { kind: "hp-y-axis", x: 2, y: 26, w: 30, h: 260 },
      { kind: "hp-values", x: 34, y: 289, w: 262, h: 18 },
    ],
    inert: [
      { label: "Presets ▾", kind: "switch", x: COLUMN.x, y: 6, w: COLUMN.w, h: 22, why: "Hyperprism's factory presets are not in idMLab yet" },
      { label: "Post-Roll (ms): 0", kind: "switch", x: COLUMN.x, y: below, w: COLUMN.w, h: 22,
        why: "post-roll belongs to MultiGrainLive's transport; idMLab's modules have none" },
    ],
  };
}

export const HYPERPRISM_PANELS: readonly PanelLayout[] = PRISM_CATALOG.filter((effect) => effect.id.startsWith("hp-")).map(hyperprismWindow);
