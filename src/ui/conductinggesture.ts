import type { ArrowDir } from "../engine/snapshot";

/** Resolve the direction of a deliberate pull away from a Conducting Arrow. */
export function conductingPullDirection(
  startX: number,
  startY: number,
  currentX: number,
  currentY: number,
  threshold = 12,
): ArrowDir | null {
  const dx = currentX - startX;
  const dy = currentY - startY;
  if (Math.hypot(dx, dy) < threshold) return null;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? "right" : "left";
  return dy >= 0 ? "down" : "up";
}
