import { describe, expect, it } from "vitest";
import { mTheme } from "./mTheme";

describe("M's light or dark", () => {
  it("follows the canvas theme when M runs inside idMLab, whatever M had chosen on its own", () => {
    expect(mTheme("dark", "light")).toEqual({ theme: "dark", ownSwitch: false });
    expect(mTheme("light", "dark")).toEqual({ theme: "light", ownSwitch: false });
  });

  it("keeps its own choice, and its own switch, when it runs alone", () => {
    expect(mTheme(undefined, "dark")).toEqual({ theme: "dark", ownSwitch: true });
    expect(mTheme(undefined, "light")).toEqual({ theme: "light", ownSwitch: true });
  });
});
