import { describe, expect, it } from "vitest";
import { createNode, moduleRegistry, validateModuleDescriptor } from "./registry";
import { M_LAB_TYPES } from "./mLabModules";
import { canAddModule, moduleLimit } from "../model/limits";
import { emptyGraph } from "../model/graph";

const ports = (type: string, direction: "input" | "output") =>
  moduleRegistry.get(type)!.ports.filter((port) => port.direction === direction)
    .map((port) => `${port.id}:${port.signal.kind}`);

describe("the M modules, built from Numerology's", () => {
  it("are registered, valid, and grouped together as M", () => {
    for (const type of Object.values(M_LAB_TYPES)) {
      const descriptor = moduleRegistry.get(type);
      expect(descriptor, type).toBeDefined();
      expect(validateModuleDescriptor(descriptor!), type).toEqual([]);
      expect(descriptor!.family).toBe("m");
    }
  });

  it("every one has a Numerology header: a comment and a minimize state", () => {
    for (const type of Object.values(M_LAB_TYPES)) {
      const node = createNode(type, "n", { x: 0, y: 0 });
      expect(node.parameters.comment, type).toBe("...");
      expect(node.parameters.collapsed, type).toBe(false);
    }
  });

  it("allows one clock, Variables, conductor and orchestra; a NoteSeq and Time Warp per voice", () => {
    for (const type of [M_LAB_TYPES.clock, M_LAB_TYPES.variables, M_LAB_TYPES.conductor, M_LAB_TYPES.orchestra]) {
      const graph = emptyGraph();
      graph.nodes.a = createNode(type, "a", { x: 0, y: 0 });
      expect(canAddModule(graph, type), type).toBe(false);
    }
    expect(moduleLimit(M_LAB_TYPES.noteSeq)).toBe(8);
    expect(moduleLimit(M_LAB_TYPES.timeWarp)).toBe(8);
  });

  it("wires M NoteSeq as a MonoNote's back panel", () => {
    expect(ports(M_LAB_TYPES.noteSeq, "input")).toEqual([
      "clock-in:transport", "sync-in:reset", "trig-in:control", "warp-in:time-map",
      "interval-in:control", "velocity-in:control",
    ]);
    expect(ports(M_LAB_TYPES.noteSeq, "output")).toEqual([
      "notes-out:note-event", "gate-out:control", "velocity-out:control", "interval-out:control",
    ]);
  });

  it("wires M Clock: transport, Sync and the Tap Conduct gate out", () => {
    expect(ports(M_LAB_TYPES.clock, "input")).toEqual([]);
    expect(ports(M_LAB_TYPES.clock, "output")).toEqual(["transport-out:transport", "sync-out:reset", "run-out:control"]);
  });

  it("wires M Time Warp: its curve out, by reference", () => {
    expect(ports(M_LAB_TYPES.timeWarp, "output")).toEqual(["warp-out:time-map"]);
  });

  it("wires M Conductor as a Triple XY: X and Y for each of three pads", () => {
    expect(ports(M_LAB_TYPES.conductor, "output")).toEqual(
      ["x1-out:control", "y1-out:control", "x2-out:control", "y2-out:control", "x3-out:control", "y3-out:control"]);
  });

  it("wires M Orchestra: notes in; one output per MIDI channel", () => {
    expect(ports(M_LAB_TYPES.orchestra, "input")).toEqual(["notes-in:note-event"]);
    expect(moduleRegistry.get(M_LAB_TYPES.orchestra)!.ports[0].cardinality).toBe("many");
    expect(ports(M_LAB_TYPES.orchestra, "output")).toEqual(
      Array.from({ length: 16 }, (_, i) => `channel-${i + 1}-out:note-event`));
  });

  it("gives M Variables no cables: it writes positions into the other modules", () => {
    expect(moduleRegistry.get(M_LAB_TYPES.variables)!.ports).toEqual([]);
  });
});

describe("a custom face can own its commands", () => {
  it("counts them as on the face, and rejects one the module does not have", () => {
    const clock = moduleRegistry.get(M_LAB_TYPES.clock)!;
    expect(validateModuleDescriptor(clock)).toEqual([]);
    const face = clock.face.map((section) => ({
      ...section,
      elements: section.elements.map((element) => (element.kind === "custom" ? { ...element, commandIds: ["nope"] } : element)),
    }));
    expect(validateModuleDescriptor({ ...clock, face })).toEqual(expect.arrayContaining([
      "Unknown custom-face command: nope", "Command is hidden from node face: play",
    ]));
  });
});
