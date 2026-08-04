import { describe, expect, it } from "vitest";
import {
  allThemes,
  applyTheme,
  DEFAULT_THEME_ID,
  orderPalettes,
  paletteTheme,
  setCustomThemes,
  themeMeta,
  THEME_IDS,
  THEMES,
} from "./themes";
import { PALETTES } from "./palettes";
import { moduleAccentToken, MODULE_ACCENT_SLOTS } from "./moduleAccents";

/** A stand-in for `document.documentElement` that records what was written. */
const fakeRoot = () => {
  const properties = new Map<string, string>();
  const style = {
    colorScheme: "",
    setProperty(name: string, value: string) {
      properties.set(name, value);
    },
    removeProperty(name: string) {
      properties.delete(name);
    },
    [Symbol.iterator]() {
      return [...properties.keys()][Symbol.iterator]();
    },
  };
  return { element: { style } as unknown as HTMLElement, properties, style };
};

describe("Theme roster", () => {
  it("ships the three built-ins plus every palette card", () => {
    expect(THEMES).toHaveLength(3 + PALETTES.length);
    expect(PALETTES.length).toBe(47);
    expect(THEMES.slice(0, 3).map((theme) => theme.id)).toEqual(["light", "dark", "teal"]);
    expect(THEMES.filter((theme) => theme.group === "base")).toHaveLength(3);
  });

  it("gives every theme a unique id", () => {
    expect(new Set(THEME_IDS).size).toBe(THEME_IDS.length);
  });

  it("defaults to a theme that exists", () => {
    expect(THEME_IDS).toContain(DEFAULT_THEME_ID);
  });

  it("falls back to the first theme for an unknown id", () => {
    expect(themeMeta("no-such-theme").id).toBe("light");
    expect(themeMeta("teal").label).toBe("Teal");
  });

  /**
   * The load-bearing invariant of a fifty-theme roster: switching themes clears
   * every custom property first, so any token one theme defines and another
   * omits would simply vanish and leave that rule unstyled.
   */
  it("defines exactly the same token set in every theme", () => {
    const expected = new Set(Object.keys(THEMES[0].tokens));
    expect(expected.size).toBeGreaterThan(80);
    for (const theme of THEMES) {
      const keys = new Set(Object.keys(theme.tokens));
      expect([...expected].filter((key) => !keys.has(key)), `${theme.id} is missing tokens`).toEqual([]);
      expect([...keys].filter((key) => !expected.has(key)), `${theme.id} has extra tokens`).toEqual([]);
    }
  });

  it("gives every theme the module identity tokens", () => {
    for (const theme of THEMES) {
      for (const slot of MODULE_ACCENT_SLOTS) {
        expect(theme.tokens[moduleAccentToken(slot)], `${theme.id} ${slot}`).toMatch(/^#[0-9a-f]{6}$/);
      }
      expect(theme.tokens["--mm-on-accent"]).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("keeps a light theme's plain variant in step with its tinted one", () => {
    for (const theme of THEMES) {
      if (!theme.plainTokens) continue;
      expect(Object.keys(theme.plainTokens).sort()).toEqual(Object.keys(theme.tokens).sort());
      // The plain variant differs only in its surfaces.
      expect(theme.plainTokens["--s-card"]).toBe("#ffffff");
      expect(theme.plainTokens["--tx-800"]).toBe(theme.tokens["--tx-800"]);
    }
  });

  it("reports a usable direction and swatch for every theme", () => {
    for (const theme of THEMES) {
      expect(["light", "dark"]).toContain(theme.colorScheme);
      expect(theme.swatch.surface).toMatch(/^#[0-9a-f]{6}$/);
      expect(theme.swatch.accent).toMatch(/^#[0-9a-f]{6}$/);
      expect(theme.swatch.ink).toMatch(/^#[0-9a-f]{6}$/);
      expect(theme.label.length).toBeGreaterThan(0);
    }
  });
});

describe("Palette ordering", () => {
  it("puts neutrals first and groups the rest by hue", () => {
    const ordered = orderPalettes([
      { id: "red", name: "red", colors: ["#c62828", "#e57373"] },
      { id: "grey", name: "grey", colors: ["#8a8a8a", "#bdbdbd"] },
      { id: "blue", name: "blue", colors: ["#1565c0", "#64b5f6"] },
    ]);
    expect(ordered[0].id).toBe("grey");
    expect(ordered.map((entry) => entry.id)).toHaveLength(3);
  });

  it("is stable for the same input", () => {
    expect(orderPalettes(PALETTES).map((palette) => palette.id))
      .toEqual(orderPalettes(PALETTES).map((palette) => palette.id));
  });
});

describe("Applying a theme", () => {
  it("writes the theme's tokens and its colour scheme", () => {
    const root = fakeRoot();
    applyTheme("teal", { root: root.element });
    expect(root.properties.get("--s-card")).toBe("#135053");
    expect(root.style.colorScheme).toBe("dark");
    expect(root.properties.size).toBeGreaterThan(80);
  });

  it("clears the previous theme's properties before writing", () => {
    const root = fakeRoot();
    root.style.setProperty("--left-over", "red");
    applyTheme("light", { root: root.element });
    expect(root.properties.has("--left-over")).toBe(false);
    expect(root.properties.get("--tx-800")).toBe("#15202b");
  });

  it("switches cleanly between two themes", () => {
    const root = fakeRoot();
    applyTheme("teal", { root: root.element });
    applyTheme("dark", { root: root.element });
    expect(root.properties.get("--s-card")).toBe("#262628");
    expect(root.style.colorScheme).toBe("dark");
  });

  it("uses the plain variant only when asked and only where one exists", () => {
    const lightPalette = THEMES.find((theme) => theme.plainTokens);
    expect(lightPalette).toBeDefined();
    if (!lightPalette) return;

    const tinted = fakeRoot();
    applyTheme(lightPalette.id, { root: tinted.element });
    const plain = fakeRoot();
    applyTheme(lightPalette.id, { root: plain.element, whitePage: true });
    expect(plain.properties.get("--s-card")).toBe("#ffffff");
    expect(tinted.properties.get("--s-card")).not.toBe("#ffffff");

    // A dark theme has no plain variant; asking for one changes nothing.
    const dark = fakeRoot();
    applyTheme("dark", { root: dark.element, whitePage: true });
    expect(dark.properties.get("--s-card")).toBe("#262628");
  });

  it("falls back rather than writing nothing for an unknown theme", () => {
    const root = fakeRoot();
    applyTheme("no-such-theme", { root: root.element });
    expect(root.properties.get("--tx-800")).toBe("#15202b");
  });
});

describe("Custom palettes", () => {
  it("joins the roster and leaves when removed", () => {
    setCustomThemes([{ id: "mine", name: "Mine", colors: ["#123456", "#abcdef", "#ff8800"] }]);
    expect(allThemes().map((theme) => theme.id)).toContain("mine");
    expect(themeMeta("mine").group).toBe("custom");
    expect(themeMeta("mine").tokens["--s-card"]).toMatch(/^#[0-9a-f]{6}$/);

    setCustomThemes([]);
    expect(allThemes().map((theme) => theme.id)).not.toContain("mine");
  });

  it("ignores a palette too small to derive a theme from", () => {
    setCustomThemes([{ id: "thin", name: "Thin", colors: ["#123456"] }]);
    expect(allThemes().map((theme) => theme.id)).not.toContain("thin");
    setCustomThemes([]);
  });

  it("gives a custom palette the same complete token set as a shipped one", () => {
    const custom = paletteTheme({ id: "x", name: "X", colors: ["#204060", "#c08040"] }, "custom");
    expect(Object.keys(custom.tokens).sort()).toEqual(Object.keys(THEMES[3].tokens).sort());
  });
});
