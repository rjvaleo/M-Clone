import { describe, expect, it } from "vitest";
import { TYPOGRAPHY } from "./typography";

describe("shared rendered typography standard", () => {
  it("defines one scale for global menus, panel chrome, and body controls", () => {
    expect(TYPOGRAPHY).toEqual({
      globalMenu: 11,
      title: 10,
      titleBar: 16,
      titleNote: 8,
      body: 8,
      compact: 7,
    });
  });
});
