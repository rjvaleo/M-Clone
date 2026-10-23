import { describe, expect, it } from "vitest";
import { makePresetPositions } from "../../engine/variables";
import { storePreset } from "./presets";
import {
  M_VARIABLES,
  activate,
  conduct,
  defaultVariables,
  recallSnapshot,
  resolveTargets,
  setTableValue,
  storeSnapshot,
  toggleArrow,
} from "./variables";

describe("M Variables: positions a–f for every variable", () => {
  it("starts on M's own presets and positions", () => {
    const state = defaultVariables();
    const m = makePresetPositions();
    expect(state.active.density).toBe(m.density.active);
    expect(state.active.noteOrder).toBe(m.noteOrderMix.active);
    expect(state.tables.transposition[3].slice(0, 4)).toEqual(m.transposition.slots[3]);
    expect(state.tables.density[0]).toHaveLength(8);
  });

  it("switches one variable's position without moving the others", () => {
    const state = activate(defaultVariables(), "transposition", 2);
    expect(state.active.transposition).toBe(2);
    expect(state.active.density).toBe(defaultVariables().active.density);
  });

  it("moves conducted variables along their arrows, one grid square per position", () => {
    let state = toggleArrow(defaultVariables(), "density", "right");
    state = toggleArrow(state, "transposition", "up");
    state = conduct(state, { x: 0.99, y: 0.99 });
    expect(state.active.density).toBe(5);
    expect(state.active.transposition).toBe(0);
    expect(state.active.noteOrder).toBe(defaultVariables().active.noteOrder);
  });

  it("stores and recalls snapshots of positions", () => {
    let state = activate(defaultVariables(), "patternGroup", 3);
    state = storeSnapshot(state, 0);
    state = activate(state, "patternGroup", 1);
    state = recallSnapshot(state, 0);
    expect(state.active.patternGroup).toBe(3);
    expect(recallSnapshot(state, 25)).toEqual(state);
  });

  it("edits one voice's value at one position", () => {
    const state = setTableValue(defaultVariables(), "density", 1, 2, 0.25);
    expect(state.tables.density[1][2]).toBe(0.25);
    expect(defaultVariables().tables.density[1][2]).not.toBe(0.25);
  });
});

describe("M Variables: writing positions into the other modules", () => {
  const seq = (nodeId: string, voice: number) => ({ kind: "noteSeq" as const, nodeId, parameters: { voice } });

  it("sets each NoteSeq's group and its own voice's variables from the active positions", () => {
    const state = activate(activate(defaultVariables(), "patternGroup", 2), "transposition", 3);
    const updates = resolveTargets(state, [seq("ns1", 1), seq("ns3", 3)]);
    const one = updates.find((u) => u.nodeId === "ns1")!.values;
    const three = updates.find((u) => u.nodeId === "ns3")!.values;
    expect(one.group).toBe(2);
    expect(one.transposition).toBe(makePresetPositions().transposition.slots[3][0]);
    expect(three.transposition).toBe(makePresetPositions().transposition.slots[3][2]);
    expect(Object.keys(one)).toEqual(expect.arrayContaining(["density", "vel-low", "vel-high", "note-order", "cycle-positions", "warp-position"]));
  });

  it("a Pattern Group position recalls the NoteSeq preset on that slot, once", () => {
    const state = activate(defaultVariables(), "patternGroup", 2);
    const presets = storePreset([], 2, "Chorus", { "rate-den": 16, octave: 1 });
    const parameters = { voice: 1, "preset-slot": 0 } as never;
    const first = resolveTargets(state, [{ kind: "noteSeq", nodeId: "ns", parameters: { ...(parameters as object), presets } as never }])[0].values;
    expect(first).toMatchObject({ "rate-den": 16, octave: 1, "preset-slot": 2 });
    expect(first.group).toBeUndefined();
    // Once recalled, editing the module is not undone by the next pass.
    const after = resolveTargets(state, [{ kind: "noteSeq", nodeId: "ns", parameters: { ...(parameters as object), presets, ...first, octave: 3 } as never }]);
    expect(after[0]?.values.octave).toBeUndefined();
  });

  it("an empty slot falls back to M's own pattern group", () => {
    const state = activate(defaultVariables(), "patternGroup", 4);
    const updates = resolveTargets(state, [seq("ns", 1)]);
    expect(updates[0].values.group).toBe(4);
  });

  it("points the cycles, Time Warps and M Orchestra at their positions", () => {
    let state = defaultVariables();
    for (const [variable, position] of [["accent", 1], ["legato", 2], ["rhythm", 3], ["timeDistortion", 4], ["orchestration", 5], ["soundChoice", 1]] as const) {
      state = activate(state, variable, position);
    }
    const updates = resolveTargets(state, [
      seq("ns", 1),
      { kind: "timeWarp", nodeId: "tw", parameters: {} },
      { kind: "orchestra", nodeId: "or", parameters: {} },
    ]);
    expect(updates.find((u) => u.nodeId === "ns")!.values["cycle-positions"]).toEqual({ accent: 1, legato: 2, rhythm: 3 });
    expect(updates.find((u) => u.nodeId === "tw")!.values).toEqual({ position: 4 });
    expect(updates.find((u) => u.nodeId === "or")!.values).toEqual({ position: 5, "sound-position": 1 });
  });

  it("sends nothing to a module that is already where it should be", () => {
    const state = defaultVariables();
    const first = resolveTargets(state, [{ kind: "timeWarp", nodeId: "tw", parameters: {} }]);
    expect(resolveTargets(state, [{ kind: "timeWarp", nodeId: "tw", parameters: first[0].values }])).toEqual([]);
  });

  it("covers every variable M has", () => {
    expect(M_VARIABLES).toEqual([
      "patternGroup", "density", "velocityRange", "noteOrder", "transposition", "timeDistortion",
      "accent", "legato", "rhythm", "orchestration", "soundChoice",
    ]);
  });
});
