import { describe, expect, it } from "vitest";
import { Rng } from "./rng";
import { pickCyclicLevel } from "./cyclic";
import { cyclePicks, playStep, type StepState, type VoiceCycles } from "./step";
import type { CyclicStep, StepEvent } from "./types";

const cells = (values: CyclicStep[]): CyclicStep[] =>
  [...values, ...Array.from({ length: 16 - values.length }, () => 2)];

const cycles = (over: Partial<VoiceCycles> = {}): VoiceCycles => ({
  cells: { accent: cells([1, 2, 3]), legato: cells([4, 3, 2, 1]), rhythm: cells([2, 3]) },
  lengths: { accent: 3, legato: 4, rhythm: 2 },
  values: { legato: [6, 25, 50, 75, 100], rhythm: [1, 1, 1.5, 2, 5] },
  ...over,
});

const steps = (...pitches: number[][]): StepEvent[] => pitches.map((p) => ({ pitches: p }));

const voice = (over: Record<string, unknown> = {}) => ({
  noteOrderMix: { original: 100, cyclic: 0, utterly: 0 },
  density: 1,
  velocityRange: { low: 40, high: 100 },
  transposition: 0,
  legato: 1,
  playEnabled: true,
  ...over,
});

const harmony = { root: 0, scale: "major" as const, scaleSnap: false };
const fresh = (): StepState => ({ order: { pos: 0, last: -1, bval: 0.5 }, holdNext: false });

describe("cyclePicks: one voice's Cyclic Variables on one step", () => {
  it("reads each kind's own cell and wraps each counter at its own length", () => {
    let counters = { accent: 0, legato: 0, rhythm: 0 };
    const accents: number[] = [];
    for (let i = 0; i < 12; i++) {
      const picks = cyclePicks(cycles(), counters, new Rng(1));
      accents.push(picks.accentLevel);
      counters = picks.next;
    }
    expect(accents).toEqual([1, 2, 3, 1, 2, 3, 1, 2, 3, 1, 2, 3]);
    expect(counters).toEqual({ accent: 0, legato: 0, rhythm: 0 });
  });

  it("gives Legato as a fraction of the onset and Rhythm as a step multiplier", () => {
    const picks = cyclePicks(cycles(), { accent: 0, legato: 0, rhythm: 1 }, new Rng(1));
    expect(picks.legato).toBe(1);
    expect(picks.rhythm).toBe(2);
  });

  it("reads the first cell when a counter is past a cycle that has since been shortened", () => {
    const picks = cyclePicks(cycles(), { accent: 9, legato: 0, rhythm: 0 }, new Rng(1));
    expect(picks.cells.accent).toBe(0);
    expect(picks.accentLevel).toBe(1);
  });

  it("reports when the Rhythm cycle begins again", () => {
    expect(cyclePicks(cycles(), { accent: 0, legato: 0, rhythm: 0 }, new Rng(1)).rhythmRestarted).toBe(true);
    expect(cyclePicks(cycles(), { accent: 0, legato: 0, rhythm: 1 }, new Rng(1)).rhythmRestarted).toBe(false);
  });

  it("draws for ranged cells in M's order: accent, then legato, then rhythm", () => {
    const ranged = cycles({
      cells: {
        accent: cells([{ min: 1, max: 4 }]),
        legato: cells([{ min: 0, max: 4 }]),
        rhythm: cells([{ min: 0, max: 4 }]),
      },
      lengths: { accent: 1, legato: 1, rhythm: 1 },
    });
    const picks = cyclePicks(ranged, { accent: 0, legato: 0, rhythm: 0 }, new Rng(42));
    const by = new Rng(42);
    const accent = pickCyclicLevel({ min: 1, max: 4 }, by);
    const legato = pickCyclicLevel({ min: 0, max: 4 }, by);
    const rhythm = pickCyclicLevel({ min: 0, max: 4 }, by);
    expect(picks.accentLevel).toBe(accent);
    expect(picks.legato).toBe([6, 25, 50, 75, 100][legato] / 100);
    expect(picks.rhythm).toBe([1, 1, 1.5, 2, 5][rhythm]);
  });
});

describe("playStep: one voice's note on one step", () => {
  const pattern = { steps: steps([60], [62], [], [64, 67]), scrambledSteps: steps([64, 67], [], [62], [60]), outputLength: 4 };

  it("plays the pattern in order, transposed, at the accent's velocity", () => {
    let state = fresh();
    const played: number[][] = [];
    for (let i = 0; i < 4; i++) {
      const step = playStep(voice({ transposition: 12 }), pattern, harmony, state, 4, 0.5, 0, new Rng(1));
      played.push(step.pitches);
      state = step.next;
    }
    expect(played).toEqual([[72], [74], [], [76, 79]]);
  });

  it("maps accent levels to steps through the Velocity Range, with 0 silent", () => {
    const at = (level: number) => playStep(voice(), pattern, harmony, fresh(), level, 1, 0, new Rng(1));
    expect([1, 2, 3, 4].map((level) => at(level).velocity)).toEqual([40, 60, 80, 100]);
    expect(at(0).sounds).toBe(false);
  });

  it("adds the tap velocity offset, clamped to MIDI", () => {
    expect(playStep(voice(), pattern, harmony, fresh(), 4, 1, 40, new Rng(1)).velocity).toBe(127);
  });

  it("sets the length from the voice legato times the cycle's legato", () => {
    expect(playStep(voice({ legato: 0.5 }), pattern, harmony, fresh(), 4, 0.75, 0, new Rng(1)).lengthFactor)
      .toBeCloseTo(0.375, 9);
  });

  it("holds a note whose density draw fails through the next step, which is silent", () => {
    // Density 0.5, and a seed whose density draw fails on the first step: that
    // step still sounds, held for two onsets, and the second step is silent.
    const at = (seed: number) => playStep(voice({ density: 0.5 }), pattern, harmony, fresh(), 4, 1, 0, new Rng(seed));
    let seed = 0;
    while (at(seed).lengthFactor !== 2 && seed < 100) seed++;
    const first = at(seed);
    expect(first.sounds).toBe(true);
    expect(first.lengthFactor).toBe(2);
    expect(first.next.holdNext).toBe(true);
    const second = playStep(voice({ density: 0.5 }), pattern, harmony, first.next, 4, 1, 0, new Rng(seed));
    expect(second.sounds).toBe(false);
  });

  it("is silent at density 0", () => {
    expect(playStep(voice({ density: 0 }), pattern, harmony, fresh(), 4, 1, 0, new Rng(1)).sounds).toBe(false);
  });

  it("keeps a muted voice reading its pattern, so it stays in phase", () => {
    const step = playStep(voice({ playEnabled: false }), pattern, harmony, fresh(), 4, 1, 0, new Rng(1));
    expect(step.played).toBe(false);
    expect(step.sounds).toBe(false);
    expect(step.next.order.pos).toBe(1);
  });

  it("reads the scrambled copy when Note Order is all Cyclic Random", () => {
    const step = playStep(voice({ noteOrderMix: { original: 0, cyclic: 100, utterly: 0 } }),
      pattern, harmony, fresh(), 4, 1, 0, new Rng(1));
    expect(step.source).toBe("cyclic");
    expect(step.pitches).toEqual([64, 67]);
  });

  it("transposes by scale steps and snaps to key when asked", () => {
    const diatonic = { ...harmony, diatonicTranspose: true };
    expect(playStep(voice({ transposition: 2 }), pattern, diatonic, fresh(), 4, 1, 0, new Rng(1)).pitches).toEqual([64]);
    const snap = { ...harmony, scaleSnap: true };
    expect(playStep(voice({ transposition: 1 }), pattern, snap, fresh(), 4, 1, 0, new Rng(1)).pitches[0] % 12)
      .not.toBe(1);
  });

  it("does nothing on an empty pattern", () => {
    const step = playStep(voice(), { steps: [], scrambledSteps: [], outputLength: 0 }, harmony, fresh(), 4, 1, 0, new Rng(1));
    expect(step.played).toBe(false);
    expect(step.sounds).toBe(false);
  });
});
