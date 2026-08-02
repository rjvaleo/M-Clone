export function copiedNumericalValue(
  latest: number,
  min = Number.NEGATIVE_INFINITY,
  max = Number.POSITIVE_INFINITY,
  step = 1,
): number {
  const clamped = Math.max(min, Math.min(max, latest));
  if (!Number.isFinite(step) || step <= 0) return clamped;
  const origin = Number.isFinite(min) ? min : 0;
  const aligned = origin + Math.round((clamped - origin) / step) * step;
  return Math.max(min, Math.min(max, Number(aligned.toFixed(10))));
}

export function draggedNumericalValue(
  initial: number,
  deltaX: number,
  upperHalf: boolean,
  min: number,
  max: number,
  step: number,
): number {
  const increments = Math.abs(deltaX) >= 3
    ? Math.round(deltaX / 4)
    : upperHalf ? 1 : -1;
  return copiedNumericalValue(initial + increments * step, min, max, step);
}

/** Assign through the native setter so React's controlled-input listener sees it. */
export function setNumericalInput(input: HTMLInputElement, value: number): void {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype, "value",
  )?.set;
  setter?.call(input, String(value));
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}
