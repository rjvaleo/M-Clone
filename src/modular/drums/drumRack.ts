/**
 * The Drum Machine template — File › Drum Machine. A transport clocking a
 * Drum Sequencer, its notes into Percussion, Percussion into the output: the
 * smallest patch that plays a beat. Load the TR-909 kit from the Percussion
 * face to hear the 909 instead of the synthetic starter kit.
 */

import { emptyGraph, type GraphDocument } from "../model/graph";
import { createNode } from "../registry/registry";

export function buildDrumRack(): GraphDocument {
  const graph = emptyGraph();
  const add = (id: string, type: string, x: number, y: number, label: string) => {
    graph.nodes[id] = { ...createNode(type, id, { x, y }), label };
  };
  const wire = (from: string, fromPort: string, to: string, toPort: string) => {
    const id = `${from}.${fromPort}-${to}.${toPort}`;
    graph.edges[id] = { id, from: { nodeId: from, portId: fromPort }, to: { nodeId: to, portId: toPort }, enabled: true };
  };
  add("transport-1", "m.transport-clock", 0, 120, "Transport");
  add("drums-1", "m.drum-seq", 360, 0, "Drums-1");
  add("percussion-1", "m.percussion", 1360, 0, "Percussion");
  add("output-1", "m.audio-output", 1360, 560, "Audio Output");
  wire("transport-1", "transport-out", "drums-1", "clock-in");
  wire("transport-1", "reset-out", "drums-1", "sync-in");
  wire("drums-1", "notes-out", "percussion-1", "notes-in");
  wire("percussion-1", "audio-out", "output-1", "audio-in");
  return graph;
}
