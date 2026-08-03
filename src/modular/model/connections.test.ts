import { describe, expect, it } from "vitest";
import { createNode, moduleRegistry } from "../registry/registry";
import type { GraphDocument } from "./graph";
import { connectionError } from "./connections";

const graph = (): GraphDocument => {
  const notes = createNode("m.note-editor", "notes", { x: 0, y: 0 });
  const output = createNode("m.midi-output", "output", { x: 400, y: 0 });
  return { nodes: { notes, output }, edges: {} };
};

describe("modular connection interaction", () => {
  it("accepts matching output and input signals", () => {
    expect(connectionError(graph(), moduleRegistry,
      { nodeId: "notes", portId: "audition-out" },
      { nodeId: "output", portId: "notes-in" })).toBeNull();
  });

  it("rejects reversed, incompatible, duplicate, and occupied connections", () => {
    const patch = graph();
    expect(connectionError(patch, moduleRegistry,
      { nodeId: "output", portId: "notes-in" },
      { nodeId: "notes", portId: "audition-out" })).toContain("output to an input");
    expect(connectionError(patch, moduleRegistry,
      { nodeId: "notes", portId: "pattern-out" },
      { nodeId: "output", portId: "notes-in" })).toContain("cannot connect");

    patch.edges.existing = {
      id: "existing",
      from: { nodeId: "notes", portId: "audition-out" },
      to: { nodeId: "output", portId: "notes-in" },
      enabled: true,
    };
    expect(connectionError(patch, moduleRegistry,
      { nodeId: "notes", portId: "audition-out" },
      { nodeId: "output", portId: "notes-in" })).toContain("already connected");
  });
});
