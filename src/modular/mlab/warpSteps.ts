/**
 * M Time Warp drawn as a Numerology CV Sequencer.
 *
 * Each step holds how far its start is pushed early or late, as a share of a
 * step. That is M's Time Distortion Map in another form: the boundary of clock
 * step i is moved to real time (i + offset) / N, and those points are the
 * map's breakpoints. Step 1 is fixed — like the Groove Clock's first diamond —
 * because a cycle must still begin on time and last exactly as long.
 */

import { POSITIONS } from "./model";
import type { TimeMap } from "../../engine/timemap";

/** Less than half a step either way, so two boundaries can never cross. */
export const MAX_WARP_OFFSET = 0.45;
export const MAX_WARP_STEPS = 64;

export type WarpBank = { offsets: number[]; length: number; denominator: number };

export const defaultWarpBanks = (): WarpBank[] =>
  Array.from({ length: POSITIONS }, () => ({ offsets: Array(16).fill(0), length: 16, denominator: 16 }));

const clampOffset = (value: number) => Math.max(-MAX_WARP_OFFSET, Math.min(MAX_WARP_OFFSET, value));

export function warpToTimeMap(bank: WarpBank): TimeMap {
  const n = Math.max(1, Math.min(MAX_WARP_STEPS, Math.round(bank.length)));
  const points = Array.from({ length: n - 1 }, (_, k) => {
    const i = k + 1;
    return { x: (i + clampOffset(bank.offsets[i] ?? 0)) / n, y: i / n };
  });
  return { points, length: n, denominator: bank.denominator > 0 ? bank.denominator : 16 };
}

export function setWarpOffset(bank: WarpBank, step: number, value: number): WarpBank {
  const offsets = [...bank.offsets];
  while (offsets.length <= step) offsets.push(0);
  offsets[step] = step === 0 ? 0 : Number(clampOffset(value).toFixed(3));
  return { ...bank, offsets };
}

export const zeroWarp = (bank: WarpBank): WarpBank => ({ ...bank, offsets: bank.offsets.map(() => 0) });
export const invertWarp = (bank: WarpBank): WarpBank => ({ ...bank, offsets: bank.offsets.map((v) => (v === 0 ? 0 : -v)) });
