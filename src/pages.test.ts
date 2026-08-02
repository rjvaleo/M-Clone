import { describe, expect, it } from "vitest";
import { githubPagesBase } from "./pages";

describe("GitHub Pages deployment", () => {
  it("serves the repository build from the M-Clone project subpath", () => {
    expect(githubPagesBase).toBe("/M-Clone/");
  });
});
