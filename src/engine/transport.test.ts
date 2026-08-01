import { describe, expect, it } from "vitest";
import { createDefaultProject } from "./project";
import { makeCursors } from "./planner";
import { rebaseChangedTimelines, timingFingerprints } from "./transport";

describe("transport timeline continuity", () => {
  it("preserves unchanged cursor objects", () => {
    const state = createDefaultProject();
    const cursors = makeCursors(state, 10);
    const timing = timingFingerprints(state);
    const result = rebaseChangedTimelines(cursors, timing, timing);
    expect(result.every((cursor, i) => cursor === cursors[i])).toBe(true);
  });

  it("starts a new segment at the next unscheduled event after a tempo change", () => {
    const before = createDefaultProject();
    const after = { ...before, tempo: 180 };
    const cursors = makeCursors(before, 10).map((cursor, voice) => ({
      ...cursor,
      nextTimeSec: 12 + voice / 10,
      originSec: 10,
      clockSec: 2 + voice,
      cyclicPos: voice + 2,
    }));

    const result = rebaseChangedTimelines(
      cursors,
      timingFingerprints(before),
      timingFingerprints(after),
    );

    expect(result.map((cursor) => cursor.originSec)).toEqual([12, 12.1, 12.2, 12.3]);
    expect(result.map((cursor) => cursor.clockSec)).toEqual([0, 0, 0, 0]);
    expect(result.map((cursor) => cursor.cyclicPos)).toEqual([2, 3, 4, 5]);
  });

  it("rebases only the voice whose time map changed", () => {
    const before = createDefaultProject();
    const after = structuredClone(before);
    after.voices[2].timeDistort.points = [{ x: 0.25, y: 0.75 }];
    const cursors = makeCursors(before, 4).map((cursor) => ({
      ...cursor, nextTimeSec: 5, clockSec: 1,
    }));
    const result = rebaseChangedTimelines(
      cursors,
      timingFingerprints(before),
      timingFingerprints(after),
    );
    expect(result[0]).toBe(cursors[0]);
    expect(result[1]).toBe(cursors[1]);
    expect(result[2]).toMatchObject({ originSec: 5, clockSec: 0 });
    expect(result[3]).toBe(cursors[3]);
  });
});
