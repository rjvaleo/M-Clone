export function knobValueFromDrag(
  startValue: number,
  deltaY: number,
  min: number,
  max: number,
  step: number,
): number {
  const raw = startValue + (deltaY / 120) * (max - min);
  const snapped = min + Math.round((raw - min) / step) * step;
  return Math.max(min, Math.min(max, snapped));
}
