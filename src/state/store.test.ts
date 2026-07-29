import { describe, it, expect, beforeEach } from "vitest";
import { useM, SNAPSHOT_COUNT } from "./store";
import { createDefaultProject } from "../engine/project";
import { makeDefaultPositions } from "../engine/variables";

beforeEach(() => {
  const project = createDefaultProject();
  useM.setState({
    project,
    positions: makeDefaultPositions(project.voices),
    snapshots: Array(SNAPSHOT_COUNT).fill(null),
    selectedVoice: 0,
    isPlaying: false,
    editingVar: null,
    midiConduct: false,
    robotConductor: false,
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
    g().setSlotValue("velocity", 0, 1, 55);
    expect(g().project.voices[1].velocity).toBe(55);
  });
  it("editing a non-active position does not change voices", () => {
    const before = g().project.voices[0].transposition;
    g().setSlotValue("transposition", 4, 0, 11);
    expect(g().project.voices[0].transposition).toBe(before);
    expect(g().positions.transposition.slots[4][0]).toBe(11);
  });
  it("opens and closes the editor", () => {
    g().openEditor("noteOrder");
    expect(g().editingVar).toBe("noteOrder");
    g().closeEditor();
    expect(g().editingVar).toBe(null);
  });
});

describe("snapshots", () => {
  it("stores and recalls the whole project", () => {
    g().setTempo(155);
    g().storeSnapshot(1);
    g().setTempo(90);
    g().recallSnapshot(1);
    expect(g().project.tempo).toBe(155);
  });
  it("recalling an empty slot is a no-op", () => {
    g().setTempo(133);
    g().recallSnapshot(3); // never stored
    expect(g().project.tempo).toBe(133);
  });
  it("rebuilds positions on recall", () => {
    g().storeSnapshot(0);
    g().recallSnapshot(0);
    expect(g().positions.density.active).toBe(0);
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
