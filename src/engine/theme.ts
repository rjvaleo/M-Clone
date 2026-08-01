export type ChannelColors = readonly [string, string, string, string];

export type ChannelTheme = {
  id: string;
  name: string;
  colors: ChannelColors;
};

/**
 * Extend this registry to add another built-in palette. Classic follows the
 * color application reference: green, red, blue, and yellow for Voices 1-4.
 */
export const CHANNEL_THEME_PRESETS = {
  classic: {
    id: "classic",
    name: "Classic",
    colors: ["#20c840", "#ff4050", "#48a8ff", "#ffd21f"],
  },
  blue: {
    id: "blue",
    name: "Blue",
    colors: ["#b9ddff", "#72b7f2", "#347fc4", "#164a7b"],
  },
  red: {
    id: "red",
    name: "Red",
    colors: ["#ffc2c2", "#f27d7d", "#c83d3d", "#791919"],
  },
  green: {
    id: "green",
    name: "Green",
    colors: ["#c7f2c2", "#79ce74", "#38933c", "#175c24"],
  },
  rgb: {
    id: "rgb",
    name: "RGB",
    colors: ["#ef3340", "#20a84a", "#357edd", "#f2c230"],
  },
  bw: {
    id: "bw",
    name: "B&W",
    colors: ["#1a1a1a", "#555555", "#999999", "#dddddd"],
  },
} as const satisfies Record<string, ChannelTheme>;

export type ChannelThemePresetId = keyof typeof CHANNEL_THEME_PRESETS;

function normalizeHex(color: string): string {
  if (/^#[0-9a-f]{3}$/i.test(color)) {
    return `#${color.slice(1).split("").map((part) => part + part).join("")}`.toLowerCase();
  }
  if (/^#[0-9a-f]{6}$/i.test(color)) return color.toLowerCase();
  throw new Error(`Invalid channel color: ${color}`);
}

export function makeCustomChannelTheme(colors: ChannelColors): ChannelTheme {
  return {
    id: "custom",
    name: "Custom",
    colors: colors.map(normalizeHex) as unknown as ChannelColors,
  };
}

export function channelThemeVariables(theme: ChannelTheme): Record<string, string> {
  return Object.fromEntries(
    theme.colors.map((color, index) => [`--channel-${index + 1}`, color]),
  );
}
