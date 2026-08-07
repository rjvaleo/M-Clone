import { describe, expect, it } from "vitest";
import { CONTROL_NAMES, everyKitImplementsEveryControl, faceFor, KIT_FACES } from "./registry";
import { KIT_IDS, KIT_META } from "./types";

describe("The kit registry", () => {
  it("has a face for every declared kit id", () => {
    // The property everyKitImplementsEveryControl checks, restated directly:
    // a kit id with no matching face would make faceFor() return undefined
    // the first time a node tried to render one of its controls.
    for (const id of KIT_IDS) {
      expect(KIT_FACES[id], id).toBeDefined();
    }
  });

  it("has no face for an id that isn't declared", () => {
    // The converse — a stray face nothing points to is dead code nothing
    // would notice.
    expect(Object.keys(KIT_FACES).sort()).toEqual([...KIT_IDS].sort());
  });

  it("gives every kit metadata: a label, a family and a blurb", () => {
    for (const id of KIT_IDS) {
      const meta = KIT_META[id];
      expect(meta, id).toBeDefined();
      expect(meta.label.length, `${id} label`).toBeGreaterThan(0);
      expect(meta.family.length, `${id} family`).toBeGreaterThan(0);
      expect(meta.blurb.length, `${id} blurb`).toBeGreaterThan(0);
    }
  });

  it("implements every one of the seven controls on every kit", () => {
    // The completeness the whole exercise is for: CATALOG.md found no
    // single source image covering more than nine of fourteen "kinds of
    // things." This is the assertion that closing that gap actually held —
    // a kit missing even one control would fail here, not silently at the
    // first node face that reaches for it.
    expect(everyKitImplementsEveryControl()).toBe(true);
    for (const id of KIT_IDS) {
      const face = faceFor(id);
      for (const control of CONTROL_NAMES) {
        expect(typeof face[control], `${id}.${control}`).toBe("function");
      }
    }
  });

  it("faceFor returns the same object as a direct lookup", () => {
    for (const id of KIT_IDS) {
      expect(faceFor(id)).toBe(KIT_FACES[id]);
    }
  });
});
