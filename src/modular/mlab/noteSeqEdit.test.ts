import { describe, expect, it } from "vitest";
import { createNode } from "../registry/registry";
import { Rng } from "../../engine/rng";
import {
  RATE_OPTIONS,
  applyMaterial,
  cellsInPlay,
  currentMaterial,
  normGates,
  randomizeLane,
  setWarpStep,
  setWarpLength,
  warpInPlay,
  setCellLength,
  setCellValue,
  setEndStep,
  shiftAll,
  toggleNoteIn,
  zeroPitches,
} from "./noteSeqEdit";
import type { VoicePattern } from "./model";

const params = (values: Record<string, unknown> = {}) =>
  createNode("m.lab-noteseq", "ns", { x: 0, y: 0 }, values as never).parameters;
const group = (p: ReturnType<typeof params>, g = 0) => (p.patterns as unknown as VoicePattern[])[g];

describe("editing a NoteSeq from its face", () => {
  it("dragging the end marker sets M's Output Length, up to 999 steps", () => {
    expect(group({ ...params(), ...setEndStep(params(), 11) } as never).length).toBe(12);
    expect(group({ ...params(), ...setEndStep(params(), 5000) } as never).length).toBe(999);
  });

  it("a note toggled in the Original list keeps the scrambled list a shuffle of it", () => {
    const p = { ...params(), ...toggleNoteIn(params(), "orig", 0, 61) };
    const pattern = group(p as never);
    expect(pattern.steps[0]).toEqual([60, 61]);
    expect(pattern.scrambled.slice(0, 8).flat().sort()).toEqual(pattern.steps.slice(0, 8).flat().sort());
  });

  it("the scrambled list can be edited on its own, as in M", () => {
    const before = group(params());
    const pattern = group({ ...params(), ...toggleNoteIn(params(), "scram", 2, 90) } as never);
    expect(pattern.scrambled[2]).toContain(90);
    expect(pattern.steps).toEqual(before.steps);
  });

  it("edits the cells of the position in play, and their own length", () => {
    const p = { ...params({ "cycle-positions": { accent: 3, legato: 0, rhythm: 0 } }) };
    const next = { ...p, ...setCellValue(p, "accent", 4, { min: 1, max: 3 }) };
    expect(cellsInPlay(next, "accent")[4]).toEqual({ min: 1, max: 3 });
    const longer = { ...next, ...setCellLength(next, "accent", 5) };
    expect((longer["cycle-lengths"] as unknown as Record<string, number[]>).accent[3]).toBe(5);
  });

  it("<< and >> shift the notes and every per-step lane together", () => {
    const p = { ...params({ skip: [true], velocity: [0.5] }) };
    const shifted = { ...p, ...shiftAll(p, 1) };
    expect(group(shifted as never).steps[1]).toEqual([60]);
    expect((shifted.skip as boolean[])[1]).toBe(true);
    expect((shifted.velocity as number[])[1]).toBe(0.5);
  });

  it("Generate and Evolve read and write the group and positions in play", () => {
    const p = params({ group: 0 });
    const material = currentMaterial(p);
    expect(material.pattern.length).toBe(8);
    const updated = { ...p, ...applyMaterial(p, { ...material, cells: { ...material.cells, accent: Array(16).fill(4) } }) };
    expect(cellsInPlay(updated, "accent").every((c) => c === 4)).toBe(true);
  });

  it("∅ sets every note to the first, Norm All sets every gate to the middle level", () => {
    const pattern = zeroPitches(group(params()));
    expect(pattern.steps.slice(0, 8).every((s) => s[0] === 60)).toBe(true);
    expect(cellsInPlay({ ...params(), ...normGates(params()) }, "legato").every((c) => c === 2)).toBe(true);
  });

  it("offers Numerology's rates, M's time bases among them", () => {
    expect(RATE_OPTIONS.map((r) => r.label)).toEqual(expect.arrayContaining(["1/4", "1/8", "16th", "1/8T"]));
    expect(RATE_OPTIONS.find((r) => r.label === "1/8")!.value).toBe("1/8");
  });

  it("the dice on a lane randomizes only that lane, and only a share of it", () => {
    const p = params();
    const accent = { ...p, ...randomizeLane(p, "accent", "all", new Rng(4)) };
    expect(cellsInPlay(accent, "accent").every((c) => typeof c === "number" && c >= 1 && c <= 4)).toBe(true);
    expect(cellsInPlay(accent, "legato")).toEqual(cellsInPlay(p, "legato"));
    const few = { ...p, ...randomizeLane(p, "velocity", "few", new Rng(4)) };
    const changed = (few.velocity as number[]).filter((v) => v !== 0).length;
    expect(changed).toBeGreaterThan(0);
    expect(changed).toBeLessThanOrEqual(4);
    const pitches = { ...p, ...randomizeLane(p, "pitch", "all", new Rng(4)) };
    expect(group(pitches as never).steps.slice(0, 8)).not.toEqual(group(p).steps.slice(0, 8));
  });

  it("the Warp lane is the NoteSeq's own Time Distortion, at the position in play", () => {
    const p = params({ "warp-position": 2 });
    const next = { ...p, ...setWarpStep(p, 3, 0.2) };
    expect(warpInPlay(next).offsets[3]).toBe(0.2);
    expect(warpInPlay({ ...next, "warp-position": 0 } as never).offsets[3]).toBe(0);
    expect(warpInPlay({ ...next, ...setWarpLength(next, 6) }).length).toBe(6);
    expect(warpInPlay({ ...p, ...setWarpStep(p, 0, 0.3) }).offsets[0]).toBe(0);
  });
});
