import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useM } from "../state/store";
import { needsDownloadName, saveProject } from "./fileCommands";

describe("project file saving", () => {
  beforeEach(() => {
    useM.getState().newDocument();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("uses the browser save picker for Save As and writes the project", async () => {
    const write = vi.fn(async () => {});
    const close = vi.fn(async () => {});
    const showSaveFilePicker = vi.fn(async () => ({
      name: "Picked.mclone",
      createWritable: async () => ({ write, close }),
    }));
    vi.stubGlobal("window", { showSaveFilePicker });

    await saveProject(true);

    expect(showSaveFilePicker).toHaveBeenCalledOnce();
    expect(write).toHaveBeenCalledWith(expect.stringContaining('"version": 2'));
    expect(close).toHaveBeenCalledOnce();
    expect(useM.getState().documentName).toBe("Picked.mclone");
  });

  it("uses the app-owned download anchor in the embedded browser", async () => {
    useM.getState().markSaved("Existing.mclone");
    const click = vi.fn();
    const remove = vi.fn();
    const link = { href: "", download: "", click, remove };
    vi.stubGlobal("window", {});
    vi.stubGlobal("document", {
      querySelector: vi.fn(() => link),
    });
    vi.stubGlobal("URL", {});

    await saveProject(false);

    expect(click).toHaveBeenCalledOnce();
    expect(remove).not.toHaveBeenCalled();
    expect(link.href).toMatch(/^data:application\/json;charset=utf-8,/);
    expect(decodeURIComponent(link.href)).toContain('"version": 2');
  });

  it("requests an in-app name when the embedded browser cannot show a picker", () => {
    expect(needsDownloadName(true, "Existing.mclone", false)).toBe(true);
    expect(needsDownloadName(false, null, false)).toBe(true);
    expect(needsDownloadName(false, "Existing.mclone", false)).toBe(false);
    expect(needsDownloadName(true, null, true)).toBe(false);
  });

  it("commits an explicit embedded-browser filename before downloading", async () => {
    const click = vi.fn();
    const link = { href: "", download: "", click };
    const showSaveFilePicker = vi.fn(async () => ({
      name: "Late Picker Name.mclone",
      createWritable: async () => ({ write: async () => {}, close: async () => {} }),
    }));
    vi.stubGlobal("window", { showSaveFilePicker });
    vi.stubGlobal("document", { querySelector: vi.fn(() => link) });

    await saveProject(true, "Untitled5");

    expect(showSaveFilePicker).not.toHaveBeenCalled();
    expect(link.download).toBe("Untitled5.mclone");
    expect(useM.getState().documentName).toBe("Untitled5.mclone");
    expect(useM.getState().isDirty).toBe(false);
    expect(click).toHaveBeenCalledOnce();
  });

  it("asks the app for a name when an exposed picker rejects the save", async () => {
    const click = vi.fn();
    const link = { href: "", download: "", click };
    vi.stubGlobal("window", {
      showSaveFilePicker: vi.fn(async () => { throw new Error("unsupported"); }),
    });
    vi.stubGlobal("document", { querySelector: vi.fn(() => link) });

    const result = await saveProject(true);

    expect(result).toBe("needs-name");
    expect(useM.getState().documentName).toBe(null);
    expect(click).not.toHaveBeenCalled();
  });
});
