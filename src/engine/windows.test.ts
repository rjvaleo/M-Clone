import { describe, expect, it } from "vitest";
import { APP_MENU_LABELS, APP_WINDOWS, closeAppWindow, initialAppWindows, openAppWindow } from "./windows";

describe("application window registry", () => {
  it("exposes the classic application menu-bar order", () => {
    expect(APP_MENU_LABELS).toEqual(["File", "Edit", "Variables", "Pattern", "Windows", "Options"]);
  });

  it("keeps five main windows permanently open; the Midi output strip can close", () => {
    const permanent = APP_WINDOWS.filter((window) => window.permanent);
    expect(permanent.map((window) => window.id)).toEqual([
      "patterns", "conducting", "variables", "cyclic-variables", "snapshot",
    ]);
    expect(closeAppWindow(new Set(["midi"]), "midi").has("midi")).toBe(false);
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
    expect(APP_WINDOWS.find((window) => window.id === "midi")?.permanent).toBe(false);
  });

  it("starts the M node with every window open except the four usually closed", () => {
    const open = initialAppWindows();
    for (const id of ["midi-view", "midi-assignment", "transposition", "timeDistort"]) {
      expect(open.has(id)).toBe(false);
    }
    expect(open.size).toBe(APP_WINDOWS.length - 4);
    for (const window of APP_WINDOWS.filter((w) => w.permanent)) expect(open.has(window.id)).toBe(true);
  });
});
