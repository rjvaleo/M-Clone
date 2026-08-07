/**
 * The parameter groupings the reference panels agree on.
 *
 * `reference/panels/CATALOG.md`'s layout grammar found that panels do not
 * arrange controls freely — they follow rules none of them state. Rule B is
 * the strongest: **parameter order is fixed by signal order, never
 * alphabetised.** ADSR is always A→D→S→R across all thirty-one sources, and
 * AHDSR always inserts hold second. Nothing sorts it, nothing reorders it,
 * and a panel that did would be unreadable to anyone who has used another.
 *
 * That rule is worth encoding rather than documenting, which is what this
 * module is: the order is a constant, and a caller assembles an envelope
 * bank by mapping over it instead of by passing four controls in whatever
 * sequence they happened to type.
 */

import type { EnvelopeShape } from "./geometry";

export type AdsrStageKey = "attack" | "decay" | "sustain" | "release";

/** The four stages, in the only order a panel ever prints them. */
export const ADSR_ORDER: readonly AdsrStageKey[] = ["attack", "decay", "sustain", "release"];

export interface AdsrStage {
  key: AdsrStageKey;
  /** The single letter panels label a compact envelope bank with — Mimic's
   * slider caps, Bitwig's knob row. */
  short: string;
  /** The full word, for a bank with room for it — CR8 prints these. */
  label: string;
  value: number;
  /**
   * True for sustain alone. Sustain is a *level* — how loud the note stays
   * while held — where the other three are *durations*. A bank that treated
   * all four alike would give sustain a time axis it does not have, and
   * would scale it against the other three when drawing.
   */
  isLevel: boolean;
}

const STAGE_LABELS: Readonly<Record<AdsrStageKey, string>> = {
  attack: "Attack",
  decay: "Decay",
  sustain: "Sustain",
  release: "Release",
};

/** The envelope as an ordered, labelled bank ready to map into controls. */
export function adsrStages(env: EnvelopeShape): AdsrStage[] {
  return ADSR_ORDER.map((key) => ({
    key,
    short: STAGE_LABELS[key][0],
    label: STAGE_LABELS[key],
    value: env[key],
    isLevel: key === "sustain",
  }));
}

/** A copy of `env` with one stage changed. */
export function withAdsrStage(env: EnvelopeShape, key: AdsrStageKey, value: number): EnvelopeShape {
  return { ...env, [key]: value };
}
