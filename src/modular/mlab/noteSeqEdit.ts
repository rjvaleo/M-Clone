/**
 * The edits M NoteSeq's face makes, as pure functions from the module's
 * parameters to the parameters that change. The face only routes the pointer
 * here and sends the result on.
 */

import type { JsonValue } from "../model/graph";
import type { CyclicStep, CyclicVariable } from "../../engine/types";
import type { ScaleName } from "../../engine/music";
import type { VoicePattern } from "./model";
import { MAX_CYCLE_CELLS, defaultCellLengths, defaultCells, defaultNoteSeqPatterns, shiftSteps, type SeqCellLengths, type SeqCells } from "./noteSeq";
import { setPatternLength, toggleNote } from "./patternEdit";
import { generate, type SeqMaterial } from "./generate";
import type { Rng } from "../../engine/rng";
import { MAX_WARP_STEPS, defaultWarpBanks, setWarpOffset, type WarpBank } from "./warpSteps";

type Params = Readonly<Record<string, JsonValue>>;
type Updates = Record<string, JsonValue>;

const read = <T>(p: Params, id: string, fallback: T): T => (p[id] as unknown as T | undefined) ?? fallback;
const json = (value: unknown) => value as JsonValue;

export const groupIndex = (p: Params) => Math.max(0, Math.min(5, Math.round(Number(p.group ?? 0))));
export const patternsOf = (p: Params) => read<VoicePattern[]>(p, "patterns", defaultNoteSeqPatterns());
export const patternInPlay = (p: Params): VoicePattern => patternsOf(p)[groupIndex(p)] ?? defaultNoteSeqPatterns()[0];
const positionOf = (p: Params, kind: CyclicVariable) =>
  read<Record<CyclicVariable, number>>(p, "cycle-positions", { accent: 0, legato: 0, rhythm: 0 })[kind] ?? 0;

const withPattern = (p: Params, pattern: VoicePattern): Updates => {
  const patterns = patternsOf(p).map((g) => g);
  patterns[groupIndex(p)] = pattern;
  return { patterns: json(patterns) };
};

/** The cells of a cycle at the position it is on now. */
export const cellsInPlay = (p: Params, kind: CyclicVariable): CyclicStep[] =>
  read<SeqCells>(p, "cells", defaultCells())[kind]?.[positionOf(p, kind)] ?? defaultCells()[kind][0];

export const cellLengthInPlay = (p: Params, kind: CyclicVariable): number =>
  read<SeqCellLengths>(p, "cycle-lengths", defaultCellLengths())[kind]?.[positionOf(p, kind)] ?? MAX_CYCLE_CELLS;

function withCells(p: Params, kind: CyclicVariable, cells: CyclicStep[]): Updates {
  const all = structuredClone(read<SeqCells>(p, "cells", defaultCells()));
  all[kind][positionOf(p, kind)] = cells;
  return { cells: json(all) };
}

export const setCellValue = (p: Params, kind: CyclicVariable, index: number, value: CyclicStep): Updates => {
  const cells = [...cellsInPlay(p, kind)];
  cells[index] = value;
  return withCells(p, kind, cells);
};

export function setCellLength(p: Params, kind: CyclicVariable, length: number): Updates {
  const lengths = structuredClone(read<SeqCellLengths>(p, "cycle-lengths", defaultCellLengths()));
  lengths[kind][positionOf(p, kind)] = Math.max(1, Math.min(MAX_CYCLE_CELLS, Math.round(length)));
  return { "cycle-lengths": json(lengths) };
}

/** The red end marker: M's Output Length. */
export const setEndStep = (p: Params, step: number): Updates => withPattern(p, setPatternLength(patternInPlay(p), step + 1));

/** A click in the pitch lane, in the Original list or the scrambled one. */
export function toggleNoteIn(p: Params, view: "orig" | "scram", step: number, pitch: number): Updates {
  const pattern = patternInPlay(p);
  if (view === "orig") return withPattern(p, toggleNote(pattern, step, pitch));
  const scrambled = pattern.scrambled.map((s) => [...s]);
  while (scrambled.length <= step) scrambled.push([]);
  const notes = scrambled[step];
  scrambled[step] = notes.includes(pitch) ? notes.filter((n) => n !== pitch) : [...notes, pitch].sort((a, b) => a - b);
  return withPattern(p, { ...pattern, scrambled });
}

const LANES = ["skip", "select", "mute", "rnd-jump", "velocity"] as const;

/** << and >>: every step's notes and its row and lane values move together. */
export function shiftAll(p: Params, by: -1 | 1): Updates {
  const pattern = patternInPlay(p);
  const n = pattern.length;
  const updates: Updates = withPattern(p, {
    ...pattern,
    steps: shiftSteps(pattern.steps, n, by),
    scrambled: shiftSteps(pattern.scrambled, n, by),
  });
  for (const lane of LANES) {
    const values = [...read<JsonValue[]>(p, lane, [])];
    while (values.length < n) values.push(lane === "rnd-jump" || lane === "velocity" ? 0 : false);
    updates[lane] = json(shiftSteps(values, n, by));
  }
  return updates;
}

/** ∅: every note in the pattern becomes the first note, a unison line. */
export function zeroPitches(pattern: VoicePattern): VoicePattern {
  const first = pattern.steps.slice(0, pattern.length).find((s) => s.length > 0)?.[0];
  if (first === undefined) return pattern;
  const steps = pattern.steps.map((s, i) => (i < pattern.length && s.length > 0 ? [first] : [...s]));
  return { ...pattern, steps, scrambled: pattern.scrambled.map((s, i) => (i < pattern.length && s.length > 0 ? [first] : [...s])) };
}
export const zeroPitchesIn = (p: Params): Updates => withPattern(p, zeroPitches(patternInPlay(p)));

/** Norm All / ZeroGate for M's Legato cells: every cell to the middle, or to the shortest. */
export const normGates = (p: Params): Updates => withCells(p, "legato", cellsInPlay(p, "legato").map(() => 2));
export const zeroGates = (p: Params): Updates => withCells(p, "legato", cellsInPlay(p, "legato").map(() => 0));

/** What Generate and Evolve work on, and where their results go back. */
export function currentMaterial(p: Params): SeqMaterial {
  return {
    pattern: patternInPlay(p),
    cells: { accent: cellsInPlay(p, "accent"), legato: cellsInPlay(p, "legato"), rhythm: cellsInPlay(p, "rhythm") },
    root: Number(p.key ?? 0),
    scale: (p.scale ?? "major") as ScaleName,
  };
}

export function applyMaterial(p: Params, material: SeqMaterial): Updates {
  const all = structuredClone(read<SeqCells>(p, "cells", defaultCells()));
  for (const kind of ["accent", "legato", "rhythm"] as CyclicVariable[]) all[kind][positionOf(p, kind)] = material.cells[kind];
  return { ...withPattern(p, material.pattern), cells: json(all) };
}

/** Rate, as Numerology's menu names it, stored as M's time base. */
export const RATE_OPTIONS = [
  { value: "1/1", label: "Whole" },
  { value: "1/2", label: "1/2" },
  { value: "3/8", label: "1/4." },
  { value: "1/4", label: "1/4" },
  { value: "1/6", label: "1/4T" },
  { value: "3/16", label: "1/8." },
  { value: "1/8", label: "1/8" },
  { value: "1/12", label: "1/8T" },
  { value: "1/16", label: "16th" },
  { value: "1/24", label: "16T" },
  { value: "1/32", label: "32nd" },
] as const;

export const rateOf = (p: Params) => `${Number(p["rate-num"] ?? 1)}/${Number(p["rate-den"] ?? 8)}`;
export function setRate(value: string): Updates {
  const [num, den] = value.split("/").map(Number);
  return { "rate-num": num, "rate-den": den };
}

/* ===== The dice on each lane ===== */

export type LaneId = "pitch" | "accent" | "legato" | "rhythm" | "velocity" | "warp";
const DICE_SHARES = { few: 0.25, some: 0.5, most: 0.75, all: 1 } as const;
export type DiceShare = keyof typeof DICE_SHARES;

/** `count` distinct indexes below `n`. */
const pick = (n: number, share: number, rng: Rng): number[] => {
  const pool = Array.from({ length: n }, (_, i) => i);
  const count = share >= 1 ? n : Math.max(1, Math.round(n * share));
  const out: number[] = [];
  while (out.length < count && pool.length) out.push(pool.splice(rng.int(pool.length), 1)[0]);
  return out;
};
const LEVELS: Record<"accent" | "legato" | "rhythm", [number, number]> = { accent: [1, 4], legato: [1, 4], rhythm: [1, 3] };

/** Randomize a share of one lane, as drumcomputer's RND does one control. */
export function randomizeLane(p: Params, lane: LaneId, share: DiceShare, rng: Rng): Updates {
  const s = DICE_SHARES[share];
  const pattern = patternInPlay(p);
  if (lane === "accent" || lane === "legato" || lane === "rhythm") {
    const cells = [...cellsInPlay(p, lane)];
    const [low, high] = LEVELS[lane];
    for (const i of pick(cellLengthInPlay(p, lane), s, rng)) cells[i] = low + rng.int(high - low + 1);
    return withCells(p, lane, cells);
  }
  if (lane === "velocity") {
    const values = Array.from({ length: pattern.length }, (_, i) => read<number[]>(p, "velocity", [])[i] ?? 0);
    for (const i of pick(pattern.length, s, rng)) values[i] = Number(((rng.next() - 0.5) * 1.2).toFixed(2));
    return { velocity: values };
  }
  if (lane === "warp") {
    const bank = warpInPlay(p);
    const offsets = Array.from({ length: Math.max(bank.offsets.length, bank.length) }, (_, i) => bank.offsets[i] ?? 0);
    for (const i of pick(bank.length, s, rng)) if (i > 0) offsets[i] = Number(((rng.next() - 0.5) * 0.5).toFixed(2));
    return withWarp(p, { ...bank, offsets });
  }
  const id = ({ few: "rnd-few", some: "rnd-some", most: "rnd-most", all: "rnd-all" } as const)[share];
  const material = generate(id, currentMaterial(p), rng, { preserveRests: true });
  return withPattern(p, material.pattern);
}

/* ===== The Warp lane ===== */

const warpPosition = (p: Params) => Math.max(0, Math.min(5, Math.round(Number(p["warp-position"] ?? 0))));
const warpBanks = (p: Params) => read<WarpBank[]>(p, "warp", defaultWarpBanks());

/** The NoteSeq's own Time Distortion at the position in play — what its Warp lane draws. */
export const warpInPlay = (p: Params): WarpBank => warpBanks(p)[warpPosition(p)] ?? defaultWarpBanks()[0];

function withWarp(p: Params, bank: WarpBank): Updates {
  const banks = warpBanks(p).map((b) => b);
  banks[warpPosition(p)] = bank;
  return { warp: json(banks) };
}

export const setWarpStep = (p: Params, step: number, value: number): Updates => withWarp(p, setWarpOffset(warpInPlay(p), step, value));
export const setWarpLength = (p: Params, length: number): Updates =>
  withWarp(p, { ...warpInPlay(p), length: Math.max(1, Math.min(MAX_WARP_STEPS, Math.round(length))) });
