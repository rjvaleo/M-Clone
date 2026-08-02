// Tests for the versioned project document, written before the codec exists.
//
// The document is the portable musical artefact: everything you would lose by
// reloading the page. Workspace geometry, zoom, skin and palette are user
// preferences and deliberately stay out of it.
//
// Decoding is defensive by design. A document may come from an older build, a
// newer build, a text editor, or a corrupted file, and none of those may be
// allowed to put the app into an impossible state.

import { describe, it, expect } from "vitest";
import {
  DOCUMENT_VERSION,
  decodeDocument,
  encodeDocument,
  type DocumentSource,
} from "./document";
import { createDefaultProject } from "./project";
import { DEFAULT_OPTIONS, setOption } from "./options";
import { makePresetPositions, POSITION_VARS } from "./variables";
import type { CyclicPositionBanks, CyclicPositionLengths, CyclicVariable } from "./types";

const KINDS: CyclicVariable[] = ["accent", "legato", "rhythm"];

function source(over: Partial<DocumentSource> = {}): DocumentSource {
  const project = createDefaultProject();
  return {
    project,
    positions: makePresetPositions(),
    snapshots: Array(26).fill(null),
    slideshows: Array.from({ length: 9 }, () => ({ events: [], loopAtSec: null })),
    currentSnapshot: null,
    snapshotQuantize: 0,
    arrows: {},
    patternGroup: 0,
    selectedVoice: 0,
    tempoRange: { low: 80, high: 160 },
    syncRatio: 4,
    syncRatioDirection: "out",
    robotRange: { x: 0.15, y: 0.15 },
    robotTimeBase: 4,
    cyclicPositions: Object.fromEntries(
      KINDS.map((kind) => [
        kind,
        Array.from({ length: 6 }, () => project.cyclic[kind].map((v) => [...v])),
      ]),
    ) as CyclicPositionBanks,
    cyclicLengths: Object.fromEntries(
      KINDS.map((kind) => [kind, Array.from({ length: 6 }, () => Array(4).fill(16))]),
    ) as CyclicPositionLengths,
    activeCyclicPositions: { accent: 0, legato: 0, rhythm: 0 },
    options: DEFAULT_OPTIONS,
    ...over,
  };
}

/** Encode, stringify, parse, decode — the real save/load path. */
function roundTrip(src: DocumentSource) {
  const result = decodeDocument(JSON.parse(JSON.stringify(encodeDocument(src))));
  if (!result.ok) throw new Error(`expected a valid document: ${result.error}`);
  return result.document;
}

describe("the document envelope", () => {
  it("stamps the schema version", () => {
    expect(encodeDocument(source()).version).toBe(DOCUMENT_VERSION);
    expect(DOCUMENT_VERSION).toBe(2);
  });

  it("survives a JSON round trip unchanged", () => {
    const doc = encodeDocument(source());
    expect(JSON.parse(JSON.stringify(doc))).toEqual(doc);
  });
});

describe("what the document carries", () => {
  it("carries the project, including harmonic options and seed", () => {
    const src = source();
    src.project.tempo = 143;
    src.project.seed = 4242;
    src.project.root = 7;
    src.project.scale = "dorian";
    src.project.scaleSnap = true;
    src.project.chordTones = true;
    const out = roundTrip(src).project;
    expect(out).toMatchObject({
      tempo: 143, seed: 4242, root: 7, scale: "dorian",
      scaleSnap: true, chordTones: true,
    });
  });

  it("carries Pattern material, Scrambled material and record modes", () => {
    const src = source();
    src.project.patterns[0].steps[0] = { pitches: [60, 64] };
    src.project.patterns[0].scrambledSteps[1] = { pitches: [72] };
    src.project.patterns[0].scrambleGeneration = 3;
    src.project.patterns[0].chordMode = "build";
    src.project.patterns[0].insertMode = "overdub";
    src.project.patterns[0].drumMachine = true;
    src.project.patterns[0].maxSize = 250;
    const out = roundTrip(src).project.patterns[0];
    expect(out.steps[0].pitches).toEqual([60, 64]);
    expect(out.scrambledSteps[1].pitches).toEqual([72]);
    expect(out).toMatchObject({
      scrambleGeneration: 3, chordMode: "build",
      insertMode: "overdub", drumMachine: true, maxSize: 250,
    });
  });

  it("carries each Voice's Time Distortion map", () => {
    const src = source();
    src.project.voices[2].timeDistort = {
      points: [{ x: 0.25, y: 0.75 }], length: 8, denominator: 4,
    };
    expect(roundTrip(src).project.voices[2].timeDistort).toEqual({
      points: [{ x: 0.25, y: 0.75 }], length: 8, denominator: 4,
    });
  });

  it("carries every Variable Position's slots and active index", () => {
    const src = source();
    src.positions.transposition.active = 3;
    src.positions.transposition.slots[3][1] = 7;
    const out = roundTrip(src).positions;
    expect(out.transposition.active).toBe(3);
    expect(out.transposition.slots[3][1]).toBe(7);
    for (const id of POSITION_VARS) expect(out[id].slots).toHaveLength(6);
  });

  it("carries Cyclic Positions, lengths and active positions", () => {
    const src = source();
    src.cyclicPositions.accent[2][0][0] = { min: 1, max: 4 };
    src.cyclicLengths.rhythm[1][3] = 9;
    src.activeCyclicPositions.legato = 5;
    const out = roundTrip(src);
    expect(out.cyclicPositions.accent[2][0][0]).toEqual({ min: 1, max: 4 });
    expect(out.cyclicLengths.rhythm[1][3]).toBe(9);
    expect(out.activeCyclicPositions.legato).toBe(5);
  });

  it("carries Snapshots, the current mark and quantization", () => {
    const src = source();
    src.snapshots[4] = {
      actives: { density: 1 } as never,
      arrows: { density: { on: true, dir: "down" } },
      playEnabled: [true, false, true, true],
      timeBase: [{ numerator: 1, denominator: 8 }],
      outputLength: [8],
      patternGroup: 2,
    };
    src.currentSnapshot = 4;
    src.snapshotQuantize = 4;
    const out = roundTrip(src);
    expect(out.snapshots[4]?.arrows.density).toEqual({ on: true, dir: "down" });
    expect(out.currentSnapshot).toBe(4);
    expect(out.snapshotQuantize).toBe(4);
  });

  it("carries all nine Slideshow scores and loop points", () => {
    const src = source();
    src.slideshows[2] = {
      events: [{ atSec: 1.25, action: { type: "snapshot", index: 4 } }],
      loopAtSec: 2,
    };
    expect(roundTrip(src).slideshows[2]).toEqual(src.slideshows[2]);
  });

  it("loads version-1 documents with empty Slideshows", () => {
    const raw = encodeDocument(source()) as unknown as Record<string, unknown>;
    raw.version = 1;
    delete raw.slideshows;
    const result = decodeDocument(raw);
    expect(result.ok && result.document.slideshows).toHaveLength(9);
    expect(result.ok && result.document.slideshows.every((show) => show.events.length === 0)).toBe(true);
  });

  it("repairs malformed Slideshow data and validates actions", () => {
    const bad = encodeDocument(source()) as unknown as Record<string, unknown>;
    bad.slideshows = "broken";
    const reset = decodeDocument(bad);
    expect(reset.ok && reset.warnings.some((warning) => warning.includes("Slideshows"))).toBe(true);

    const raw = encodeDocument(source()) as unknown as Record<string, unknown>;
    raw.slideshows = [{
      events: [
        null,
        { atSec: -1, action: { type: "snapshot", index: 0 } },
        { atSec: 4, action: { type: "snapshot", index: 99 } },
        { atSec: 2, action: { type: "position", variable: "density", position: 99 } },
        { atSec: 1, action: { type: "snapshot", index: 2 } },
        { atSec: 3, action: { type: "unknown" } },
      ],
      loopAtSec: 0.5,
    }];
    const result = decodeDocument(raw);
    if (!result.ok) throw new Error(result.error);
    expect(result.document.slideshows[0]).toEqual({
      events: [
        { atSec: 1, action: { type: "snapshot", index: 2 } },
        { atSec: 2, action: { type: "position", variable: "density", position: 5 } },
      ],
      loopAtSec: 2,
    });

    const emptyLoop = encodeDocument(source()) as unknown as Record<string, unknown>;
    emptyLoop.slideshows = [{ events: [], loopAtSec: 1 }];
    const emptyResult = decodeDocument(emptyLoop);
    expect(emptyResult.ok && emptyResult.document.slideshows[0].loopAtSec).toBe(1);
  });

  it("keeps Cyclic Variable Position events in Slideshows", () => {
    const raw = encodeDocument(source()) as unknown as Record<string, unknown>;
    raw.slideshows = [{
      events: [{ atSec: 1, action: { type: "position", variable: "legato", position: 4 } }],
      loopAtSec: null,
    }];
    const result = decodeDocument(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.document.slideshows[0].events).toEqual([
        { atSec: 1, action: { type: "position", variable: "legato", position: 4 } },
      ]);
    }
  });

  it("carries Conducting Arrows and the Pattern Group", () => {
    const src = source({
      arrows: { density: { on: true, dir: "left" } },
      patternGroup: 5,
    });
    const out = roundTrip(src);
    expect(out.arrows.density).toEqual({ on: true, dir: "left" });
    expect(out.patternGroup).toBe(5);
  });

  it("carries the conducting configuration", () => {
    const src = source({
      tempoRange: { low: 60, high: 200 },
      syncRatio: 8,
      syncRatioDirection: "in",
      robotRange: { x: 0.4, y: 0.2 },
      robotTimeBase: 16,
    });
    expect(roundTrip(src)).toMatchObject({
      tempoRange: { low: 60, high: 200 },
      syncRatio: 8,
      syncRatioDirection: "in",
      robotRange: { x: 0.4, y: 0.2 },
      robotTimeBase: 16,
    });
  });

  it("leaves transient and preference state out", () => {
    const json = JSON.stringify(encodeDocument(source()));
    for (const key of [
      "isPlaying", "isPaused", "baton", "restorePoint", "clipboard",
      "midiViewEvents", "midiViewNextId", "editingVar", "zoom", "theme",
    ]) {
      expect(json).not.toContain(`"${key}"`);
    }
  });
});

describe("the document is detached from live state", () => {
  it("does not alias the source", () => {
    const src = source();
    const doc = encodeDocument(src);
    src.project.patterns[0].steps[0].pitches.push(99);
    src.positions.density.slots[0][0] = 0.01;
    expect(doc.project.patterns[0].steps[0].pitches).not.toContain(99);
    expect(doc.positions.density.slots[0][0]).not.toBe(0.01);
  });

  it("hands back a decoded document that does not alias its input", () => {
    const raw = JSON.parse(JSON.stringify(encodeDocument(source())));
    const result = decodeDocument(raw);
    if (!result.ok) throw new Error(result.error);
    raw.project.patterns[0].steps[0].pitches = [1, 2, 3];
    expect(result.document.project.patterns[0].steps[0].pitches).not.toEqual([1, 2, 3]);
  });
});

describe("decoding rejects what it cannot trust", () => {
  it("rejects a non-object", () => {
    for (const bad of [null, undefined, 42, "nope", []]) {
      expect(decodeDocument(bad).ok).toBe(false);
    }
  });

  it("rejects a missing version", () => {
    const raw = encodeDocument(source()) as Record<string, unknown>;
    delete raw.version;
    expect(decodeDocument(raw).ok).toBe(false);
  });

  it("rejects a version from a newer build", () => {
    const result = decodeDocument({ ...encodeDocument(source()), version: 99 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/newer/i);
  });

  it("rejects a document with no project", () => {
    const raw = encodeDocument(source()) as Record<string, unknown>;
    delete raw.project;
    expect(decodeDocument(raw).ok).toBe(false);
  });

  it("rejects a project without the four Patterns or Voices", () => {
    const short = encodeDocument(source());
    short.project.patterns = short.project.patterns.slice(0, 2);
    expect(decodeDocument(short).ok).toBe(false);

    const noVoices = encodeDocument(source());
    noVoices.project.voices = [];
    expect(decodeDocument(noVoices).ok).toBe(false);
  });

  it("rejects a Pattern whose steps are not steps", () => {
    const raw = encodeDocument(source()) as never as Record<string, never>;
    (raw.project as never as { patterns: unknown[] }).patterns[0] = { id: "x" };
    expect(decodeDocument(raw).ok).toBe(false);
  });
});

describe("decoding repairs what it can", () => {
  it("expands legacy four-Pattern documents and defaults new MIDI input settings", () => {
    const raw = encodeDocument(source());
    raw.project.patterns = raw.project.patterns.slice(0, 4);
    delete (raw.project as unknown as Record<string, unknown>).midiAssignments;
    delete (raw.project as unknown as Record<string, unknown>).echoMapChannels;
    const result = decodeDocument(raw);
    if (!result.ok) throw new Error(result.error);
    expect(result.document.project.patterns).toHaveLength(24);
    expect(result.document.project.midiAssignments.inputs).toHaveLength(16);
    expect(result.document.project.echoMapChannels).toEqual([]);
  });

  it("clamps persisted MIDI assignment and Echo Map values", () => {
    const raw = encodeDocument(source());
    raw.project.midiAssignments.inputs[0] = { deviceId: "kbd", channel: 99 };
    raw.project.midiAssignments.latencyMs = 5000;
    raw.project.echoMapChannels = [0, 3, 30];
    const result = decodeDocument(raw);
    if (!result.ok) throw new Error(result.error);
    expect(result.document.project.midiAssignments.inputs[0]).toEqual({ deviceId: "kbd", channel: 16 });
    expect(result.document.project.midiAssignments.latencyMs).toBe(999);
    expect(result.document.project.echoMapChannels).toEqual([1, 3, 16]);
  });
  it("supplies defaults for fields absent from an older document", () => {
    const raw = encodeDocument(source()) as Record<string, unknown>;
    delete raw.snapshots;
    delete raw.arrows;
    delete raw.patternGroup;
    delete raw.cyclicPositions;
    delete raw.positions;
    const result = decodeDocument(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.snapshots).toHaveLength(26);
    expect(result.document.arrows).toEqual({});
    expect(result.document.patternGroup).toBe(0);
    // Absent Variable Positions fall back to the shipped presets.
    expect(result.document.positions.density.slots).toHaveLength(6);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("defaults a Pattern's Scrambled material to its Original when absent", () => {
    const raw = encodeDocument(source());
    delete (raw.project.patterns[0] as Partial<typeof raw.project.patterns[0]>)
      .scrambledSteps;
    const result = decodeDocument(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const pattern = result.document.project.patterns[0];
    expect(pattern.scrambledSteps).toHaveLength(pattern.steps.length);
  });

  it("clamps a tempo from outside the sane range", () => {
    const fast = encodeDocument(source());
    fast.project.tempo = 100000;
    const slow = encodeDocument(source());
    slow.project.tempo = -5;
    const a = decodeDocument(fast);
    const b = decodeDocument(slow);
    expect(a.ok && a.document.project.tempo).toBeLessThanOrEqual(999);
    expect(b.ok && b.document.project.tempo).toBeGreaterThan(0);
  });

  it("clamps an out-of-range Pattern Group and current Snapshot", () => {
    const raw = encodeDocument(source());
    raw.patternGroup = 99;
    raw.currentSnapshot = 500;
    const result = decodeDocument(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.patternGroup).toBeLessThan(6);
    expect(result.document.currentSnapshot).toBe(null);
  });

  it("clamps an active Variable Position that points nowhere", () => {
    const raw = encodeDocument(source());
    raw.positions.density.active = 42;
    const result = decodeDocument(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.positions.density.active).toBeLessThan(6);
  });

  it("drops a Snapshot quantization that isn't on the numerical", () => {
    const raw = encodeDocument(source());
    raw.snapshotQuantize = 7;
    const result = decodeDocument(raw);
    expect(result.ok && result.document.snapshotQuantize).toBe(0);
  });

  it("keeps Output Length inside the Pattern it belongs to", () => {
    const raw = encodeDocument(source());
    raw.project.patterns[0].outputLength = 9999;
    const result = decodeDocument(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const pattern = result.document.project.patterns[0];
    expect(pattern.outputLength).toBeLessThanOrEqual(pattern.steps.length);
  });
});

describe("a thoroughly corrupted but loadable document", () => {
  /** Valid Patterns — the one hard requirement — and garbage everywhere else. */
  function garbage() {
    const raw = JSON.parse(JSON.stringify(encodeDocument(source()))) as Record<
      string, unknown
    >;
    const project = raw.project as Record<string, unknown>;
    project.tempo = "fast";
    project.root = null;
    project.scale = 7;
    project.seed = "abc";
    project.cyclic = { accent: "no", legato: [null, 4], rhythm: 3 };
    project.cyclicLengths = { accent: "x" };
    project.cyclicValues = { legato: "x", rhythm: null };
    project.voices = [null, 5, "voice", { timeDistort: "no", outputChannels: "no" }];
    (project.patterns as Record<string, unknown>[])[1].chordMode = "wrong";
    (project.patterns as Record<string, unknown>[])[1].insertMode = "wrong";
    (project.patterns as Record<string, unknown>[])[1].id = 42;
    (project.patterns as Record<string, unknown>[])[1].scrambleGeneration = -9;
    raw.positions = { density: { active: "x", slots: "no" } };
    raw.snapshots = ["nope", 3, null];
    raw.arrows = { good: { on: true, dir: "sideways" }, bad: "no" };
    raw.tempoRange = "no";
    raw.robotRange = null;
    raw.syncRatio = 3;
    raw.robotTimeBase = 7;
    raw.syncRatioDirection = "sideways";
    raw.selectedVoice = 99;
    raw.activeCyclicPositions = "no";
    raw.cyclicLengths = { accent: [["x"]] };
    raw.cyclicPositions = { accent: [[[{ min: 9, max: -1 }]]], legato: "no", rhythm: 4 };
    return raw;
  }

  it("still loads", () => {
    expect(decodeDocument(garbage()).ok).toBe(true);
  });

  it("repairs a missing variable-mark bank", () => {
    const raw = JSON.parse(JSON.stringify(encodeDocument(source()))) as Record<string, unknown>;
    delete raw.variableMarks;
    const result = decodeDocument(raw);
    if (!result.ok) throw new Error(result.error);
    expect(result.document.variableMarks.density).toEqual([false, false, false, false, false, false]);
  });

  it("repairs missing marks within a bank and accepts one-based Program display", () => {
    const raw = JSON.parse(JSON.stringify(encodeDocument(source()))) as Record<string, unknown>;
    raw.variableMarks = {};
    const project = raw.project as Record<string, unknown>;
    (project.midiAssignments as Record<string, unknown>).programBase = 1;
    const result = decodeDocument(raw);
    if (!result.ok) throw new Error(result.error);
    expect(result.document.variableMarks.density).toEqual([false, false, false, false, false, false]);
    expect(result.document.project.midiAssignments.programBase).toBe(1);
  });

  it("repairs every field to something legal", () => {
    const result = decodeDocument(garbage());
    if (!result.ok) throw new Error(result.error);
    const d = result.document;

    expect(d.project.tempo).toBeGreaterThan(0);
    expect(d.project.root).toBe(0);
    expect(d.project.seed).toEqual(expect.any(Number));
    expect(d.project.voices).toHaveLength(4);
    expect(d.project.voices[3].timeDistort.points).toEqual([]);
    expect(d.project.voices[3].outputChannels.length).toBeGreaterThan(0);
    expect(d.project.patterns[1].chordMode).toBe("single");
    expect(d.project.patterns[1].insertMode).toBe("insert");
    expect(typeof d.project.patterns[1].id).toBe("string");
    expect(d.project.patterns[1].scrambleGeneration).toBe(0);

    expect(d.positions.density.active).toBe(0);
    expect(d.positions.density.slots).toHaveLength(6);
    expect(d.snapshots.every((s) => s === null)).toBe(true);
    expect(d.arrows.good).toEqual({ on: true, dir: "right" });
    expect(d.arrows.bad).toBeUndefined();

    expect(d.tempoRange.high).toBeGreaterThanOrEqual(d.tempoRange.low);
    expect(d.robotRange).toEqual({ x: 0.15, y: 0.15 });
    expect(d.syncRatio).toBe(4);
    expect(d.robotTimeBase).toBe(4);
    expect(d.syncRatioDirection).toBe("out");
    expect(d.selectedVoice).toBeLessThan(4);
    expect(d.activeCyclicPositions).toEqual({ accent: 0, legato: 0, rhythm: 0 });
  });

  it("keeps every Cyclic bank fully shaped whatever the file held", () => {
    const result = decodeDocument(garbage());
    if (!result.ok) throw new Error(result.error);
    for (const kind of KINDS) {
      expect(result.document.cyclicPositions[kind]).toHaveLength(6);
      expect(result.document.cyclicLengths[kind]).toHaveLength(6);
      for (const position of result.document.cyclicPositions[kind]) {
        expect(position).toHaveLength(4);
      }
      for (const position of result.document.cyclicLengths[kind]) {
        expect(position).toHaveLength(4);
        for (const length of position) {
          expect(length).toBeGreaterThanOrEqual(1);
          expect(length).toBeLessThanOrEqual(16);
        }
      }
    }
  });

  it("clamps a random level range into 0..4 and keeps it ordered", () => {
    const result = decodeDocument(garbage());
    if (!result.ok) throw new Error(result.error);
    const step = result.document.cyclicPositions.accent[0][0][0];
    expect(step).toEqual({ min: 4, max: 4 });
  });

  it("keeps a Voice's velocity range ordered even when the file inverts it", () => {
    const raw = encodeDocument(source());
    raw.project.voices[0].velocityRange = { low: 100, high: 3 };
    const result = decodeDocument(raw);
    if (!result.ok) throw new Error(result.error);
    const range = result.document.project.voices[0].velocityRange;
    expect(range.high).toBeGreaterThanOrEqual(range.low);
  });

  it("clamps note pitches into the MIDI range", () => {
    const raw = encodeDocument(source());
    raw.project.patterns[0].steps[0] = { pitches: [-40, 900] };
    const result = decodeDocument(raw);
    if (!result.ok) throw new Error(result.error);
    expect(result.document.project.patterns[0].steps[0].pitches).toEqual([0, 127]);
  });

  it("drops de-duplicated output channels and clamps them to 1..16", () => {
    const raw = encodeDocument(source());
    raw.project.voices[0].outputChannels = [1, 1, 99, -5];
    const result = decodeDocument(raw);
    if (!result.ok) throw new Error(result.error);
    expect(result.document.project.voices[0].outputChannels).toEqual([1, 16]);
  });

  it("falls back to a neutral map when Time Distortion points are unusable", () => {
    const raw = encodeDocument(source());
    raw.project.voices[1].timeDistort = {
      points: "no", length: 0, denominator: 5,
    } as never;
    const result = decodeDocument(raw);
    if (!result.ok) throw new Error(result.error);
    expect(result.document.project.voices[1].timeDistort).toEqual({
      points: [], length: 1, denominator: 4,
    });
  });
})

describe("structurally broken pieces the decoder must still handle", () => {
  it("rejects a Pattern that isn't an object at all", () => {
    const raw = encodeDocument(source());
    (raw.project.patterns as unknown[])[0] = null;
    expect(decodeDocument(raw).ok).toBe(false);
  });

  it("defaults the whole Cyclic section when the project omits it", () => {
    const raw = encodeDocument(source());
    const project = raw.project as unknown as Record<string, unknown>;
    delete project.cyclic;
    delete project.cyclicLengths;
    delete project.cyclicValues;
    const result = decodeDocument(raw);
    if (!result.ok) throw new Error(result.error);
    for (const kind of KINDS) {
      expect(result.document.project.cyclic[kind]).toHaveLength(4);
      expect(result.document.project.cyclicLengths[kind].length).toBeGreaterThan(0);
    }
    expect(result.document.project.cyclicValues.legato.length).toBeGreaterThan(0);
    expect(result.document.project.cyclicValues.rhythm.length).toBeGreaterThan(0);
  });

  it("defaults the Cyclic Position lengths when the document omits them", () => {
    const raw = encodeDocument(source()) as unknown as Record<string, unknown>;
    delete raw.cyclicLengths;
    const result = decodeDocument(raw);
    if (!result.ok) throw new Error(result.error);
    for (const kind of KINDS) {
      expect(result.document.cyclicLengths[kind]).toHaveLength(6);
      expect(result.document.cyclicLengths[kind][0]).toEqual([16, 16, 16, 16]);
    }
  });
})

describe("the Options menu travels with the document", () => {
  it("round-trips every option", () => {
    const options = setOption(
      setOption(DEFAULT_OPTIONS, "useMetronome", true),
      "slideshowRecordWait",
      false,
    );
    const back = roundTrip(source({ options }));
    expect(back.options.useMetronome).toBe(true);
    expect(back.options.slideshowRecordWait).toBe(false);
    expect(back.options.noZoomRects).toBe(false);
  });

  it("defaults the whole set when a v1 file predates it", () => {
    // Documents saved before Options existed simply have no such key, and must
    // still open rather than being rejected.
    const raw = JSON.parse(JSON.stringify(encodeDocument(source()))) as Record<string, unknown>;
    delete raw.options;
    const result = decodeDocument(raw);
    if (!result.ok) throw new Error(result.error);
    expect(result.document.options).toEqual(DEFAULT_OPTIONS);
  });

  it("repairs an options bag that is the wrong shape", () => {
    const raw = JSON.parse(JSON.stringify(encodeDocument(source()))) as Record<string, unknown>;
    raw.options = "not an object";
    const result = decodeDocument(raw);
    if (!result.ok) throw new Error(result.error);
    expect(result.document.options).toEqual(DEFAULT_OPTIONS);
    expect(result.warnings.join(" ")).toMatch(/option/i);
  });

  it("keeps the good keys and defaults the bad ones", () => {
    const raw = JSON.parse(JSON.stringify(encodeDocument(source()))) as Record<string, unknown>;
    raw.options = { useMetronome: true, noZoomRects: "yes", bogus: true };
    const result = decodeDocument(raw);
    if (!result.ok) throw new Error(result.error);
    expect(result.document.options.useMetronome).toBe(true);
    expect(result.document.options.noZoomRects).toBe(false);
    expect("bogus" in result.document.options).toBe(false);
  });
})
