import { describe, expect, it } from "vitest";
import type { Scale } from "./scales";
import { scaleById } from "./scales";
import { CHORD_DEGREES, snapToChord, snapToScale, type ChordShape } from "./quantize";

/** A deliberately microtonal scale: 150-cent steps land between piano keys. */
const THIRDS: Scale = {
  id: "test-thirds",
  name: "Test thirds",
  category: "MICROTONAL & CONTEMPORARY",
  info: "test",
  cents: [0, 150, 300, 450, 600, 750, 900, 1050],
};

const major = () => scaleById("ionian-major");

describe("snapToScale", () => {
  it("leaves a note already on a degree exactly where it is", () => {
    // C major, root C: D is degree 1 at 200 cents, which is a piano key.
    expect(snapToScale(62, major(), 0)).toEqual({ note: 62, detuneCents: 0 });
  });

  it("pulls an out-of-scale note onto the nearest degree", () => {
    // F# is not in C major; G is 100 cents away and F is 100 below, so the
    // tie resolves downward — see the note on ties below.
    expect(snapToScale(63, major(), 0).note).toBe(62);
  });

  it("snaps downward when asked", () => {
    expect(snapToScale(61, major(), 0, "down")).toEqual({ note: 60, detuneCents: 0 });
  });

  it("snaps upward when asked", () => {
    expect(snapToScale(61, major(), 0, "up")).toEqual({ note: 62, detuneCents: 0 });
  });

  it("resolves a tie to the lower degree, so the choice is at least stable", () => {
    // C# sits exactly between C and D. Either is defensible; picking
    // consistently is what matters, or the same note snaps two ways.
    expect(snapToScale(61, major(), 0).note).toBe(60);
  });

  it("reports the detune that a 12-TET keyboard cannot play", () => {
    // 150 cents is a quarter-tone above D-flat: the nearest key is D (200
    // cents) and the true pitch is 50 cents below it. Without the detune the
    // whole point of a microtonal scale is lost.
    expect(snapToScale(61, THIRDS, 0)).toEqual({ note: 62, detuneCents: -50 });
  });

  it("keeps every snapped pitch within half a semitone of its key", () => {
    // The contract the synth relies on: `note` is the key to press and
    // `detuneCents` is a trim, never a second pitch.
    for (let note = 36; note <= 84; note++) {
      const snapped = snapToScale(note, THIRDS, 3);
      expect(Math.abs(snapped.detuneCents)).toBeLessThanOrEqual(50.000001);
    }
  });

  it("follows the root, so the same note fits one key and not another", () => {
    // F is degree 3 of C major and sits untouched.
    expect(snapToScale(65, major(), 0)).toEqual({ note: 65, detuneCents: 0 });
    // The same F is out of D major, so the same scale in a different key
    // moves it. This is the whole reason root is a parameter.
    expect(snapToScale(65, major(), 2).note).not.toBe(65);
  });

  it("works below the root as well as above it", () => {
    // A scale is a repeating shape, so degrees continue downward: F2 is
    // degree 3 an octave under the root and must land exactly, not be
    // dragged up to the lowest degree the table happens to list.
    expect(snapToScale(48, major(), 0)).toEqual({ note: 48, detuneCents: 0 });
    expect(snapToScale(41, major(), 0)).toEqual({ note: 41, detuneCents: 0 });
    // An out-of-scale note below the root still lands on a real scale tone.
    // Which of the two neighbours it picks is the tie rule's business, tested
    // separately — asserting it here would be testing that twice.
    const snapped = snapToScale(46, major(), 0);
    expect([45, 47]).toContain(snapped.note);
    expect(snapped.detuneCents).toBe(0);
  });

  it("passes every note through untouched when the scale is all twelve keys", () => {
    // Built here rather than looked up: the library has no plain 12-TET entry,
    // because 12-TET is what a scale is measured *against* rather than one of
    // the eighty-one. It is still the right degenerate case to pin.
    const chromatic: Scale = {
      id: "test-chromatic",
      name: "Test chromatic",
      category: "MICROTONAL & CONTEMPORARY",
      info: "test",
      cents: Array.from({ length: 12 }, (_, i) => i * 100),
    };
    for (let note = 48; note <= 72; note++) {
      expect(snapToScale(note, chromatic, 0)).toEqual({ note, detuneCents: 0 });
    }
  });
});

describe("snapToChord", () => {
  it("knows the four chord shapes as scale degrees", () => {
    expect(CHORD_DEGREES.triad).toEqual([0, 2, 4]);
    expect(CHORD_DEGREES.seventh).toEqual([0, 2, 4, 6]);
    expect(CHORD_DEGREES.power).toEqual([0, 4]);
    expect(CHORD_DEGREES.sus4).toEqual([0, 3, 4]);
  });

  it("pulls a scale note that is not a chord tone onto one", () => {
    // D is in C major but not in its triad; the nearest chord tone is C or E,
    // and the tie resolves down to C.
    expect(snapToChord(62, major(), 0, "triad").note).toBe(60);
  });

  it("leaves a chord tone alone", () => {
    for (const note of [60, 64, 67]) {
      expect(snapToChord(note, major(), 0, "triad")).toEqual({ note, detuneCents: 0 });
    }
  });

  it("admits the seventh only for the seventh chord", () => {
    // B is degree 6 of C major: a chord tone for `seventh`, not for `triad`.
    expect(snapToChord(71, major(), 0, "seventh")).toEqual({ note: 71, detuneCents: 0 });
    expect(snapToChord(71, major(), 0, "triad").note).not.toBe(71);
  });

  it("spans octaves, so a chord tone is a chord tone anywhere", () => {
    for (const note of [48, 60, 72, 84]) {
      expect(snapToChord(note, major(), 0, "triad")).toEqual({ note, detuneCents: 0 });
    }
  });

  it("carries the detune through for a microtonal chord", () => {
    const snapped = snapToChord(61, THIRDS, 0, "triad");
    expect(Math.abs(snapped.detuneCents)).toBeLessThanOrEqual(50.000001);
  });

  it("degrades to the plain scale for a shape the scale is too short for", () => {
    // A pentatonic has no degree 6. Asking for a seventh must still return a
    // real pitch rather than NaN — the degree wraps into the next octave,
    // which is what `degreeCents` already does for the scale itself.
    const pentatonic = scaleById("major-pentatonic");
    const snapped = snapToChord(62, pentatonic, 0, "seventh" as ChordShape);
    expect(Number.isFinite(snapped.note)).toBe(true);
    expect(Number.isFinite(snapped.detuneCents)).toBe(true);
  });
});
