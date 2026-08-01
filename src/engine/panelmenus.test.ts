import { describe, expect, it } from "vitest";
import { PANEL_MENU_ACCESS, PANEL_MENU_OWNERS, variableMenuLabels } from "./panelmenus";

describe("panel context-menu ownership", () => {
  it("keeps module commands off title bars and available by right-click", () => {
    expect(PANEL_MENU_ACCESS).toBe("context");
  });

  it("keeps Pattern/Edit with the Pattern Editor and conducting options with Conducting", () => {
    expect(PANEL_MENU_OWNERS).toEqual({
      Edit: "pattern-editor",
      Pattern: "pattern-editor",
      Variables: "variables",
      Options: "conducting",
      Harmony: "conducting",
      Output: "conducting",
    });
  });

  it("includes every implemented variable editor followed by the four manual color commands", () => {
    expect(variableMenuLabels([
      "Note Density", "Velocity Range", "Note Order",
      "Transposition", "Time Distortion", "Orchestration",
    ])).toEqual([
      "Edit Note Density…", "Edit Velocity Range…", "Edit Note Order…",
      "Edit Transposition…", "Edit Time Distortion…", "Edit Orchestration…",
      "Voice 1 Color…", "Voice 2 Color…", "Voice 3 Color…", "Voice 4 Color…",
    ]);
  });
});
