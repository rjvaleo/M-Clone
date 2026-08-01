import { describe, expect, it } from "vitest";
import { shouldCloseMenu } from "./WindowMenu";

describe("menu dismissal", () => {
  it("does not dismiss on the menu title before its toggle click runs", () => {
    expect(shouldCloseMenu(true, false)).toBe(false);
    expect(shouldCloseMenu(false, true)).toBe(false);
    expect(shouldCloseMenu(false, false)).toBe(true);
  });
});
