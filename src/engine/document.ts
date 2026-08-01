// The versioned project document — M-Clone's portable save format.
//
// The document holds everything musical: the Project and its Patterns
// (Original and Scrambled material both), Variable and Cyclic Positions,
// Snapshots, Conducting Arrows and configuration. It deliberately excludes
// workspace geometry, zoom, skin and palette, which are per-machine
// preferences rather than part of the piece.
//
// Decoding is defensive. A file may come from an older build, a newer build, a
// text editor, or a truncated download, and none of those may be allowed to
// leave the app in an impossible state. Anything structurally required is
// rejected outright; anything merely missing or out of range is defaulted or
// clamped, and the caller is told what was repaired.

import type {
  CyclicPositionBanks,
  CyclicPositionLengths,
  CyclicStep,
  CyclicVariable,
  Pattern,
  ProjectState,
  StepEvent,
  VoiceState,
} from "./types";
import type { ArrowState, Snapshot } from "./snapshot";
import { QUANTIZE_VALUES } from "./snapshot";
import type { VariablePositions } from "./variables";
import { POSITION_COUNT, POSITION_VARS } from "./variables";
import { createDefaultProject } from "./project";
import { makePresetPositions } from "./variables";
import { neutralTimeMap } from "./timemap";
import { DEFAULT_OPTIONS, OPTION_IDS, type Options } from "./options";
import type { Slideshow, SlideshowAction } from "./slideshow";

export const DOCUMENT_VERSION = 2;

const SNAPSHOT_SLOTS = 26;
const SLIDESHOW_SLOTS = 9;
const CYCLIC_KINDS: CyclicVariable[] = ["accent", "legato", "rhythm"];
const MIN_TEMPO = 1;
const MAX_TEMPO = 999;

/** The live state a document is captured from. */
export type DocumentSource = {
  project: ProjectState;
  positions: VariablePositions;
  snapshots: (Snapshot | null)[];
  slideshows: Slideshow[];
  currentSnapshot: number | null;
  snapshotQuantize: number;
  arrows: Record<string, ArrowState>;
  patternGroup: number;
  selectedVoice: number;
  tempoRange: { low: number; high: number };
  syncRatio: number;
  syncRatioDirection: "out" | "in";
  robotRange: { x: number; y: number };
  robotTimeBase: number;
  cyclicPositions: CyclicPositionBanks;
  cyclicLengths: CyclicPositionLengths;
  activeCyclicPositions: Record<CyclicVariable, number>;
  options: Options;
};

export type ProjectDocumentV2 = DocumentSource & { version: 2 };

export type DecodeResult =
  | { ok: true; document: ProjectDocumentV2; warnings: string[] }
  | { ok: false; error: string };

/* ===== Encoding ===== */

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** Capture the musical document from live state, fully detached. */
export function encodeDocument(source: DocumentSource): ProjectDocumentV2 {
  return {
    version: DOCUMENT_VERSION,
    project: clone(source.project),
    positions: clone(source.positions),
    snapshots: clone(source.snapshots),
    slideshows: clone(source.slideshows),
    currentSnapshot: source.currentSnapshot,
    snapshotQuantize: source.snapshotQuantize,
    arrows: clone(source.arrows),
    patternGroup: source.patternGroup,
    selectedVoice: source.selectedVoice,
    tempoRange: { ...source.tempoRange },
    syncRatio: source.syncRatio,
    syncRatioDirection: source.syncRatioDirection,
    robotRange: { ...source.robotRange },
    robotTimeBase: source.robotTimeBase,
    cyclicPositions: clone(source.cyclicPositions),
    cyclicLengths: clone(source.cyclicLengths),
    activeCyclicPositions: { ...source.activeCyclicPositions },
    options: { ...source.options },
  };
}

/* ===== Decoding ===== */

type Bag = Record<string, unknown>;

const isBag = (v: unknown): v is Bag =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));

/** A finite number, or `fallback` when the value is missing or nonsense. */
function num(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function isStep(value: unknown): value is StepEvent {
  return (
    isBag(value) &&
    Array.isArray(value.pitches) &&
    value.pitches.every((p) => typeof p === "number" && Number.isFinite(p))
  );
}

function readSteps(value: unknown): StepEvent[] | null {
  if (!Array.isArray(value) || !value.every(isStep)) return null;
  return value.map((s) => ({
    pitches: s.pitches.map((p) => clamp(Math.round(p), 0, 127)),
  }));
}

/**
 * Patterns are the one place decoding refuses to guess: without well-formed
 * steps there is no piece to load.
 */
function readPattern(value: unknown, index: number, warn: (m: string) => void) {
  if (!isBag(value)) return null;
  const steps = readSteps(value.steps);
  if (!steps) return null;

  const defaults = createDefaultProject().patterns[index];

  let scrambledSteps = readSteps(value.scrambledSteps);
  if (!scrambledSteps) {
    warn(`Pattern ${index + 1}: no Scrambled material, copied from Original`);
    scrambledSteps = steps.map((s) => ({ pitches: [...s.pitches] }));
  }

  const maxSize = clamp(Math.round(num(value.maxSize, defaults.maxSize)), steps.length, 999);
  const chordMode = ["single", "chord", "build"].includes(value.chordMode as string)
    ? (value.chordMode as Pattern["chordMode"])
    : defaults.chordMode;
  const insertMode = ["insert", "replace", "overdub"].includes(value.insertMode as string)
    ? (value.insertMode as Pattern["insertMode"])
    : defaults.insertMode;

  return {
    id: typeof value.id === "string" ? value.id : defaults.id,
    steps,
    scrambledSteps,
    scrambleGeneration: Math.max(0, Math.round(num(value.scrambleGeneration, 0))),
    // Output Length can never point past the material that exists.
    outputLength: clamp(Math.round(num(value.outputLength, steps.length)), 0, steps.length),
    maxSize,
    chordMode,
    insertMode,
    drumMachine: bool(value.drumMachine, defaults.drumMachine),
  } satisfies Pattern;
}

function readVoice(value: unknown, index: number): VoiceState {
  const defaults = createDefaultProject().voices[index];
  if (!isBag(value)) return defaults;

  const map = isBag(value.timeDistort) ? (value.timeDistort as Bag) : null;
  const points = Array.isArray(map?.points)
    ? (map!.points as unknown[])
        .filter(isBag)
        .map((p) => ({ x: clamp(num(p.x, 0), 0, 1), y: clamp(num(p.y, 0), 0, 1) }))
    : [];

  const mix = isBag(value.noteOrderMix) ? (value.noteOrderMix as Bag) : null;
  const range = isBag(value.velocityRange) ? (value.velocityRange as Bag) : null;
  const low = clamp(Math.round(num(range?.low, defaults.velocityRange.low)), 0, 127);

  return {
    patternIndex: clamp(Math.round(num(value.patternIndex, defaults.patternIndex)), 0, 3),
    playEnabled: bool(value.playEnabled, defaults.playEnabled),
    transposition: clamp(Math.round(num(value.transposition, 0)), -127, 127),
    noteOrderMix: mix
      ? {
          original: clamp(num(mix.original, 100), 0, 100),
          cyclic: clamp(num(mix.cyclic, 0), 0, 100),
          utterly: clamp(num(mix.utterly, 0), 0, 100),
        }
      : { ...defaults.noteOrderMix },
    density: clamp(num(value.density, defaults.density), 0, 1),
    velocityRange: {
      low,
      high: clamp(Math.round(num(range?.high, defaults.velocityRange.high)), low, 127),
    },
    timeBaseNumerator: Math.max(1, Math.round(num(value.timeBaseNumerator, defaults.timeBaseNumerator))),
    timeBaseDenominator: Math.max(1, Math.round(num(value.timeBaseDenominator, defaults.timeBaseDenominator))),
    timeDistort: map
      ? {
          points,
          length: clamp(Math.round(num(map.length, 1)), 1, 64),
          denominator: [1, 2, 4, 8, 16].includes(num(map.denominator, 4))
            ? num(map.denominator, 4)
            : 4,
        }
      : neutralTimeMap(),
    legato: clamp(num(value.legato, defaults.legato), 0, 4),
    channel: clamp(Math.round(num(value.channel, defaults.channel)), 1, 16),
    outputChannels: Array.isArray(value.outputChannels)
      ? (value.outputChannels as unknown[])
          .map((c) => clamp(Math.round(num(c, 1)), 1, 16))
          .filter((c, i, all) => all.indexOf(c) === i)
      : [...defaults.outputChannels],
    program: clamp(Math.round(num(value.program, defaults.program)), 0, 127),
  };
}

function readCyclicStep(value: unknown): CyclicStep {
  if (isBag(value)) {
    const min = clamp(Math.round(num(value.min, 2)), 0, 4);
    return { min, max: clamp(Math.round(num(value.max, min)), min, 4) };
  }
  return clamp(Math.round(num(value, 2)), 0, 4);
}

function readProject(value: unknown, warn: (m: string) => void): ProjectState | null {
  if (!isBag(value)) return null;
  if (!Array.isArray(value.patterns) || value.patterns.length !== 4) return null;
  if (!Array.isArray(value.voices) || value.voices.length !== 4) return null;

  const patterns: Pattern[] = [];
  for (let i = 0; i < 4; i++) {
    const pattern = readPattern(value.patterns[i], i, warn);
    if (!pattern) return null;
    patterns.push(pattern);
  }

  const defaults = createDefaultProject();
  const readBank = (source: unknown, fallback: CyclicStep[][]) =>
    Array.isArray(source)
      ? (source as unknown[]).map((voice, vi) =>
          Array.isArray(voice)
            ? (voice as unknown[]).map(readCyclicStep)
            : [...fallback[vi]],
        )
      : fallback.map((v) => [...v]);

  const cyclicSource = isBag(value.cyclic) ? (value.cyclic as Bag) : {};
  const lengthsSource = isBag(value.cyclicLengths) ? (value.cyclicLengths as Bag) : {};
  const valuesSource = isBag(value.cyclicValues) ? (value.cyclicValues as Bag) : {};

  return {
    tempo: clamp(num(value.tempo, defaults.tempo), MIN_TEMPO, MAX_TEMPO),
    patterns,
    voices: Array.from({ length: 4 }, (_, i) => readVoice((value.voices as unknown[])[i], i)),
    root: clamp(Math.round(num(value.root, defaults.root)), 0, 11),
    scale: typeof value.scale === "string" ? (value.scale as ProjectState["scale"]) : defaults.scale,
    scaleSnap: bool(value.scaleSnap, defaults.scaleSnap),
    seed: Math.round(num(value.seed, defaults.seed)),
    diatonicTranspose: bool(value.diatonicTranspose, false),
    secondOrderTranspose: bool(value.secondOrderTranspose, false),
    chordTones: bool(value.chordTones, false),
    cyclic: Object.fromEntries(
      CYCLIC_KINDS.map((kind) => [kind, readBank(cyclicSource[kind], defaults.cyclic[kind])]),
    ) as ProjectState["cyclic"],
    cyclicLengths: Object.fromEntries(
      CYCLIC_KINDS.map((kind) => [
        kind,
        Array.isArray(lengthsSource[kind])
          ? (lengthsSource[kind] as unknown[]).map((n) => clamp(Math.round(num(n, 16)), 1, 16))
          : [...defaults.cyclicLengths[kind]],
      ]),
    ) as ProjectState["cyclicLengths"],
    cyclicValues: {
      legato: Array.isArray(valuesSource.legato)
        ? (valuesSource.legato as unknown[]).map((n) => num(n, 1))
        : [...defaults.cyclicValues.legato],
      rhythm: Array.isArray(valuesSource.rhythm)
        ? (valuesSource.rhythm as unknown[]).map((n) => num(n, 1))
        : [...defaults.cyclicValues.rhythm],
    },
  };
}

function readPositions(value: unknown, warn: (m: string) => void): VariablePositions {
  const defaults = makePresetPositions();
  if (!isBag(value)) {
    warn("No Variable Positions in the document, using the shipped presets");
    return defaults;
  }
  const out = {} as VariablePositions;
  for (const id of POSITION_VARS) {
    const entry = isBag(value[id]) ? (value[id] as Bag) : null;
    const slots = Array.isArray(entry?.slots) && entry!.slots.length === POSITION_COUNT
      ? clone(entry!.slots as VariablePositions[typeof id]["slots"])
      : defaults[id].slots;
    out[id] = {
      active: clamp(Math.round(num(entry?.active, 0)), 0, POSITION_COUNT - 1),
      slots,
    };
  }
  return out;
}

function readSnapshots(value: unknown, warn: (m: string) => void): (Snapshot | null)[] {
  if (!Array.isArray(value)) {
    warn("No Snapshots in the document, starting with empty locations");
    return Array(SNAPSHOT_SLOTS).fill(null);
  }
  return Array.from({ length: SNAPSHOT_SLOTS }, (_, i) => {
    const entry = value[i];
    return isBag(entry) ? (clone(entry) as Snapshot) : null;
  });
}

function readSlideshows(value: unknown, warn: (m: string) => void): Slideshow[] {
  if (value === undefined) {
    return Array.from({ length: SLIDESHOW_SLOTS }, () => ({ events: [], loopAtSec: null }));
  }
  if (!Array.isArray(value)) {
    warn("The saved Slideshows were unreadable and were reset.");
    return Array.from({ length: SLIDESHOW_SLOTS }, () => ({ events: [], loopAtSec: null }));
  }
  return Array.from({ length: SLIDESHOW_SLOTS }, (_, i) => {
    const show = isBag(value[i]) ? value[i] as Bag : {};
    const events = Array.isArray(show.events) ? show.events.flatMap((rawEvent) => {
      if (!isBag(rawEvent) || !isBag(rawEvent.action)) return [];
      const atSec = num(rawEvent.atSec, -1);
      const action = rawEvent.action as Bag;
      if (atSec < 0) return [];
      if (action.type === "snapshot") {
        const index = Math.round(num(action.index, -1));
        return index >= 0 && index < SNAPSHOT_SLOTS
          ? [{ atSec, action: { type: "snapshot", index } as SlideshowAction }]
          : [];
      }
      if (action.type === "position" && [
        ...POSITION_VARS, ...CYCLIC_KINDS,
      ].includes(action.variable as never)) {
        return [{
          atSec,
          action: {
            type: "position", variable: action.variable,
            position: clamp(Math.round(num(action.position, 0)), 0, POSITION_COUNT - 1),
          } as SlideshowAction,
        }];
      }
      return [];
    }).sort((a, b) => a.atSec - b.atSec) : [];
    const loopAtSec = typeof show.loopAtSec === "number" && Number.isFinite(show.loopAtSec)
      ? Math.max(events[events.length - 1]?.atSec ?? 0, show.loopAtSec)
      : null;
    return { events, loopAtSec };
  });
}

function readArrows(value: unknown, warn: (m: string) => void): Record<string, ArrowState> {
  if (!isBag(value)) {
    warn("No Conducting Arrows in the document, none armed");
    return {};
  }
  const out: Record<string, ArrowState> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!isBag(entry)) continue;
    const dir = entry.dir;
    out[key] = {
      on: bool(entry.on, false),
      dir: ["right", "down", "left", "up"].includes(dir as string)
        ? (dir as ArrowState["dir"])
        : "right",
    };
  }
  return out;
}

function readCyclicBanks(value: unknown, warn: (m: string) => void): CyclicPositionBanks {
  const defaults = createDefaultProject();
  if (!isBag(value)) {
    warn("No Cyclic Positions in the document, using the defaults");
  }
  const source = isBag(value) ? (value as Bag) : {};
  return Object.fromEntries(
    CYCLIC_KINDS.map((kind) => {
      const bank = source[kind];
      if (!Array.isArray(bank)) {
        return [kind, Array.from({ length: POSITION_COUNT }, () =>
          defaults.cyclic[kind].map((v) => [...v]))];
      }
      return [
        kind,
        Array.from({ length: POSITION_COUNT }, (_, p) => {
          const position = bank[p];
          if (!Array.isArray(position)) return defaults.cyclic[kind].map((v) => [...v]);
          return Array.from({ length: 4 }, (_, v) => {
            const voice = (position as unknown[])[v];
            return Array.isArray(voice)
              ? (voice as unknown[]).map(readCyclicStep)
              : [...defaults.cyclic[kind][v]];
          });
        }),
      ];
    }),
  ) as CyclicPositionBanks;
}

function readCyclicLengths(value: unknown): CyclicPositionLengths {
  const source = isBag(value) ? (value as Bag) : {};
  return Object.fromEntries(
    CYCLIC_KINDS.map((kind) => {
      const bank = source[kind];
      return [
        kind,
        Array.from({ length: POSITION_COUNT }, (_, p) => {
          const position = Array.isArray(bank) ? (bank as unknown[])[p] : null;
          return Array.from({ length: 4 }, (_, v) =>
            clamp(
              Math.round(num(Array.isArray(position) ? (position as unknown[])[v] : 16, 16)),
              1,
              16,
            ),
          );
        }),
      ];
    }),
  ) as CyclicPositionLengths;
}

/**
 * Read the Options menu.
 *
 * Absent entirely is the normal case for a document saved before Options were
 * carried, so that is silent; anything present but malformed is repaired and
 * reported. Unknown keys are dropped rather than passed through.
 */
function readOptions(value: unknown, warn: (m: string) => void): Options {
  if (value === undefined) return { ...DEFAULT_OPTIONS };
  if (!isBag(value)) {
    warn("The saved options were unreadable and were reset to their defaults.");
    return { ...DEFAULT_OPTIONS };
  }
  const bag = value as Bag;
  return OPTION_IDS.reduce((acc, id) => {
    acc[id] = bool(bag[id], DEFAULT_OPTIONS[id]);
    return acc;
  }, {} as Options);
}

/** Parse and validate a decoded JSON value into a document. */
export function decodeDocument(raw: unknown): DecodeResult {
  if (!isBag(raw)) return { ok: false, error: "Not a project document." };

  const version = raw.version;
  if (typeof version !== "number" || !Number.isFinite(version)) {
    return { ok: false, error: "Not a project document: no schema version." };
  }
  if (version > DOCUMENT_VERSION) {
    return {
      ok: false,
      error: `This project was saved by a newer version of M-Clone (document version ${version}).`,
    };
  }

  const warnings: string[] = [];
  const warn = (message: string) => warnings.push(message);

  const project = readProject(raw.project, warn);
  if (!project) {
    return { ok: false, error: "This project's musical data is missing or damaged." };
  }

  const quantize = num(raw.snapshotQuantize, 0);
  const currentSnapshot = raw.currentSnapshot;
  const syncRatio = num(raw.syncRatio, 4);
  const robotTimeBase = num(raw.robotTimeBase, 4);
  const tempoRange = isBag(raw.tempoRange) ? (raw.tempoRange as Bag) : {};
  const robotRange = isBag(raw.robotRange) ? (raw.robotRange as Bag) : {};
  const actives = isBag(raw.activeCyclicPositions) ? (raw.activeCyclicPositions as Bag) : {};

  const low = clamp(num(tempoRange.low, 80), MIN_TEMPO, MAX_TEMPO);

  return {
    ok: true,
    warnings,
    document: {
      version: DOCUMENT_VERSION,
      project,
      positions: readPositions(raw.positions, warn),
      snapshots: readSnapshots(raw.snapshots, warn),
      slideshows: readSlideshows(raw.slideshows, warn),
      currentSnapshot:
        typeof currentSnapshot === "number" &&
        currentSnapshot >= 0 &&
        currentSnapshot < SNAPSHOT_SLOTS
          ? Math.round(currentSnapshot)
          : null,
      snapshotQuantize: (QUANTIZE_VALUES as readonly number[]).includes(quantize)
        ? quantize
        : 0,
      arrows: readArrows(raw.arrows, warn),
      patternGroup: clamp(Math.round(num(raw.patternGroup, 0)), 0, POSITION_COUNT - 1),
      selectedVoice: clamp(Math.round(num(raw.selectedVoice, 0)), 0, 3),
      tempoRange: { low, high: clamp(num(tempoRange.high, 160), low, MAX_TEMPO) },
      syncRatio: [1, 2, 4, 8, 16].includes(syncRatio) ? syncRatio : 4,
      syncRatioDirection: raw.syncRatioDirection === "in" ? "in" : "out",
      robotRange: {
        x: clamp(num(robotRange.x, 0.15), 0, 1),
        y: clamp(num(robotRange.y, 0.15), 0, 1),
      },
      robotTimeBase: [1, 2, 4, 8, 16].includes(robotTimeBase) ? robotTimeBase : 4,
      cyclicPositions: readCyclicBanks(raw.cyclicPositions, warn),
      cyclicLengths: readCyclicLengths(raw.cyclicLengths),
      activeCyclicPositions: Object.fromEntries(
        CYCLIC_KINDS.map((kind) => [
          kind,
          clamp(Math.round(num(actives[kind], 0)), 0, POSITION_COUNT - 1),
        ]),
      ) as Record<CyclicVariable, number>,
      options: readOptions(raw.options, warn),
    },
  };
}
