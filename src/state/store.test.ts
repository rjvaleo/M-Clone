import { describe, it, expect, beforeEach } from "vitest";
import { useM, SNAPSHOT_COUNT, MAX_PATTERN_STEPS } from "./store";
import { createDefaultProject } from "../engine/project";
import { makeDefaultPositions } from "../engine/variables";
import type { CyclicPositionBanks, CyclicPositionLengths } from "../engine/types";
import {
  originalToScrambled,
  swapScrambledAndOriginal,
} from "../engine/patterncmd";
import { DEFAULT_OPTIONS } from "../engine/options";

beforeEach(() => {
  const project = createDefaultProject();
  const cyclicPositions = Object.fromEntries(
    (["accent", "legato", "rhythm"] as const).map((kind) => [
      kind,
      Array.from({ length: 6 }, () => project.cyclic[kind].map((voice) => [...voice])),
    ]),
  ) as CyclicPositionBanks;
  const cyclicLengths = Object.fromEntries(
    (["accent", "legato", "rhythm"] as const).map((kind) => [
      kind, Array.from({ length: 6 }, () => Array(4).fill(16)),
    ]),
  ) as CyclicPositionLengths;
  useM.setState({
    project,
    positions: makeDefaultPositions(project.voices),
    snapshots: Array(SNAPSHOT_COUNT).fill(null),
    selectedVoice: 0,
    isPlaying: false,
    editingVar: null,
    midiConduct: false,
    robotConductor: false,
    isPaused: false,
    baton: { x: 0.5, y: 0.5 },
    tempoRange: { low: 80, high: 160 },
    syncRatio: 4,
    syncRatioDirection: "out",
    robotRange: { x: 0.15, y: 0.15 },
    robotTimeBase: 4,
    currentSnapshot: null,
    restorePoint: null,
    snapshotQuantize: 0,
    arrows: {},
    patternGroup: 0,
    clipboard: [],
    cyclicPositions,
    cyclicLengths,
    activeCyclicPositions: { accent: 0, legato: 0, rhythm: 0 },
    midiViewEvents: [],
    midiViewNextId: 0,
    options: { ...DEFAULT_OPTIONS },
    editorRegion: null,
    snapshotMode: "idle",
    snapshotDraft: null,
    slideshows: Array.from({ length: 9 }, () => ({ events: [], loopAtSec: null })),
    slideshowTransport: {
      mode: "idle", slot: null, waiting: false, paused: false,
      startedAtSec: 0, pausedAtSec: null, cursor: 0,
    },
  });
});

const g = () => useM.getState();

describe("transport + selection", () => {
  it("sets tempo", () => {
    g().setTempo(140);
    expect(g().project.tempo).toBe(140);
  });
  it("sets playing flag", () => {
    g().setPlaying(true);
    expect(g().isPlaying).toBe(true);
  });
  it("selects a voice", () => {
    g().selectVoice(2);
    expect(g().selectedVoice).toBe(2);
  });
});

describe("Midi View", () => {
  it("records actual planned notes as bounded MIDI messages and clears them", () => {
    g().recordMidiNotes([{
      voice: 3, note: 69, velocity: 110, channel: 4,
      startSec: 4, durationSec: 0.25,
    }]);
    expect(g().midiViewEvents.map((event) => event.type)).toEqual(["note-on", "note-off"]);
    expect(g().midiViewEvents[0]).toMatchObject({ voice: 3, noteName: "A4", channel: 4 });
    g().clearMidiView();
    expect(g().midiViewEvents).toEqual([]);
  });
});

describe("voice edits", () => {
  it("toggles the targeted voice only", () => {
    const before = g().project.voices[1].playEnabled;
    g().toggleVoiceEnabled(1);
    expect(g().project.voices[1].playEnabled).toBe(!before);
    // voice 0 untouched (exercises the non-matching branch)
    expect(g().project.voices[0].playEnabled).toBe(
      createDefaultProject().voices[0].playEnabled,
    );
  });
  it("sets a voice parameter", () => {
    g().setVoiceParam(0, "density", 0.5);
    expect(g().project.voices[0].density).toBe(0.5);
    expect(g().project.voices[1].density).toBe(1); // others unchanged
  });
  it("syncs a position-variable edit into the active slot", () => {
    g().setVoiceParam(0, "density", 0.3);
    const { active, slots } = g().positions.density;
    expect(slots[active][0]).toBe(0.3);
  });
  it("does not touch positions for a non-position parameter", () => {
    const before = g().positions;
    g().setVoiceParam(0, "channel", 9);
    expect(g().positions).toBe(before);
  });
  it("sets transposition", () => {
    g().setVoiceParam(2, "transposition", 7);
    expect(g().project.voices[2].transposition).toBe(7);
  });
  it("sets a note-order mix and syncs it to the active position", () => {
    const mix = { original: 45, cyclic: 35, utterly: 20 };
    g().setVoiceParam(0, "noteOrderMix", mix);
    expect(g().project.voices[0].noteOrderMix).toEqual(mix);
    expect(g().positions.noteOrderMix.slots[0][0]).toEqual(mix);
  });
  it("sets Orchestration routing and syncs it to the active position", () => {
    g().setVoiceParam(1, "outputChannels", [2, 6, 10]);
    expect(g().project.voices[1].outputChannels).toEqual([2, 6, 10]);
    expect(g().positions.outputChannels.slots[0][1]).toEqual([2, 6, 10]);
  });
});

describe("pattern step editing", () => {
  it("adds a pitch to an empty step", () => {
    g().toggleStepPitch(1, 3, 60);
    expect(g().project.patterns[1].steps[3].pitches).toEqual([60]);
  });
  it("removes a pitch that is already present", () => {
    g().toggleStepPitch(1, 3, 60);
    g().toggleStepPitch(1, 3, 60);
    expect(g().project.patterns[1].steps[3].pitches).toEqual([]);
  });
  it("keeps chord pitches sorted", () => {
    g().toggleStepPitch(1, 3, 67);
    g().toggleStepPitch(1, 3, 60);
    g().toggleStepPitch(1, 3, 64);
    expect(g().project.patterns[1].steps[3].pitches).toEqual([60, 64, 67]);
  });
  it("does not touch other patterns or steps", () => {
    g().toggleStepPitch(1, 3, 60);
    expect(g().project.patterns[0].steps[3].pitches).not.toContain(60);
    expect(g().project.patterns[1].steps[4].pitches).toEqual([]);
  });
});

describe("paintStep (paint + auto-extend length)", () => {
  it("paints a note on within range", () => {
    g().paintStep(0, 2, 60, true);
    expect(g().project.patterns[0].steps[2].pitches).toContain(60);
  });
  it("paints a note off", () => {
    g().paintStep(0, 2, 60, true);
    g().paintStep(0, 2, 60, false);
    expect(g().project.patterns[0].steps[2].pitches).not.toContain(60);
  });
  it("extends the pattern and length to the last painted step", () => {
    g().setOutputLength(1, 8); // pattern 1 starts empty
    g().paintStep(1, 20, 64, true); // position 21 (0-indexed 20)
    expect(g().project.patterns[1].steps.length).toBeGreaterThanOrEqual(21);
    expect(g().project.patterns[1].steps[20].pitches).toContain(64);
    expect(g().project.patterns[1].outputLength).toBe(21);
  });
  it("does not shrink when the furthest note is erased — extension remains", () => {
    g().paintStep(1, 20, 64, true); // length 21
    g().paintStep(1, 20, 64, false); // erase furthest → length stays 21
    expect(g().project.patterns[1].outputLength).toBe(21);
  });
  it("grows only when painting beyond the current length", () => {
    g().setOutputLength(1, 10);
    g().paintStep(1, 3, 60, true); // inside → unchanged
    expect(g().project.patterns[1].outputLength).toBe(10);
    g().paintStep(1, 15, 60, true); // beyond → grows to 16
    expect(g().project.patterns[1].outputLength).toBe(16);
  });
  it("painting the same pitch twice is idempotent", () => {
    g().paintStep(1, 2, 60, true);
    g().paintStep(1, 2, 60, true);
    expect(g().project.patterns[1].steps[2].pitches).toEqual([60]);
  });
  it("erasing past the end is a no-op", () => {
    const before = g().project.patterns[0].steps.length;
    g().paintStep(0, 40, 60, false);
    expect(g().project.patterns[0].steps.length).toBe(before);
  });
  it("ignores steps past the pattern's size numerical", () => {
    g().setPatternMaxSize(0, 40);
    g().paintStep(0, 100, 60, true);
    expect(g().project.patterns[0].steps.length).toBeLessThanOrEqual(40);
  });
  it("allows a pattern to grow toward the 999-step ceiling", () => {
    g().setPatternMaxSize(0, MAX_PATTERN_STEPS);
    g().paintStep(0, 500, 60, true);
    expect(g().project.patterns[0].steps.length).toBe(501);
  });
  it("ignores negative step indices", () => {
    const before = g().project.patterns[0].steps.length;
    g().paintStep(0, -1, 60, true);
    expect(g().project.patterns[0].steps.length).toBe(before);
  });
  it("does not touch other patterns", () => {
    g().paintStep(0, 30, 60, true);
    expect(g().project.patterns[1].steps.length).toBe(
      createDefaultProject().patterns[1].steps.length,
    );
  });
});

describe("output length", () => {
  it("sets a pattern's output length", () => {
    g().setOutputLength(0, 5);
    expect(g().project.patterns[0].outputLength).toBe(5);
  });
  it("clamps below 0", () => {
    g().setOutputLength(0, -3);
    expect(g().project.patterns[0].outputLength).toBe(0);
  });
  it("clamps above the step count", () => {
    const len = g().project.patterns[0].steps.length;
    g().setOutputLength(0, len + 10);
    expect(g().project.patterns[0].outputLength).toBe(len);
  });
  it("leaves other patterns untouched", () => {
    const before = g().project.patterns[1].outputLength;
    g().setOutputLength(0, 2);
    expect(g().project.patterns[1].outputLength).toBe(before);
  });
});

describe("pattern size numerical", () => {
  it("sets the maximum size", () => {
    g().setPatternMaxSize(0, 48);
    expect(g().project.patterns[0].maxSize).toBe(48);
  });
  it("refuses to drop below the steps the pattern already holds", () => {
    const len = g().project.patterns[0].steps.length;
    g().setPatternMaxSize(0, 2);
    expect(g().project.patterns[0].maxSize).toBe(len);
  });
  it("clamps to the hard ceiling", () => {
    g().setPatternMaxSize(0, MAX_PATTERN_STEPS + 500);
    expect(g().project.patterns[0].maxSize).toBe(MAX_PATTERN_STEPS);
  });
  it("treats a blank numerical as zero rather than NaN", () => {
    g().setPatternMaxSize(0, NaN);
    expect(g().project.patterns[0].maxSize).toBe(g().project.patterns[0].steps.length);
  });
  it("leaves other patterns untouched", () => {
    const before = g().project.patterns[1].maxSize;
    g().setPatternMaxSize(0, 40);
    expect(g().project.patterns[1].maxSize).toBe(before);
  });
  it("stops paintStep at the size ceiling", () => {
    g().setPatternMaxSize(0, 20);
    g().paintStep(0, 25, 60, true);
    expect(g().project.patterns[0].steps.length).toBeLessThanOrEqual(20);
  });
});

describe("record modes", () => {
  it("cycles the chord mode", () => {
    g().setPatternMode(0, "chordMode", "chord");
    expect(g().project.patterns[0].chordMode).toBe("chord");
  });
  it("sets the insertion mode", () => {
    g().setPatternMode(0, "insertMode", "overdub");
    expect(g().project.patterns[0].insertMode).toBe("overdub");
  });
  it("toggles drum machine record", () => {
    g().setPatternMode(0, "drumMachine", true);
    expect(g().project.patterns[0].drumMachine).toBe(true);
  });
  it("leaves other patterns untouched", () => {
    g().setPatternMode(0, "chordMode", "build");
    expect(g().project.patterns[1].chordMode).toBe("single");
  });
});

describe("region editing tools", () => {
  it("the Eraser rests a region without changing the length", () => {
    const before = g().project.patterns[0].steps.length;
    g().eraseRegion(0, 1, 3);
    const p = g().project.patterns[0];
    expect(p.steps.length).toBe(before);
    expect(p.steps.slice(1, 4).every((s) => s.pitches.length === 0)).toBe(true);
    expect(p.steps[0].pitches).toEqual([60]);
    expect(p.steps[4].pitches).toEqual([67]);
  });
  it("the Eraser leaves other patterns untouched", () => {
    const before = g().project.patterns[1].steps;
    g().eraseRegion(0, 0, 2);
    expect(g().project.patterns[1].steps).toBe(before);
  });

  it("the Plunger inserts blank steps ahead of the click", () => {
    const before = g().project.patterns[0];
    g().insertSteps(0, 2, 3);
    const p = g().project.patterns[0];
    expect(p.steps.length).toBe(before.steps.length + 3);
    expect(p.outputLength).toBe(before.outputLength + 3);
    expect(p.steps.slice(2, 5).every((s) => s.pitches.length === 0)).toBe(true);
    expect(p.steps[5].pitches).toEqual([64]); // what used to sit at step 2
  });
  it("the Plunger never pushes past the size numerical", () => {
    g().setPatternMaxSize(0, g().project.patterns[0].steps.length + 1);
    g().insertSteps(0, 0, 10);
    expect(g().project.patterns[0].steps.length).toBe(g().project.patterns[0].maxSize);
  });
  it("the Plunger is a no-op with no room left", () => {
    g().setPatternMaxSize(0, g().project.patterns[0].steps.length);
    const before = g().project.patterns[0];
    g().insertSteps(0, 0, 4);
    expect(g().project.patterns[0]).toBe(before);
  });
  it("the Plunger leaves other patterns untouched", () => {
    const before = g().project.patterns[1];
    g().insertSteps(0, 0, 1);
    expect(g().project.patterns[1]).toBe(before);
  });

  it("the Scissors cut steps out and shorten the pattern", () => {
    const before = g().project.patterns[0];
    g().deleteRegion(0, 1, 2);
    const p = g().project.patterns[0];
    expect(p.steps.length).toBe(before.steps.length - 2);
    expect(p.outputLength).toBe(before.outputLength - 2);
    expect(p.steps[0].pitches).toEqual([60]);
    expect(p.steps[1].pitches).toEqual([65]); // step 3 closed up
  });
  it("the Scissors clamp the output length at zero", () => {
    g().setOutputLength(0, 1);
    g().deleteRegion(0, 0, 5);
    expect(g().project.patterns[0].outputLength).toBe(0);
  });
  it("the Scissors are a no-op when the region misses the pattern", () => {
    const before = g().project.patterns[0];
    g().deleteRegion(0, 500, 520);
    expect(g().project.patterns[0]).toBe(before);
  });
  it("the Scissors leave other patterns untouched", () => {
    const before = g().project.patterns[1];
    g().deleteRegion(0, 0, 1);
    expect(g().project.patterns[1]).toBe(before);
  });
});

describe("Pattern and Edit menu commands", () => {
  it("runs a command over the pattern's steps", () => {
    g().runPatternCommand(0, (steps) =>
      steps.map((s) => ({ pitches: s.pitches.map((p) => p + 12) })));
    expect(g().project.patterns[0].steps[0].pitches).toEqual([72]);
  });

  it("pulls Output Length back when a command shortens the pattern", () => {
    g().setOutputLength(0, 8);
    g().runPatternCommand(0, (steps) => steps.slice(0, 3));
    expect(g().project.patterns[0].outputLength).toBe(3);
  });

  it("leaves Output Length alone when the pattern grows", () => {
    g().setOutputLength(0, 8);
    const before = g().project.patterns[0].outputLength;
    g().runPatternCommand(0, (steps) => [...steps, { pitches: [] }]);
    expect(g().project.patterns[0].outputLength).toBe(before);
  });

  it("leaves other patterns untouched", () => {
    const before = g().project.patterns[1];
    g().runPatternCommand(0, (steps) => steps.slice(0, 1));
    expect(g().project.patterns[1]).toBe(before);
  });

  it("holds copied steps on the clipboard, detached from the pattern", () => {
    const steps = g().project.patterns[0].steps;
    g().setClipboard(steps);
    g().clipboard[0].pitches.push(99);
    expect(g().project.patterns[0].steps[0].pitches).not.toContain(99);
  });

  it("starts with an empty clipboard", () => {
    expect(g().clipboard).toEqual([]);
  });

  const material = (steps: { pitches: number[] }[]) =>
    steps.map((step) => [...step.pitches].sort((a, b) => a - b).join(",")).sort();

  const expectCoherentScramble = (patternIndex: number, generation: number) => {
    const p = g().project.patterns[patternIndex];
    expect(p.scrambledSteps).toHaveLength(p.steps.length);
    expect(material(p.scrambledSteps)).toEqual(material(p.steps));
    expect(p.scrambleGeneration).toBe(generation);
  };

  // The manual says a reordering operation occurs whenever material is edited
  // or recorded into a Pattern. Each store editing route must therefore keep
  // the stored copy structurally coherent.
  it("regenerates Scrambled after every ordinary Pattern editing route", () => {
    let generation = g().project.patterns[0].scrambleGeneration;

    g().toggleStepPitch(0, 0, 61);
    expectCoherentScramble(0, ++generation);

    g().paintStep(0, 20, 80, true);
    expectCoherentScramble(0, ++generation);

    g().eraseRegion(0, 0, 1);
    expectCoherentScramble(0, ++generation);

    g().insertSteps(0, 2, 1);
    expectCoherentScramble(0, ++generation);

    g().deleteRegion(0, 2, 2);
    expectCoherentScramble(0, ++generation);

    g().runPatternCommand(0, (steps) =>
      steps.map((step) => ({ pitches: step.pitches.map((pitch) => pitch + 1) })));
    expectCoherentScramble(0, ++generation);
  });

  it("runs a Pattern-level Cyclic Random command without overwriting its result", () => {
    g().runPatternDocumentCommand(0, (pattern) =>
      originalToScrambled(pattern, null));
    const copied = g().project.patterns[0];
    expect(copied.scrambledSteps).toEqual(copied.steps);

    const beforeOriginal = copied.steps.map((step) => ({ pitches: [...step.pitches] }));
    const beforeScrambled = copied.scrambledSteps.map((step, index) => ({
      pitches: [90 + index, ...step.pitches],
    }));
    useM.setState((state) => ({
      project: {
        ...state.project,
        patterns: state.project.patterns.map((pattern, index) =>
          index === 0 ? { ...pattern, scrambledSteps: beforeScrambled } : pattern),
      },
    }));
    g().runPatternDocumentCommand(0, (pattern) =>
      swapScrambledAndOriginal(pattern, { from: 0, to: 1 }));
    expect(g().project.patterns[0].steps.slice(0, 2)).toEqual(beforeScrambled.slice(0, 2));
    expect(g().project.patterns[0].scrambledSteps.slice(0, 2))
      .toEqual(beforeOriginal.slice(0, 2));
  });
});

describe("key / scale", () => {
  it("toggles scale snap", () => {
    g().setScaleSnap(true);
    expect(g().project.scaleSnap).toBe(true);
  });
  it("sets the scale", () => {
    g().setScale("dorian");
    expect(g().project.scale).toBe("dorian");
  });
  it("sets the root", () => {
    g().setRoot(5);
    expect(g().project.root).toBe(5);
  });
  it("sets the seed", () => {
    g().setSeed(99);
    expect(g().project.seed).toBe(99);
  });
  it("toggles the harmonic options", () => {
    g().setDiatonicTranspose(true);
    g().setSecondOrderTranspose(true);
    g().setChordTones(true);
    expect(g().project.diatonicTranspose).toBe(true);
    expect(g().project.secondOrderTranspose).toBe(true);
    expect(g().project.chordTones).toBe(true);
  });
});

describe("variable positions", () => {
  it("activates a position and applies its values to voices", () => {
    // edit position 2's transposition for voice 0, then activate it
    g().setSlotValue("transposition", 2, 0, 7);
    g().activatePosition("transposition", 2);
    expect(g().positions.transposition.active).toBe(2);
    expect(g().project.voices[0].transposition).toBe(7);
  });
  it("editing the active position applies live", () => {
    // default active is 0
    g().setSlotValue("velocityRange", 0, 1, { low: 55, high: 105 });
    expect(g().project.voices[1].velocityRange).toEqual({ low: 55, high: 105 });
  });
  it("editing a non-active position does not change voices", () => {
    const before = g().project.voices[0].transposition;
    g().setSlotValue("transposition", 4, 0, 11);
    expect(g().project.voices[0].transposition).toBe(before);
    expect(g().positions.transposition.slots[4][0]).toBe(11);
  });
  it("opens and closes the editor", () => {
    g().openEditor("noteOrderMix");
    expect(g().editingVar).toBe("noteOrderMix");
    g().closeEditor();
    expect(g().editingVar).toBe(null);
  });
});

describe("snapshots", () => {
  // "These are 26 locations for storing screen control combinations."
  it("provides 26 locations", () => {
    expect(g().snapshots).toHaveLength(26);
    expect(SNAPSHOT_COUNT).toBe(26);
  });

  it("starts with every location empty and no current snapshot", () => {
    expect(g().snapshots.every((s) => s === null)).toBe(true);
    expect(g().currentSnapshot).toBe(null);
  });

  it("stores the active Variable Positions, not their contents", () => {
    g().activatePosition("transposition", 2);
    g().storeSnapshot(0);
    // Change what lives at position 2 after storing.
    g().setSlotValue("transposition", 2, 0, 11);
    g().activatePosition("transposition", 0);
    g().recallSnapshot(0);
    // The snapshot returns us to position 2, and position 2 now holds 11.
    expect(g().positions.transposition.active).toBe(2);
    expect(g().project.voices[0].transposition).toBe(11);
  });

  it("restores Play-Enable and Time Base", () => {
    g().setVoiceParam(1, "timeBaseDenominator", 16);
    g().toggleVoiceEnabled(2);
    const enabled = g().project.voices[2].playEnabled;
    g().storeSnapshot(3);
    g().setVoiceParam(1, "timeBaseDenominator", 4);
    g().toggleVoiceEnabled(2);
    g().recallSnapshot(3);
    expect(g().project.voices[1].timeBaseDenominator).toBe(16);
    expect(g().project.voices[2].playEnabled).toBe(enabled);
  });

  it("restores the Conducting Arrows", () => {
    g().setArrow("density", { on: true, dir: "down" });
    g().storeSnapshot(4);
    g().setArrow("density", { on: false, dir: "right" });
    g().recallSnapshot(4);
    expect(g().arrows.density).toEqual({ on: true, dir: "down" });
  });

  it("restores the Pattern Group", () => {
    g().setPatternGroup(3);
    g().storeSnapshot(5);
    g().setPatternGroup(0);
    g().recallSnapshot(5);
    expect(g().patternGroup).toBe(3);
  });

  // "This is depicted by a black mark in the sun of an existing Snapshot
  //  display. It is changed whenever you store or execute a Snapshot."
  it("marks the current snapshot when storing", () => {
    g().storeSnapshot(7);
    expect(g().currentSnapshot).toBe(7);
  });

  it("marks the current snapshot when executing", () => {
    g().storeSnapshot(7);
    g().storeSnapshot(9);
    g().recallSnapshot(7);
    expect(g().currentSnapshot).toBe(7);
  });

  it("recalling an empty location is a no-op", () => {
    g().storeSnapshot(1);
    g().recallSnapshot(20); // never stored
    expect(g().currentSnapshot).toBe(1);
  });

  it("ignores locations outside A-Z", () => {
    g().storeSnapshot(99);
    g().storeSnapshot(-1);
    expect(g().snapshots.every((s) => s === null)).toBe(true);
    expect(g().currentSnapshot).toBe(null);
  });

  it("ignores recalling or erasing outside A-Z", () => {
    g().storeSnapshot(1);
    g().recallSnapshot(99);
    g().recallSnapshot(-1);
    g().eraseSnapshot(99);
    g().eraseSnapshot(-1);
    expect(g().currentSnapshot).toBe(1);
    expect(g().snapshots[1]).not.toBe(null);
  });

  it("leaves a Variable alone when an older snapshot has no entry for it", () => {
    // A snapshot stored before a Variable existed shouldn't reset it.
    g().activatePosition("timeDistort", 3);
    g().storeSnapshot(0);
    const snap = g().snapshots[0]!;
    delete (snap.actives as Record<string, number>).timeDistort;
    g().activatePosition("timeDistort", 1);
    g().recallSnapshot(0);
    expect(g().positions.timeDistort.active).toBe(1);
  });

  // Erase Snapshot, from the Edit menu.
  it("erases a location and clears the current mark if it pointed there", () => {
    g().storeSnapshot(2);
    g().eraseSnapshot(2);
    expect(g().snapshots[2]).toBe(null);
    expect(g().currentSnapshot).toBe(null);
  });

  it("leaves the current mark alone when erasing a different location", () => {
    g().storeSnapshot(2);
    g().storeSnapshot(3);
    g().eraseSnapshot(2);
    expect(g().currentSnapshot).toBe(3);
  });
});

describe("Hold/Do and Edit Snapshot", () => {
  it("holds a Variable Position change until Do applies it", () => {
    const before = g().positions.transposition.active;
    g().beginHold();
    g().activatePosition("transposition", 3);
    expect(g().positions.transposition.active).toBe(before);
    expect(g().snapshotDraft?.actives.transposition).toBe(3);
    g().doHold();
    expect(g().positions.transposition.active).toBe(3);
    expect(g().snapshotMode).toBe("idle");
  });

  it("stores only controls selected during Hold", () => {
    g().beginHold();
    g().activatePosition("transposition", 2);
    g().storeSnapshot(0);
    g().activatePosition("density", 4);
    g().recallSnapshot(0);
    expect(g().positions.transposition.active).toBe(2);
    expect(g().positions.density.active).toBe(4);
  });

  it("Edit Snapshot toggles membership and can copy to another location", () => {
    g().blinkEverything();
    g().storeSnapshot(0);
    g().editCurrentSnapshot();
    g().activatePosition("density", 2); // selected control: remove it
    g().storeSnapshot(1);
    expect(g().snapshots[1]?.included?.actives).not.toContain("density");
    expect(g().snapshots[0]).not.toBe(g().snapshots[1]);
  });

  it("Hold/Do cancels Edit Snapshot without changing the stored Snapshot", () => {
    g().blinkEverything();
    g().storeSnapshot(0);
    const before = g().snapshots[0];
    g().editCurrentSnapshot();
    g().activatePosition("density", 2);
    g().doHold();
    expect(g().snapshotMode).toBe("idle");
    expect(g().snapshots[0]).toBe(before);
  });

  it("holds and edits Play Enable, Output Length, arrows, and Pattern Group", () => {
    const enabled = g().project.voices[0].playEnabled;
    const length = g().project.patterns[0].outputLength;
    g().beginHold();
    g().toggleVoiceEnabled(0);
    g().setVoiceParam(0, "timeBaseNumerator", 3);
    g().setVoiceParam(0, "timeBaseDenominator", 16);
    g().setOutputLength(0, length - 1);
    g().setArrow("density", { on: true, dir: "left" });
    g().setPatternGroup(4);
    expect(g().project.voices[0].playEnabled).toBe(enabled);
    expect(g().project.patterns[0].outputLength).toBe(length);
    expect(g().project.voices[0].timeBaseNumerator).toBe(1);
    expect(g().project.voices[0].timeBaseDenominator).toBe(8);
    g().doHold();
    expect(g().project.voices[0].playEnabled).toBe(!enabled);
    expect(g().project.patterns[0].outputLength).toBe(length - 1);
    expect(g().project.voices[0].timeBaseNumerator).toBe(3);
    expect(g().project.voices[0].timeBaseDenominator).toBe(16);
    expect(g().arrows.density).toEqual({ on: true, dir: "left" });
    expect(g().patternGroup).toBe(4);

    g().blinkEverything();
    g().storeSnapshot(0);
    g().editCurrentSnapshot();
    g().toggleVoiceEnabled(0);
    g().setVoiceParam(0, "timeBaseDenominator", 4);
    g().setOutputLength(0, length);
    g().setArrow("density", { on: false, dir: "right" });
    g().setPatternGroup(2);
    expect(g().snapshotDraft?.included?.playEnabled).not.toContain(0);
    expect(g().snapshotDraft?.included?.timeBase).not.toContain(0);
    expect(g().snapshotDraft?.included?.outputLength).not.toContain(0);
    expect(g().snapshotDraft?.included?.arrows).not.toContain("density");
    expect(g().snapshotDraft?.included?.patternGroup).toBe(false);
  });

  it("ignores Do and Edit when no draft/current Snapshot exists", () => {
    g().doHold();
    g().editCurrentSnapshot();
    expect(g().snapshotMode).toBe("idle");
  });

  it("turns a legacy whole-screen Snapshot into an editable membership list", () => {
    g().storeSnapshot(0);
    expect(g().snapshots[0]?.included).toBeUndefined();
    g().editCurrentSnapshot();
    expect(g().snapshotDraft?.included?.actives).toHaveLength(6);
  });

  it("leaves Cyclic Positions unchanged when an older Snapshot lacks them", () => {
    g().storeSnapshot(0);
    delete g().snapshots[0]!.cyclicActives;
    g().activateCyclicPosition("legato", 4);
    g().recallSnapshot(0);
    expect(g().activeCyclicPositions.legato).toBe(4);
  });

  it("Edit Snapshot can add a control that was not previously included", () => {
    g().beginHold();
    g().activatePosition("transposition", 2);
    g().storeSnapshot(0);
    g().editCurrentSnapshot();
    g().activatePosition("density", 3);
    expect(g().snapshotDraft?.included?.actives).toContain("density");
  });

  it("normalizes sparse partial Snapshots before editing", () => {
    g().beginHold();
    g().activatePosition("transposition", 2);
    g().storeSnapshot(0);
    g().snapshots[0]!.included = {};
    g().editCurrentSnapshot();
    expect(g().snapshotDraft?.included).toMatchObject({
      cyclicActives: [], arrows: [], playEnabled: [], timeBase: [], outputLength: [], patternGroup: false,
    });
  });
});

describe("Slideshows", () => {
  it("records executed Snapshots with Record Wait timing", () => {
    g().storeSnapshot(0);
    g().storeSnapshot(1);
    g().recordSlideshow(2, 10);
    g().recallSnapshot(0, 14);
    g().recallSnapshot(1, 15.5);
    g().stopSlideshow(16);
    expect(g().slideshows[2].events).toEqual([
      { atSec: 0, action: { type: "snapshot", index: 0 } },
      { atSec: 1.5, action: { type: "snapshot", index: 1 } },
    ]);
  });

  it("plays recorded actions and stops at the end", () => {
    g().storeSnapshot(0);
    g().activatePosition("transposition", 3);
    g().storeSnapshot(1);
    useM.setState({
      isPlaying: true,
      slideshows: [{
        events: [{ atSec: 0, action: { type: "snapshot", index: 1 } }],
        loopAtSec: null,
      }, ...g().slideshows.slice(1)],
    });
    g().playSlideshow(0, 20, 0);
    g().advanceSlideshow(20);
    expect(g().positions.transposition.active).toBe(3);
    expect(g().slideshowTransport.mode).toBe("idle");
  });

  it("executes a recorded Position action", () => {
    useM.setState({
      isPlaying: true,
      slideshows: [{ events: [{ atSec: 0, action: { type: "position", variable: "density", position: 3 } }], loopAtSec: null }, ...g().slideshows.slice(1)],
    });
    g().playSlideshow(0, 2);
    g().advanceSlideshow(2);
    expect(g().positions.density.active).toBe(3);
  });

  it("records Position changes and supports transport controls", () => {
    g().recordSlideshow(0, 0);
    g().activatePosition("density", 2);
    expect(g().slideshows[0].events[0].action).toEqual({
      type: "position", variable: "density", position: 2,
    });
    g().pauseSlideshow(1);
    expect(g().slideshowTransport.paused).toBe(true);
    g().pauseSlideshow(2);
    expect(g().slideshowTransport.paused).toBe(false);
    g().toggleSlideshowLoop(3);
    expect(g().slideshows[0].loopAtSec).not.toBe(null);
    expect(g().slideshowTransport.mode).toBe("idle");
  });

  it("records and plays Cyclic Variable Position changes", () => {
    g().recordSlideshow(0, 0);
    g().activateCyclicPosition("legato", 4);
    expect(g().slideshows[0].events[0].action).toEqual({
      type: "position", variable: "legato", position: 4,
    });
    g().stopSlideshow(1);
    g().activateCyclicPosition("legato", 0);
    g().setPlaying(true);
    g().playSlideshow(0, 2);
    g().advanceSlideshow(2);
    expect(g().activeCyclicPositions.legato).toBe(4);
  });

  it("adds and removes a playback loop, then stops playback", () => {
    useM.setState({
      isPlaying: true,
      slideshows: [{ events: [{ atSec: 0, action: { type: "position", variable: "density", position: 1 } }], loopAtSec: null }, ...g().slideshows.slice(1)],
    });
    g().playSlideshow(0, 10, 0);
    g().toggleSlideshowLoop(11);
    expect(g().slideshows[0].loopAtSec).toBe(1);
    g().toggleSlideshowLoop(11, true);
    expect(g().slideshows[0].loopAtSec).toBe(null);
    g().stopSlideshow(12);
    expect(g().slideshowTransport.mode).toBe("idle");
  });

  it("ignores invalid/empty slideshow commands and idle advancement", () => {
    g().recordSlideshow(-1, 0);
    g().recordSlideshow(9, 0);
    g().playSlideshow(0, 0);
    g().playSlideshow(99, 0);
    g().toggleSlideshowLoop(0);
    g().advanceSlideshow(0);
    expect(g().slideshowTransport.mode).toBe("idle");
  });

  it("pauses with music Stop and resumes with Start", () => {
    useM.setState({
      isPlaying: true,
      slideshows: [{ events: [{ atSec: 5, action: { type: "snapshot", index: 0 } }], loopAtSec: null }, ...g().slideshows.slice(1)],
    });
    g().playSlideshow(0, 0, 0);
    g().setPlaying(false);
    expect(g().slideshowTransport.paused).toBe(true);
    g().setPlaying(true);
    expect(g().slideshowTransport.paused).toBe(false);
  });
});

describe("Restore From Snapshot", () => {
  // "This button undoes the changes brought about by the most recently
  //  executed Snapshot."
  it("undoes the most recently executed snapshot", () => {
    g().activatePosition("transposition", 1);
    g().storeSnapshot(0);
    g().activatePosition("transposition", 4);
    g().recallSnapshot(0);
    expect(g().positions.transposition.active).toBe(1);
    g().restoreFromSnapshot();
    expect(g().positions.transposition.active).toBe(4);
  });

  it("does nothing before any snapshot has been executed", () => {
    const before = g().positions.transposition.active;
    g().restoreFromSnapshot();
    expect(g().positions.transposition.active).toBe(before);
  });

  it("is not armed by merely storing a snapshot", () => {
    g().activatePosition("density", 2);
    g().storeSnapshot(0);
    g().restoreFromSnapshot();
    expect(g().positions.density.active).toBe(2);
  });
});

describe("Snapshot Quantization", () => {
  it("starts on the wave, meaning no quantization", () => {
    expect(g().snapshotQuantize).toBe(0);
  });
  it("takes a note value", () => {
    g().setSnapshotQuantize(4);
    expect(g().snapshotQuantize).toBe(4);
  });
  it("rejects a value that isn't on the numerical", () => {
    g().setSnapshotQuantize(4);
    g().setSnapshotQuantize(7);
    expect(g().snapshotQuantize).toBe(4);
  });
});

describe("conducting arrows", () => {
  it("start unarmed", () => {
    expect(g().arrows.density ?? { on: false }).toMatchObject({ on: false });
  });
  it("arm and rotate independently", () => {
    g().setArrow("density", { on: true, dir: "down" });
    g().setArrow("transposition", { on: false, dir: "left" });
    expect(g().arrows.density).toEqual({ on: true, dir: "down" });
    expect(g().arrows.transposition).toEqual({ on: false, dir: "left" });
  });
});

describe("pattern group", () => {
  it("starts on a", () => {
    expect(g().patternGroup).toBe(0);
  });
  it("selects another group", () => {
    g().setPatternGroup(5);
    expect(g().patternGroup).toBe(5);
  });
  it("ignores a group outside a-f", () => {
    g().setPatternGroup(9);
    expect(g().patternGroup).toBe(0);
  });
});

describe("conductor flags", () => {
  it("toggles midi conduct", () => {
    g().setMidiConduct(true);
    expect(g().midiConduct).toBe(true);
  });
  it("toggles robot conductor", () => {
    g().setRobot(true);
    expect(g().robotConductor).toBe(true);
  });
});

describe("the Conducting Grid", () => {
  it("records the Baton even when no arrows are armed", () => {
    const active = g().positions.density.active;
    g().conductAt(0.2, 0.8);
    expect(g().baton).toEqual({ x: 0.2, y: 0.8 });
    expect(g().positions.density.active).toBe(active);
  });

  it("conducts several armed Variable Positions atomically by direction", () => {
    g().setArrow("density", { on: true, dir: "right" });
    g().setArrow("transposition", { on: true, dir: "down" });
    g().conductAt(0.9, 0.1);
    expect(g().positions.density.active).toBe(5);
    expect(g().positions.transposition.active).toBe(0);
    expect(g().project.voices[0].density)
      .toBe(g().positions.density.slots[5][0]);
    expect(g().project.voices[0].transposition)
      .toBe(g().positions.transposition.slots[0][0]);
  });

  it("reverses left/up arrows and conducts Pattern Group", () => {
    g().setArrow("patternGroup", { on: true, dir: "left" });
    g().conductAt(0.9, 0.5);
    expect(g().patternGroup).toBe(0);
    g().conductAt(0, 0.5);
    expect(g().patternGroup).toBe(5);
  });

  it("conducts Tempo continuously inside its selected range", () => {
    g().setTempoRange(80, 160);
    g().setArrow("tempo", { on: true, dir: "up" });
    g().conductAt(0.5, 0.75);
    expect(g().project.tempo).toBe(100);
  });

  // "After setting the tempo range, the midpoint becomes the new tempo."
  it("normalizes a Tempo Range and selects its midpoint", () => {
    g().setTempoRange(200, 60);
    expect(g().tempoRange).toEqual({ low: 60, high: 200 });
    expect(g().project.tempo).toBe(130);
  });

  it("moves and conducts the Robot Baton inside its movement ranges", () => {
    g().setRobotRange("x", 0.2);
    g().setRobotRange("y", 0.4);
    g().robotStep(1, -1);
    expect(g().baton.x).toBeCloseTo(0.7);
    expect(g().baton.y).toBeCloseTo(0.1);
  });

  it("stores Pause, Sync Ratio direction/value, and Robot Time Base", () => {
    g().setPaused(true);
    g().setSyncRatioDirection("in");
    g().setSyncRatio(8);
    g().setRobotTimeBase(16);
    expect(g().isPaused).toBe(true);
    expect(g().syncRatioDirection).toBe("in");
    expect(g().syncRatio).toBe(8);
    expect(g().robotTimeBase).toBe(16);
  });

  it("ignores unsupported Sync Ratio and Robot Time Base values", () => {
    g().setSyncRatio(3);
    g().setRobotTimeBase(3);
    expect(g().syncRatio).toBe(4);
    expect(g().robotTimeBase).toBe(4);
  });
});

describe("cyclic variables", () => {
  it("conducts Legato, Rhythm, and Accent Positions", () => {
    g().setArrow("legato", { on: true, dir: "right" });
    g().setArrow("rhythm", { on: true, dir: "down" });
    g().setArrow("accent", { on: true, dir: "left" });
    g().conductAt(0.8, 0.2);
    expect(g().activeCyclicPositions).toEqual({ legato: 4, rhythm: 1, accent: 1 });
  });

  it("Hold/Do and Snapshots include Cyclic Variable Positions", () => {
    g().beginHold();
    g().activateCyclicPosition("legato", 3);
    expect(g().activeCyclicPositions.legato).toBe(0);
    g().doHold();
    expect(g().activeCyclicPositions.legato).toBe(3);
    g().blinkEverything();
    g().storeSnapshot(0);
    g().activateCyclicPosition("legato", 1);
    g().recallSnapshot(0);
    expect(g().activeCyclicPositions.legato).toBe(3);
  });

  it("Edit Snapshot toggles a Cyclic Variable Position's membership", () => {
    g().storeSnapshot(0);
    g().editCurrentSnapshot();
    g().activateCyclicPosition("legato", 4);
    expect(g().snapshotDraft?.cyclicActives?.legato).toBe(4);
    expect(g().snapshotDraft?.included?.cyclicActives).not.toContain("legato");
    expect(g().activeCyclicPositions.legato).toBe(0);
  });
  it("sets one cyclic level without changing other steps or voices", () => {
    g().setCyclicLevel("accent", 2, 5, 4);
    expect(g().project.cyclic.accent[2][5]).toBe(4);
    expect(g().project.cyclic.accent[2][4]).toBe(2);
    expect(g().project.cyclic.accent[1][5]).toBe(2);
  });
  it("clamps cyclic levels to the five valid values", () => {
    g().setCyclicLevel("rhythm", 0, 0, 99);
    g().setCyclicLevel("legato", 0, 0, -5);
    expect(g().project.cyclic.rhythm[0][0]).toBe(4);
    expect(g().project.cyclic.legato[0][0]).toBe(0);
  });
  it("stores six independent Positions and activates one for playback", () => {
    g().setCyclicPositionLevel("accent", 3, 1, 2, 4);
    expect(g().cyclicPositions.accent[3][1][2]).toBe(4);
    expect(g().project.cyclic.accent[1][2]).toBe(2);
    g().activateCyclicPosition("accent", 3);
    expect(g().activeCyclicPositions.accent).toBe(3);
    expect(g().project.cyclic.accent[1][2]).toBe(4);
  });
  it("sets and clamps an independent 1-16 step length per Voice and Position", () => {
    g().setCyclicLength("rhythm", 2, 3, 99);
    g().setCyclicLength("rhythm", 2, 0, -4);
    expect(g().cyclicLengths.rhythm[2]).toEqual([1, 16, 16, 16]);
    g().activateCyclicPosition("rhythm", 2);
    expect(g().project.cyclicLengths.rhythm).toEqual([1, 16, 16, 16]);
  });
  it("sets global Legato and Rhythm values but not Accent values", () => {
    g().setCyclicValue("legato", 4, 400);
    g().setCyclicValue("rhythm", 0, 1.5);
    g().setCyclicValue("accent", 2, 99);
    expect(g().project.cyclicValues.legato[4]).toBe(400);
    expect(g().project.cyclicValues.rhythm[0]).toBe(1.5);
    expect("accent" in g().project.cyclicValues).toBe(false);
  });
  it("immediately updates playback when editing the active Position", () => {
    g().setCyclicPositionLevel("legato", 0, 0, 0, 4);
    g().setCyclicLength("legato", 0, 0, 3);
    expect(g().project.cyclic.legato[0][0]).toBe(4);
    expect(g().project.cyclicLengths.legato[0]).toBe(3);
  });
  it("stores an ordered cyclic level range and updates the active Position", () => {
    g().setCyclicPositionRange("accent", 0, 2, 6, 4, 1);
    expect(g().cyclicPositions.accent[0][2][6]).toEqual({ min: 1, max: 4 });
    expect(g().project.cyclic.accent[2][6]).toEqual({ min: 1, max: 4 });
    g().setCyclicPositionRange("accent", 4, 1, 3, 0, 2);
    expect(g().cyclicPositions.accent[4][1][3]).toEqual({ min: 0, max: 2 });
    expect(g().project.cyclic.accent[1][3]).toBe(2);
  });
});

describe("project document export / import", () => {
  it("exports the live musical state", () => {
    g().setTempo(137);
    g().activatePosition("transposition", 2);
    g().setPatternGroup(4);
    const doc = g().exportDocument();
    expect(doc.version).toBe(2);
    expect(doc.project.tempo).toBe(137);
    expect(doc.positions.transposition.active).toBe(2);
    expect(doc.patternGroup).toBe(4);
  });

  it("round-trips every musical subsystem through import", () => {
    g().setTempo(151);
    g().setVoiceParam(1, "density", 0.42);
    g().paintStep(0, 3, 71, true);
    g().activatePosition("noteOrderMix", 3);
    g().setArrow("density", { on: true, dir: "up" });
    g().setPatternGroup(2);
    g().storeSnapshot(5);
    g().setSnapshotQuantize(4);
    const doc = JSON.parse(JSON.stringify(g().exportDocument()));

    // Wander away from all of it.
    g().setTempo(90);
    g().setVoiceParam(1, "density", 1);
    g().activatePosition("noteOrderMix", 0);
    g().setArrow("density", { on: false, dir: "right" });
    g().setPatternGroup(0);
    g().eraseSnapshot(5);
    g().setSnapshotQuantize(0);

    expect(g().importDocument(doc).ok).toBe(true);
    expect(g().project.tempo).toBe(151);
    expect(g().project.voices[1].density).toBeCloseTo(0.42, 9);
    expect(g().project.patterns[0].steps[3].pitches).toContain(71);
    expect(g().positions.noteOrderMix.active).toBe(3);
    expect(g().arrows.density).toEqual({ on: true, dir: "up" });
    expect(g().patternGroup).toBe(2);
    expect(g().snapshots[5]).not.toBe(null);
    expect(g().snapshotQuantize).toBe(4);
  });

  it("round-trips Scrambled material and Cyclic Positions", () => {
    g().runPatternCommand(0, (steps) => steps);
    g().setCyclicLength("rhythm", 2, 1, 7);
    g().activateCyclicPosition("accent", 4);
    const doc = JSON.parse(JSON.stringify(g().exportDocument()));
    g().setCyclicLength("rhythm", 2, 1, 16);
    g().activateCyclicPosition("accent", 0);

    g().importDocument(doc);
    expect(g().cyclicLengths.rhythm[2][1]).toBe(7);
    expect(g().activeCyclicPositions.accent).toBe(4);
    expect(g().project.patterns[0].scrambledSteps).toHaveLength(
      g().project.patterns[0].steps.length,
    );
  });

  it("stops playback before replacing live state", () => {
    g().setPlaying(true);
    g().importDocument(g().exportDocument());
    expect(g().isPlaying).toBe(false);
    expect(g().isPaused).toBe(false);
  });

  it("clears transient state that belongs to the old project", () => {
    g().storeSnapshot(0);
    g().recallSnapshot(0); // arms Restore From Snapshot
    g().setClipboard([{ pitches: [60] }]);
    expect(g().restorePoint).not.toBe(null);
    g().importDocument(g().exportDocument());
    expect(g().restorePoint).toBe(null);
    expect(g().clipboard).toEqual([]);
    expect(g().midiViewEvents).toEqual([]);
  });

  it("reports failure and changes nothing when the document is bad", () => {
    g().setTempo(123);
    const result = g().importDocument({ nonsense: true });
    expect(result.ok).toBe(false);
    expect(g().project.tempo).toBe(123);
  });

  it("surfaces repair warnings without failing", () => {
    const doc = JSON.parse(JSON.stringify(g().exportDocument()));
    delete doc.arrows;
    const result = g().importDocument(doc);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("does not alias the document it imported", () => {
    const doc = JSON.parse(JSON.stringify(g().exportDocument()));
    g().importDocument(doc);
    doc.project.patterns[0].steps[0].pitches = [1, 2, 3];
    expect(g().project.patterns[0].steps[0].pitches).not.toEqual([1, 2, 3]);
  });

  it("starts a new project from the shipped defaults", () => {
    g().setTempo(200);
    g().paintStep(0, 5, 90, true);
    g().newDocument();
    expect(g().project.tempo).toBe(createDefaultProject().tempo);
    expect(g().project.patterns[0].steps[5].pitches).not.toContain(90);
    expect(g().snapshots.every((s) => s === null)).toBe(true);
    expect(g().isPlaying).toBe(false);
  });
})

describe("document name and unsaved changes", () => {
  it("starts as an unnamed, clean document", () => {
    g().newDocument();
    expect(g().documentName).toBe(null);
    expect(g().isDirty).toBe(false);
  });

  it("becomes dirty when the music changes", () => {
    g().newDocument();
    g().setTempo(133);
    expect(g().isDirty).toBe(true);
  });

  it("becomes dirty when a Pattern is edited", () => {
    g().newDocument();
    g().paintStep(0, 2, 64, true);
    expect(g().isDirty).toBe(true);
  });

  it("stays clean when only transient state moves", () => {
    g().newDocument();
    g().setPlaying(true);
    g().selectVoice(2);
    g().openEditor("density");
    expect(g().isDirty).toBe(false);
  });

  it("is clean again after saving, and remembers the name", () => {
    g().newDocument();
    g().setTempo(120);
    g().markSaved("Piece One.mclone.json");
    expect(g().isDirty).toBe(false);
    expect(g().documentName).toBe("Piece One.mclone.json");
  });

  it("goes dirty again after a change following a save", () => {
    g().markSaved("x.json");
    g().setTempo(101);
    expect(g().isDirty).toBe(true);
  });

  it("is clean immediately after importing a document", () => {
    g().setTempo(155);
    const doc = JSON.parse(JSON.stringify(g().exportDocument()));
    g().setTempo(90);
    g().importDocument(doc);
    expect(g().isDirty).toBe(false);
  });

  it("adopts the name it was opened under", () => {
    const doc = JSON.parse(JSON.stringify(g().exportDocument()));
    g().importDocument(doc, "Opened.mclone.json");
    expect(g().documentName).toBe("Opened.mclone.json");
    expect(g().isDirty).toBe(false);
  });

  it("forgets the name on New", () => {
    g().markSaved("old.json");
    g().newDocument();
    expect(g().documentName).toBe(null);
    expect(g().isDirty).toBe(false);
  });

  it("leaves name and dirty state alone when an import fails", () => {
    g().markSaved("kept.json");
    g().setTempo(111);
    g().importDocument({ garbage: true });
    expect(g().documentName).toBe("kept.json");
    expect(g().isDirty).toBe(true);
  });
})

describe("the Options menu in the store", () => {
  it("starts at the manual's defaults", () => {
    expect(g().options).toEqual(DEFAULT_OPTIONS);
  });

  it("toggles one option without touching the rest", () => {
    g().setOption("useMetronome", true);
    expect(g().options.useMetronome).toBe(true);
    expect(g().options.slideshowRecordWait).toBe(true);
    expect(g().options.noZoomRects).toBe(false);
  });

  it("marks the document dirty, because options are saved with it", () => {
    useM.setState({ isDirty: false });
    g().setOption("noZoomRects", true);
    expect(g().isDirty).toBe(true);
  });

  it("carries options out through the document", () => {
    g().setOption("useMetronome", true);
    expect(g().exportDocument().options.useMetronome).toBe(true);
  });

  it("takes options back in when a document is opened", () => {
    g().setOption("useMetronome", true);
    const saved = JSON.parse(JSON.stringify(g().exportDocument()));
    g().newDocument();
    expect(g().options.useMetronome).toBe(false);
    const result = g().importDocument(saved, "x.mclone.json");
    expect(result.ok).toBe(true);
    expect(g().options.useMetronome).toBe(true);
  });

  it("resets options when a new document is started", () => {
    g().setOption("useMetronome", true);
    g().newDocument();
    expect(g().options).toEqual(DEFAULT_OPTIONS);
  });
});

describe("the Pattern Editor's selected Region", () => {
  it("starts with nothing selected", () => {
    expect(g().editorRegion).toBeNull();
  });

  it("holds the Region so the menu bar can act on it", () => {
    // M's Edit and Pattern menus are global but operate on the current
    // selection, so the selection cannot live inside the editor window.
    g().setEditorRegion({ from: 2, to: 5, point: false });
    expect(g().editorRegion).toEqual({ from: 2, to: 5, point: false });
  });

  it("clears back to nothing", () => {
    g().setEditorRegion({ from: 2, to: 5, point: false });
    g().setEditorRegion(null);
    expect(g().editorRegion).toBeNull();
  });

  it("does not dirty the document, because a selection is not musical content", () => {
    useM.setState({ isDirty: false });
    g().setEditorRegion({ from: 1, to: 3, point: false });
    expect(g().isDirty).toBe(false);
  });

  it("is not written into the saved document", () => {
    g().setEditorRegion({ from: 1, to: 3, point: false });
    expect("editorRegion" in g().exportDocument()).toBe(false);
  });
})
