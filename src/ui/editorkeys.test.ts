import { describe, expect, it } from "vitest";
import { isLegacyClearKey } from "./editorkeys";

describe("Pattern Editor keyboard commands", () => {
  it("maps the browser Delete key to M's legacy Clear key only", () => {
    expect(isLegacyClearKey("Delete")).toBe(true);
    expect(isLegacyClearKey("Backspace")).toBe(false);
    expect(isLegacyClearKey("Clear")).toBe(true);
  });
});
