// A module's panel, as data, and the checks every panel must pass.
//
// A panel places each of its module's controls at a position, inside a group,
// with nothing overlapping and no blank space: the groups and displays must
// cover the panel. Positions are pixels inside the panel, which has one fixed
// width per module type, as every idMLab module does.

import type { ModuleDescriptor, ParameterDescriptor } from "../../model/graph";
import type { Travel } from "./travel";
import type { Readout } from "./readout";

/** The looks a panel can wear: four new ones and the originals' own. */
export type PanelStyle = "cabinet" | "night" | "graph" | "strip" | "soundhack" | "lexicon" | "platinum";

export type ControlKind = "knob" | "hslider" | "vslider" | "switch" | "select" | "asset" | "readout" | "field" | "pad";

type Box = { x: number; y: number; w: number; h: number };

export type PanelControl = Box & {
  param: string;
  kind: ControlKind;
  /** Printed under or beside the control; the parameter's own label otherwise. */
  label?: string;
  /** How far it turns for a value; from the parameter otherwise. */
  travel?: Travel;
  /** A larger or louder variant of the style's control: "big", "small". */
  size?: "big" | "small";
  /** What a switch says off and on, when that is not just its label. */
  states?: readonly [string, string];
  /** What a control reads at zero when zero means something else ("AUTO"). */
  zero?: string;
  /** The page it is on, when the panel has pages; on every page otherwise. */
  page?: string;
  /**
   * A second place for a control already on the panel, as the Lexicon soft
   * row repeats six controls from the other pages. Not its one placing.
   */
  alias?: boolean;
  /** How its number reads, where the original printed it its own way. */
  readout?: Readout;
  /** A pad's second control, up its left edge; `param` runs along the top. */
  paramY?: string;
  /** A choice drawn as a pop-up menu rather than a row of buttons. */
  menu?: boolean;
};

export type PanelGroup = Box & { id: string; label: string; tint?: string };

export type PanelDisplay = Box & { kind: string };

/** A control the original drew that this port has no parameter for. Drawn, dimmed. */
export type InertControl = Box & { label: string; kind: ControlKind; why: string; page?: string };

/** One page of a panel whose controls take turns in the same place. */
export type PanelPage = { id: string; label: string };

export type PanelLayout = {
  moduleType: string;
  style: PanelStyle;
  width: number;
  height: number;
  groups: PanelGroup[];
  controls: PanelControl[];
  displays: PanelDisplay[];
  inert?: InertControl[];
  /** Pages, the first shown first. A control with no page is on all of them. */
  pages?: PanelPage[];
  /** The panel's own colour, where its look has one (a SoundHack badge). */
  accent?: string;
  /** Lettering on the accent, when white would not read on it. */
  accentInk?: string;
  /** How every control's number reads, unless the control says otherwise. */
  readout?: Readout;
};

/** The group a control sits in, which gives it its colour. */
export function groupOf(layout: PanelLayout, control: Box): PanelGroup | undefined {
  return layout.groups.find((group) => inside(control, group));
}

/** The parameters a panel never draws: a module's view state, not its sound. */
const NOT_ON_PANELS = new Set(["collapsed", "comment", "presets"]);

const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const inside = (a: Box, b: Box) => a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;

/** The control kinds each parameter shape may take. */
function allowed(parameter: ParameterDescriptor): { kinds: ControlKind[]; needs: string } {
  switch (parameter.kind) {
    case "boolean":
      return { kinds: ["switch"], needs: "a boolean needs a switch" };
    case "enum":
      return {
        kinds: (parameter.options?.length ?? 0) === 2 ? ["select", "switch", "knob"] : ["select", "knob"],
        needs: "a choice needs a selector or a dial",
      };
    case "string":
      return { kinds: ["asset"], needs: "a sample needs an asset slot" };
    default:
      return { kinds: ["knob", "hslider", "vslider", "readout", "field", "pad"], needs: "a number needs a knob, slider, field or readout" };
  }
}

/** The share of the panel the groups and displays cover, sampled every 2 px. */
export function coverage(layout: PanelLayout): number {
  const boxes: Box[] = [...layout.groups, ...layout.displays];
  let covered = 0;
  let total = 0;
  for (let y = 1; y < layout.height; y += 2) {
    for (let x = 1; x < layout.width; x += 2) {
      total += 1;
      if (boxes.some((b) => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h)) covered += 1;
    }
  }
  return total === 0 ? 0 : covered / total;
}

/** The least share of a panel its groups and displays may leave uncovered. */
export const MIN_COVERAGE = 0.97;

/** Every way a panel falls short of its module, as sentences; none when it is right. */
export function validateLayout(layout: PanelLayout, module: ModuleDescriptor): string[] {
  const errors: string[] = [];
  const parameters = new Map(module.parameters.map((p) => [p.id, p]));
  const seen = new Set<string>();

  const pages = new Set((layout.pages ?? []).map((page) => page.id));
  for (const control of layout.controls) {
    const parameter = parameters.get(control.param);
    if (!parameter) {
      errors.push(`${control.param}: not a parameter of ${module.type}`);
      continue;
    }
    if (control.page !== undefined && !pages.has(control.page)) errors.push(`${control.param}: on a page the panel does not have`);
    if (!control.alias) {
      if (seen.has(control.param)) errors.push(`${control.param}: placed twice`);
      seen.add(control.param);
    }
    const { kinds, needs } = allowed(parameter);
    if (!kinds.includes(control.kind)) errors.push(`${control.param}: ${needs}, not a ${control.kind}`);
    if (control.kind === "pad") {
      const y = control.paramY === undefined ? undefined : parameters.get(control.paramY);
      if (control.paramY === undefined) errors.push(`${control.param}: a pad needs a Y`);
      else if (!y) errors.push(`${control.paramY}: not a parameter of ${module.type}`);
      else if (y.kind !== "number") errors.push(`${control.paramY}: a pad's Y must be a number`);
      else if (!control.alias) {
        if (seen.has(control.paramY)) errors.push(`${control.paramY}: placed twice`);
        seen.add(control.paramY);
      }
    }
  }
  for (const parameter of module.parameters) {
    if (!NOT_ON_PANELS.has(parameter.id) && !seen.has(parameter.id)) errors.push(`${parameter.id}: not on the panel`);
  }

  const panel = { x: 0, y: 0, w: layout.width, h: layout.height };
  const placed = [
    ...layout.controls.map((c) => ({ box: c, name: c.param, page: c.page })),
    ...(layout.inert ?? []).map((c) => ({ box: c, name: `${c.label} (inert)`, page: c.page })),
  ];
  // Two controls collide only when they can be seen together: on one page,
  // or either of them on every page.
  const together = (a?: string, b?: string) => a === undefined || b === undefined || a === b;
  placed.forEach(({ box, name, page }, index) => {
    if (!inside(box, panel)) errors.push(`${name}: runs off the panel`);
    if (layout.groups.filter((group) => inside(box, group)).length !== 1) errors.push(`${name}: not inside one group`);
    for (const other of placed.slice(0, index)) {
      if (together(page, other.page) && overlaps(box, other.box)) errors.push(`${name}: overlaps ${other.name}`);
    }
  });
  for (const display of layout.displays) {
    if (!inside(display, panel)) errors.push(`${display.kind} display: runs off the panel`);
    for (const { box, name } of placed) {
      if (overlaps(display, box)) errors.push(`${display.kind} display: overlaps ${name}`);
    }
  }

  const used = coverage(layout);
  if (used < MIN_COVERAGE) errors.push(`only ${Math.round(used * 100)}% of the panel is used; leave no blank space`);
  return errors;
}
