// Rows of controls laid edge to edge in a box, for the panels of the ported
// effects: each row split into equal columns, a control taking one or more of
// them, the rows the heights given or shared alike. Positions land on whole
// pixels, with the gap between every pair.

import type { ControlKind, InertControl, PanelControl, PanelGroup } from "../layout";

type Box = { x: number; y: number; w: number; h: number };

/** One control in a row, or a dimmed one the original drew (`inert` says why). */
export type Cell = {
  param: string;
  label?: string;
  kind?: ControlKind;
  span?: number;
  size?: "big" | "small";
  states?: readonly [string, string];
  zero?: string;
  menu?: boolean;
  inert?: string;
};

export const knob = (param: string, label: string, more: Partial<Cell> = {}): Cell => ({ param, label, ...more });
export const big = (param: string, label: string, more: Partial<Cell> = {}): Cell => ({ param, label, size: "big", ...more });
export const toggle = (param: string, label: string, more: Partial<Cell> = {}): Cell => ({ param, label, kind: "switch", ...more });
export const mute = (span = 1): Cell => ({ param: "mute", label: "Mute", kind: "switch", span });

/** Placed controls and dimmed ones. */
export type Placed = { controls: PanelControl[]; inert: InertControl[] };

/** Lay `rows` into `box`, `gap` apart; `heights` are the rows' own, else shared alike. */
export function cells(box: Box, rows: readonly (readonly Cell[])[], heights?: readonly number[], gap = 2): Placed {
  const placed: Placed = { controls: [], inert: [] };
  const shared = (box.h - gap * (rows.length - 1)) / rows.length;
  let y = box.y;
  rows.forEach((row, r) => {
    const h = heights?.[r] ?? shared;
    const columns = row.reduce((n, cell) => n + (cell.span ?? 1), 0);
    const pitch = (box.w + gap) / columns;
    let column = 0;
    for (const cell of row) {
      const left = Math.round(box.x + column * pitch);
      column += cell.span ?? 1;
      const right = Math.round(box.x + column * pitch - gap);
      const at = { x: left, y: Math.round(y), w: right - left, h: Math.round(y + h) - Math.round(y) };
      const { span: _span, inert, kind = "knob", ...rest } = cell;
      if (inert !== undefined) {
        // A dimmed dial is a circle, as wide as its cell allows, at the top of it.
        const side = kind === "knob" ? Math.min(at.w, at.h) : 0;
        const dial = side > 0 ? { x: at.x + Math.floor((at.w - side) / 2), y: at.y, w: side, h: side } : at;
        placed.inert.push({ label: cell.label ?? cell.param, kind, why: inert, ...dial });
      } else {
        placed.controls.push({ ...rest, kind, ...at });
      }
    }
    y += h + gap;
  });
  return placed;
}

/** A group with its rows of controls, `inset` from its edges below its label. */
export type GroupSpec = PanelGroup & { rows: readonly (readonly Cell[])[]; heights?: readonly number[] };
export type Inset = { top: number; pad: number; gap: number };

/** Every group's controls, each in the box its label and edges leave. */
export function fill(groups: readonly GroupSpec[], { top, pad, gap }: Inset): Placed & { groups: PanelGroup[] } {
  const all = groups.map(({ rows, heights, ...group }) => ({
    group,
    ...cells({ x: group.x + pad, y: group.y + top, w: group.w - 2 * pad, h: group.h - top - pad }, rows, heights, gap),
  }));
  return { groups: all.map((g) => g.group), controls: all.flatMap((g) => g.controls), inert: all.flatMap((g) => g.inert) };
}
