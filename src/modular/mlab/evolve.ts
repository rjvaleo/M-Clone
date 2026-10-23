/**
 * M NoteSeq's Evolve: small, partly random changes grouped into three
 * dimensions, X, Y and Z (manual p51–52). Each dimension holds up to eight
 * transformations, each with its chance of running when the dimension is
 * evolved. By default pitch is on X, timing on Y, velocity on Z.
 */

import type { Rng } from "../../engine/rng";
import type { CyclicStep, CyclicVariable } from "../../engine/types";
import { normalizeCyclicStep } from "../../engine/cyclic";
import type { SeqMaterial } from "./generate";

export type EvolveDimension = "x" | "y" | "z";
export type EvolveStep = { id: EvolveId; probability: number };
export type EvolveConfig = Record<EvolveDimension, EvolveStep[]>;

export const EVOLVE_TRANSFORMS = [
  { id: "swap-pitches", label: "Swap two pitch values", kind: "pitch" },
  { id: "minor-third", label: "Move one step a minor third", kind: "pitch" },
  { id: "octave", label: "Move one step an octave", kind: "pitch" },
  { id: "swap-scrambled", label: "Swap two scrambled steps", kind: "pitch" },
  { id: "swap-legato", label: "Swap two legato cells", kind: "timing" },
  { id: "nudge-rhythm", label: "Nudge one rhythm cell", kind: "timing" },
  { id: "widen-legato", label: "Widen a legato cell", kind: "timing" },
  { id: "nudge-accent", label: "Nudge one accent cell", kind: "velocity" },
  { id: "widen-accent", label: "Widen an accent cell into a range", kind: "velocity" },
  { id: "narrow-accent", label: "Narrow an accent range", kind: "velocity" },
] as const;
export type EvolveId = (typeof EVOLVE_TRANSFORMS)[number]["id"];

export const DEFAULT_EVOLVE: EvolveConfig = {
  x: [{ id: "swap-pitches", probability: 100 }, { id: "minor-third", probability: 25 }],
  y: [{ id: "swap-legato", probability: 100 }, { id: "nudge-rhythm", probability: 25 }],
  z: [{ id: "nudge-accent", probability: 100 }, { id: "widen-accent", probability: 25 }],
};

const sounding = (material: SeqMaterial) =>
  material.pattern.steps.slice(0, material.pattern.length)
    .map((s, i) => (s.length > 0 ? i : -1)).filter((i) => i >= 0);

const two = (n: number, rng: Rng): [number, number] | null => {
  if (n < 2) return null;
  const a = rng.int(n);
  let b = rng.int(n - 1);
  if (b >= a) b += 1;
  return [a, b];
};

const clampLevel = (v: number) => Math.max(0, Math.min(4, v));

function withCell(material: SeqMaterial, kind: CyclicVariable, index: number, cell: CyclicStep): SeqMaterial {
  const cells = [...material.cells[kind]];
  cells[index] = cell;
  return { ...material, cells: { ...material.cells, [kind]: cells } };
}

function movePitch(material: SeqMaterial, rng: Rng, by: number): SeqMaterial {
  const steps = sounding(material);
  if (!steps.length) return material;
  const at = steps[rng.int(steps.length)];
  const dir = rng.chance(0.5) ? 1 : -1;
  const next = material.pattern.steps.map((s) => [...s]);
  next[at] = next[at].map((p) => Math.max(0, Math.min(127, p + dir * by)));
  return { ...material, pattern: { ...material.pattern, steps: next } };
}

const TRANSFORM: Record<EvolveId, (m: SeqMaterial, rng: Rng) => SeqMaterial> = {
  "swap-pitches": (m, rng) => {
    const steps = sounding(m);
    const pair = two(steps.length, rng);
    if (!pair) return m;
    const next = m.pattern.steps.map((s) => [...s]);
    const [a, b] = [steps[pair[0]], steps[pair[1]]];
    [next[a], next[b]] = [next[b], next[a]];
    return { ...m, pattern: { ...m.pattern, steps: next } };
  },
  "minor-third": (m, rng) => movePitch(m, rng, 3),
  octave: (m, rng) => movePitch(m, rng, 12),
  "swap-scrambled": (m, rng) => {
    const pair = two(m.pattern.length, rng);
    if (!pair) return m;
    const next = m.pattern.scrambled.map((s) => [...s]);
    [next[pair[0]], next[pair[1]]] = [next[pair[1]], next[pair[0]]];
    return { ...m, pattern: { ...m.pattern, scrambled: next } };
  },
  "swap-legato": (m, rng) => {
    const pair = two(m.cells.legato.length, rng);
    if (!pair) return m;
    const cells = [...m.cells.legato];
    [cells[pair[0]], cells[pair[1]]] = [cells[pair[1]], cells[pair[0]]];
    return { ...m, cells: { ...m.cells, legato: cells } };
  },
  "nudge-rhythm": (m, rng) => nudge(m, "rhythm", rng),
  "widen-legato": (m, rng) => widen(m, "legato", rng),
  "nudge-accent": (m, rng) => nudge(m, "accent", rng),
  "widen-accent": (m, rng) => widen(m, "accent", rng),
  "narrow-accent": (m, rng) => {
    const ranges = m.cells.accent.map((c, i) => (normalizeCyclicStep(c).min !== normalizeCyclicStep(c).max ? i : -1)).filter((i) => i >= 0);
    if (!ranges.length) return m;
    const at = ranges[rng.int(ranges.length)];
    const { min, max } = normalizeCyclicStep(m.cells.accent[at]);
    const next = rng.chance(0.5) ? { min: min + 1, max } : { min, max: max - 1 };
    return withCell(m, "accent", at, next.min === next.max ? next.min : next);
  },
};

function nudge(m: SeqMaterial, kind: CyclicVariable, rng: Rng): SeqMaterial {
  if (!m.cells[kind].length) return m;
  const at = rng.int(m.cells[kind].length);
  const { min, max } = normalizeCyclicStep(m.cells[kind][at]);
  const by = rng.chance(0.5) ? 1 : -1;
  const shift = Math.max(-min, Math.min(4 - max, by));
  return withCell(m, kind, at, min === max ? min + shift : { min: min + shift, max: max + shift });
}

function widen(m: SeqMaterial, kind: CyclicVariable, rng: Rng): SeqMaterial {
  if (!m.cells[kind].length) return m;
  const at = rng.int(m.cells[kind].length);
  const { min, max } = normalizeCyclicStep(m.cells[kind][at]);
  const next = max < 4 && (min === 0 || rng.chance(0.5)) ? { min, max: clampLevel(max + 1) } : { min: clampLevel(min - 1), max };
  return withCell(m, kind, at, next.min === next.max ? next.min : next);
}

/** Evolve one dimension once: each of its transformations runs on its own chance. */
export function evolve(dimension: EvolveDimension, config: EvolveConfig, material: SeqMaterial, rng: Rng): SeqMaterial {
  let next = material;
  for (const step of (config[dimension] ?? []).slice(0, 8)) {
    if (step.probability <= 0) continue;
    if (step.probability >= 100 || rng.next() * 100 < step.probability) next = TRANSFORM[step.id](next, rng);
  }
  return next;
}
