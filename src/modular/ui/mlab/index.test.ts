import { describe, expect, it } from "vitest";
import { M_LAB_MODULES, M_LAB_TYPES } from "../../registry/mLabModules";
import { MLAB_FACES, N4_TITLES } from "./index";

// Every custom element an M module's face names, as the canvas looks it up.
const customIds = M_LAB_MODULES.flatMap((module) =>
  module.face.flatMap((section) => section.elements.flatMap((element) => (element.kind === "custom" ? [element.id] : []))),
);

describe("the M module faces", () => {
  it("has a face for every custom element an M module names, and the synth's panel", () => {
    expect(customIds.length).toBeGreaterThan(0);
    for (const id of customIds) expect(MLAB_FACES[id], id).toBeTruthy();
    expect(MLAB_FACES["synth-panel"]).toBeTruthy();
  });

  it("titles every M module type as Numerology does", () => {
    expect(Object.keys(N4_TITLES).sort()).toEqual(Object.values(M_LAB_TYPES).sort());
    expect(N4_TITLES[M_LAB_TYPES.noteSeq]).toBe("M Note Sequencer");
    expect(N4_TITLES[M_LAB_TYPES.timeWarp]).toBe("CV Sequencer");
    expect(N4_TITLES[M_LAB_TYPES.orchestra]).toBe("Orchestra Matrix");
  });
});
