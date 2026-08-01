import { PPQN, type PlannedNote } from "./planner";

export type PerformanceNote = {
  voice: number;
  note: number;
  velocity: number;
  channel: number;
  /** Timestamp on the shared musical transport. */
  atTick: number;
  durationTicks: number;
};

export type PerformanceTempo = { atTick: number; bpm: number };

export type Movie = {
  ppqn: number;
  notes: PerformanceNote[];
  tempos: PerformanceTempo[];
};

export type MovieRecorder = {
  mode: "idle" | "armed" | "recording";
  movie: Movie | null;
  draft: Movie | null;
  originTick: number | null;
  lastTempo: number | null;
};

export const EMPTY_MOVIE_RECORDER: MovieRecorder = {
  mode: "idle",
  movie: null,
  draft: null,
  originTick: null,
  lastTempo: null,
};

export function armMovie(state: MovieRecorder): MovieRecorder {
  return { ...state, mode: "armed", draft: null, originTick: 0, lastTempo: null };
}

function compareNotes(a: PerformanceNote, b: PerformanceNote): number {
  return a.atTick - b.atTick || a.voice - b.voice || a.channel - b.channel || a.note - b.note;
}

/** Capture the planner's musical timestamps; wall-clock pause time is never introduced. */
export function captureMovieNotes(
  state: MovieRecorder,
  notes: readonly PlannedNote[],
  bpm: number,
): MovieRecorder {
  if (state.mode === "idle" || notes.length === 0) return state;
  const firstTick = Math.min(...notes.map((note) => note.atTick ?? 0));
  // Armed/recording states are anchored by armMovie; idle returned above.
  const originTick = state.originTick as number;
  const incoming = notes.map((note): PerformanceNote => ({
    voice: Math.max(0, Math.round(note.voice)),
    note: Math.max(0, Math.min(127, Math.round(note.note))),
    velocity: Math.max(0, Math.min(127, Math.round(note.velocity))),
    channel: Math.max(1, Math.min(16, Math.round(note.channel))),
    atTick: Math.max(0, Math.round((note.atTick ?? firstTick) - originTick)),
    durationTicks: Math.max(1, Math.round(note.durationTicks ?? 1)),
  }));
  const draft = state.draft ?? { ppqn: PPQN, notes: [], tempos: [] };
  const tempo = Math.max(1, bpm);
  const tempos = tempo === state.lastTempo
    ? draft.tempos
    : [...draft.tempos, {
        atTick: draft.tempos.length === 0 ? 0 : Math.max(0, firstTick - originTick),
        bpm: tempo,
      }];
  return {
    ...state,
    mode: "recording",
    originTick,
    lastTempo: tempo,
    draft: {
      ...draft,
      notes: [...draft.notes, ...incoming].sort(compareNotes),
      tempos,
    },
  };
}

export function finishMovie(state: MovieRecorder): MovieRecorder {
  return {
    mode: "idle",
    movie: state.draft?.notes.length ? state.draft : state.movie,
    draft: null,
    originTick: null,
    lastTempo: null,
  };
}

function u16(value: number): number[] {
  return [(value >>> 8) & 0xff, value & 0xff];
}

function u32(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

function ascii(value: string): number[] {
  return [...value].map((char) => char.charCodeAt(0));
}

function variableLength(value: number): number[] {
  let remaining = Math.max(0, Math.round(value));
  const bytes = [remaining & 0x7f];
  while ((remaining >>>= 7) > 0) bytes.unshift((remaining & 0x7f) | 0x80);
  return bytes;
}

function chunk(id: "MThd" | "MTrk", data: number[]): number[] {
  return [...ascii(id), ...u32(data.length), ...data];
}

function endTrack(data: number[]): number[] {
  return [...data, 0, 0xff, 0x2f, 0];
}

function tempoTrack(movie: Movie): number[] {
  const data: number[] = [];
  let previousTick = 0;
  const tempos = movie.tempos.length > 0 ? movie.tempos : [{ atTick: 0, bpm: 120 }];
  for (const tempo of [...tempos].sort((a, b) => a.atTick - b.atTick)) {
    const tick = Math.max(previousTick, Math.round(tempo.atTick));
    const micros = Math.max(1, Math.min(0xffffff, Math.round(60_000_000 / tempo.bpm)));
    data.push(...variableLength(tick - previousTick), 0xff, 0x51, 3,
      (micros >>> 16) & 0xff, (micros >>> 8) & 0xff, micros & 0xff);
    previousTick = tick;
  }
  return chunk("MTrk", endTrack(data));
}

type MidiTrackEvent = { tick: number; priority: number; bytes: number[] };

function voiceTrack(notes: readonly PerformanceNote[]): number[] {
  const events: MidiTrackEvent[] = notes.flatMap((note) => {
    const tick = Math.max(0, Math.round(note.atTick));
    const channel = Math.max(0, Math.min(15, Math.round(note.channel) - 1));
    const pitch = Math.max(0, Math.min(127, Math.round(note.note)));
    const velocity = Math.max(0, Math.min(127, Math.round(note.velocity)));
    return [
      { tick, priority: 1, bytes: [0x90 | channel, pitch, velocity] },
      {
        tick: tick + Math.max(1, Math.round(note.durationTicks)),
        priority: 0,
        bytes: [0x80 | channel, pitch, 0],
      },
    ];
  }).sort((a, b) => a.tick - b.tick || a.priority - b.priority);
  const data: number[] = [];
  let previousTick = 0;
  for (const event of events) {
    data.push(...variableLength(event.tick - previousTick), ...event.bytes);
    previousTick = event.tick;
  }
  return chunk("MTrk", endTrack(data));
}

/** Encode an editable format-1 SMF: tempo map plus one track per used Voice. */
export function encodeMovieAsSmf(movie: Movie): Uint8Array {
  const voices = [...new Set(movie.notes.map((note) => note.voice))].sort((a, b) => a - b);
  const tracks = [
    tempoTrack(movie),
    ...voices.map((voice) => voiceTrack(movie.notes.filter((note) => note.voice === voice))),
  ];
  return new Uint8Array([
    ...chunk("MThd", [...u16(1), ...u16(tracks.length), ...u16(movie.ppqn)]),
    ...tracks.flat(),
  ]);
}

export function movieFileName(documentName: string | null): string {
  if (!documentName) return "M Movie.mid";
  const stem = documentName.replace(/\.mclone\.json$/i, "").replace(/\.json$/i, "");
  return `${stem} Movie.mid`;
}
