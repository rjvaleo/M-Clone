import { describe, it, expect } from "vitest";
import { planWindow, makeCursors, type VoiceCursor } from "./planner";
import { Rng } from "./rng";
import { neutralTimeMap } from "./timemap";
import type { ProjectState, VoiceState, Pattern } from "./types";

function pattern(
  id: string,
  steps: number[][],
  outputLength?: number,
  scrambled = steps,
): Pattern {
  return {
    id,
    steps: steps.map((pitches) => ({ pitches })),
    scrambledSteps: scrambled.map((pitches) => ({ pitches })),
    scrambleGeneration: 0,
    outputLength: outputLength ?? steps.length,
    maxSize: 100,
    chordMode: "single",
    insertMode: "insert",
    drumMachine: false,
  };
}

function voice(over: Partial<VoiceState> = {}): VoiceState {
  return {
    patternIndex: 0,
    playEnabled: true,
    transposition: 0,
    noteOrderMix: { original: 100, cyclic: 0, utterly: 0 },
    density: 1,
    velocityRange: { low: 100, high: 100 },
    timeBaseNumerator: 1,
    timeBaseDenominator: 4, // quarter notes
    timeDistort: neutralTimeMap(),
    legato: 0.9,
    channel: 1,
    outputChannels: [1],
    program: 0,
    ...over,
  };
}

function project(patterns: Pattern[], voices: VoiceState[], over: Partial<ProjectState> = {}): ProjectState {
  return {
    tempo: 120,
    patterns,
    voices,
    root: 0,
    scale: "chromatic",
    scaleSnap: false,
    seed: 1,
    cyclic: {
      accent: voices.map(() => Array(16).fill(2)),
      legato: voices.map(() => Array(16).fill(2)),
      rhythm: voices.map(() => Array(16).fill(2)),
    },
    cyclicLengths: {
      accent: voices.map(() => 16),
      legato: voices.map(() => 16),
      rhythm: voices.map(() => 16),
    },
    cyclicValues: {
      legato: [6, 25, 50, 75, 100],
      rhythm: [0.5, 0.75, 1, 1.5, 2],
    },
    ...over,
  };
}

describe("planWindow — basic playback", () => {
  it("emits pattern notes at the right times", () => {
    const st = project([pattern("p", [[60], [64]])], [voice()]);
    const cursors = makeCursors(st, 0);
    const { notes } = planWindow(st, cursors, new Rng(1), 0, 1.0);
    expect(notes).toHaveLength(2);
    expect(notes[0]).toMatchObject({ note: 60, startSec: 0, channel: 1, velocity: 100 });
    expect(notes[0]).toMatchObject({ atTick: 0, durationTicks: 432 });
    expect(notes[1]).toMatchObject({ note: 64 });
    expect(notes[1].atTick).toBe(960);
    expect(notes[1].startSec).toBeCloseTo(0.5, 9);
    expect(notes[0].durationSec).toBeCloseTo(0.225, 9); // level 2 is 50%
  });

  it("applies per-voice transposition", () => {
    const st = project([pattern("p", [[60]])], [voice({ transposition: 12 })]);
    const { notes } = planWindow(st, makeCursors(st, 0), new Rng(1), 0, 0.5);
    expect(notes[0].note).toBe(72);
  });

  it("plays chords (multiple pitches per step)", () => {
    const st = project([pattern("p", [[60, 64, 67]])], [voice()]);
    const { notes } = planWindow(st, makeCursors(st, 0), new Rng(1), 0, 0.5);
    expect(notes.map((n) => n.note).sort((a, b) => a - b)).toEqual([60, 64, 67]);
  });

  it("skips rests (empty steps)", () => {
    const st = project([pattern("p", [[60], []])], [voice()]);
    const { notes } = planWindow(st, makeCursors(st, 0), new Rng(1), 0, 1.0);
    expect(notes).toHaveLength(1);
    expect(notes[0].note).toBe(60);
  });
});

describe("planWindow — independent voice randomness", () => {
  it("keeps one voice reproducible when another voice changes random consumption", () => {
    const patterns = [
      pattern("a", [[60], [61], [62], [63]]),
      pattern("b", [[70], [71], [72], [73]]),
    ];
    const voices = [
      voice({ patternIndex: 0, noteOrderMix: { original: 0, cyclic: 0, utterly: 100 } }),
      voice({ patternIndex: 1, outputChannels: [2],
        noteOrderMix: { original: 0, cyclic: 0, utterly: 100 } }),
    ];
    const a = project(patterns, voices);
    const b = project(patterns, [{ ...voices[0], density: 0 }, voices[1]]);
    const rngs = () => [new Rng(101), new Rng(202)];
    const notesA = planWindow(a, makeCursors(a, 0), rngs(), 0, 3).notes
      .filter((note) => note.voice === 1).map((note) => note.note);
    const notesB = planWindow(b, makeCursors(b, 0), rngs(), 0, 3).notes
      .filter((note) => note.voice === 1).map((note) => note.note);
    expect(notesB).toEqual(notesA);
  });
});

describe("planWindow — density and enable", () => {
  it("emits nothing at density 0 but still advances the clock", () => {
    const st = project([pattern("p", [[60], [64]])], [voice({ density: 0 })]);
    const cursors = makeCursors(st, 0);
    const { notes, cursors: next } = planWindow(st, cursors, new Rng(1), 0, 1.0);
    expect(notes).toHaveLength(0);
    expect(next[0].nextTimeSec).toBeCloseTo(1.0, 9);
  });

  it("emits nothing for a disabled voice", () => {
    const st = project([pattern("p", [[60]])], [voice({ playEnabled: false })]);
    const { notes } = planWindow(st, makeCursors(st, 0), new Rng(1), 0, 1.0);
    expect(notes).toHaveLength(0);
  });

  it("keeps a disabled voice in tempo (advances its clock)", () => {
    const st = project([pattern("p", [[60]])], [voice({ playEnabled: false })]);
    const cursors = makeCursors(st, 0);
    const { cursors: next } = planWindow(st, cursors, new Rng(1), 0, 1.0);
    expect(next[0].nextTimeSec).toBeGreaterThanOrEqual(1.0);
  });
});

describe("planWindow — scale snapping", () => {
  it("snaps transposed notes into the key when enabled", () => {
    // C major, transpose +1 -> C# should snap to C (60)
    const st = project([pattern("p", [[60]])], [voice({ transposition: 1 })], {
      scale: "major",
      root: 0,
      scaleSnap: true,
    });
    const { notes } = planWindow(st, makeCursors(st, 0), new Rng(1), 0, 0.5);
    expect(notes[0].note).toBe(60);
  });
  it("leaves notes untouched when snapping is off", () => {
    const st = project([pattern("p", [[60]])], [voice({ transposition: 1 })], {
      scale: "major",
      scaleSnap: false,
    });
    const { notes } = planWindow(st, makeCursors(st, 0), new Rng(1), 0, 0.5);
    expect(notes[0].note).toBe(61);
  });
});

describe("planWindow — harmonic options", () => {
  it("diatonic transpose moves by scale steps", () => {
    // C major, +2 steps -> C becomes E
    const st = project([pattern("p", [[60]])], [voice({ transposition: 2 })], {
      scale: "major",
      diatonicTranspose: true,
    });
    const { notes } = planWindow(st, makeCursors(st, 0), new Rng(1), 0, 0.5);
    expect(notes[0].note).toBe(64);
  });

  it("second-order transpose stacks voices cumulatively", () => {
    const st = project(
      [pattern("a", [[60]]), pattern("b", [[60]])],
      [
        voice({ patternIndex: 0, transposition: 4, channel: 1, outputChannels: [1] }),
        voice({ patternIndex: 1, transposition: 3, channel: 2, outputChannels: [2] }),
      ],
      { secondOrderTranspose: true },
    );
    const { notes } = planWindow(st, makeCursors(st, 0), new Rng(1), 0, 0.5);
    const byCh = Object.fromEntries(notes.map((n) => [n.channel, n.note]));
    expect(byCh[1]).toBe(64); // 60 + 4
    expect(byCh[2]).toBe(67); // 60 + (4 + 3)
  });

  it("chord-tone targeting snaps to the tonic triad", () => {
    // D (62) with C-major chord targeting -> C (60)
    const st = project([pattern("p", [[62]])], [voice()], {
      scale: "major",
      chordTones: true,
    });
    const { notes } = planWindow(st, makeCursors(st, 0), new Rng(1), 0, 0.5);
    expect(notes[0].note).toBe(60);
  });
});

describe("planWindow — windowing continuity", () => {
  it("continues where the previous window left off", () => {
    const st = project([pattern("p", [[60], [64], [67], [72]])], [voice()]);
    let cursors = makeCursors(st, 0);
    const first = planWindow(st, cursors, new Rng(1), 0, 1.0);
    cursors = first.cursors;
    const second = planWindow(st, cursors, new Rng(1), 1.0, 2.0);
    expect(first.notes.map((n) => n.note)).toEqual([60, 64]);
    expect(second.notes.map((n) => n.note)).toEqual([67, 72]);
  });

  // "Cyclic Random ... has been recomposed and stored as a 'copy' of the
  // original Pattern."
  it("reads Cyclic Random from the Pattern's stored Scrambled list", () => {
    const st = project(
      [pattern("p", [[60], [62]], undefined, [[72], [74]])],
      [voice({ noteOrderMix: { original: 0, cyclic: 100, utterly: 0 } })],
    );
    const result = planWindow(st, makeCursors(st, 0), new Rng(1), 0, 1);
    expect(result.notes.map((n) => n.note)).toEqual([72, 74]);
  });

  it("shares one Pattern-owned Scrambled list between Voices", () => {
    const st = project(
      [pattern("p", [[60]], undefined, [[72]])],
      [
        voice({ noteOrderMix: { original: 0, cyclic: 100, utterly: 0 } }),
        voice({
          noteOrderMix: { original: 0, cyclic: 100, utterly: 0 },
          channel: 2,
          outputChannels: [2],
        }),
      ],
    );
    const result = planWindow(st, makeCursors(st, 0), new Rng(1), 0, 0.5);
    expect(result.notes.map((n) => n.note)).toEqual([72, 72]);
  });

  it("sees a changed Scrambled list in the next scheduling window", () => {
    const st = project(
      [pattern("p", [[60], [62]], undefined, [[70], [71]])],
      [voice({ noteOrderMix: { original: 0, cyclic: 100, utterly: 0 } })],
    );
    const first = planWindow(st, makeCursors(st, 0), new Rng(1), 0, 0.5);
    st.patterns[0].scrambledSteps[1] = { pitches: [80] };
    const second = planWindow(st, first.cursors, new Rng(1), 0.5, 1);
    expect(first.notes.map((n) => n.note)).toEqual([70]);
    expect(second.notes.map((n) => n.note)).toEqual([80]);
  });
});

describe("planWindow — cyclic variables", () => {
  it("applies the Accent cycle to note velocity", () => {
    const st = project(
      [pattern("p", [[60], [62]])],
      [voice({ velocityRange: { low: 48, high: 110 } })],
    );
    st.cyclic = {
      accent: [[4, 0, ...Array(14).fill(2)]],
      legato: [Array(16).fill(2)],
      rhythm: [Array(16).fill(2)],
    };
    const { notes } = planWindow(st, makeCursors(st, 0), new Rng(1), 0, 1);
    expect(notes.map((n) => n.velocity)).toEqual([110]);
  });

  it("applies the Legato cycle to note duration", () => {
    const st = project([pattern("p", [[60], [62]])], [voice({ legato: 1 })]);
    st.cyclic = {
      accent: [Array(16).fill(2)],
      legato: [[0, 4, ...Array(14).fill(2)]],
      rhythm: [Array(16).fill(2)],
    };
    const { notes } = planWindow(st, makeCursors(st, 0), new Rng(1), 0, 1);
    expect(notes[0].durationSec).toBeCloseTo(0.03, 9);
    expect(notes[1].durationSec).toBeCloseTo(0.5, 9);
  });

  it("applies Rhythm to spacing and continues its cycle across windows", () => {
    const st = project([pattern("p", [[60], [62], [64]])], [
      voice({ velocityRange: { low: 1, high: 100 } }),
    ]);
    st.cyclic = {
      accent: [Array(16).fill(2)],
      legato: [Array(16).fill(2)],
      rhythm: [[0, 4, ...Array(14).fill(2)]],
    };
    const first = planWindow(st, makeCursors(st, 0), new Rng(1), 0, 0.3);
    expect(first.notes.map((n) => n.startSec)).toEqual([0, 0.25]);
    expect(first.cursors[0].cyclicPos).toBe(2);
    const second = planWindow(st, first.cursors, new Rng(1), 0.3, 1.5);
    expect(second.notes[0].startSec).toBeCloseTo(1.25, 9);
  });

  it("leaves playback unchanged at the neutral cyclic level", () => {
    const st = project([pattern("p", [[60]])], [voice({ velocityRange: { low: 100, high: 100 }, legato: 1 })]);
    const { notes } = planWindow(st, makeCursors(st, 0), new Rng(1), 0, 0.5);
    expect(notes[0]).toMatchObject({ velocity: 100, durationSec: 0.25 });
  });

  it("wraps each Voice at its configured cycle length", () => {
    const st = project([pattern("p", [[60], [62], [64]])], [voice()]);
    st.cyclic.accent[0] = [4, 0, 1, ...Array(13).fill(2)];
    st.cyclicLengths.accent[0] = 2;
    const { notes } = planWindow(st, makeCursors(st, 0), new Rng(1), 0, 2);
    expect(notes.map((note) => note.startSec)).toEqual([0, 1]);
    expect(notes.map((note) => note.velocity)).toEqual([100, 100]);
  });

  it("uses edited global Rhythm and Legato level values", () => {
    const st = project([pattern("p", [[60], [62]])], [voice({ legato: 1 })]);
    st.cyclic.rhythm[0][0] = 4;
    st.cyclic.legato[0][0] = 4;
    st.cyclicValues.rhythm[4] = 3;
    st.cyclicValues.legato[4] = 200;
    const { notes } = planWindow(st, makeCursors(st, 0), new Rng(1), 0, 2);
    // Legato is a percentage of the actual 1.5-second interval to the next onset.
    expect(notes[0].durationSec).toBeCloseTo(3, 9);
    expect(notes[1].startSec).toBeCloseTo(1.5, 9);
  });

  it("makes 400% Legato overlap the next three equal-spaced notes", () => {
    const st = project([pattern("p", [[60]])], [voice({ legato: 1 })]);
    st.cyclic.legato[0][0] = 4;
    st.cyclicValues.legato[4] = 400;
    const { notes } = planWindow(st, makeCursors(st, 0), new Rng(1), 0, 0.6);
    expect(notes[0].durationSec).toBeCloseTo(2, 9);
    expect(notes[1].startSec).toBeCloseTo(0.5, 9);
  });

  it("chooses cyclic range levels deterministically during playback", () => {
    const make = () => {
      const st = project([pattern("p", [[60]])], [
        voice({ velocityRange: { low: 20, high: 100 } }),
      ]);
      st.cyclic.accent[0] = Array(16).fill({ min: 1, max: 4 });
      return st;
    };
    const a = make();
    const b = make();
    const first = planWindow(a, makeCursors(a, 0), new Rng(99), 0, 4).notes;
    const second = planWindow(b, makeCursors(b, 0), new Rng(99), 0, 4).notes;
    expect(first.map((note) => note.velocity)).toEqual(second.map((note) => note.velocity));
    expect(new Set(first.map((note) => note.velocity)).size).toBeGreaterThan(1);
  });
});

describe("planWindow — edge cases", () => {
  it("does not loop forever on a zero-length pattern", () => {
    const st = project([pattern("p", [[60]], 0)], [voice()]);
    const cursors = makeCursors(st, 0);
    const { notes, cursors: next } = planWindow(st, cursors, new Rng(1), 0, 5.0);
    expect(notes).toHaveLength(0);
    expect(next[0].nextTimeSec).toBeGreaterThanOrEqual(5.0);
  });

  it("respects outputLength shorter than the pattern", () => {
    const st = project([pattern("p", [[60], [64], [67]], 2)], [voice()]);
    const { notes } = planWindow(st, makeCursors(st, 0), new Rng(1), 0, 1.5);
    // only first two steps cycle: 60, 64, 60
    expect(notes.map((n) => n.note)).toEqual([60, 64, 60]);
  });

  it("handles multiple voices independently", () => {
    const st = project(
      [pattern("a", [[60]]), pattern("b", [[48]])],
      [
        voice({ patternIndex: 0, channel: 1, outputChannels: [1] }),
        voice({ patternIndex: 1, channel: 2, outputChannels: [2] }),
      ],
    );
    const { notes } = planWindow(st, makeCursors(st, 0), new Rng(1), 0, 0.5);
    const byChannel = Object.fromEntries(notes.map((n) => [n.channel, n.note]));
    expect(byChannel).toEqual({ 1: 60, 2: 48 });
  });

  it("fans one Voice out to every assigned Orchestration channel", () => {
    const st = project(
      [pattern("p", [[60]])],
      [voice({ channel: 2, outputChannels: [2, 5, 16] })],
    );
    const { notes } = planWindow(st, makeCursors(st, 0), new Rng(1), 0, 0.5);
    expect(notes.map((n) => n.channel)).toEqual([2, 5, 16]);
    expect(notes.map((n) => n.note)).toEqual([60, 60, 60]);
  });

  it("emits no notes when Orchestration assigns a Voice to no channels", () => {
    const st = project([pattern("p", [[60]])], [voice({ outputChannels: [] })]);
    const { notes } = planWindow(st, makeCursors(st, 0), new Rng(1), 0, 0.5);
    expect(notes).toEqual([]);
  });

  it("clamps notes to the MIDI range", () => {
    const st = project([pattern("p", [[120]])], [voice({ transposition: 24 })]);
    const { notes } = planWindow(st, makeCursors(st, 0), new Rng(1), 0, 0.5);
    expect(notes[0].note).toBe(127);
  });
});

describe("makeCursors", () => {
  it("creates one cursor per voice starting at the given time", () => {
    const st = project([pattern("p", [[60]])], [voice(), voice()]);
    const cursors: VoiceCursor[] = makeCursors(st, 2.5);
    expect(cursors).toHaveLength(2);
    expect(cursors[0].nextTimeSec).toBe(2.5);
    expect(cursors[0].order).toEqual({ pos: 0, last: -1, bval: 0.5 });
    expect(cursors[0].cyclicPos).toBe(0);
    expect(cursors[0]).not.toHaveProperty("cyclicOrder");
  });
});

describe("planWindow — Time Distortion", () => {
  // A map covering one quarter note (0.5s @120bpm) that climbs steeply to
  // (0.25, 0.75) then runs shallow to the corner. The voice plays quarter
  // notes, so its steps land exactly on the cycle boundaries when undistorted.
  const steep = { points: [{ x: 0.25, y: 0.75 }], length: 4, denominator: 4 };

  it("changes nothing with a neutral map", () => {
    const st = project([pattern("p", [[60], [64], [67], [72]])], [voice()]);
    const { notes } = planWindow(st, makeCursors(st, 0), new Rng(1), 0, 2);
    expect(notes.map((n) => n.startSec)).toEqual([0, 0.5, 1, 1.5]);
  });

  it("bunches the early notes and stretches the late ones", () => {
    // Cycle spans 2s. Steps fall on clock 0, 0.5, 1, 1.5 -> phases 0, .25,
    // .5, .75. Clock .25 and .5 are inside the steep climb, so they arrive
    // early; clock .75 is on the shallow run, so it arrives late.
    const st = project(
      [pattern("p", [[60], [64], [67], [72]])],
      [voice({ timeDistort: steep })],
    );
    const { notes } = planWindow(st, makeCursors(st, 0), new Rng(1), 0, 2);
    const times = notes.map((n) => n.startSec);
    expect(times[0]).toBeCloseTo(0, 9);
    expect(times[1]).toBeCloseTo(2 * (0.25 / 3), 9); // ~0.167s, was 0.5s
    expect(times[2]).toBeCloseTo(2 * (0.5 / 3), 9); // ~0.333s, was 1.0s
    expect(times[3]).toBeCloseTo(2 * 0.25, 9); // 0.5s, was 1.5s
    // Every distorted note lands earlier than it would have run straight.
    expect(times[1]).toBeLessThan(0.5);
    expect(times[3]).toBeLessThan(1.5);
  });

  it("keeps the cycle boundary on time, so tempo never drifts", () => {
    const st = project([pattern("p", [[60]])], [voice({ timeDistort: steep })]);
    let cursors = makeCursors(st, 0);
    // Run out four whole cycles' worth of clock.
    for (let i = 0; i < 8; i++) {
      cursors = planWindow(st, cursors, new Rng(1), i, i + 1).cursors;
    }
    // Clock and real time have advanced together across whole cycles.
    const cycles = Math.floor(cursors[0].clockSec / 2);
    expect(cursors[0].nextTimeSec).toBeGreaterThanOrEqual(cycles * 2);
  });

  it("distorts each voice independently", () => {
    const st = project(
      [pattern("a", [[60], [64]]), pattern("b", [[72], [76]])],
      [
        voice({ patternIndex: 0, channel: 1, outputChannels: [1] }),
        voice({
          patternIndex: 1, channel: 2, outputChannels: [2], timeDistort: steep,
        }),
      ],
    );
    const { notes } = planWindow(st, makeCursors(st, 0), new Rng(1), 0, 1);
    const v1 = notes.filter((n) => n.channel === 1).map((n) => n.startSec);
    const v2 = notes.filter((n) => n.channel === 2).map((n) => n.startSec);
    expect(v1[1]).toBeCloseTo(0.5, 9); // undistorted
    expect(v2[1]).toBeLessThan(0.5); // distorted
  });

  it("never emits notes out of order", () => {
    const st = project(
      [pattern("p", [[60], [64], [67], [72]])],
      [voice({ timeDistort: steep })],
    );
    const { notes } = planWindow(st, makeCursors(st, 0), new Rng(1), 0, 6);
    const times = notes.map((n) => n.startSec);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it("carries clock position across scheduling windows", () => {
    const st = project(
      [pattern("p", [[60], [64], [67], [72]])],
      [voice({ timeDistort: steep })],
    );
    const one = planWindow(st, makeCursors(st, 0), new Rng(1), 0, 0.3);
    const two = planWindow(st, one.cursors, new Rng(1), 0.3, 2);
    const all = [...one.notes, ...two.notes].map((n) => n.startSec);
    expect([...all].sort((a, b) => a - b)).toEqual(all);
    expect(one.cursors[0].clockSec).toBeGreaterThan(0);
  });

  it("keeps a silent voice's clock advancing under distortion", () => {
    const st = project([pattern("p", [], 0)], [voice({ timeDistort: steep })]);
    const { cursors } = planWindow(st, makeCursors(st, 0), new Rng(1), 0, 1);
    expect(cursors[0].clockSec).toBeGreaterThan(0);
  });
});
