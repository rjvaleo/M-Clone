import { describe, expect, it } from "vitest";
import { encodeDocument } from "./document";
import { mergeStartupState } from "./startup";
import { createDefaultProject } from "./project";
import { makePresetPositions } from "./variables";
import { DEFAULT_OPTIONS } from "./options";

function document() {
  const project = createDefaultProject();
  const positions = makePresetPositions();
  return encodeDocument({
    project, positions, snapshots: Array(26).fill(null), slideshows: Array.from(
      { length: 9 }, () => ({ events: [], loopAtSec: null }),
    ), currentSnapshot: null, snapshotQuantize: 0, arrows: {}, patternGroup: 0,
    selectedVoice: 0, tempoRange: { low: 80, high: 160 }, syncRatio: 4,
    syncRatioDirection: "out", robotRange: { x: 0.15, y: 0.15 }, robotTimeBase: 4,
    cyclicPositions: Object.fromEntries((["accent", "legato", "rhythm"] as const).map(
      (kind) => [kind, Array.from({ length: 6 }, () => project.cyclic[kind])],
    )) as never,
    cyclicLengths: Object.fromEntries((["accent", "legato", "rhythm"] as const).map(
      (kind) => [kind, Array.from({ length: 6 }, () => Array(4).fill(16))],
    )) as never,
    activeCyclicPositions: { accent: 0, legato: 0, rhythm: 0 },
    options: { ...DEFAULT_OPTIONS },
  });
}

describe("Startup State", () => {
  it("keeps screen settings but never Pattern contents or Time Maps", () => {
    const blank = document();
    const saved = document();
    saved.project.tempo = 177;
    saved.project.patterns[0].steps[0] = { pitches: [99] };
    saved.positions.timeDistort.slots[0][0] = {
      points: [{ x: 0.5, y: 0.8 }], length: 2, denominator: 8,
    };
    const merged = mergeStartupState(blank, saved);
    expect(merged.project.tempo).toBe(177);
    expect(merged.project.patterns).toEqual(blank.project.patterns);
    expect(merged.positions.timeDistort).toEqual(blank.positions.timeDistort);
  });
});
