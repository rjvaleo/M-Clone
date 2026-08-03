import { describe, expect, it } from "vitest";
import { emptyGraph } from "../model/graph";
import { executeGraphCommand } from "../model/commands";
import { createNode } from "../registry/registry";
import {
  createModularDocument,
  decodeModularDocument,
  encodeModularDocument,
} from "./document";

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
      ok: false, error: "Not an M Modular document",
    });
    expect(decodeModularDocument({
      format: "m-modular", schemaVersion: 2, product: "modular",
      graph: { nodes: { bad: { id: "different" } }, edges: {} },
      snapshots: [], macros: [], assets: [],
    })).toEqual({ ok: false, error: "Invalid Modular graph" });
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
});
