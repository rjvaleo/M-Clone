import { describe, expect, it } from "vitest";
import recorded from "./__fixtures__/plannerParity.json";
import { parityScenarios, playScenario } from "./__fixtures__/plannerParity";

describe("planner parity", () => {
  // Recorded before the step logic moved into step.ts: the same scenarios must
  // still produce exactly the same notes, steps and cycle resets.
  for (const [name, state] of Object.entries(parityScenarios())) {
    it(`plays the ${name} scenario exactly as before`, () => {
      expect(JSON.parse(JSON.stringify(playScenario(state))))
        .toEqual((recorded as Record<string, unknown>)[name]);
    });
  }
});
