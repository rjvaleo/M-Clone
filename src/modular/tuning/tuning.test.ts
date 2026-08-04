import { describe, expect, it } from "vitest";
import { SCALES, SCALE_CATEGORIES, scaleById, scalesInCategory } from "./scales";
import {
  centsToHz,
  centsToRatio,
  hzToCents,
  degreeCents,
  degreeHz,
  mapKeyboard,
  nearestDegree,
  rootHzForMidi,
} from "./tuning";

/**
 * True-pitch tuning, ported from the scale sequencer.
 *
 * The whole point of this library is that a scale is a list of *cent* offsets
 * rather than a list of semitones: Pythagorean thirds, maqam quarter-tones and
 * gamelan intervals are not 12-TET pitches rounded off, they are their own
 * numbers. So the tests below check real intervals against known values rather
 * than against whatever the code happens to produce.
 */

describe("Cents", () => {
  it("is a logarithmic ratio: 1200 cents is an octave", () => {
    expect(centsToRatio(0)).toBe(1);
    expect(centsToRatio(1200)).toBeCloseTo(2, 12);
    expect(centsToRatio(-1200)).toBeCloseTo(0.5, 12);
    expect(centsToRatio(2400)).toBeCloseTo(4, 12);
  });

  it("puts A5 an octave above A4", () => {
    expect(centsToHz(440, 1200)).toBeCloseTo(880, 9);
    expect(centsToHz(440, 0)).toBe(440);
  });

  it("measures the interval between two pitches", () => {
    // The inverse of `centsToHz`, which is how a tuner reads how far a played
    // pitch sits from the degree it was aiming at.
    expect(hzToCents(440, 880)).toBeCloseTo(1200, 9);
    expect(hzToCents(440, 220)).toBeCloseTo(-1200, 9);
    expect(hzToCents(440, 440 * 1.5)).toBeCloseTo(701.955, 3);
    expect(hzToCents(440, centsToHz(440, 350))).toBeCloseTo(350, 9);
  });

  it("keeps a just fifth just, where 12-TET does not", () => {
    // 3:2 is 701.955 cents. The tempered fifth is 700, which is why this
    // library stores cents rather than semitones.
    const just = centsToHz(440, 701.955);
    expect(just).toBeCloseTo(440 * 1.5, 4);
    expect(centsToHz(440, 700)).not.toBeCloseTo(440 * 1.5, 4);
  });
});

describe("Root pitch from a MIDI note", () => {
  it("anchors on A4 = 440", () => {
    expect(rootHzForMidi(69)).toBe(440);
    expect(rootHzForMidi(81)).toBeCloseTo(880, 9);
    expect(rootHzForMidi(57)).toBeCloseTo(220, 9);
  });

  it("gives middle C its usual frequency", () => {
    expect(rootHzForMidi(60)).toBeCloseTo(261.6256, 4);
  });
});

describe("Degrees", () => {
  const major = scaleById("ionian-major");

  it("walks up the scale", () => {
    expect(degreeCents(major, 0)).toBe(0);
    expect(degreeCents(major, 1)).toBe(200);
    expect(degreeCents(major, 6)).toBe(1100);
  });

  it("wraps into the next octave past the last degree", () => {
    // Seven degrees, so degree 7 is the octave and degree 8 is the ninth.
    expect(degreeCents(major, 7)).toBe(1200);
    expect(degreeCents(major, 8)).toBe(1400);
    expect(degreeCents(major, 14)).toBe(2400);
  });

  it("walks down below the root, which the source could not", () => {
    // JavaScript's `%` keeps the sign of the dividend, so a naive
    // `degree % length` reads -1 as -1 rather than as the seventh below.
    expect(degreeCents(major, -1)).toBe(1100 - 1200);
    expect(degreeCents(major, -7)).toBe(-1200);
    expect(degreeCents(major, -8)).toBe(1100 - 2400);
  });

  it("turns a degree into a pitch", () => {
    expect(degreeHz(major, 440, 0)).toBe(440);
    expect(degreeHz(major, 440, 7)).toBeCloseTo(880, 9);
  });

  it("reads a degree that is not a whole number as the one below it", () => {
    expect(degreeCents(major, 2.7)).toBe(degreeCents(major, 2));
  });
});

describe("Finding the nearest degree", () => {
  const major = scaleById("ionian-major");

  it("names the degree a pitch belongs to, and how far off it is", () => {
    expect(nearestDegree(major, 400)).toEqual({ degree: 2, octave: 0, errorCents: 0 });
    expect(nearestDegree(major, 1400)).toEqual({ degree: 1, octave: 1, errorCents: 0 });
  });

  it("reports the error for a pitch between two degrees", () => {
    // A quarter-tone above the major third: 50 cents sharp of degree 2.
    const found = nearestDegree(major, 450);
    expect(found.degree).toBe(2);
    expect(found.errorCents).toBe(50);
  });

  it("rounds to the nearer neighbour, not the lower one", () => {
    const found = nearestDegree(major, 460);
    expect(found.degree).toBe(3);
    expect(found.errorCents).toBe(-40);
  });

  it("works below the root", () => {
    expect(nearestDegree(major, -100)).toEqual({ degree: 6, octave: -1, errorCents: 0 });
  });

  it("gives a pitch just under the octave to the next root", () => {
    // 1160 cents is 60 above the leading tone and 40 below the octave, so it
    // belongs to the root above — the search has to look past the end of the
    // scale, not stop at its last degree.
    expect(nearestDegree(major, 1160)).toEqual({ degree: 0, octave: 1, errorCents: -40 });
  });
});

describe("Mapping a keyboard", () => {
  const major = scaleById("ionian-major");

  it("gives every key a pitch, in order", () => {
    const keys = mapKeyboard(major, { rootHz: 440, rootMidi: 69, low: 21, high: 108 });
    expect(keys).toHaveLength(88);
    expect(keys[0].midi).toBe(21);
    expect(keys[87].midi).toBe(108);
    for (let i = 1; i < keys.length; i++) {
      expect(keys[i].hz).toBeGreaterThanOrEqual(keys[i - 1].hz);
    }
  });

  it("marks the keys that are in the scale, and the roots", () => {
    const keys = mapKeyboard(major, { rootHz: 440, rootMidi: 69, low: 60, high: 72 });
    const root = keys.find((key) => key.midi === 69);
    expect(root?.isRoot).toBe(true);
    expect(root?.inScale).toBe(true);
    expect(root?.hz).toBe(440);
    // B is the second degree of A major and is in the scale; A# is not.
    expect(keys.find((key) => key.midi === 71)?.inScale).toBe(true);
    expect(keys.find((key) => key.midi === 70)?.inScale).toBe(false);
  });

  it("tunes an in-scale key to the scale rather than to the piano", () => {
    // Pythagorean's major third is 408 cents, not 400: the key that plays it
    // must be sharp of the equal-tempered note it sits on.
    const pythagorean = scaleById("pythagorean-tuning");
    const keys = mapKeyboard(pythagorean, { rootHz: 440, rootMidi: 69, low: 69, high: 81 });
    const third = keys.find((key) => key.midi === 73);
    expect(third?.degree).toBe(4);
    expect(third?.hz).toBeCloseTo(centsToHz(440, 408), 6);
    expect(third?.hz).not.toBeCloseTo(centsToHz(440, 400), 3);
  });

  it("refuses a range that runs backwards", () => {
    expect(mapKeyboard(major, { rootHz: 440, rootMidi: 69, low: 80, high: 60 })).toEqual([]);
  });
});

describe("The scale library", () => {
  it("carries every scale the sequencer had", () => {
    expect(SCALES.length).toBe(81);
    expect(SCALE_CATEGORIES).toHaveLength(7);
  });

  it("gives each scale a stable id, so a document can name one", () => {
    const ids = SCALES.map((scale) => scale.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => /^[a-z0-9-]+$/.test(id))).toBe(true);
  });

  it("starts every scale on its root and climbs from there", () => {
    // The source shipped one that did not: Raga Marwa ended on a stray 0,
    // so its last degree sounded the root again instead of the leading tone.
    for (const scale of SCALES) {
      expect(scale.cents[0], scale.name).toBe(0);
      for (let i = 1; i < scale.cents.length; i++) {
        expect(scale.cents[i], `${scale.name} degree ${i}`).toBeGreaterThan(scale.cents[i - 1]);
      }
    }
  });

  it("files every scale under a category that exists", () => {
    for (const scale of SCALES) {
      expect(SCALE_CATEGORIES, scale.name).toContain(scale.category);
    }
  });

  it("keeps the equal divisions equal", () => {
    const edo19 = scaleById("19-edo");
    expect(edo19.cents).toHaveLength(19);
    for (let i = 1; i < edo19.cents.length; i++) {
      expect(edo19.cents[i] - edo19.cents[i - 1]).toBeCloseTo(1200 / 19, 9);
    }
  });

  it("keeps the just intervals just", () => {
    const pythagorean = scaleById("pythagorean-tuning");
    // The fifth this tuning is stacked from is a true 3:2, at 702 cents.
    expect(centsToRatio(pythagorean.cents[7])).toBeCloseTo(1.5, 3);
    // And its major third is the wide 81:64 that follows from those fifths.
    expect(centsToRatio(pythagorean.cents[4])).toBeCloseTo(81 / 64, 3);
  });

  it("groups the scales for a menu, in library order", () => {
    const maqam = scalesInCategory("MIDDLE EASTERN — MAQAM");
    expect(maqam).toHaveLength(12);
    expect(maqam.every((scale) => scale.category === "MIDDLE EASTERN — MAQAM")).toBe(true);
    // Every scale belongs to exactly one group, so the groups partition the
    // library — a menu built from them shows all 81 and none of them twice.
    const grouped = SCALE_CATEGORIES.flatMap((category) => scalesInCategory(category));
    expect(grouped).toHaveLength(SCALES.length);
  });

  it("says so when asked for a scale it does not have", () => {
    expect(() => scaleById("no-such-scale")).toThrow("Unknown scale");
  });
});
