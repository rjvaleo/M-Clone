import { describe, expect, it } from "vitest";
import {
  EXISTING_FUNCTIONALITY_GAP_IDS,
  MANUAL_CAPABILITIES,
  NEW_FUNCTIONALITY_IDS,
  conformanceCounts,
  conformanceTrack,
  conformanceTrackCounts,
  type ManualCapability,
} from "./manualConformance";

describe("M 2.7 manual inventory", () => {
  it("has unique stable ids and a disposition for every inventoried capability", () => {
    expect(MANUAL_CAPABILITIES.length).toBeGreaterThan(100);
    expect(new Set(MANUAL_CAPABILITIES.map((item) => item.id)).size)
      .toBe(MANUAL_CAPABILITIES.length);
    expect(Object.values(conformanceCounts()).reduce((sum, count) => sum + count, 0))
      .toBe(MANUAL_CAPABILITIES.length);
  });

  it("groups every red capability exactly once as an existing gap or new functionality", () => {
    const redIds = MANUAL_CAPABILITIES
      .filter((item) => item.result === "partial" || item.result === "fail")
      .map((item) => item.id)
      .sort();
    const groupedIds = [
      ...EXISTING_FUNCTIONALITY_GAP_IDS,
      ...NEW_FUNCTIONALITY_IDS,
    ].sort();
    expect(new Set(groupedIds).size).toBe(groupedIds.length);
    expect(groupedIds).toEqual(redIds);
    expect(Object.values(conformanceTrackCounts()).reduce((sum, count) => sum + count, 0))
      .toBe(MANUAL_CAPABILITIES.length);
  });
});

function assertion(capability: ManualCapability) {
  const title = `${capability.id} - pp. ${capability.pages}: ${capability.behavior}`;
  if (capability.result === "not-applicable") {
    it.skip(title, () => {});
  } else {
    it(title, () => {
      expect(capability.result, capability.evidence).toBe("pass");
    });
  }
}

describe("close these gaps in existing functionality first", () => {
  const gaps = MANUAL_CAPABILITIES
    .filter((capability) => conformanceTrack(capability) === "existing-gap");
  if (gaps.length === 0) it("has no remaining existing-functionality gaps", () => expect(gaps).toEqual([]));
  else gaps.forEach(assertion);
});

describe("then evaluate completely new functionality", () => {
  const capabilities = MANUAL_CAPABILITIES
    .filter((capability) => conformanceTrack(capability) === "new");
  if (capabilities.length === 0) it("has no remaining new-capability gaps", () => expect(capabilities).toEqual([]));
  else capabilities.forEach(assertion);
});

describe("already implemented manual functionality", () => {
  MANUAL_CAPABILITIES
    .filter((capability) => conformanceTrack(capability) === "implemented")
    .forEach(assertion);
});

describe("legacy or browser-host exceptions", () => {
  MANUAL_CAPABILITIES
    .filter((capability) => conformanceTrack(capability) === "exception")
    .forEach(assertion);
});
