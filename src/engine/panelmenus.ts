export const PANEL_MENU_ACCESS = "context" as const;

export const PANEL_MENU_OWNERS = {
  Edit: "pattern-editor",
  Pattern: "pattern-editor",
  Variables: "variables",
  Options: "conducting",
  Harmony: "conducting",
  Output: "conducting",
} as const;

export function variableMenuLabels(editors: readonly string[]): string[] {
  return [
    ...editors.map((name) => `Edit ${name}…`),
    ...Array.from({ length: 4 }, (_, voice) => `Voice ${voice + 1} Color…`),
  ];
}
