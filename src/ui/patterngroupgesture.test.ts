import { describe, expect, it } from "vitest";
import { patternGroupSelectionSyncs } from "./patterngroupgesture";

describe("Pattern Group selection modifier", () => {
  it("syncs ordinary selection but suppresses Sync for Option/Alt-click", () => {
    expect(patternGroupSelectionSyncs(false)).toBe(true);
    expect(patternGroupSelectionSyncs(true)).toBe(false);
  });
});
