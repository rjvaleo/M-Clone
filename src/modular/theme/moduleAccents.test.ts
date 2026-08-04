import { describe, expect, it } from "vitest";
import {
  accentInkToken,
  deriveModuleAccents,
  fixedModuleAccents,
  moduleAccentHues,
  moduleAccentToken,
  MODULE_ACCENT_SLOTS,
} from "./moduleAccents";
import { hexToRgb, rgbToHsl } from "../../lib/theme-studio";
import { PALETTES } from "./palettes";

const lightness = (hex: string) => rgbToHsl(hexToRgb(hex)).l;
const hue = (hex: string) => rgbToHsl(hexToRgb(hex)).h;

/** Shortest distance between two hues, in degrees. */
const separation = (a: number, b: number) => {
  const raw = Math.abs(a - b) % 360;
  return raw > 180 ? 360 - raw : raw;
};

const accentList = (colors: string[], mode: "light" | "dark") => {
  const tokens = deriveModuleAccents(colors, mode);
  return MODULE_ACCENT_SLOTS.map((slot) => tokens[moduleAccentToken(slot)]);
};

describe("Module identity accents", () => {
  it("produces one colour per module family", () => {
    const tokens = deriveModuleAccents(["#c62828", "#1565c0", "#2e7d32"], "dark");
    for (const slot of MODULE_ACCENT_SLOTS) {
      expect(tokens[moduleAccentToken(slot)]).toMatch(/^#[0-9a-f]{6}$/);
    }
    // Every slot is a distinct token, so no family can silently share another's.
    expect(new Set(MODULE_ACCENT_SLOTS).size).toBe(MODULE_ACCENT_SLOTS.length);
  });

  it("keeps every family visually distinct, whatever the palette", () => {
    // The property that matters: no two modules may read as the same colour.
    for (const palette of PALETTES) {
      for (const mode of ["light", "dark"] as const) {
        const hues = accentList(palette.colors, mode).map(hue);
        for (let i = 0; i < hues.length; i++) {
          for (let j = i + 1; j < hues.length; j++) {
            expect(
              separation(hues[i], hues[j]),
              `${palette.id} (${mode}) slots ${i} and ${j}`,
            ).toBeGreaterThan(12);
          }
        }
      }
    }
  });

  it("still produces one distinct colour per slot from a palette of greys", () => {
    const hues = accentList(["#8a8a8a", "#bdbdbd", "#5c5c5c"], "dark").map(hue);
    expect(new Set(hues).size).toBe(MODULE_ACCENT_SLOTS.length);
  });

  it("survives a two-colour palette by generating the rest", () => {
    expect(accentList(["#204060", "#c08040"], "light")).toHaveLength(MODULE_ACCENT_SLOTS.length);
    expect(moduleAccentHues(["#204060", "#c08040"])).toHaveLength(MODULE_ACCENT_SLOTS.length);
  });

  it("takes hue from the palette but never lightness", () => {
    // A palette of near-blacks must not yield near-black accents, or every
    // module header would be invisible against a dark surface.
    for (const accent of accentList(["#101015", "#141a12", "#181018"], "dark")) {
      expect(lightness(accent)).toBeGreaterThan(0.5);
      expect(lightness(accent)).toBeLessThan(0.8);
    }
    // And a palette of near-whites must not yield near-white accents on light.
    for (const accent of accentList(["#f8f8fa", "#fafaf2", "#f4f8fa"], "light")) {
      expect(lightness(accent)).toBeLessThan(0.6);
    }
  });

  it("pitches accents for the direction they sit on", () => {
    const colors = ["#c62828", "#1565c0", "#2e7d32", "#f9a825", "#6a1b9a"];
    const dark = accentList(colors, "dark").map(lightness);
    const light = accentList(colors, "light").map(lightness);
    for (let i = 0; i < dark.length; i++) expect(dark[i]).toBeGreaterThan(light[i]);
  });

  it("gives the palette's strongest colour to the first slot", () => {
    const colors = ["#8a8a8a", "#ff0000", "#9a9a9a"];
    const hues = moduleAccentHues(colors);
    // Pure red is the most chromatic, so it leads and keeps its own hue.
    expect(separation(hues[0], hue("#ff0000"))).toBeLessThan(1);
  });

  it("is deterministic", () => {
    const colors = ["#742f14", "#5a84ac", "#c7ac9f"];
    expect(deriveModuleAccents(colors, "dark")).toEqual(deriveModuleAccents(colors, "dark"));
  });

  it("handles an empty palette without throwing", () => {
    expect(accentList([], "dark")).toHaveLength(MODULE_ACCENT_SLOTS.length);
    expect(new Set(accentList([], "dark")).size).toBe(MODULE_ACCENT_SLOTS.length);
  });
});

describe("Accent ink", () => {
  it("contrasts against the accent in each direction", () => {
    // Dark themes carry light accent chips, so their ink is dark, and the
    // reverse on light themes.
    expect(lightness(accentInkToken("dark")["--mm-on-accent"])).toBeLessThan(0.2);
    expect(lightness(accentInkToken("light")["--mm-on-accent"])).toBeGreaterThan(0.9);
  });

  it("is included by both accent producers", () => {
    expect(deriveModuleAccents(["#c62828"], "dark")["--mm-on-accent"]).toBeDefined();
    expect(fixedModuleAccents("light")["--mm-on-accent"]).toBeDefined();
  });
});

describe("Fixed accents for the hand-authored themes", () => {
  it("keeps Modular's original identity hues", () => {
    const dark = fixedModuleAccents("dark");
    // Amber clock, pink order, teal density — recognisably the originals.
    expect(separation(hue(dark[moduleAccentToken("clock")]), hue("#ffb703"))).toBeLessThan(3);
    expect(separation(hue(dark[moduleAccentToken("order")]), hue("#f15bb5"))).toBeLessThan(3);
    expect(separation(hue(dark[moduleAccentToken("density")]), hue("#00d4a6"))).toBeLessThan(3);
  });

  it("darkens them for a light theme so they hold against a pale canvas", () => {
    const light = fixedModuleAccents("light");
    const dark = fixedModuleAccents("dark");
    for (const slot of MODULE_ACCENT_SLOTS) {
      expect(lightness(light[moduleAccentToken(slot)]))
        .toBeLessThan(lightness(dark[moduleAccentToken(slot)]));
    }
  });
});
