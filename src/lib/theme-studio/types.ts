/** Theme Studio's only data type. A palette is a name and some hex values. */
export interface StudioPalette {
  id: string;
  name: string;
  /** Hex values, `#rgb` or `#rrggbb`. Two is enough; four to six reads best. */
  colors: string[];
  /** Free text shown under the name — where the palette came from. */
  note?: string;
  /**
   * Built-in palettes the host owns. The studio will preview and duplicate one
   * but never edit or delete it, so a host can safely pass its shipped set in
   * alongside the user's own.
   */
  readOnly?: boolean;
}

export function paletteId(name: string, taken: readonly string[] = []): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48) || 'palette';
  if (!taken.includes(base)) return base;
  let n = 2;
  while (taken.includes(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

/** `#abc` → `#aabbcc`; anything unparseable → null. */
export function normalizeHex(input: string): string | null {
  const value = input.trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(value)) {
    return `#${value
      .split('')
      .map((c) => c + c)
      .join('')}`.toLowerCase();
  }
  return /^[0-9a-f]{6}$/i.test(value) ? `#${value.toLowerCase()}` : null;
}
