/**
 * The theme roster: three hand-authored themes plus one generated from every
 * ingested palette card.
 *
 * Ported from the CTIO board's theme system. Two things changed in the move:
 *
 * 1. **Light carries a full token block.** In the source application Light was
 *    the absence of tokens — Tailwind's own literal colours showed through when
 *    no theme was applied. Modular has no utility framework to fall through to,
 *    so every theme here writes a complete set and `applyTheme` is uniform.
 * 2. **No icon library.** The source used `lucide-react` for the picker; the
 *    swatch already says more about a theme than any glyph, so themes carry
 *    colours and no icon.
 *
 * A theme is a token block. `modular.css` speaks the token vocabulary directly,
 * so applying a theme is writing that theme's custom properties onto the root.
 */

import { deriveTheme, paletteOrder, type Tokens } from "../../lib/theme-studio";
import { deriveModuleAccents, fixedModuleAccents } from "./moduleAccents";
import { PALETTES } from "./palettes";

export type ThemeId = string;

export interface ThemeMeta {
  id: ThemeId;
  label: string;
  blurb: string;
  /** What the browser should assume for form controls and scrollbars. */
  colorScheme: "light" | "dark";
  swatch: { surface: string; accent: string; ink: string };
  /** Custom properties written onto the root element. */
  tokens: Tokens;
  /** Light palette themes only: the same theme on white rather than tinted surfaces. */
  plainTokens?: Tokens;
  /** Built-ins come first in the picker; palettes are grouped after them. */
  group: "base" | "palette" | "custom";
  /** The palette card's colours, shown as a strip in the picker. */
  source?: string[];
}

/**
 * Modular's original light appearance, expressed in the shared vocabulary.
 *
 * The values are the cool slate the canvas already used, laddered out so the
 * rest of the token families exist. Keeping this as the default means porting
 * the theme system did not silently restyle the app.
 */
const LIGHT_TOKENS: Tokens = {
  "--color-navy": "#1f3864",
  "--color-brand": "#2e5496",
  "--color-ink": "#15202b",
  "--color-mute": "#5b6b7a",
  "--chart-track": "#e2e8f0",
  "--chart-track-strong": "#cbd5e1",
  "--metric-warn": "#b4231c",
  "--status-done-text": "#1b7a3d",
  "--status-done-bg": "#dcf0df",
  "--status-progress-text": "#1f5fa8",
  "--status-progress-bg": "#dde8f8",
  "--status-risk-text": "#9a6b00",
  "--status-risk-bg": "#fff1c9",
  "--status-blocked-text": "#b4231c",
  "--status-blocked-bg": "#fbe0dc",
  "--status-todo-text": "#5a6472",
  "--status-todo-bg": "#edf0f4",
  "--status-external-text": "#8250b4",
  "--status-external-bg": "#efe6f8",
  "--lane-active-bar": "#ffffff",
  "--lane-active-track": "rgba(255, 255, 255, .2)",
  "--sel": "#2e5496",
  "--sel-ink": "#16233d",
  "--sel-fill": "#dbe6f7",
  "--sel-fill-2": "#eff4fc",
  "--sel-edge": "rgba(46, 84, 150, .45)",
  "--sel-soft": "rgba(46, 84, 150, .16)",
  "--s-body": "237 243 249",
  "--s-page": "233 238 245",
  "--s-card": "#ffffff",
  "--s-raised": "242 246 250",
  "--s-200": "#e2e9f0",
  "--s-300": "#cdd8e3",
  "--s-900": "#15202b",
  "--s-nav": "#1f3864",
  "--s-brand": "#2e5496",
  "--tx-max": "#0b131c",
  "--tx-800": "#15202b",
  "--tx-700": "#2b3947",
  "--tx-600": "#425362",
  "--tx-500": "#5b6b7a",
  "--tx-400": "#76858f",
  "--tx-300": "#93a1ab",
  "--bd-50": "#e8eef4",
  "--bd-100": "#dbe3eb",
  "--bd-200": "#b8c5d2",
  "--bd-300": "#9dadbc",
  "--bd-400": "#7f92a3",
  "--bd-hairline": "rgba(20, 55, 85, .10)",
  "--ac-50": "226 236 250",
  "--ac-100": "209 226 247",
  "--ac-200": "184 209 240",
  "--ac-400": "96 141 205",
  "--ac-tx-900": "#1b3a6b",
  "--ac-tx-700": "#2e5496",
  "--ac-tx-600": "#3f68ad",
  "--ac-bd-300": "#9dbbe4",
  "--ac-bd-500": "#5a86c4",
  "--ac-on": "#2e5496",
  "--hv-50": "#eef3f8",
  "--hv-100": "#e3ebf3",
  "--hv-200": "#d5e0ea",
  "--hv-ac-50": "#e3edfa",
  "--hv-ac-100": "#d2e1f6",
  "--em-50": "220 240 223",
  "--em-100": "#c6e6cb",
  "--em-bd-200": "#9ed3a6",
  "--hv-em": "#d2ebd6",
  "--am-50": "255 241 201",
  "--am-100": "255 233 173",
  "--am-bd-200": "#f0d183",
  "--am-bd-300": "#d9b155",
  "--hv-am": "#ffeec0",
  "--rd-50": "#fbe0dc",
  "--rd-100": "#f7cdc7",
  "--rd-bd-200": "#eda9a0",
  "--rd-bd-300": "#d97a6e",
  "--ig-50": "222 230 250",
  "--ig-100": "#cfdaf6",
  "--ig-bd": "#9db0e4",
  "--vi-50": "#efe6f8",
  "--vi-bd": "#c4a8e0",
  "--scroll": "#c0ccd8",
  "--scroll-hover": "#a3b3c3",
  "--placeholder": "#94a3af",
  "--caret": "#2e5496",
};

const DARK_TOKENS: Tokens = {
  "--color-navy": "#dcdce0",
  "--color-brand": "#cacad0",
  "--color-ink": "#f0f0f2",
  "--color-mute": "#adadb4",
  "--chart-track": "#38383c",
  "--chart-track-strong": "#4f4f53",
  "--metric-warn": "#fca5a5",
  "--status-done-text": "#86efac",
  "--status-done-bg": "#1c4a35",
  "--status-progress-text": "#93c5fd",
  "--status-progress-bg": "#1d4374",
  "--status-risk-text": "#fcd34d",
  "--status-risk-bg": "#574620",
  "--status-blocked-text": "#fca5a5",
  "--status-blocked-bg": "#5a2b33",
  "--status-todo-text": "#d8d8dd",
  "--status-todo-bg": "#3a3a3f",
  "--status-external-text": "#d8b4fe",
  "--status-external-bg": "#4a3468",
  "--lane-active-bar": "#1c1c1d",
  "--lane-active-track": "rgba(28, 28, 29, .16)",
  "--sel": "#f2f2f5",
  "--sel-ink": "#f5f5f7",
  "--sel-fill": "#4a4a50",
  "--sel-fill-2": "#35353a",
  "--sel-edge": "rgba(242, 242, 245, .55)",
  "--sel-soft": "rgba(242, 242, 245, .22)",
  "--s-body": "28 28 29",
  "--s-page": "31 31 32",
  "--s-card": "#262628",
  "--s-raised": "47 47 49",
  "--s-200": "#3b3b3e",
  "--s-300": "#4f4f53",
  "--s-900": "#141415",
  "--s-nav": "#2a2a2d",
  "--s-brand": "#4a4a4f",
  "--tx-max": "#ffffff",
  "--tx-800": "#f0f0f2",
  "--tx-700": "#dedee2",
  "--tx-600": "#c6c6cc",
  "--tx-500": "#aaaab1",
  "--tx-400": "#8f8f96",
  "--tx-300": "#77777e",
  "--bd-50": "#2a2a2c",
  "--bd-100": "#333336",
  "--bd-200": "#414145",
  "--bd-300": "#565659",
  "--bd-400": "#77777e",
  "--bd-hairline": "rgba(180, 180, 186, .20)",
  "--ac-50": "43 43 46",
  "--ac-100": "53 53 58",
  "--ac-200": "66 66 72",
  "--ac-400": "130 130 139",
  "--ac-tx-900": "#e8e8ec",
  "--ac-tx-700": "#d2d2d8",
  "--ac-tx-600": "#bcbcc3",
  "--ac-bd-300": "#5a5a61",
  "--ac-bd-500": "#82828b",
  "--ac-on": "#9a9aa2",
  "--hv-50": "#2a2a2c",
  "--hv-100": "#37373a",
  "--hv-200": "#45454a",
  "--hv-ac-50": "#38383d",
  "--hv-ac-100": "#424248",
  "--em-50": "26 70 56",
  "--em-100": "#225746",
  "--em-bd-200": "#2d7159",
  "--hv-em": "#276250",
  "--am-50": "74 59 28",
  "--am-100": "90 71 32",
  "--am-bd-200": "#7a5c22",
  "--am-bd-300": "#b98829",
  "--hv-am": "#675327",
  "--rd-50": "#502932",
  "--rd-100": "#632f39",
  "--rd-bd-200": "#7f3c47",
  "--rd-bd-300": "#c65867",
  "--ig-50": "51 52 93",
  "--ig-100": "#41426f",
  "--ig-bd": "#6263a8",
  "--vi-50": "#423059",
  "--vi-bd": "#75529b",
  "--scroll": "#56565b",
  "--scroll-hover": "#74747b",
  "--placeholder": "#8a8a91",
  "--caret": "#d2d2d8",
};

const TEAL_TOKENS: Tokens = {
  "--color-navy": "#9beae4",
  "--color-brand": "#7fd8d2",
  "--color-ink": "#eafaf9",
  "--color-mute": "#a9d6d3",
  "--chart-track": "#1c6467",
  "--chart-track-strong": "#2b8385",
  "--metric-warn": "#ffb4b4",
  "--status-done-text": "#86efac",
  "--status-done-bg": "#145c46",
  "--status-progress-text": "#a9d3ff",
  "--status-progress-bg": "#1d4b7a",
  "--status-risk-text": "#fcd34d",
  "--status-risk-bg": "#5a4a1d",
  "--status-blocked-text": "#ffb4b4",
  "--status-blocked-bg": "#5e2f38",
  "--status-todo-text": "#d8f2f0",
  "--status-todo-bg": "#1e6062",
  "--status-external-text": "#dcb8ff",
  "--status-external-bg": "#4a3670",
  "--lane-active-bar": "#ffffff",
  "--lane-active-track": "rgba(255, 255, 255, .2)",
  "--sel": "#8df0ea",
  "--sel-ink": "#eafaf9",
  "--sel-fill": "#2a8f8c",
  "--sel-fill-2": "#1c6b6c",
  "--sel-edge": "rgba(141, 240, 234, .55)",
  "--sel-soft": "rgba(141, 240, 234, .22)",
  "--s-body": "12 58 60",
  "--s-page": "14 65 68",
  "--s-card": "#135053",
  "--s-raised": "24 96 98",
  "--s-200": "#1e7073",
  "--s-300": "#2a8a8c",
  "--s-900": "#072b2d",
  "--s-nav": "#0a3335",
  "--s-brand": "#17726f",
  "--tx-max": "#ffffff",
  "--tx-800": "#eafaf9",
  "--tx-700": "#d3f0ee",
  "--tx-600": "#b7e4e1",
  "--tx-500": "#98d2ce",
  "--tx-400": "#7cbcb8",
  "--tx-300": "#64a4a1",
  "--bd-50": "#12484b",
  "--bd-100": "#17585a",
  "--bd-200": "#1e6b6d",
  "--bd-300": "#2b8385",
  "--bd-400": "#3ea0a1",
  "--bd-hairline": "rgba(160, 235, 230, .22)",
  "--ac-50": "22 89 91",
  "--ac-100": "26 102 104",
  "--ac-200": "33 118 120",
  "--ac-400": "55 153 154",
  "--ac-tx-900": "#ccf5f1",
  "--ac-tx-700": "#a5e8e2",
  "--ac-tx-600": "#7fd8d2",
  "--ac-bd-300": "#2f9294",
  "--ac-bd-500": "#45adae",
  "--ac-on": "#3fc0bd",
  "--hv-50": "#17585a",
  "--hv-100": "#1c6669",
  "--hv-200": "#237a7c",
  "--hv-ac-50": "#1c6669",
  "--hv-ac-100": "#237a7c",
  "--em-50": "23 86 74",
  "--em-100": "#1e6455",
  "--em-bd-200": "#348e79",
  "--hv-em": "#226e5d",
  "--am-50": "85 73 31",
  "--am-100": "99 86 42",
  "--am-bd-200": "#7d6a2c",
  "--am-bd-300": "#b58f34",
  "--hv-am": "#6b5c2e",
  "--rd-50": "#5a3038",
  "--rd-100": "#6a3742",
  "--rd-bd-200": "#86454f",
  "--rd-bd-300": "#c96271",
  "--ig-50": "51 64 107",
  "--ig-100": "#3f4d7c",
  "--ig-bd": "#6b76ad",
  "--vi-50": "#453563",
  "--vi-bd": "#7a5da3",
  "--scroll": "#2b8385",
  "--scroll-hover": "#3ea0a1",
  "--placeholder": "#86b8b5",
  "--caret": "#9beae4",
};

// The three hand-authored themes have no palette to derive identity colours
// from, so they carry Modular's original five, pitched for their own direction.
const BASE_THEMES: ThemeMeta[] = [
  {
    id: "light",
    label: "Light",
    blurb: "Cool slate, the original canvas",
    colorScheme: "light",
    swatch: { surface: "#ffffff", accent: "#2e5496", ink: "#15202b" },
    tokens: { ...LIGHT_TOKENS, ...fixedModuleAccents("light") },
    group: "base",
  },
  {
    id: "dark",
    label: "Dark",
    blurb: "Neutral grey, no colour cast",
    colorScheme: "dark",
    swatch: { surface: "#262628", accent: "#dcdce0", ink: "#f0f0f2" },
    tokens: { ...DARK_TOKENS, ...fixedModuleAccents("dark") },
    group: "base",
  },
  {
    id: "teal",
    label: "Teal",
    blurb: "Saturated mid-dark, not dimmed",
    colorScheme: "dark",
    swatch: { surface: "#135053", accent: "#9beae4", ink: "#eafaf9" },
    tokens: { ...TEAL_TOKENS, ...fixedModuleAccents("dark") },
    group: "base",
  },
];

/**
 * Ordered so that neighbouring entries look alike: neutrals first, then by hue
 * around the wheel, and light before dark inside each hue band. Scanning
 * forty-seven palettes by name finds nothing; scanning them by colour does.
 */
export function orderPalettes<T extends { colors: string[] }>(list: readonly T[]): T[] {
  return [...list].sort((a, b) => {
    const pa = paletteOrder(a.colors);
    const pb = paletteOrder(b.colors);
    const na = pa.chroma < 0.1;
    const nb = pb.chroma < 0.1;
    if (na !== nb) return na ? -1 : 1;
    if (!na) {
      // A 30° band is wide enough that one palette's warm grey and another's tan
      // land together, and narrow enough that reds do not merge into oranges.
      const band = Math.floor(pa.hue / 30) - Math.floor(pb.hue / 30);
      if (band !== 0) return band;
    }
    return pb.light - pa.light;
  });
}

export function paletteTheme(
  palette: { id: string; name: string; colors: string[] },
  group: "palette" | "custom" = "palette",
): ThemeMeta {
  const derived = deriveTheme(palette.colors);
  const accents = deriveModuleAccents(palette.colors, derived.mode);
  return {
    id: palette.id,
    label: palette.name,
    blurb: `${derived.mode === "dark" ? "Dark" : "Light"} · ${palette.colors.length} colours`,
    colorScheme: derived.mode,
    swatch: derived.swatch,
    tokens: { ...derived.tokens, ...accents },
    plainTokens: derived.plainTokens ? { ...derived.plainTokens, ...accents } : undefined,
    group,
    source: palette.colors,
  };
}

const PALETTE_THEMES: ThemeMeta[] = orderPalettes(PALETTES).map((palette) => paletteTheme(palette));

/** The themes that ship with the app. Palettes authored in Theme Studio join at runtime. */
export const THEMES: ThemeMeta[] = [...BASE_THEMES, ...PALETTE_THEMES];

export const THEME_IDS = THEMES.map((theme) => theme.id);

export const DEFAULT_THEME_ID = "dark";

/**
 * Themes created in Theme Studio. Held in a module variable rather than a store
 * because `applyTheme` runs outside React — the host store pushes them in here
 * on load and on every edit.
 */
let customThemes: ThemeMeta[] = [];

export function setCustomThemes(
  palettes: readonly { id: string; name: string; colors: string[] }[],
): void {
  customThemes = orderPalettes(palettes)
    .filter((palette) => palette.colors.length >= 2)
    .map((palette) => paletteTheme(palette, "custom"));
}

/** Every theme currently available, shipped and custom alike. */
export function allThemes(): ThemeMeta[] {
  return [...THEMES, ...customThemes];
}

export function themeMeta(id: ThemeId): ThemeMeta {
  return allThemes().find((theme) => theme.id === id) ?? THEMES[0];
}

/**
 * Put a theme on the document.
 *
 * Every inline custom property is cleared first, so switching from a theme that
 * defines a token to one that does not cannot leave the old value behind.
 */
export function applyTheme(
  id: ThemeId,
  { whitePage = false, root = document.documentElement }: { whitePage?: boolean; root?: HTMLElement } = {},
): void {
  const meta = themeMeta(id);
  const tokens = whitePage && meta.plainTokens ? meta.plainTokens : meta.tokens;

  for (const key of [...root.style].filter((name) => name.startsWith("--"))) {
    root.style.removeProperty(key);
  }
  for (const [key, value] of Object.entries(tokens)) root.style.setProperty(key, value);
  root.style.colorScheme = meta.colorScheme;
}
