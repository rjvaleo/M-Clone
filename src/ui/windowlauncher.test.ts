import { describe, expect, it } from "vitest";
import type { MenuItem } from "./WindowMenu";
import { mergeWindowLauncherItems } from "./windowlauncher";

describe("canvas-wide module launcher", () => {
  const launcher: MenuItem[] = [{ label: "Synth", run: () => undefined }];

  it("is the complete context menu on modules without local commands", () => {
    expect(mergeWindowLauncherItems([], launcher)).toEqual(launcher);
  });

  it("follows local module commands without replacing them", () => {
    const local: MenuItem[] = [{ label: "Edit Orchestration…", run: () => undefined }];
    expect(mergeWindowLauncherItems(local, launcher)).toEqual([
      ...local, "separator", ...launcher,
    ]);
  });
});
