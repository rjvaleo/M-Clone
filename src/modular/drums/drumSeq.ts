/**
 * The Drum Sequencer: rows of pads against a step grid, as Numerology 4's
 * DrumSeq lays them out (manual p119) — one row per drum sound, each a fixed
 * note, and per step whether it plays and how hard.
 *
 * Around Numerology's grid sit the things a drum machine adds:
 *
 *   - **probability** per step, drawn from the project seed and the step's
 *     place since the last reset, so a part that plays "half the time" plays
 *     the same half every time the song is played back;
 *   - **flam** per step: a softer grace note up to half a step before the hit;
 *   - **ratchet** per step: the step split into equal repeats;
 *   - **swing**, MPC-style: every second step pushed late, 50 % straight to
 *     75 % (half a step);
 *   - **polymeter**: each row may have its own length, looping inside the
 *     pattern and restarting with it — or, with rows running free, never
 *     pulled back at all.
 *
 * Everything here is a pure function of the step's number since the last
 * reset. That is what makes the processor indifferent to how the timeline is
 * cut into windows: a window asks for the hits that fall inside it, and a
 * grace note that belongs to the next window's step is still found, because
 * the steps just past the window's end are asked too.
 */

import { randomUnit } from "../runtime/rng";
import { stepTicks } from "../runtime/time";
import type { PlayheadMark } from "../ui/n4/playhead";

export const MAX_DRUM_ROWS = 16;
export const MAX_DRUM_STEPS = 64;
export const MAX_RATCHET = 8;
/** A full flam puts the grace note this much of a step before its hit. */
export const FLAM_SPAN = 0.5;
export const DEFAULT_VELOCITY = 100;
export const DEFAULT_TRACKS = 10;

/**
 * The sixteen pads, General MIDI's drum map. The first four are the notes a
 * fresh m.percussion plays; the first ten are the TR-909 kit's pads (see
 * drumKits.ts), so a fresh sequencer and a loaded kit line up row for slot.
 */
export const DRUM_ROW_DEFAULTS: readonly { name: string; note: number }[] = [
  { name: "Kick", note: 36 },
  { name: "Snare", note: 38 },
  { name: "C.Hat", note: 42 },
  { name: "O.Hat", note: 46 },
  { name: "Clap", note: 39 },
  { name: "Rim", note: 37 },
  { name: "Ride", note: 51 },
  { name: "Lo Tom", note: 41 },
  { name: "Mid Tom", note: 45 },
  { name: "Hi Tom", note: 48 },
  { name: "Crash", note: 49 },
  { name: "Lo Tom 2", note: 43 },
  { name: "Mid Tom 2", note: 47 },
  { name: "Hi Tom 2", note: 50 },
  { name: "Tamb", note: 54 },
  { name: "Cowbell", note: 56 },
];

/** The per-step lanes besides on/off. */
export type DrumLane = "vel" | "prob" | "flam" | "ratchet";
export const DRUM_LANES: readonly DrumLane[] = ["vel", "prob", "flam", "ratchet"];

/**
 * One pad's row. The lanes are as long as they need to be; a step past a
 * lane's end reads that lane's default, so a document stores only what was
 * touched.
 */
export type DrumRow = {
  name: string;
  /** The note every hit on this row sends. */
  note: number;
  /** This row's own length; 0 follows the pattern length. */
  length: number;
  mute: boolean;
  on: boolean[];
  /** 1–127. */
  vel: number[];
  /** Chance the step plays, 0–1. */
  prob: number[];
  /** 0 for none, 1 for the grace note half a step early. */
  flam: number[];
  /** Hits in the step, 1–8. */
  ratchet: number[];
};

const LANE_DEFAULTS: Readonly<Record<DrumLane, number>> = { vel: DEFAULT_VELOCITY, prob: 1, flam: 0, ratchet: 1 };

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/** Holds one lane value inside its range. */
const laneValue = (lane: DrumLane, value: number): number => {
  if (lane === "vel") return clamp(Math.round(value), 1, 127);
  if (lane === "ratchet") return clamp(Math.round(value), 1, MAX_RATCHET);
  return clamp(value, 0, 1);
};

export const blankRow = (name: string, note: number): DrumRow => ({
  name, note, length: 0, mute: false, on: [], vel: [], prob: [], flam: [], ratchet: [],
});

const onAt = (steps: readonly number[]): boolean[] => {
  const on: boolean[] = [];
  for (const step of steps) on[step] = true;
  return Array.from(on, (value) => value === true);
};

/** A fresh sequencer plays a beat, as a fresh NoteSeq plays M's riff. */
export function defaultDrumRows(): DrumRow[] {
  const rows = DRUM_ROW_DEFAULTS.map(({ name, note }) => blankRow(name, note));
  rows[0].on = onAt([0, 4, 8, 12]);
  rows[1].on = onAt([4, 12]);
  rows[2].on = onAt([2, 6, 10, 14]);
  return rows;
}

const readLane = (lane: DrumLane, value: unknown): number[] =>
  (Array.isArray(value) ? value : []).map((entry) => laneValue(lane, finite(entry) ? entry : LANE_DEFAULTS[lane]));

/** Rows from a document: always sixteen, every value inside its range. */
export function readDrumRows(value: unknown): DrumRow[] {
  const list = Array.isArray(value) ? value : [];
  return DRUM_ROW_DEFAULTS.map((fallback, index) => {
    const raw = (typeof list[index] === "object" && list[index] !== null ? list[index] : {}) as Record<string, unknown>;
    return {
      name: typeof raw.name === "string" ? raw.name : fallback.name,
      note: finite(raw.note) ? clamp(Math.round(raw.note), 0, 127) : fallback.note,
      length: finite(raw.length) ? clamp(Math.round(raw.length), 0, MAX_DRUM_STEPS) : 0,
      mute: raw.mute === true,
      on: (Array.isArray(raw.on) ? raw.on : []).map((entry) => entry === true),
      vel: readLane("vel", raw.vel),
      prob: readLane("prob", raw.prob),
      flam: readLane("flam", raw.flam),
      ratchet: readLane("ratchet", raw.ratchet),
    };
  });
}

/** One step of one lane, with the lane's default past its end. */
export const stepValue = (row: DrumRow, lane: DrumLane, step: number): number => row[lane][step] ?? LANE_DEFAULTS[lane];

/* ===== Settings ===== */

export type DrumSettings = {
  /** Rows in play, from the top. */
  tracks: number;
  /** The pattern length in steps: every row starts again here. */
  length: number;
  stepTicks: number;
  /** 50 (straight) to 75 (every second step half a step late). */
  swing: number;
  /** A grace note's velocity as a share of its hit's. */
  flamLevel: number;
  /** Rows loop on their own lengths only, never restarted by the pattern. */
  free: boolean;
};

/** The module's parameters as whole, bounded settings. */
export function drumSettings(number: (id: string, fallback: number) => number, flag: (id: string) => boolean): DrumSettings {
  const num = number("rate-num", 1);
  const den = number("rate-den", 16);
  return {
    tracks: clamp(Math.round(number("tracks", DEFAULT_TRACKS)), 1, MAX_DRUM_ROWS),
    length: clamp(Math.round(number("length", 16)), 1, MAX_DRUM_STEPS),
    stepTicks: num > 0 && den > 0 ? stepTicks(num, den) : 0,
    swing: clamp(number("swing", 50), 50, 75),
    flamLevel: clamp(number("flam-level", 0.6), 0, 1),
    free: flag("free"),
  };
}

/* ===== Where each step falls ===== */

export const rowLength = (row: DrumRow, patternLength: number): number => (row.length > 0 ? row.length : patternLength);

/** Which of its steps a row plays on the n-th step since the reset. */
export function rowStepAt(row: DrumRow, settings: DrumSettings, n: number): number {
  const position = settings.free ? n : n % settings.length;
  return position % rowLength(row, settings.length);
}

/** How late swing puts every second step, in ticks. */
export const swingOffset = (settings: DrumSettings): number =>
  Math.round(((settings.swing - 50) / 50) * settings.stepTicks);

/** The tick the n-th step since the reset begins on. */
export const stepOnset = (n: number, settings: DrumSettings): number =>
  n * settings.stepTicks + (n % 2 === 1 ? swingOffset(settings) : 0);

export type DrumHit = {
  /** Ticks since the reset. */
  tick: number;
  row: number;
  /** The row's own step this hit came from. */
  step: number;
  note: number;
  velocity: number;
  duration: number;
  /** A flam's grace note rather than the hit itself. */
  grace: boolean;
};

/**
 * Every hit in [from, to), in ticks since the reset, by time then row (a
 * grace note before its hit).
 *
 * `key` keys the probability draws; each step's draw depends on nothing but
 * the key, the row and the step's number, so the same stretch of time plays
 * the same way however it is asked for.
 */
export function hitsInRange(rows: readonly DrumRow[], settings: DrumSettings, key: number, from: number, to: number): DrumHit[] {
  const size = settings.stepTicks;
  if (size <= 0) return [];
  const lead = Math.round(FLAM_SPAN * size);
  const hits: DrumHit[] = [];
  const keep = (hit: DrumHit) => { if (hit.tick >= from && hit.tick < to && hit.tick >= 0) hits.push(hit); };
  // A step's events lie between its grace note (`lead` early) and the next
  // step's onset (at most a step and a half later).
  const first = Math.max(0, Math.floor(from / size) - 1);
  const last = Math.floor((to + lead) / size) + 1;
  for (let n = first; n <= last; n++) {
    const onset = stepOnset(n, settings);
    const span = stepOnset(n + 1, settings) - onset;
    for (let r = 0; r < settings.tracks; r++) {
      const row = rows[r];
      if (!row || row.mute) continue;
      const step = rowStepAt(row, settings, n);
      if (row.on[step] !== true) continue;
      const chance = stepValue(row, "prob", step);
      if (chance < 1 && randomUnit(key, n, r) >= chance) continue;
      const velocity = stepValue(row, "vel", step);
      const flam = stepValue(row, "flam", step);
      if (flam > 0) {
        const early = Math.max(1, Math.round(flam * lead));
        keep({
          tick: onset - early, row: r, step, note: row.note, grace: true, duration: early,
          velocity: Math.max(1, Math.round(velocity * settings.flamLevel)),
        });
      }
      const repeats = stepValue(row, "ratchet", step);
      for (let k = 0; k < repeats; k++) {
        keep({
          tick: onset + Math.floor((k * span) / repeats), row: r, step, note: row.note, velocity, grace: false,
          duration: Math.max(1, Math.floor(span / repeats)),
        });
      }
    }
  }
  return hits.sort((a, b) => a.tick - b.tick || a.row - b.row || Number(b.grace) - Number(a.grace));
}

/** The playhead: the pattern position on the step labels, and each row's own step. */
export function drumPlayheadMarks(position: number, rowSteps: readonly number[]): PlayheadMark[] {
  const marks: PlayheadMark[] = [];
  if (position >= 0) marks.push({ lane: "step", step: position, classes: ["is-playing"] });
  rowSteps.forEach((step, row) => {
    if (step >= 0) marks.push({ lane: `row-${row}`, step, classes: ["is-playing"] });
  });
  return marks;
}

/* ===== Edits ===== */

const withRow = (rows: readonly DrumRow[], index: number, change: (row: DrumRow) => DrumRow): DrumRow[] =>
  rows.map((row, i) => (i === index ? change(row) : row));

const grownTo = <T>(lane: readonly T[], length: number, fill: T): T[] =>
  Array.from({ length: Math.max(length, lane.length) }, (_, i) => lane[i] ?? fill);

export const toggleStep = (rows: readonly DrumRow[], row: number, step: number): DrumRow[] =>
  withRow(rows, row, (r) => {
    const on = grownTo(r.on, step + 1, false);
    on[step] = !on[step];
    return { ...r, on };
  });

/** One step of one lane. Setting a velocity also switches the step on. */
export const setStepValue = (rows: readonly DrumRow[], row: number, lane: DrumLane, step: number, value: number): DrumRow[] =>
  withRow(rows, row, (r) => {
    const values = grownTo(r[lane], step + 1, LANE_DEFAULTS[lane]);
    values[step] = laneValue(lane, value);
    const next = { ...r, [lane]: values };
    if (lane === "vel") {
      next.on = grownTo(r.on, step + 1, false);
      next.on[step] = true;
    }
    return next;
  });

export const setRowField = (rows: readonly DrumRow[], row: number,
  changes: Partial<Pick<DrumRow, "name" | "note" | "length" | "mute">>): DrumRow[] =>
  withRow(rows, row, (r) => ({
    ...r,
    ...changes,
    note: clamp(Math.round(changes.note ?? r.note), 0, 127),
    length: clamp(Math.round(changes.length ?? r.length), 0, MAX_DRUM_STEPS),
  }));

/** << and >>: roll a row's first `length` steps one place, every lane together. */
export const shiftRow = (rows: readonly DrumRow[], row: number, length: number, by: -1 | 1): DrumRow[] =>
  withRow(rows, row, (r) => {
    if (length <= 1) return r;
    const roll = <T>(lane: readonly T[], fill: T): T[] => {
      const all = grownTo(lane, length, fill);
      const head = all.slice(0, length);
      const rolled = by < 0 ? [...head.slice(1), head[0]] : [head[length - 1], ...head.slice(0, length - 1)];
      return [...rolled, ...all.slice(length)];
    };
    return {
      ...r,
      on: roll(r.on, false),
      vel: roll(r.vel, LANE_DEFAULTS.vel),
      prob: roll(r.prob, LANE_DEFAULTS.prob),
      flam: roll(r.flam, LANE_DEFAULTS.flam),
      ratchet: roll(r.ratchet, LANE_DEFAULTS.ratchet),
    };
  });

export const clearRow = (rows: readonly DrumRow[], row: number): DrumRow[] =>
  withRow(rows, row, (r) => ({ ...r, on: [], vel: [], prob: [], flam: [], ratchet: [] }));
