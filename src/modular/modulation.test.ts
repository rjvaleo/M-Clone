import { describe, expect, it } from "vitest";
import { isMappable } from "./modulationTargets";
import {
  ADSR_TYPE,
  ENV_FOLLOWER_TYPE,
  isModulator,
  lfoRateHz,
  lfoStates,
  SYNC_NOTES,
  liveLfoValue,
  LFO_COLORS,
  LFO_SHAPES,
  LFO_TYPE,
  extrapolatePhase,
  mappingsByTarget,
  modulatedValue,
  nextLfoColor,
  shapeValue,
  targetKey,
  targetsOf,
  withTarget,
  withoutTarget,
} from "./modulation";
import { createNode, moduleRegistry } from "./registry/registry";
import { emptyGraph, type GraphDocument } from "./model/graph";

const graphWith = (nodes: { id: string; type: string; parameters?: Record<string, unknown> }[]): GraphDocument => {
  const document = emptyGraph();
  for (const entry of nodes) {
    const node = createNode(entry.type, entry.id, { x: 0, y: 0 });
    Object.assign(node.parameters, entry.parameters ?? {});
    document.nodes[entry.id] = node;
  }
  return document;
};

describe("An LFO's mappings", () => {
  it("is a control module with rate, shape, amount, phase, colour, its targets, and sync", () => {
    const lfo = moduleRegistry.get(LFO_TYPE)!;
    expect(lfo.family).toBe("control");
    expect(lfo.parameters.map((p) => p.id)).toEqual(["rate", "shape", "amount", "phase", "color", "targets", "sync", "note"]);
    expect(lfo.parameters.find((p) => p.id === "shape")?.options).toEqual(LFO_SHAPES);
  });

  it("adds a target once, and removes it", () => {
    const one = withTarget([], { nodeId: "d", parameterId: "feedback" });
    expect(withTarget(one, { nodeId: "d", parameterId: "feedback" })).toEqual(one);
    const two = withTarget(one, { nodeId: "r", parameterId: "mix" });
    expect(withoutTarget(two, { nodeId: "d", parameterId: "feedback" })).toEqual([{ nodeId: "r", parameterId: "mix" }]);
  });

  it("reads only well-formed targets from a document", () => {
    const node = createNode(LFO_TYPE, "l", { x: 0, y: 0 });
    node.parameters.targets = [{ nodeId: "d", parameterId: "feedback" }, { nodeId: 3 }, "junk"] as never;
    expect(targetsOf(node)).toEqual([{ nodeId: "d", parameterId: "feedback" }]);
  });

  it("knows every LFO on each knob, with its colour", () => {
    const graph = graphWith([
      { id: "d", type: "m.audio-delay" },
      { id: "l1", type: LFO_TYPE, parameters: { color: LFO_COLORS[2].name, targets: [{ nodeId: "d", parameterId: "feedback" }] } },
      { id: "l2", type: LFO_TYPE, parameters: { color: LFO_COLORS[5].name, targets: [{ nodeId: "d", parameterId: "feedback" }, { nodeId: "gone", parameterId: "x" }] } },
    ]);
    const map = mappingsByTarget(graph);
    expect(map.get(targetKey({ nodeId: "d", parameterId: "feedback" }))?.map((m) => [m.lfoNodeId, m.color])).toEqual([
      ["l1", LFO_COLORS[2].value],
      ["l2", LFO_COLORS[5].value],
    ]);
    // A target whose module has gone is not drawn anywhere.
    expect(map.has(targetKey({ nodeId: "gone", parameterId: "x" }))).toBe(false);
  });

  it("gives a new LFO the first colour no other LFO wears", () => {
    const graph = graphWith([
      { id: "l1", type: LFO_TYPE, parameters: { color: LFO_COLORS[0].name } },
      { id: "l2", type: LFO_TYPE, parameters: { color: LFO_COLORS[1].name } },
    ]);
    expect(nextLfoColor(graph)).toBe(LFO_COLORS[2].name);
  });
});

describe("Where a modulated knob is", () => {
  it("moves by the LFO's value over half the knob's range, inside the range", () => {
    expect(modulatedValue(0.5, 0.5, 0, 1)).toBeCloseTo(0.75);
    expect(modulatedValue(0.5, -1, 0, 1)).toBe(0);
    expect(modulatedValue(100, 1, 20, 20000)).toBe(10_090);
    expect(modulatedValue(19_000, 1, 20, 20000)).toBe(20_000);
  });

  it("draws the shapes the Rust LFO plays, and none for the random ones", () => {
    expect(shapeValue(0, 0.25)).toBeCloseTo(1);
    expect(shapeValue(1, 0.75)).toBeCloseTo(0);
    expect(shapeValue(2, 0.75)).toBeCloseTo(0.5);
    expect(shapeValue(3, 0.75)).toBeCloseTo(-0.5);
    expect(shapeValue(4, 0.6)).toBe(-1);
    expect(shapeValue(5, 0.3)).toBeNull();
    expect(shapeValue(6, 0.3)).toBeNull();
  });

  it("carries the phase forward between reports, wrapping at one", () => {
    expect(extrapolatePhase(0.25, 2, 0.25)).toBeCloseTo(0.75);
    expect(extrapolatePhase(0.9, 1, 0.2)).toBeCloseTo(0.1);
  });
});

describe("What a face draws between reports", () => {
  it("carries a predictable shape forward from the last report, scaled by the amount", () => {
    // A sine at 1 Hz reported at phase 0: a quarter second later it is at its top.
    expect(liveLfoValue({ phase: 0, value: 0, at: 10 }, { rate: 1, shape: 0, amount: 0.5 }, 10.25)).toBeCloseTo(0.5);
  });

  it("holds a random shape's reported value until the next report", () => {
    expect(liveLfoValue({ phase: 0.2, value: -0.3, at: 10 }, { rate: 1, shape: 5, amount: 1 }, 10.4)).toBe(-0.3);
  });

  it("does not run on past a report that has gone stale", () => {
    // Audio stopped: the face holds what it last heard rather than inventing.
    expect(liveLfoValue({ phase: 0, value: 0.1, at: 10 }, { rate: 1, shape: 0, amount: 1 }, 12)).toBe(0.1);
  });

  it("knows which knobs can be mapped", () => {
    expect(isMappable("m.audio-delay", "feedback")).toBe(true);
    // Structural, so Web Audio rebuilds for it and the plan never routes it.
    expect(isMappable("m.audio-delay", "max-delay-seconds")).toBe(false);
    expect(isMappable("m.prism-tremolo", "depth")).toBe(true);
    // A choice moves in steps that are names, not a range.
    expect(isMappable("m.prism-tremolo", "shape")).toBe(false);
    // Event-side modules have no engine half to move.
    expect(isMappable("m.lab-noteseq", "density")).toBe(false);
    expect(isMappable(LFO_TYPE, "rate")).toBe(false);
  });
});

describe("An LFO as a face draws it", () => {
  it("reads its rate, shape and amount from the document", () => {
    const graph = graphWith([{ id: "l", type: LFO_TYPE, parameters: { rate: 3, shape: "Saw down", amount: 0.2 } }]);
    expect(lfoStates(graph).get("l")).toEqual({ rate: 3, shape: 3, amount: 0.2 });
  });
});

describe("Tempo sync", () => {
  it("offers every note value from a whole note to a thirty-second, straight, dotted and triplet", () => {
    expect(SYNC_NOTES.map((n) => n.label)).toEqual([
      "1/32T", "1/32", "D 1/32", "1/16T", "1/16", "D 1/16", "1/8T", "1/8", "D 1/8",
      "1/4T", "1/4", "D 1/4", "1/2T", "1/2", "D 1/2", "1/1T", "1/1", "D 1/1",
    ]);
    const beats = (label: string) => SYNC_NOTES.find((n) => n.label === label)!.beats;
    expect(beats("1/4")).toBe(1);
    expect(beats("1/1")).toBe(4);
    expect(beats("1/32")).toBe(0.125);
    expect(beats("D 1/8")).toBe(0.75);
    // A triplet is two thirds of the straight note, exactly.
    expect(beats("1/8T")).toBe(0.5 * 2 / 3);
    expect(beats("1/4T")).toBe(2 / 3);
  });

  it("keeps the names and lengths the synth's delay already uses", async () => {
    const { DELAY_NOTES } = await import("./audio/synthLaws");
    for (const note of DELAY_NOTES) {
      const same = SYNC_NOTES.find((n) => n.label === note.label);
      if (!same) continue;
      expect(same.beats).toBeCloseTo(note.beats, 4);
    }
  });

  it("plays the rate knob unsynced, and the note at the tempo synced", () => {
    expect(lfoRateHz({ rate: 3, sync: false, note: "1/8" }, 140)).toBe(3);
    // An eighth at 120 BPM is a quarter of a second.
    expect(lfoRateHz({ rate: 3, sync: true, note: "1/8" }, 120)).toBe(4);
    expect(lfoRateHz({ rate: 3, sync: true, note: "D 1/4" }, 90)).toBe(90 / 60 / 1.5);
  });

  it("draws a synced LFO at the tempo's rate", () => {
    const graph = graphWith([{ id: "l", type: LFO_TYPE, parameters: { rate: 3, sync: true, note: "1/16", amount: 1 } }]);
    expect(lfoStates(graph, 120).get("l")?.rate).toBe(8);
    expect(lfoStates(graph, 60).get("l")?.rate).toBe(4);
  });

  it("leaves a patch saved before sync on its own rate", () => {
    const graph = graphWith([{ id: "l", type: LFO_TYPE, parameters: { rate: 3 } }]);
    delete graph.nodes.l.parameters.sync;
    delete graph.nodes.l.parameters.note;
    expect(lfoStates(graph, 200).get("l")?.rate).toBe(3);
  });
});

describe("The envelope follower and the gate ADSR as modulators", () => {
  const graph = () => graphWith([
    { id: "d", type: "m.audio-delay" },
    { id: "l", type: LFO_TYPE, parameters: { color: "Amber", targets: [{ nodeId: "d", parameterId: "feedback" }] } },
    { id: "e", type: ENV_FOLLOWER_TYPE, parameters: { color: "Cyan", targets: [{ nodeId: "d", parameterId: "feedback" }] } },
    { id: "a", type: ADSR_TYPE, parameters: { color: "Magenta", targets: [{ nodeId: "d", parameterId: "delay-seconds" }] } },
  ]);

  it("are modulators, and nothing else is", () => {
    expect([LFO_TYPE, ENV_FOLLOWER_TYPE, ADSR_TYPE].every(isModulator)).toBe(true);
    expect(isModulator("m.audio-delay")).toBe(false);
  });

  it("ring the knobs they move in their own colours, beside the LFO's", () => {
    const map = mappingsByTarget(graph());
    expect(map.get("d|feedback")).toEqual([
      { lfoNodeId: "l", color: LFO_COLORS[0].value },
      { lfoNodeId: "e", color: LFO_COLORS[1].value },
    ]);
    expect(map.get("d|delay-seconds")).toEqual([{ lfoNodeId: "a", color: LFO_COLORS[2].value }]);
  });

  it("take a colour no other modulator wears", () => {
    expect(nextLfoColor(graph())).toBe(LFO_COLORS[3].name);
  });

  it("are drawn from what the rack reports, held between reports", () => {
    const states = lfoStates(graph(), 120);
    for (const id of ["e", "a"]) {
      const state = states.get(id)!;
      expect(liveLfoValue({ phase: Number.NaN, value: 0.42, at: 10 }, state, 10.2)).toBe(0.42);
    }
  });
});

describe("Modulation's fallbacks", () => {
  it("gives a quarter's beats to a name that is not a note value", () => {
    expect(lfoRateHz({ rate: 3, sync: true, note: "1/5" }, 120)).toBe(2);
    expect(lfoRateHz({ rate: 3, sync: true, note: undefined }, 60)).toBe(1);
  });

  it("reads no targets from a document whose targets are not a list", () => {
    const graph = graphWith([{ id: "lfo", type: LFO_TYPE, parameters: { targets: "osc|freq" } }]);
    expect(targetsOf(graph.nodes.lfo!)).toEqual([]);
  });

  it("wears the first colour when its own is not one of the palette", () => {
    const graph = graphWith([
      { id: "lfo", type: LFO_TYPE, parameters: { color: "Plaid", targets: [{ nodeId: "osc", parameterId: "freq" }] } },
      { id: "osc", type: LFO_TYPE },
    ]);
    expect(mappingsByTarget(graph).get("osc|freq")).toEqual([{ lfoNodeId: "lfo", color: LFO_COLORS[0].value }]);
  });

  it("starts again at the first colour once every colour is worn", () => {
    const graph = graphWith(LFO_COLORS.map((c, i) => ({ id: `l${i}`, type: LFO_TYPE, parameters: { color: c.name } })));
    expect(nextLfoColor(graph)).toBe(LFO_COLORS[0].name);
  });

  it("plays the falling saw and both halves of the square", () => {
    expect(shapeValue(3, 0.25)).toBe(0.5);
    expect(shapeValue(4, 0.25)).toBe(1);
    expect(shapeValue(4, 0.75)).toBe(-1);
  });

  it("falls back to the defaults for a rate or amount that is not a finite number", () => {
    const graph = graphWith([
      { id: "lfo", type: LFO_TYPE, parameters: { rate: "fast", amount: Number.NaN, sync: false } },
      { id: "env", type: ENV_FOLLOWER_TYPE, parameters: { amount: null } },
    ]);
    const states = lfoStates(graph);
    expect(states.get("lfo")).toMatchObject({ rate: 1, amount: 0.5 });
    expect(states.get("env")).toEqual({ rate: 0, shape: -1, amount: 0.5 });
  });
});
