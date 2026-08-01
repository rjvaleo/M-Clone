import { describe, expect, it } from "vitest";
import {
  CHANNEL_THEME_PRESETS,
  channelThemeVariables,
  makeCustomChannelTheme,
} from "./theme";

describe("channel theme presets", () => {
  it("ships the six requested extensible presets", () => {
    expect(Object.keys(CHANNEL_THEME_PRESETS)).toEqual([
      "classic", "blue", "red", "green", "rgb", "bw",
    ]);
  });

  it("gives every preset four valid, visually distinct channel colors", () => {
    for (const preset of Object.values(CHANNEL_THEME_PRESETS)) {
      expect(preset.colors).toHaveLength(4);
      expect(new Set(preset.colors)).toHaveLength(4);
      expect(preset.colors.every((color) => /^#[0-9a-f]{6}$/i.test(color))).toBe(true);
    }
  });

  it("maps a palette to stable CSS custom properties", () => {
    expect(channelThemeVariables(CHANNEL_THEME_PRESETS.classic)).toEqual({
      "--channel-1": "#20c840",
      "--channel-2": "#ff4050",
      "--channel-3": "#48a8ff",
      "--channel-4": "#ffd21f",
    });
  });

  it("creates a detached custom theme and normalizes short hex colors", () => {
    const colors = ["#123", "#ABC", "#010203", "#fefefe"] as const;
    const theme = makeCustomChannelTheme(colors);
    expect(theme).toEqual({
      id: "custom",
      name: "Custom",
      colors: ["#112233", "#aabbcc", "#010203", "#fefefe"],
    });
    expect(theme.colors).not.toBe(colors);
  });

  it("rejects invalid custom colors", () => {
    expect(() => makeCustomChannelTheme(["red", "#fff", "#000", "#123"])).toThrow();
  });
});
