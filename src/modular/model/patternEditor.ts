/**
 * The Pattern Editor: a clock in, fully formed notes out.
 *
 * Time Base, Phase, the three Cyclic editors, the Note Editor and the pieces
 * that turn a chosen step into a sounding note were always used together and
 * always in the same order — a patch that had one had all of them, wired the
 * only way they can be wired. Ten modules and a dozen cables to express one
 * idea: *this is the pattern, this is how it is clocked, and these are the
 * notes it makes*.
 *
 * So the Pattern Editor holds the lot. It is a **compound**, not a new engine:
 * at compile time it expands into exactly the nodes it replaces, wired the way
 * they were always wired. Every processor, every test and every timing
 * guarantee behind them is the same code as before — the module is a way of
 * editing that graph, not a second implementation of it.
 *
 * ## Why the cyclics lose their own presets
 *
 * Individually they had eight positions each, which meant a stream had five
 * independent preset banks and no way to move between musical ideas as a whole.
 * Here there is one bank on the Pattern Editor, and a slot stores everything:
 * the pattern, all three grids, their lengths, the step rate and the phase. One
 * click is one complete idea, which is what the presets were always for.
 */

import type { Edge, GraphDocument, JsonValue, NodeId, NodeInstance, PortRef } from "./graph";
import { createNode, moduleRegistry } from "../registry/registry";

export const PATTERN_EDITOR_TYPE = "m.pattern-editor";

/**
 * The parts, and where they sit when the compound is expanded on the canvas.
 *
 * The offsets matter only for `Expand`, which drops the real nodes down so a
 * user can see and rewire what the compound was doing.
 */
export const PATTERN_PARTS = [
  { key: "timeBase", type: "m.time-base", dx: 0, dy: 0 },
  { key: "phase", type: "m.phase", dx: 300, dy: 0 },
  { key: "cyclicRhythm", type: "m.cyclic-rhythm", dx: 600, dy: 0 },
  { key: "cyclicAccent", type: "m.cyclic-accent", dx: 600, dy: -320 },
  { key: "cyclicLegato", type: "m.cyclic-legato", dx: 600, dy: 320 },
  { key: "noteEditor", type: "m.note-editor", dx: 1300, dy: 320 },
  { key: "noteOrder", type: "m.note-order", dx: 1300, dy: 0 },
  { key: "stepToNotes", type: "m.step-to-notes", dx: 1850, dy: 0 },
  { key: "velocityRange", type: "m.velocity-range", dx: 2200, dy: 0 },
  { key: "legato", type: "m.legato-processor", dx: 2700, dy: 0 },
] as const;

type PartKey = (typeof PATTERN_PARTS)[number]["key"];
type Parts = Record<PartKey, NodeInstance>;

/**
 * Which of the compound's parameters belong to which part.
 *
 * This is the whole mapping between the merged face and the graph underneath:
 * the Pattern Editor's `numerator` is the Time Base's `numerator`, its
 * `accent-grid` is the Cyclic Accent's `preset-values`, and so on. Everything
 * else about the expansion is mechanical.
 */
export const PART_PARAMETERS: Record<PartKey, Record<string, string>> = {
  timeBase: { numerator: "numerator", denominator: "denominator" },
  phase: { "offset-ticks": "offset-ticks" },
  cyclicRhythm: { "rhythm-grid": "preset-values", "rhythm-length": "sequence-length" },
  cyclicAccent: { "accent-grid": "preset-values", "accent-length": "sequence-length" },
  cyclicLegato: { "legato-grid": "preset-values", "legato-length": "sequence-length" },
  noteOrder: {},
  stepToNotes: { velocity: "velocity", gate: "gate", channel: "channel" },
  velocityRange: {},
  legato: {},
  noteEditor: {
    "preset-values": "preset-values",
    "output-length": "output-length",
    "maximum-size": "maximum-size",
  },
};

/** Whether a part declares a port, so the expansion never wires a missing one. */
function hasPort(node: NodeInstance, portId: string): boolean {
  // The `?? false` is unreachable: this is only ever asked about parts the
  // expansion just built from `PATTERN_PARTS`, which are registry types by
  // construction. It stays because the registry lookup is typed as optional.
  /* v8 ignore next */
  return moduleRegistry.get(node.moduleType)?.ports.some((port) => port.id === portId) ?? false;
}

function uniqueId(base: string, taken: Set<string>): string {
  if (!taken.has(base)) {
    taken.add(base);
    return base;
  }
  let next = 2;
  while (taken.has(`${base}-${next}`)) next += 1;
  const id = `${base}-${next}`;
  taken.add(id);
  return id;
}

/**
 * Build the parts, handing each the slice of the compound's state it owns.
 *
 * `active-position` goes to every part, so recalling a slot on the compound
 * moves all of them together — which is the point of merging the banks.
 */
function createParts(node: NodeInstance, taken: Set<string>): Parts {
  const active = Number(node.parameters["active-position"] ?? 0);
  const parts = {} as Parts;
  for (const { key, type, dx, dy } of PATTERN_PARTS) {
    const values: Record<string, JsonValue> = { "active-position": active };
    for (const [outer, inner] of Object.entries(PART_PARAMETERS[key])) {
      const value = node.parameters[outer];
      if (value !== undefined) values[inner] = value;
    }
    parts[key] = createNode(type, uniqueId(`${node.id}-${key}`, taken), {
      x: node.position.x + dx,
      y: node.position.y + dy,
    }, values);
  }
  return parts;
}

/** The compound's inputs, and every part port they feed. */
function inputTargets(parts: Parts, portId: string): PortRef[] {
  if (portId === "transport-in") return [{ nodeId: parts.timeBase.id, portId: "transport-in" }];
  if (portId === "record-in") return [{ nodeId: parts.noteEditor.id, portId: "record-in" }];
  if (portId === "reset-in") {
    return [
      { nodeId: parts.timeBase.id, portId: "reset-in" },
      { nodeId: parts.phase.id, portId: "reset-in" },
      { nodeId: parts.cyclicRhythm.id, portId: "reset-in" },
      { nodeId: parts.cyclicAccent.id, portId: "reset-in" },
      { nodeId: parts.cyclicLegato.id, portId: "reset-in" },
      { nodeId: parts.noteOrder.id, portId: "reset-in" },
    ];
  }
  if (portId === "position-in") {
    // Only the parts that actually have presets. Step→Notes is a utility with
    // no positions, and a cable into a port it does not declare is a dangling
    // edge the compiler would rightly refuse.
    return PATTERN_PARTS
      .filter(({ key }) => hasPort(parts[key], "position-in"))
      .map(({ key }) => ({ nodeId: parts[key].id, portId: "position-in" }));
  }
  return [];
}

/**
 * The compound's outputs, and the part port each one really comes from.
 *
 * `notes-out` is the point of the module: whole notes, with the accent already
 * in their velocity and the legato already in their length. The warped clock is
 * offered too, because anything running alongside the pattern wants the clock
 * the pattern is actually using rather than the one before the rhythm bent it.
 */
function outputSource(parts: Parts, portId: string): PortRef | null {
  if (portId === "notes-out") return { nodeId: parts.legato.id, portId: "notes-out" };
  if (portId === "clock-out") return { nodeId: parts.cyclicRhythm.id, portId: "clock-out" };
  if (portId === "audition-out") return { nodeId: parts.noteEditor.id, portId: "audition-out" };
  return null;
}

/** The wiring between the parts — the cables the user no longer has to make. */
function internalEdges(parts: Parts, taken: Set<string>, base: string): Edge[] {
  const edges: Edge[] = [];
  const link = (from: PortRef, to: PortRef, name: string) => {
    edges.push({ id: uniqueId(`${base}-${name}`, taken), from, to, enabled: true });
  };
  // The clock chain, then the note chain, wired exactly as the Stream compound
  // wires the same parts — this is the arrangement, not a new one.
  link({ nodeId: parts.timeBase.id, portId: "clock-out" },
    { nodeId: parts.phase.id, portId: "clock-in" }, "clock-tb-ph");
  link({ nodeId: parts.phase.id, portId: "clock-out" },
    { nodeId: parts.cyclicRhythm.id, portId: "clock-in" }, "clock-ph-cr");
  link({ nodeId: parts.cyclicRhythm.id, portId: "clock-out" },
    { nodeId: parts.cyclicAccent.id, portId: "clock-in" }, "clock-cr-ca");
  link({ nodeId: parts.cyclicRhythm.id, portId: "clock-out" },
    { nodeId: parts.cyclicLegato.id, portId: "clock-in" }, "clock-cr-cl");
  link({ nodeId: parts.cyclicRhythm.id, portId: "clock-out" },
    { nodeId: parts.noteOrder.id, portId: "clock-in" }, "clock-cr-no");
  link({ nodeId: parts.noteEditor.id, portId: "pattern-out" },
    { nodeId: parts.noteOrder.id, portId: "pattern-in" }, "pattern-ne-no");
  link({ nodeId: parts.noteOrder.id, portId: "steps-out" },
    { nodeId: parts.stepToNotes.id, portId: "steps-in" }, "notes-no-sn");
  link({ nodeId: parts.stepToNotes.id, portId: "notes-out" },
    { nodeId: parts.velocityRange.id, portId: "notes-in" }, "notes-sn-vr");
  link({ nodeId: parts.velocityRange.id, portId: "notes-out" },
    { nodeId: parts.legato.id, portId: "notes-in" }, "notes-vr-lg");
  // Accent becomes velocity and legato becomes length: the two cyclic streams
  // are what turn a chosen step into a note with dynamics and duration.
  link({ nodeId: parts.cyclicAccent.id, portId: "accent-out" },
    { nodeId: parts.velocityRange.id, portId: "accent-in" }, "control-ca-vr");
  link({ nodeId: parts.cyclicLegato.id, portId: "legato-out" },
    { nodeId: parts.legato.id, portId: "legato-in" }, "control-cl-lg");
  return edges;
}

function cloneGraph(graph: GraphDocument): GraphDocument {
  return {
    nodes: Object.fromEntries(
      Object.entries(graph.nodes).map(([id, node]) => [id, structuredClone(node)]),
    ),
    edges: Object.fromEntries(
      Object.entries(graph.edges).map(([id, edge]) => [id, structuredClone(edge)]),
    ),
  };
}

/** Replace one Pattern Editor with the graph it stands for. */
export function expandPatternEditor(graph: GraphDocument, nodeId: NodeId): GraphDocument {
  const node = graph.nodes[nodeId];
  if (!node || node.moduleType !== PATTERN_EDITOR_TYPE) return graph;

  const next = cloneGraph(graph);
  const taken = new Set(Object.keys(next.nodes));
  taken.delete(nodeId);
  const edgeIds = new Set(Object.keys(next.edges));
  const parts = createParts(node, taken);

  delete next.nodes[nodeId];
  for (const { key } of PATTERN_PARTS) next.nodes[parts[key].id] = parts[key];

  for (const edge of internalEdges(parts, edgeIds, nodeId)) next.edges[edge.id] = edge;

  // Re-point every cable that touched the compound at the part that really
  // owns that port. An input fanning out to several parts becomes several
  // cables, which is what the compound was doing invisibly.
  for (const [id, edge] of Object.entries(next.edges)) {
    if (edge.to.nodeId === nodeId) {
      delete next.edges[id];
      for (const target of inputTargets(parts, edge.to.portId)) {
        const newId = uniqueId(`${id}-${target.nodeId}`, edgeIds);
        next.edges[newId] = { id: newId, from: edge.from, to: target, enabled: edge.enabled };
      }
      continue;
    }
    if (edge.from.nodeId === nodeId) {
      const source = outputSource(parts, edge.from.portId);
      if (!source) {
        delete next.edges[id];
        continue;
      }
      next.edges[id] = { ...edge, from: source };
    }
  }
  return next;
}

/** Expand every Pattern Editor in a graph, in a stable order. */
export function materializePatternEditors(graph: GraphDocument): GraphDocument {
  let next = graph;
  const ids = Object.values(graph.nodes)
    .filter((node) => node.moduleType === PATTERN_EDITOR_TYPE)
    .map((node) => node.id)
    .sort();
  for (const id of ids) next = expandPatternEditor(next, id);
  return next;
}
