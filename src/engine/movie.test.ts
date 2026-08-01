import { describe, expect, it } from "vitest";
import {
  EMPTY_MOVIE_RECORDER,
  armMovie,
  captureMovieNotes,
  finishMovie,
  encodeMovieAsSmf,
  movieFileName,
} from "./movie";
import type { PlannedNote } from "./planner";

const note = (overrides: Partial<PlannedNote> = {}): PlannedNote => ({
  voice: 0,
  note: 60,
  velocity: 100,
  channel: 1,
  startSec: 10,
  durationSec: 0.5,
  atTick: 0,
  durationTicks: 480,
  ...overrides,
});

describe("Movie recording", () => {
  it("arms without erasing the last Movie until new output arrives", () => {
    const previous = {
      ppqn: 960 as const,
      notes: [{ voice: 0, note: 60, velocity: 100, channel: 1, atTick: 0, durationTicks: 480 }],
      tempos: [{ atTick: 0, bpm: 120 }],
    };
    const armed = armMovie({ ...EMPTY_MOVIE_RECORDER, movie: previous });
    expect(armed).toMatchObject({ mode: "armed", movie: previous, draft: null });
  });

  it("starts on planner output, normalizes the timeline, and retains chords", () => {
    const armed = armMovie(EMPTY_MOVIE_RECORDER);
    const recording = captureMovieNotes(armed, [
      note(),
      note({ note: 64 }),
      note({ voice: 1, note: 67, channel: 2, atTick: 480 }),
    ], 132);
    expect(recording.mode).toBe("recording");
    expect(recording.draft).toEqual({
      ppqn: 960,
      notes: [
        { voice: 0, note: 60, velocity: 100, channel: 1, atTick: 0, durationTicks: 480 },
        { voice: 0, note: 64, velocity: 100, channel: 1, atTick: 0, durationTicks: 480 },
        { voice: 1, note: 67, velocity: 100, channel: 2, atTick: 480, durationTicks: 480 },
      ],
      tempos: [{ atTick: 0, bpm: 132 }],
    });
  });

  it("uses transport ticks so pause wall time never becomes a recorded gap", () => {
    let state = captureMovieNotes(armMovie(EMPTY_MOVIE_RECORDER), [note()], 120);
    state = captureMovieNotes(state, [
      note({ startSec: 110, atTick: 480, note: 62 }),
    ], 120);
    expect(state.draft?.notes.map((event) => event.atTick)).toEqual([0, 480]);
    expect(state.draft?.tempos).toEqual([{ atTick: 0, bpm: 120 }]);
  });

  it("records tempo changes at the first affected musical tick", () => {
    let state = captureMovieNotes(armMovie(EMPTY_MOVIE_RECORDER), [note()], 120);
    state = captureMovieNotes(state, [note({ atTick: 960, note: 62 })], 90);
    expect(state.draft?.tempos).toEqual([
      { atTick: 0, bpm: 120 },
      { atTick: 960, bpm: 90 },
    ]);
  });

  it("preserves a phased Voice's opening silence from transport tick zero", () => {
    const recording = captureMovieNotes(
      armMovie(EMPTY_MOVIE_RECORDER),
      [note({ atTick: 480 })],
      120,
    );
    expect(recording.draft?.notes[0].atTick).toBe(480);
    expect(recording.draft?.tempos[0].atTick).toBe(0);
  });

  it("ignores telemetry while idle and finalizes only a non-empty Movie", () => {
    expect(captureMovieNotes(EMPTY_MOVIE_RECORDER, [note()], 120))
      .toBe(EMPTY_MOVIE_RECORDER);
    expect(finishMovie(armMovie(EMPTY_MOVIE_RECORDER))).toEqual(EMPTY_MOVIE_RECORDER);
    const recording = captureMovieNotes(armMovie(EMPTY_MOVIE_RECORDER), [note()], 120);
    expect(finishMovie(recording)).toMatchObject({
      mode: "idle",
      draft: null,
      movie: { notes: [{ atTick: 0 }] },
    });
  });

  it("ignores an empty planner batch and safely supplies missing musical timestamps", () => {
    const armed = armMovie(EMPTY_MOVIE_RECORDER);
    expect(captureMovieNotes(armed, [], 120)).toBe(armed);
    const recording = captureMovieNotes(armed, [note({
      atTick: undefined,
      durationTicks: undefined,
    })], 0);
    expect(recording.draft).toMatchObject({
      notes: [{ atTick: 0, durationTicks: 1 }],
      tempos: [{ atTick: 0, bpm: 1 }],
    });
  });
});

describe("Standard MIDI File export", () => {
  it("writes a deterministic format-1 file with tempo and one track per used voice", () => {
    const movie = finishMovie(captureMovieNotes(armMovie(EMPTY_MOVIE_RECORDER), [
      note(),
      note({ voice: 1, channel: 2, note: 67, atTick: 2400, durationTicks: 960 }),
    ], 120)).movie!;
    const bytes = encodeMovieAsSmf(movie);
    expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe("MThd");
    expect(Array.from(bytes.slice(4, 14))).toEqual([
      0, 0, 0, 6, // header length
      0, 1,       // format 1
      0, 3,       // conductor + two voice tracks
      3, 192,      // 960 PPQN
    ]);
    expect(encodeMovieAsSmf(movie)).toEqual(bytes);
    expect(Array.from(bytes)).toContain(0x51);
    expect(Array.from(bytes)).toContain(0x90);
    expect(Array.from(bytes)).toContain(0x91);

    const fixture = encodeMovieAsSmf({
      ppqn: 960,
      tempos: [{ atTick: 0, bpm: 120 }],
      notes: [{
        voice: 0, channel: 1, note: 60, velocity: 100,
        atTick: 0, durationTicks: 480,
      }],
    });
    expect(Array.from(fixture)).toEqual([
      0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, 0, 2, 3, 0xc0,
      0x4d, 0x54, 0x72, 0x6b, 0, 0, 0, 11,
      0, 0xff, 0x51, 3, 0x07, 0xa1, 0x20, 0, 0xff, 0x2f, 0,
      0x4d, 0x54, 0x72, 0x6b, 0, 0, 0, 13,
      0, 0x90, 60, 100, 0x83, 0x60, 0x80, 60, 0, 0, 0xff, 0x2f, 0,
    ]);
  });

  it("orders note-off before note-on at the same tick and clamps MIDI data", () => {
    const bytes = encodeMovieAsSmf({
      ppqn: 960,
      tempos: [{ atTick: 0, bpm: 120 }],
      notes: [
        { voice: 0, channel: 1, note: 60, velocity: 200, atTick: 0, durationTicks: 480 },
        { voice: 0, channel: 1, note: 60, velocity: 1, atTick: 480, durationTicks: 1 },
      ],
    });
    const hex = Array.from(bytes).map((value) => value.toString(16).padStart(2, "0")).join(" ");
    expect(hex).toContain("83 60 80 3c 00 00 90 3c 01");
    expect(hex).toContain("90 3c 7f");
  });

  it("provides a stable MIDI download name", () => {
    expect(movieFileName(null)).toBe("M Movie.mid");
    expect(movieFileName("Study.mclone")).toBe("Study Movie.mid");
    expect(movieFileName("Study.mclone.json")).toBe("Study Movie.mid");
    expect(movieFileName("Study.json")).toBe("Study Movie.mid");
  });

  it("supplies a default tempo track when a Movie has no tempo markers", () => {
    const bytes = encodeMovieAsSmf({ ppqn: 960, notes: [], tempos: [] });
    expect(Array.from(bytes)).toContain(0x51);
  });
});
