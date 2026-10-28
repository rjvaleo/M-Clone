/**
 * Shapes and defaults the M modules share.
 *
 * The defaults come from M Clone's own project defaults (src/engine/project.ts),
 * so a fresh M module starts exactly where a fresh M does: the same level
 * values, the same harmony, voice n on channel n.
 */

import { createDefaultProject } from "../../engine/project";
import type { CyclicVariable } from "../../engine/types";
import type { ScaleName } from "../../engine/music";

export const MAX_VOICES = 8;
export const POSITIONS = 6;
export const POSITION_LABELS = ["a", "b", "c", "d", "e", "f"] as const;

const project = createDefaultProject();
const voices = <T>(make: (voice: number) => T): T[] => Array.from({ length: MAX_VOICES }, (_, v) => make(v));
const positions = <T>(make: (position: number) => T): T[] => Array.from({ length: POSITIONS }, (_, p) => make(p));

/* ===== Cyclic Variables ===== */

export type CyclePositions = Record<CyclicVariable, number>;
/** What each of the five levels means: Legato as a percentage, Rhythm as a multiple of the time base. */
export type CycleValues = { legato: number[]; rhythm: number[] };

export const defaultCyclePositions = (): CyclePositions => ({ accent: 0, legato: 0, rhythm: 0 });
export const defaultCycleValues = (): CycleValues => structuredClone(project.cyclicValues);

/* ===== Patterns ===== */

/** One pattern group: chords as note lists, an empty list a rest, and the Cyclic-Random copy. */
export type VoicePattern = { steps: number[][]; scrambled: number[][]; length: number };

export type PatternHarmony = {
  root: number;
  scale: ScaleName;
  scaleSnap: boolean;
  diatonicTranspose: boolean;
  chordTones: boolean;
};

export const defaultHarmony = (): PatternHarmony => ({
  root: project.root,
  scale: project.scale,
  scaleSnap: project.scaleSnap,
  diatonicTranspose: project.diatonicTranspose ?? false,
  chordTones: project.chordTones ?? false,
});

/* ===== M Orchestra ===== */

/** Channels 1–16 per position a–f, per voice. Voice n plays on channel n, as in M. */
export const defaultOrchestration = (): number[][][] =>
  positions(() => voices((v) => [v + 1]));

/** A program per position, per channel 1–16; null sends nothing. */
export const defaultPrograms = (): (number | null)[][] =>
  positions(() => Array.from({ length: 16 }, () => null));
