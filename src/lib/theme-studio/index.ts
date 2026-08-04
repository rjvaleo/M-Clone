/**
 * Theme Studio — a portable palette editor and token derivation engine.
 *
 * Depends on React and nothing else. See README.md for how to drop it into
 * another application.
 */

export { ThemeStudio, type ThemeStudioProps } from './ThemeStudio';
export { deriveTheme, paletteOrder, hexToRgb, rgbToHsl, hsl, type DerivedTheme, type Tokens } from './derive';
export { normalizeHex, paletteId, type StudioPalette } from './types';
export { ensureStudioStyles, STUDIO_CSS } from './styles';
