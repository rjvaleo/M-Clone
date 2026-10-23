/**
 * The M Rack template — File › M Rack. M built from its modules, laid out
 * as Numerology lays out a rack: the shared modules down one column (the
 * Conductor, M Variables and M's four edit windows, M Orchestra), then a NoteSeq for each of M's four
 * voices, each with its own Warp lane, and a Synth to hear them. Voice 4
 * also has a standalone Time Warp cabled in, to show the patched form.
 */

import { emptyGraph, type GraphDocument } from "../model/graph";
import { createNode } from "../registry/registry";

const VOICES = [
  { "rate-num": 1, "rate-den": 8 },
  { "rate-num": 1, "rate-den": 4, octave: -1 },
  { "rate-num": 1, "rate-den": 16, octave: 1, dir: "alt1" },
  { "rate-num": 3, "rate-den": 16, dir: "rev" },
];

export function buildMRack(): GraphDocument {
  const graph = emptyGraph();
  const add = (id: string, type: string, x: number, y: number, label: string, values: Record<string, unknown> = {}) => {
    graph.nodes[id] = { ...createNode(type, id, { x, y }, values as never), label };
  };
  const wire = (from: string, fromPort: string, to: string, toPort: string) => {
    const id = `${from}.${fromPort}-${to}.${toPort}`;
    graph.edges[id] = { id, from: { nodeId: from, portId: fromPort }, to: { nodeId: to, portId: toPort }, enabled: true };
  };
  add("conductor-1", "m.lab-conductor", 0, 0, "Conductor-1");
  add("variables-1", "m.lab-variables", 0, 280, "Variables-1");
  // M's four edit windows, as M sets them beside its Variables window.
  add("density-1", "m.lab-density", 0, 660, "Note Density");
  add("velocity-1", "m.lab-velocity-range", 250, 660, "Velocity Range");
  add("transposition-1", "m.lab-transposition", 0, 790, "Transposition");
  add("order-1", "m.lab-note-order", 250, 790, "Note Order");
  add("orchestra-1", "m.lab-orchestra", 0, 930, "Orchestra-1");
  VOICES.forEach((settings, v) => {
    add(`noteseq-${v + 1}`, "m.lab-noteseq", 860, v * 520, `NoteSeq-${v + 1}`, { voice: v + 1, channel: v + 1, ...settings });
  });
  add("timewarp-4", "m.lab-time-warp", 1700, 3 * 520, "TimeWarp-4");
  add("synth-1", "m.synth", 1700, 0, "Synth");
  add("output-1", "m.audio-output", 1700, 860, "Audio Output");
  for (let v = 1; v <= 4; v++) {
    wire("conductor-1", "transport-out", `noteseq-${v}`, "clock-in");
    wire("conductor-1", "sync-out", `noteseq-${v}`, "sync-in");
    wire("conductor-1", "run-out", `noteseq-${v}`, "trig-in");
    wire(`noteseq-${v}`, "notes-out", "orchestra-1", "notes-in");
    wire("orchestra-1", `channel-${v}-out`, "synth-1", "notes-in");
  }
  wire("timewarp-4", "warp-out", "noteseq-4", "warp-in");
  wire("synth-1", "audio-out", "output-1", "audio-in");
  return graph;
}
