import { describe, expect, it } from "vitest";
import { windowBackShortcut } from "./windowstack";

describe("classic window stacking shortcuts", () => {
  it("maps Command-Option-1 through 6 to the six permanent modules", () => {
    expect(windowBackShortcut({ key: "1", metaKey: true, altKey: true })).toBe("patterns");
    expect(windowBackShortcut({ key: "2", metaKey: true, altKey: true })).toBe("conducting");
    expect(windowBackShortcut({ key: "6", metaKey: true, altKey: true })).toBe("snapshot");
  });

  it("ignores incomplete modifiers and non-window digits", () => {
    expect(windowBackShortcut({ key: "1", metaKey: true, altKey: false })).toBeNull();
    expect(windowBackShortcut({ key: "7", metaKey: true, altKey: true })).toBeNull();
  });
});
