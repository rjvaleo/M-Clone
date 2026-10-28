import { describe, expect, it } from "vitest";
import {
  DELAY_NOTES,
  FILTER_ENV_SPAN,
  NOTE_TAIL_SEC,
  envelopeEvents,
  pulseAdvanceSec,
  releaseEvents,
  TAPE_SPEEDS,
  delaySeconds,
  filterSweep,
  keyFollowedCutoff,
  lfoTargetGain,
  modulatedPulseWidth,
  planTapeGlide,
  pulseWidthSwing,
  tapeCurveLength,
  tapeCurveValueAt,
  tapeGlideCurve,
  tapeGlideValueAt,
} from "./synthLaws";

/**
 * The scale sequencer's synth laws, pinned to the numbers its `app.js`
 * computes. Each expectation below is the original's arithmetic done by hand.
 */

describe("Key follow", () => {
  it("moves the cutoff by the note's distance from middle C, scaled by the amount", () => {
    expect(keyFollowedCutoff(1000, 72, 1)).toBeCloseTo(2000, 9);
    expect(keyFollowedCutoff(1000, 48, 1)).toBeCloseTo(500, 9);
    expect(keyFollowedCutoff(1000, 72, 0.5)).toBeCloseTo(1000 * Math.SQRT2, 9);
    expect(keyFollowedCutoff(1000, 96, 0)).toBe(1000);
  });

  it("follows a microtonal pitch by its true distance", () => {
    expect(keyFollowedCutoff(1000, 60.5, 1)).toBeCloseTo(1000 * Math.pow(2, 0.5 / 12), 9);
  });

  it("is clamped above at 20 kHz and, like the original, not below", () => {
    expect(keyFollowedCutoff(15000, 84, 1)).toBe(20000);
    expect(keyFollowedCutoff(20, 36, 1)).toBeCloseTo(5, 9);
  });
});

describe("The filter envelope amount", () => {
  it("reaches four octaves up at +100 %, linearly in hertz", () => {
    const sweep = filterSweep(1000, 0, 1, 0.3);
    expect(FILTER_ENV_SPAN).toBe(15);
    expect(sweep.base).toBe(1000);
    expect(sweep.peak).toBe(16000);
    expect(sweep.peak / sweep.base).toBe(2 ** 4);
    // The sustain is the same reach scaled by the sustain level, in hertz.
    expect(sweep.sustain).toBeCloseTo(1000 + 15000 * 0.3, 9);
  });

  it("is linear, so half the amount is half the reach in hertz, not half the octaves", () => {
    expect(filterSweep(1000, 0, 0.5, 1).peak).toBe(8500);
  });

  it("subtracts at −100 %, landing on the 20 Hz floor", () => {
    const sweep = filterSweep(1000, 0, -1, 0.3);
    expect(sweep.peak).toBe(20);
    expect(sweep.sustain).toBe(20);
    expect(filterSweep(1000, 0, -0.05, 1).peak).toBe(250);
  });

  it("clamps the peak and sustain to 20 Hz–20 kHz", () => {
    expect(filterSweep(2000, 0, 1, 1).peak).toBe(20000);
    expect(filterSweep(2000, 0, 1, 1).sustain).toBe(20000);
  });

  it("keeps idMLab's octave amount alongside, which the original law reduces to at zero", () => {
    const octaves = filterSweep(500, 2, 0, 0.5);
    expect(octaves.peak).toBeCloseTo(2000, 9);
    expect(octaves.sustain).toBeCloseTo(1000, 9);
    const both = filterSweep(500, 1, 0.1, 1);
    expect(both.peak).toBeCloseTo(500 * 2 + 0.1 * 15 * 500, 9);
  });

  it("reads its inputs inside their ranges", () => {
    expect(filterSweep(1000, 0, 5, 2)).toEqual(filterSweep(1000, 0, 1, 1));
    expect(filterSweep(100, 20, 0, 1).peak).toBe(20000);
  });
});

describe("LFO targets", () => {
  const scales = { cutoffHz: 2000, volume: 0.21, delayWet: 0.25 };

  it("scales a filter LFO by the knob's cutoff, in hertz", () => {
    expect(lfoTargetGain("filter", 0.2, scales)).toBe(400);
  });

  it("scales a resonance LFO by ten units of Q", () => {
    expect(lfoTargetGain("resonance", 0.5, scales)).toBe(5);
  });

  it("scales volume and delay wet by their own level", () => {
    expect(lfoTargetGain("volume", 0.5, scales)).toBeCloseTo(0.105, 12);
    expect(lfoTargetGain("delay-wet", 1, scales)).toBe(0.25);
  });

  it("gives a pulse-width LFO and an unassigned one no gain at all", () => {
    expect(lfoTargetGain("pw", 1, scales)).toBe(0);
    expect(lfoTargetGain("none", 1, scales)).toBe(0);
  });
});

describe("Pulse width", () => {
  it("swings by sin(phase) · depth · 0.45 per pulse LFO, summed", () => {
    expect(pulseWidthSwing([{ phase: Math.PI / 2, depth: 1 }])).toBeCloseTo(0.45, 12);
    expect(pulseWidthSwing([{ phase: Math.PI / 6, depth: 0.5 }, { phase: -Math.PI / 2, depth: 0.2 }]))
      .toBeCloseTo(0.5 * 0.5 * 0.45 - 0.2 * 0.45, 12);
    expect(pulseWidthSwing([])).toBe(0);
  });

  it("holds the modulated width between 5 % and 95 %", () => {
    expect(modulatedPulseWidth(0.5, 0.2)).toBeCloseTo(0.7, 12);
    expect(modulatedPulseWidth(0.5, 0.6)).toBe(0.95);
    expect(modulatedPulseWidth(0.1, -0.45)).toBe(0.05);
  });
});

describe("The delay's time", () => {
  it("is each note value's beats at the tempo", () => {
    const at120 = DELAY_NOTES.map((note) => delaySeconds(120, note.beats));
    expect(at120).toEqual([0.0625, 0.125, 0.166665, 0.25, 0.375, 0.5, 0.666665, 0.75, 1, 1.5, 2]);
    expect(delaySeconds(90, 1)).toBeCloseTo(2 / 3, 12);
  });

  it("keeps the original's eleven note values, its 1/4T included", () => {
    expect(DELAY_NOTES.map((note) => note.label)).toEqual([
      "1/32", "1/16", "1/8T", "1/8", "D 1/8", "1/4", "1/4T", "D 1/4", "1/2", "D 1/2", "1 bar",
    ]);
    expect(DELAY_NOTES[6].beats).toBe(1.33333);
  });

  it("is held to the line's four seconds and five milliseconds", () => {
    expect(delaySeconds(30, 4)).toBe(4);
    expect(delaySeconds(1e6, 0.125)).toBe(0.005);
  });
});

describe("The tape glide", () => {
  it("takes |Δspeed| / 12 seconds at the tape's speed", () => {
    // 7.5 IPS: head gap 3.75 in, 0.25 s → 0.5 s is 15 → 7.5 in/s.
    const glide = planTapeGlide(1, 0, 0.25, 0.5, 7.5)!;
    expect(glide.L).toBe(3.75);
    expect(glide.v0).toBe(15);
    expect(glide.v1).toBe(7.5);
    expect(glide.T).toBeCloseTo(0.625, 12);
    expect(glide.start).toBe(1);
    expect(glide.dEnd).toBe(0.5);
  });

  it("takes four times longer at 30 IPS than at 7.5 for the same musical change", () => {
    const fast = planTapeGlide(0, 0, 0.25, 0.5, 30)!;
    const slow = planTapeGlide(0, 0, 0.25, 0.5, 7.5)!;
    expect(fast.T / slow.T).toBeCloseTo(4, 12);
  });

  it("never lets the read overrun the write, and stays within 0.02–10 s", () => {
    // Cassette: Δv / 12 is 0.156 s, but 0.25 s of change needs 0.294 s.
    expect(planTapeGlide(0, 0, 0.25, 0.5, 1.875)!.T).toBeCloseTo(0.25 / 0.85, 12);
    expect(planTapeGlide(0, 0, 0.005, 4, 30)!.T).toBe(10);
    expect(planTapeGlide(0, 0, 0.25, 0.2505, 30)!.T).toBe(0.02);
  });

  it("does nothing for a change under half a millisecond", () => {
    expect(planTapeGlide(0, 0, 0.25, 0.2504, 7.5)).toBeNull();
  });

  it("follows L / v with v ramping linearly, starting after its delay", () => {
    const glide = planTapeGlide(2, 0.12, 0.25, 0.5, 7.5)!;
    expect(glide.start).toBeCloseTo(2.12, 12);
    expect(tapeGlideValueAt(glide, 2)).toBeCloseTo(0.25, 12);
    expect(tapeGlideValueAt(glide, glide.start + glide.T / 2)).toBeCloseTo(3.75 / 11.25, 12);
    expect(tapeGlideValueAt(glide, glide.start + glide.T)).toBe(0.5);
  });

  it("hands Web Audio a curve with a point per half millisecond, from start to target", () => {
    const glide = planTapeGlide(0, 0, 0.25, 0.5, 7.5)!;
    const curve = tapeGlideCurve(glide);
    expect(curve.length).toBe(1250);
    expect(curve[0]).toBeCloseTo(0.25, 6);
    expect(curve[curve.length - 1]).toBeCloseTo(0.5, 6);
    expect(tapeCurveLength(planTapeGlide(0, 0, 0.25, 0.2505, 30)!)).toBe(40);
    expect(tapeCurveLength({ ...glide, T: 0.001 })).toBe(16);
    expect(tapeCurveLength({ ...glide, T: 100 })).toBe(48000);
  });

  it("reads the curve as setValueCurveAtTime does: held, interpolated, then held at its end", () => {
    const glide = planTapeGlide(1, 0.5, 0.25, 0.5, 7.5)!;
    const curve = tapeGlideCurve(glide);
    expect(tapeCurveValueAt(glide, 1.2, 0.25)).toBe(0.25);
    const step = glide.T / (curve.length - 1);
    expect(tapeCurveValueAt(glide, glide.start + step * 10, 0)).toBeCloseTo(curve[10], 6);
    const between = tapeCurveValueAt(glide, glide.start + step * 10.25, 0);
    expect(between).toBeCloseTo(curve[10] + (curve[11] - curve[10]) * 0.25, 6);
    expect(tapeCurveValueAt(glide, glide.start + glide.T + 1, 0)).toBeCloseTo(0.5, 9);
    // And the analytic path and the curve agree to well under a sample.
    expect(Math.abs(tapeGlideValueAt(glide, glide.start + step * 10.25) - between)).toBeLessThan(1e-6);
  });

  it("knows the original's six tape speeds", () => {
    expect(TAPE_SPEEDS.map((speed) => speed.ips)).toEqual([30, 15, 7.5, 3.75, 1.875, 0.9375]);
  });
});

describe("An envelope, as playNote writes it", () => {
  it("is from, a ramp to the peak and to the sustain, which holds: no release is written at the start", () => {
    const times = { attack: 0.01, decay: 0.08 };
    expect(envelopeEvents(1, 0, 1, 0.6, times)).toEqual([
      { kind: "set", value: 0, time: 1 },
      { kind: "linear", value: 1, time: 1.01 },
      { kind: "linear", value: 0.6, time: 1.09 },
    ]);
    // Negative times are none.
    expect(envelopeEvents(0, 0, 1, 1, { attack: -1, decay: -1 }).map((e) => e.time))
      .toEqual([0, 0, 0]);
  });

  it("releases at the note-off: the sustain, then a ramp over the release time", () => {
    expect(releaseEvents(2, 0.6, 0, 0.3)).toEqual([
      { kind: "set", value: 0.6, time: 2 },
      { kind: "linear", value: 0, time: 2.3 },
    ]);
    expect(releaseEvents(2, 0.6, 0, -1).map((e) => e.time)).toEqual([2, 2]);
    // The oscillators stop 50 ms after the release ends.
    expect(NOTE_TAIL_SEC).toBe(0.05);
  });
});

describe("The pulse LFO's advance", () => {
  it("moves through the steps since the last note's, this one's included", () => {
    // The first step of a run advances by its own length, before it plays.
    expect(pulseAdvanceSec(null, { onsetSec: 5, stepSec: 0.25 })).toBe(0.25);
    // The next step: one step on.
    expect(pulseAdvanceSec({ onsetSec: 5, stepSec: 0.25 }, { onsetSec: 5.25, stepSec: 0.25 })).toBe(0.25);
    // After a rest: two. A chord: none.
    expect(pulseAdvanceSec({ onsetSec: 5, stepSec: 0.25 }, { onsetSec: 5.5, stepSec: 0.25 })).toBe(0.5);
    expect(pulseAdvanceSec({ onsetSec: 5, stepSec: 0.25 }, { onsetSec: 5, stepSec: 0.25 })).toBe(0);
    // Steps of different lengths: the rest of the earlier, then this whole one.
    expect(pulseAdvanceSec({ onsetSec: 0, stepSec: 0.5 }, { onsetSec: 1, stepSec: 0.25 })).toBe(0.75);
  });

  it("moves by the time between notes played live", () => {
    expect(pulseAdvanceSec(null, { onsetSec: 3 })).toBe(0);
    expect(pulseAdvanceSec({ onsetSec: 3 }, { onsetSec: 3.4 })).toBeCloseTo(0.4, 12);
    expect(pulseAdvanceSec({ onsetSec: 3 }, { onsetSec: 3.4, stepSec: 0.25 })).toBeCloseTo(0.4, 12);
    expect(pulseAdvanceSec({ onsetSec: 3, stepSec: 0.25 }, { onsetSec: 3.4, stepSec: Number.NaN })).toBeCloseTo(0.4, 12);
  });
});
