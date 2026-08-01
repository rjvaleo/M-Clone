// Portable transport continuity helpers. They contain no browser APIs, so the
// same rules can be used by future native scheduler adapters.

import type { ProjectState } from "./types";
import type { TimeMap } from "./timemap";
import type { VoiceCursor } from "./planner";

export type TimingFingerprint = {
  tempo: number;
  numerator: number;
  denominator: number;
  timeMap: string;
};

function mapKey(map: TimeMap): string {
  return `${map.length}/${map.denominator}:${map.points
    .map((point) => `${point.x},${point.y}`)
    .join(";")}`;
}

export function timingFingerprints(state: ProjectState): TimingFingerprint[] {
  return state.voices.map((voice) => ({
    tempo: state.tempo,
    numerator: voice.timeBaseNumerator,
    denominator: voice.timeBaseDenominator,
    timeMap: mapKey(voice.timeDistort),
  }));
}

function sameTiming(a: TimingFingerprint | undefined, b: TimingFingerprint): boolean {
  return a?.tempo === b.tempo
    && a.numerator === b.numerator
    && a.denominator === b.denominator
    && a.timeMap === b.timeMap;
}

/**
 * Start a new timing segment at each affected voice's next unscheduled event.
 * This preserves phase and prevents a tempo/map edit from retroactively moving
 * elapsed events into the past (which would otherwise create catch-up bursts).
 */
export function rebaseChangedTimelines(
  cursors: readonly VoiceCursor[],
  previous: readonly TimingFingerprint[],
  next: readonly TimingFingerprint[],
): VoiceCursor[] {
  return cursors.map((cursor, index) => {
    if (sameTiming(previous[index], next[index])) return cursor;
    return {
      ...cursor,
      originSec: cursor.nextTimeSec,
      clockSec: 0,
    };
  });
}
