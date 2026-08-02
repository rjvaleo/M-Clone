import { describe, expect, it } from "vitest";
import { APP_MENU_LABELS, APP_WINDOWS, closeAppWindow, openAppWindow } from "./windows";

describe("application window registry", () => {
  it("exposes the classic application menu-bar order", () => {
    expect(APP_MENU_LABELS).toEqual(["File", "Edit", "Variables", "Pattern", "Windows", "Options"]);
  });

  it("keeps the six color-app windows permanently open", () => {
    const permanent = APP_WINDOWS.filter((window) => window.permanent);
    expect(permanent.map((window) => window.id)).toEqual([
      "patterns", "conducting", "variables", "cyclic-variables", "midi", "snapshot",
    ]);
    expect(closeAppWindow(new Set(APP_WINDOWS.map((window) => window.id)), "patterns").has("patterns")).toBe(true);
  });

  it("opens each auxiliary window once and allows it to close", () => {
    const opened = openAppWindow(new Set<string>(), "midi-view");
    expect([...openAppWindow(opened, "midi-view")]).toEqual(["midi-view"]);
    expect(closeAppWindow(opened, "midi-view").has("midi-view")).toBe(false);
    expect(APP_WINDOWS).toContainEqual({ id: "synth", label: "Synth", permanent: false });
  });

  it("keeps MIDI Assignment separate from the permanent compact Midi window", () => {
    expect(APP_WINDOWS).toContainEqual({
      id: "midi-assignment", label: "Midi Assignment", permanent: false,
    });
    expect(APP_WINDOWS.find((window) => window.id === "midi")?.permanent).toBe(true);
  });
});
