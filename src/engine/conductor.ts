import type { ArrowDir } from "./snapshot";

export type BatonPoint = { x: number; y: number };
export type TempoRange = { low: number; high: number };

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

export function clampBaton(point: BatonPoint): BatonPoint {
  return { x: clamp01(point.x), y: clamp01(point.y) };
}

/** Read the normalized Grid axis in the direction a Conducting Arrow points. */
export function axisValue(point: BatonPoint, direction: ArrowDir): number {
  const clamped = clampBaton(point);
  if (direction === "right") return clamped.x;
  if (direction === "left") return 1 - clamped.x;
  if (direction === "down") return clamped.y;
  return 1 - clamped.y;
}

/** The Grid is six squares across and down, one for each Variable Position. */
export function positionFromBaton(
  point: BatonPoint,
  direction: ArrowDir,
): number {
  return Math.min(5, Math.floor(axisValue(point, direction) * 6));
}

export function normalizeTempoRange(low: number, high: number): TempoRange {
  const a = Math.max(40, Math.min(240, Math.round(low)));
  const b = Math.max(40, Math.min(240, Math.round(high)));
  return { low: Math.min(a, b), high: Math.max(a, b) };
}

export function conductedTempo(range: TempoRange, value: number): number {
  const normalized = normalizeTempoRange(range.low, range.high);
  return Math.round(
    normalized.low + (normalized.high - normalized.low) * clamp01(value),
  );
}

export function robotMove(
  point: BatonPoint,
  signedJump: BatonPoint,
  range: BatonPoint,
): BatonPoint {
  return clampBaton({
    x: point.x + signedJump.x * clamp01(range.x),
    y: point.y + signedJump.y * clamp01(range.y),
  });
}
