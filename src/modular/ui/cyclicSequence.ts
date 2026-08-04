/**
 * The data behind M's Cyclic editors.
 *
 * Accent, Legato and Rhythm are one sequence with three destinations: sixteen
 * steps, each holding a level from 0 to 4, and the only difference between the
 * three modules is what that level is finally multiplied into. So there is one
 * grid, one storage shape and one set of edit rules here, and the modules
 * supply nothing but a legend.
 *
 * A cell is either a **fixed** level or a **range**. A range is M's most
 * characteristic idea in this editor: the step does not play a set value, it
 * plays somewhere between two, chosen afresh each time round. That is what
 * keeps a sixteen-step pattern from sounding like a sixteen-step pattern.
 *
 * All of this is pure so the interactions can be tested without a DOM.
 */

import { PRESET_SLOTS } from "../registry/descriptorKit";

export const CYCLIC_STEPS = 16;
export const CYCLIC_MIN_LEVEL = 0;
export const CYCLIC_MAX_LEVEL = 4;
// The pad's slot count, not a number of its own: the Cyclic editors show the
// same sixteen positions as every other module.
export const CYCLIC_PRESET_COUNT = PRESET_SLOTS;

/** A fixed level, or `[low, high]` chosen anew on every pass. */
export type CyclicCell = number | [number, number];

export type CyclicPreset = CyclicCell[];

export const clampLevel = (level: number): number =>
  Math.min(CYCLIC_MAX_LEVEL, Math.max(CYCLIC_MIN_LEVEL, Math.round(level)));

/** True when a cell plays a different value each time it comes round. */
export function isRangedCell(cell: CyclicCell): boolean {
  return Array.isArray(cell) && cell.length >= 2 && cell[0] !== cell[1];
}

/** The levels a cell can produce, low first. A fixed cell spans one level. */
export function cellSpan(cell: CyclicCell): { low: number; high: number } {
  if (Array.isArray(cell) && cell.length >= 2) {
    const a = clampLevel(cell[0]);
    const b = clampLevel(cell[1]);
    return { low: Math.min(a, b), high: Math.max(a, b) };
  }
  const level = clampLevel(typeof cell === "number" ? cell : 2);
  return { low: level, high: level };
}

/** Whether a level is inside a cell's span, for painting the column. */
export const cellCoversLevel = (cell: CyclicCell, level: number): boolean => {
  const { low, high } = cellSpan(cell);
  return level >= low && level <= high;
};

/** Collapse a span back to storage: one number when fixed, a pair when ranged. */
export function makeCell(low: number, high: number): CyclicCell {
  const a = clampLevel(low);
  const b = clampLevel(high);
  return a === b ? a : [Math.min(a, b), Math.max(a, b)];
}

/** Sixteen steps at a middle level — a usable starting grid rather than silence. */
export const defaultPreset = (): CyclicPreset =>
  Array.from({ length: CYCLIC_STEPS }, () => 2);

/**
 * Read a module's stored presets defensively.
 *
 * Grids arrive from documents that may predate a change, or be hand-edited, so
 * anything unusable becomes a default rather than an exception on a node face.
 */
export function readPresets(value: unknown): CyclicPreset[] {
  const source = Array.isArray(value) ? value : [];
  return Array.from({ length: CYCLIC_PRESET_COUNT }, (_, position) => {
    const preset = source[position];
    if (!Array.isArray(preset) || preset.length === 0) return defaultPreset();
    return Array.from({ length: CYCLIC_STEPS }, (_, step) => {
      const cell = preset[step % preset.length];
      if (Array.isArray(cell) && cell.length >= 2) {
        return makeCell(Number(cell[0]) || 0, Number(cell[1]) || 0);
      }
      return clampLevel(typeof cell === "number" ? cell : 2);
    });
  });
}

/** Replace one step in one preset, leaving every other value untouched. */
export function withCell(
  presets: readonly CyclicPreset[],
  position: number,
  step: number,
  cell: CyclicCell,
): CyclicPreset[] {
  return presets.map((preset, index) =>
    index === position
      ? preset.map((existing, stepIndex) => (stepIndex === step ? cell : existing))
      : preset,
  );
}

/**
 * What a drag from one cell to another means.
 *
 * Two gestures share one drag, distinguished by direction, which is what lets
 * the grid be edited without a modifier key or a mode:
 *
 * - **Vertically**, within a step, the drag sets that step's range — press at
 *   one level and release at another and the step now plays between them.
 * - **Horizontally**, across steps, it paints the level it started on, so a run
 *   of steps can be set in one motion.
 */
export function applyDrag(
  presets: readonly CyclicPreset[],
  position: number,
  anchor: { step: number; level: number },
  current: { step: number; level: number },
): CyclicPreset[] {
  if (current.step === anchor.step) {
    return withCell(presets, position, anchor.step, makeCell(anchor.level, current.level));
  }
  const from = Math.min(anchor.step, current.step);
  const to = Math.max(anchor.step, current.step);
  const painted = makeCell(anchor.level, anchor.level);
  let next = presets.map((preset) => [...preset]);
  for (let step = from; step <= to; step++) {
    next = withCell(next, position, step, painted);
  }
  return next;
}

/** Every step to a single level, for a quick clear or fill. */
export function fillPreset(
  presets: readonly CyclicPreset[],
  position: number,
  level: number,
): CyclicPreset[] {
  const value = clampLevel(level);
  return presets.map((preset, index) =>
    index === position ? preset.map(() => value) : preset,
  );
}

/** A compact description of a preset, for the a–h strip's caption. */
export function summarisePreset(preset: CyclicPreset): string {
  const spans = preset.map(cellSpan);
  const low = Math.min(...spans.map((span) => span.low));
  const high = Math.max(...spans.map((span) => span.high));
  const ranged = preset.filter(isRangedCell).length;
  const base = low === high ? `all ${low}` : `${low}–${high}`;
  return ranged > 0 ? `${base} · ${ranged}r` : base;
}

export type CyclicLegend = {
  /** What the level means once it reaches its destination. */
  caption: string;
  /** The value each level produces, for the axis. */
  valueForLevel: (level: number) => string;
};

/**
 * The only thing that differs between the three modules.
 *
 * Rhythm's factors are the runtime's own table; Accent and Legato are
 * proportions applied by their consumers, so they read as a share rather than
 * an absolute — the Velocity Range module decides what level 4 actually means
 * in MIDI terms.
 */
export const CYCLIC_LEGENDS: Record<string, CyclicLegend> = {
  "m.cyclic-accent": {
    caption: "Level scales velocity between the Velocity Range low and high",
    valueForLevel: (level) => `${Math.round((clampLevel(level) / 4) * 100)}%`,
  },
  "m.cyclic-legato": {
    caption: "Level scales note length against the Legato base multiplier",
    valueForLevel: (level) => `${[25, 50, 100, 150, 200][clampLevel(level)]}%`,
  },
  "m.cyclic-rhythm": {
    caption: "Level multiplies each step's duration, warping the clock",
    valueForLevel: (level) => `×${[0.5, 0.75, 1, 1.25, 1.5][clampLevel(level)]}`,
  },
};

export const legendFor = (moduleType: string): CyclicLegend =>
  CYCLIC_LEGENDS[moduleType] ?? {
    caption: "Level 0 to 4",
    valueForLevel: (level) => String(clampLevel(level)),
  };
