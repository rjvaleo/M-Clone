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

  it("refuses a second cable into a port that accepts one", () => {
    // Not the same as a duplicate: a different source, the same single-input
    // port. Silently replacing the first cable would lose work.
    const patch = graph();
    patch.nodes.order = createNode("m.note-order", "order", { x: 400, y: 400 });
    patch.nodes.second = createNode("m.note-editor", "second", { x: 0, y: 400 });
    patch.edges.existing = {
      id: "existing",
      from: { nodeId: "notes", portId: "pattern-out" },
      to: { nodeId: "order", portId: "pattern-in" },
      enabled: true,
    };
    expect(connectionError(patch, moduleRegistry,
      { nodeId: "second", portId: "pattern-out" },
      { nodeId: "order", portId: "pattern-in" })).toContain("only one connection");
  });

  it("refuses a node wired to itself", () => {
    const patch = graph();
    expect(connectionError(patch, moduleRegistry,
      { nodeId: "notes", portId: "audition-out" },
      { nodeId: "notes", portId: "record-in" })).toContain("connect directly to itself");
  });

  it("reports a port that is no longer there", () => {
    const patch = graph();
    expect(connectionError(patch, moduleRegistry,
      { nodeId: "notes", portId: "gone-out" },
      { nodeId: "output", portId: "notes-in" })).toContain("no longer exists");
    expect(connectionError(patch, moduleRegistry,
      { nodeId: "notes", portId: "audition-out" },
      { nodeId: "vanished", portId: "notes-in" })).toContain("no longer exists");
  });
});
