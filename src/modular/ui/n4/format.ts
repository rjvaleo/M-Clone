/**
 * The value a tight module prints under a control: as short as it can be and
 * still say what it is, because it sits in a 30px column in an 8px face.
 */

export function formatValue(value: number, { unit, step }: { unit?: string; step?: number }): string {
  if (unit === "Hz" && Math.abs(value) >= 1000) {
    const k = value / 1000;
    return `${Math.abs(k) >= 10 ? Math.round(k) : k.toFixed(1)}k`;
  }
  if (unit === "ms" && Math.abs(value) >= 1000) return `${(value / 1000).toFixed(1)}s`;
  const places = step === undefined ? 2 : step >= 1 ? 0 : step >= 0.1 ? 1 : 2;
  return `${value.toFixed(places)}${unit ?? ""}`;
}
