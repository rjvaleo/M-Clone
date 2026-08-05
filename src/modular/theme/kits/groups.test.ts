import { describe, expect, it } from "vitest";
import { ADSR_ORDER, adsrStages, withAdsrStage } from "./groups";
import type { EnvelopeShape } from "./geometry";

const env: EnvelopeShape = { attack: 0.1, decay: 0.4, sustain: 0.7, release: 0.2 };

describe("ADSR_ORDER", () => {
  it("is attack, decay, sustain, release — in that order and no other", () => {
    // CATALOG.md's layout rule B: every panel surveyed prints these four in
    // signal order, never alphabetised and never rearranged. The constant is
    // the enforcement.
    expect(ADSR_ORDER).toEqual(["attack", "decay", "sustain", "release"]);
  });
});

describe("adsrStages", () => {
  it("returns the four stages in signal order", () => {
    expect(adsrStages(env).map((stage) => stage.key)).toEqual([
      "attack",
      "decay",
      "sustain",
      "release",
    ]);
  });

  it("labels them the way a panel prints them", () => {
    expect(adsrStages(env).map((stage) => stage.short)).toEqual(["A", "D", "S", "R"]);
    expect(adsrStages(env).map((stage) => stage.label)).toEqual([
      "Attack",
      "Decay",
      "Sustain",
      "Release",
    ]);
  });

  it("carries each stage's current value", () => {
    expect(adsrStages(env).map((stage) => stage.value)).toEqual([0.1, 0.4, 0.7, 0.2]);
  });

  it("marks sustain as the one level among three durations", () => {
    // Sustain is how loud the held note stays; the other three are how long
    // something takes. A control bank that treated all four alike would give
    // sustain a time axis it does not have.
    expect(adsrStages(env).map((stage) => stage.isLevel)).toEqual([false, false, true, false]);
  });
});

describe("withAdsrStage", () => {
  it("sets only the named stage", () => {
    expect(withAdsrStage(env, "decay", 0.9)).toEqual({
      attack: 0.1,
      decay: 0.9,
      sustain: 0.7,
      release: 0.2,
    });
  });

  it("leaves the original envelope untouched", () => {
    const before = { ...env };
    withAdsrStage(env, "attack", 0.5);
    expect(env).toEqual(before);
  });

  it("can set every stage in turn", () => {
    const updated = ADSR_ORDER.reduce<EnvelopeShape>(
      (shape, key) => withAdsrStage(shape, key, 0.5),
      env,
    );
    expect(updated).toEqual({ attack: 0.5, decay: 0.5, sustain: 0.5, release: 0.5 });
  });
});
