import { describe, expect, it } from "vitest";
import { transportDocumentTitle } from "./documenttitle";

describe("transport document title", () => {
  it("uses the saved file name and falls back only for an unsaved document", () => {
    expect(transportDocumentTitle(null)).toBe("Untitled");
    expect(transportDocumentTitle("My Piece.mclone.json")).toBe("My Piece.mclone.json");
  });
});
