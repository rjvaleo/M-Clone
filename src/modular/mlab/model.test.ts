import { describe, expect, it, vi } from "vitest";
import { defaultHarmony } from "./model";

// Hoisted above the import: a project saved before Diatonic Transpose and Chord Tones existed has neither.
vi.mock("../../engine/project", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../engine/project")>();
  return {
    ...actual,
    createDefaultProject: () => {
      const project = actual.createDefaultProject();
      delete project.diatonicTranspose;
      delete project.chordTones;
      return project;
    },
  };
});

describe("M modules' harmony defaults", () => {
  it("read a missing Diatonic Transpose or Chord Tones as off", () => {
    expect(defaultHarmony()).toMatchObject({ diatonicTranspose: false, chordTones: false });
  });
});
