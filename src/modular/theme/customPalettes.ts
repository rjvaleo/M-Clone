/**
 * Palettes authored in Theme Studio.
 *
 * The studio itself persists nothing — that is what makes it portable — so this
 * is the host's half of the bargain: load on start, save on every edit, and push
 * the result into the theme registry so a hand-made palette is a real theme
 * everywhere the shipped ones are.
 */

import { create } from "zustand";
import type { StudioPalette } from "../../lib/theme-studio";
import { setCustomThemes } from "./themes";

const STORAGE_KEY = "m.modular.custom-palettes.v1";

function load(): StudioPalette[] {
  try {
    if (typeof localStorage === "undefined") return [];
    const raw: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (palette): palette is StudioPalette =>
        !!palette &&
        typeof palette === "object" &&
        typeof (palette as StudioPalette).id === "string" &&
        Array.isArray((palette as StudioPalette).colors),
    );
  } catch {
    return [];
  }
}

const initial = load();
setCustomThemes(initial);

interface CustomPaletteState {
  palettes: StudioPalette[];
  setPalettes: (palettes: StudioPalette[]) => void;
}

export const useCustomPalettes = create<CustomPaletteState>((set) => ({
  palettes: initial,
  setPalettes: (palettes) => {
    // Never persist a host-owned palette that was only passed in for reference.
    const own = palettes.filter((palette) => !palette.readOnly);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(own));
    } catch {
      // A full or unavailable store must not stop the edit from taking effect.
    }
    setCustomThemes(own);
    set({ palettes: own });
  },
}));
