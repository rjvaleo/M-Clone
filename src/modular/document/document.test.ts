import { describe, expect, it } from "vitest";
import { emptyGraph } from "../model/graph";
import { executeGraphCommand } from "../model/commands";
import { createNode } from "../registry/registry";
import {
  createModularDocument,
  decodeModularDocument,
  encodeModularDocument,
} from "./document";

/** The failure message, or a sentence saying it did not fail. */
const errorOf = (value: unknown): string => {
  const result = decodeModularDocument(value);
  return result.ok ? "decoded without complaint" : result.error;
};

describe("Modular document v2", () => {
  it("round-trips an independent Modular graph", () => {
    const graph = executeGraphCommand(emptyGraph(), {
      type: "add-node",
      node: createNode("m.note-editor", "notes-1", { x: 40, y: 80 }),
    }).graph;
    const document = createModularDocument(graph);
    const decoded = decodeModularDocument(encodeModularDocument(document));
    expect(decoded).toEqual({ ok: true, document, warnings: [] });
  });

  it("rejects Classic and malformed documents", () => {
    expect(decodeModularDocument({ version: 2, project: {} })).toEqual({
      ok: false, error: "Not an idMLab document",
    });
    expect(decodeModularDocument({
      format: "m-modular", schemaVersion: 2, product: "modular",
      graph: { nodes: { bad: { id: "different" } }, edges: {} },
      snapshots: [], macros: [], assets: [],
    })).toEqual({ ok: false, error: "Invalid idMLab graph" });
  });

  it("migrates v1 port and parameter names and preserves edge wiring", () => {
    const legacy = {
      format: "m-modular",
      schemaVersion: 1,
      product: "modular",
      graph: {
        nodes: {
          editor: {
            id: "editor",
            moduleType: "m.note-editor",
            moduleVersion: 1,
            label: "Note Editor",
            position: { x: 0, y: 0 },
            parameters: {
              "pattern-presets": Array.from({ length: 8 }, () => Array.from({ length: 16 }, () => [])),
              "active-position": 0,
              "output-length": 16,
              "maximum-size": 64,
              "chord-mode": "single",
              "insert-mode": "insert",
              "drum-machine": false,
              "play-enabled": true,
              "time-base-numerator": 1,
              "time-base-denominator": 16,
              phase: 0,
              "source-channel": "all",
              "input-use": "record",
              "echo-input": false,
              "mouse-advance": false,
            },
            enabled: true,
          },
          order: {
            id: "order",
            moduleType: "m.note-order",
            moduleVersion: 1,
            label: "Note Order",
            position: { x: 100, y: 0 },
            parameters: {
              original: 50,
              cyclic: 4,
              utterly: 46,
              "preset-values": Array.from({ length: 8 }, () => ({ original: 50, cyclic: 4, utterly: 46 })),
              "active-position": 4,
            },
            enabled: true,
          },
          density: {
            id: "density",
            moduleType: "m.note-density",
            moduleVersion: 1,
            label: "Note Density",
            position: { x: 200, y: 0 },
            parameters: {
              density: 57,
              seed: 1,
              "preset-values": [57, 55, 30, 45, 100, 35, 100, 100],
              "active-position": 0,
            },
            enabled: true,
          },
          out: {
            id: "out",
            moduleType: "m.midi-output",
            moduleVersion: 1,
            label: "MIDI Output",
            position: { x: 300, y: 0 },
            parameters: {
              "device-id": "",
              channel: 1,
              "latency-ms": 0,
              "program-base": "0",
            },
            enabled: true,
          },
        },
        edges: {
          e1: {
            id: "e1",
            from: { nodeId: "editor", portId: "step-clock-in" },
            to: { nodeId: "editor", portId: "step-clock-in" },
            enabled: true,
          },
          e2: {
            id: "e2",
            from: { nodeId: "order", portId: "cursor-out" },
            to: { nodeId: "out", portId: "monitor-out" },
            enabled: true,
          },
          e3: {
            id: "e3",
            from: { nodeId: "density", portId: "rejected-out" },
            to: { nodeId: "out", portId: "monitor-out" },
            enabled: true,
          },
        },
      },
      snapshots: [],
      macros: [],
      assets: [],
    };

    const decoded = decodeModularDocument(legacy);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.document.schemaVersion).toBe(2);
    expect(decoded.document.graph.nodes.editor.parameters["preset-values"]).toBeDefined();
    expect(decoded.document.graph.nodes.editor.parameters["pattern-presets"]).toBeUndefined();
    expect(decoded.document.graph.nodes.editor.moduleVersion).toBe(2);
    expect(decoded.document.graph.edges.e1.from.portId).toBe("clock-in");
    expect(decoded.document.graph.edges.e1.to.portId).toBe("clock-in");
    expect(decoded.document.graph.edges.e2.from.portId).toBe("cursor-telemetry");
    expect(decoded.document.graph.edges.e2.to.portId).toBe("monitor-telemetry");
    expect(decoded.document.graph.edges.e3.from.portId).toBe("rejected-telemetry");
    expect(decoded.warnings.length).toBeGreaterThan(0);
  });

  it("renames a v1 port at whichever end of the cable it is on", () => {
    // The same rename has to work in both directions, because which end a
    // legacy document happened to record is not something we control.
    const node = (id: string, moduleType: string) => ({
      id, moduleType, moduleVersion: 1, label: id,
      position: { x: 0, y: 0 }, parameters: {}, enabled: true,
    });
    const decoded = decodeModularDocument({
      format: "m-modular", schemaVersion: 1, product: "modular",
      graph: {
        nodes: {
          order: node("order", "m.note-order"),
          density: node("density", "m.note-density"),
          out: node("out", "m.midi-output"),
        },
        edges: {
          intoOrder: {
            id: "intoOrder", enabled: true,
            from: { nodeId: "out", portId: "monitor-out" },
            to: { nodeId: "order", portId: "cursor-out" },
          },
          intoDensity: {
            id: "intoDensity", enabled: true,
            from: { nodeId: "out", portId: "monitor-out" },
            to: { nodeId: "density", portId: "rejected-out" },
          },
        },
      },
      snapshots: [], macros: [], assets: [],
    });
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.document.graph.edges.intoOrder.to.portId).toBe("cursor-telemetry");
    expect(decoded.document.graph.edges.intoOrder.from.portId).toBe("monitor-telemetry");
    expect(decoded.document.graph.edges.intoDensity.to.portId).toBe("rejected-telemetry");
  });

  it("refuses a document it cannot vouch for", () => {
    const base = {
      format: "m-modular", schemaVersion: 2, product: "modular",
      graph: { nodes: {}, edges: {} }, snapshots: [], macros: [], assets: [],
    };
    expect(errorOf("not an object")).toBe("idMLab document must be an object");
    expect(errorOf({ ...base, schemaVersion: 99 }))
      .toContain("Unsupported idMLab document version");
    expect(errorOf({ ...base, product: "classic" })).toBe("Invalid idMLab product marker");
    expect(errorOf({ ...base, snapshots: "no" })).toBe("Invalid idMLab document collections");
    expect(errorOf({ ...base, macros: 7 })).toBe("Invalid idMLab document collections");
    expect(errorOf({ ...base, assets: null })).toBe("Invalid idMLab document collections");
    expect(errorOf({ ...base, performance: () => 1 })).toBe("Invalid idMLab performance data");
  });

  it("keeps performance data when there is some", () => {
    const decoded = decodeModularDocument({
      format: "m-modular", schemaVersion: 2, product: "modular",
      graph: { nodes: {}, edges: {} }, snapshots: [], macros: [], assets: [],
      performance: { take: 3 },
    });
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.document.performance).toEqual({ take: 3 });
  });

  it("rejects a graph whose nodes or edges are not what they claim", () => {
    const withGraph = (graph: unknown) => errorOf({
      format: "m-modular", schemaVersion: 2, product: "modular",
      graph, snapshots: [], macros: [], assets: [],
    });
    expect(withGraph("nope")).toBe("Invalid idMLab graph");
    expect(withGraph({ nodes: {}, edges: [] })).toBe("Invalid idMLab graph");
    // An edge filed under a key that is not its own id: the document disagrees
    // with itself, and picking one of the two would be a guess.
    expect(withGraph({
      nodes: {},
      edges: { a: { id: "b", from: { nodeId: "x", portId: "y" }, to: { nodeId: "x", portId: "y" }, enabled: true } },
    })).toBe("Invalid idMLab graph");
    expect(withGraph({ nodes: {}, edges: { a: "not an edge" } })).toBe("Invalid idMLab graph");
  });

  it("rejects a node whose enabled flag is not a flag", () => {
    expect(errorOf({
      format: "m-modular", schemaVersion: 2, product: "modular",
      graph: {
        nodes: {
          n: {
            id: "n", moduleType: "m.phase", moduleVersion: 2, label: "Phase",
            position: { x: 0, y: 0 }, parameters: {}, enabled: "yes",
          },
        },
        edges: {},
      },
      snapshots: [], macros: [], assets: [],
    })).toBe("Invalid idMLab graph");
  });
});
