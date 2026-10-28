import type { Edge, GraphDocument, JsonValue, NodeInstance, NodeId, PortRef } from "./graph";
import { createNode } from "../registry/registry";

type StreamParts = {
  timeBase: NodeInstance;
  phase: NodeInstance;
  cyclicRhythm: NodeInstance;
  cyclicAccent: NodeInstance;
  cyclicLegato: NodeInstance;
  noteOrder: NodeInstance;
  stepToNotes: NodeInstance;
  noteDensity: NodeInstance;
  transposition: NodeInstance;
  velocityRange: NodeInstance;
  legato: NodeInstance;
  playEnable: NodeInstance;
};

const modulePlacement = [
  { key: "timeBase", type: "m.time-base", dx: 0, dy: 0 },
  { key: "phase", type: "m.phase", dx: 260, dy: 0 },
  { key: "cyclicRhythm", type: "m.cyclic-rhythm", dx: 520, dy: 0 },
  { key: "cyclicAccent", type: "m.cyclic-accent", dx: 520, dy: -290 },
  { key: "cyclicLegato", type: "m.cyclic-legato", dx: 520, dy: 290 },
  { key: "noteOrder", type: "m.note-order", dx: 1080, dy: 0 },
  { key: "stepToNotes", type: "m.step-to-notes", dx: 1640, dy: 0 },
  { key: "noteDensity", type: "m.note-density", dx: 1960, dy: 0 },
  { key: "transposition", type: "m.transposition", dx: 2520, dy: 0 },
  { key: "velocityRange", type: "m.velocity-range", dx: 3080, dy: 0 },
  { key: "legato", type: "m.legato-processor", dx: 3640, dy: 0 },
  { key: "playEnable", type: "m.play-enable", dx: 4200, dy: 0 },
] as const;

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

function createStreamParts(
  streamNode: NodeInstance,
  nodeIds: Set<string>,
): StreamParts {
  const activePosition = Number(streamNode.parameters["active-position"] ?? 0);
  const values: Record<string, JsonValue> = { "active-position": activePosition };

  const created = Object.fromEntries(
    modulePlacement.map(({ key, type, dx, dy }) => {
      const id = uniqueId(`${streamNode.id}-${key}`, nodeIds);
      return [
        key,
        createNode(type, id, {
          x: streamNode.position.x + dx,
          y: streamNode.position.y + dy,
        }, values),
      ];
    }),
  );

  return created as unknown as StreamParts;
}

function connect(ids: Set<string>, edges: Edge[], from: PortRef, to: PortRef, base: string): void {
  const id = uniqueId(base, ids);
  edges.push({ id, from, to, enabled: true });
}

function mapInputTargets(parts: StreamParts, portId: string): PortRef[] {
  if (portId === "transport-in") {
    return [{ nodeId: parts.timeBase.id, portId: "transport-in" }];
  }
  if (portId === "reset-in") {
    return [
      { nodeId: parts.timeBase.id, portId: "reset-in" },
      { nodeId: parts.phase.id, portId: "reset-in" },
      { nodeId: parts.cyclicRhythm.id, portId: "reset-in" },
      { nodeId: parts.noteOrder.id, portId: "reset-in" },
      { nodeId: parts.cyclicAccent.id, portId: "reset-in" },
      { nodeId: parts.cyclicLegato.id, portId: "reset-in" },
    ];
  }
  if (portId === "pattern-in") {
    return [{ nodeId: parts.noteOrder.id, portId: "pattern-in" }];
  }
  if (portId === "position-in") {
    return [
      { nodeId: parts.timeBase.id, portId: "position-in" },
      { nodeId: parts.phase.id, portId: "position-in" },
      { nodeId: parts.cyclicRhythm.id, portId: "position-in" },
      { nodeId: parts.cyclicAccent.id, portId: "position-in" },
      { nodeId: parts.cyclicLegato.id, portId: "position-in" },
      { nodeId: parts.noteOrder.id, portId: "position-in" },
      { nodeId: parts.noteDensity.id, portId: "position-in" },
      { nodeId: parts.transposition.id, portId: "position-in" },
      { nodeId: parts.velocityRange.id, portId: "position-in" },
      { nodeId: parts.legato.id, portId: "position-in" },
      { nodeId: parts.playEnable.id, portId: "position-in" },
    ];
  }
  return [];
}

function mapOutputSource(parts: StreamParts, portId: string): PortRef | null {
  if (portId === "notes-out") {
    return { nodeId: parts.playEnable.id, portId: "notes-out" };
  }
  return null;
}

function expandOneStream(graph: GraphDocument, streamNodeId: NodeId): GraphDocument {
  const streamNode = graph.nodes[streamNodeId];
  if (!streamNode || streamNode.moduleType !== "m.stream") return graph;

  const next = cloneGraph(graph);
  const nodeIds = new Set(Object.keys(next.nodes));
  const edgeIds = new Set(Object.keys(next.edges));
  const parts = createStreamParts(streamNode, nodeIds);

  const insertedEdges: Edge[] = [];
  connect(edgeIds, insertedEdges,
    { nodeId: parts.timeBase.id, portId: "clock-out" },
    { nodeId: parts.phase.id, portId: "clock-in" },
    `${streamNode.id}-clock-tb-ph`);
  connect(edgeIds, insertedEdges,
    { nodeId: parts.phase.id, portId: "clock-out" },
    { nodeId: parts.cyclicRhythm.id, portId: "clock-in" },
    `${streamNode.id}-clock-ph-cr`);
  connect(edgeIds, insertedEdges,
    { nodeId: parts.cyclicRhythm.id, portId: "clock-out" },
    { nodeId: parts.noteOrder.id, portId: "clock-in" },
    `${streamNode.id}-clock-cr-no`);
  connect(edgeIds, insertedEdges,
    { nodeId: parts.cyclicRhythm.id, portId: "clock-out" },
    { nodeId: parts.cyclicAccent.id, portId: "clock-in" },
    `${streamNode.id}-clock-cr-ca`);
  connect(edgeIds, insertedEdges,
    { nodeId: parts.cyclicRhythm.id, portId: "clock-out" },
    { nodeId: parts.cyclicLegato.id, portId: "clock-in" },
    `${streamNode.id}-clock-cr-cl`);
  connect(edgeIds, insertedEdges,
    { nodeId: parts.noteOrder.id, portId: "steps-out" },
    { nodeId: parts.stepToNotes.id, portId: "steps-in" },
    `${streamNode.id}-notes-no-sn`);
  connect(edgeIds, insertedEdges,
    { nodeId: parts.stepToNotes.id, portId: "notes-out" },
    { nodeId: parts.noteDensity.id, portId: "notes-in" },
    `${streamNode.id}-notes-sn-nd`);
  connect(edgeIds, insertedEdges,
    { nodeId: parts.noteDensity.id, portId: "notes-out" },
    { nodeId: parts.transposition.id, portId: "notes-in" },
    `${streamNode.id}-notes-nd-tr`);
  connect(edgeIds, insertedEdges,
    { nodeId: parts.transposition.id, portId: "notes-out" },
    { nodeId: parts.velocityRange.id, portId: "notes-in" },
    `${streamNode.id}-notes-tr-vr`);
  connect(edgeIds, insertedEdges,
    { nodeId: parts.velocityRange.id, portId: "notes-out" },
    { nodeId: parts.legato.id, portId: "notes-in" },
    `${streamNode.id}-notes-vr-lg`);
  connect(edgeIds, insertedEdges,
    { nodeId: parts.legato.id, portId: "notes-out" },
    { nodeId: parts.playEnable.id, portId: "notes-in" },
    `${streamNode.id}-notes-lg-pe`);
  connect(edgeIds, insertedEdges,
    { nodeId: parts.cyclicAccent.id, portId: "accent-out" },
    { nodeId: parts.velocityRange.id, portId: "accent-in" },
    `${streamNode.id}-control-ca-vr`);
  connect(edgeIds, insertedEdges,
    { nodeId: parts.cyclicLegato.id, portId: "legato-out" },
    { nodeId: parts.legato.id, portId: "legato-in" },
    `${streamNode.id}-control-cl-lg`);

  const expandedEdges: Record<string, Edge> = {};
  for (const [edgeId, edge] of Object.entries(next.edges)) {
    if (edge.from.nodeId !== streamNodeId && edge.to.nodeId !== streamNodeId) {
      expandedEdges[edgeId] = edge;
      continue;
    }
    if (edge.to.nodeId === streamNodeId) {
      const targets = mapInputTargets(parts, edge.to.portId);
      if (targets.length === 0) continue;
      if (targets.length === 1) {
        expandedEdges[edgeId] = {
          ...edge,
          to: targets[0],
        };
        continue;
      }
      for (const target of targets) {
        const forkId = uniqueId(`${edgeId}-${target.nodeId.split("-").pop()}-${target.portId}`, edgeIds);
        expandedEdges[forkId] = {
          id: forkId,
          from: edge.from,
          to: target,
          enabled: edge.enabled,
        };
      }
      continue;
    }
    if (edge.from.nodeId === streamNodeId) {
      const source = mapOutputSource(parts, edge.from.portId);
      if (!source) continue;
      expandedEdges[edgeId] = {
        ...edge,
        from: source,
      };
      continue;
    }
  }

  for (const edge of insertedEdges) expandedEdges[edge.id] = edge;

  delete next.nodes[streamNodeId];
  next.nodes[parts.timeBase.id] = parts.timeBase;
  next.nodes[parts.phase.id] = parts.phase;
  next.nodes[parts.cyclicRhythm.id] = parts.cyclicRhythm;
  next.nodes[parts.cyclicAccent.id] = parts.cyclicAccent;
  next.nodes[parts.cyclicLegato.id] = parts.cyclicLegato;
  next.nodes[parts.noteOrder.id] = parts.noteOrder;
  next.nodes[parts.stepToNotes.id] = parts.stepToNotes;
  next.nodes[parts.noteDensity.id] = parts.noteDensity;
  next.nodes[parts.transposition.id] = parts.transposition;
  next.nodes[parts.velocityRange.id] = parts.velocityRange;
  next.nodes[parts.legato.id] = parts.legato;
  next.nodes[parts.playEnable.id] = parts.playEnable;
  next.edges = expandedEdges;

  return next;
}

export function materializeStreamCompounds(graph: GraphDocument): GraphDocument {
  let next = graph;
  const streamIds = Object.values(graph.nodes)
    .filter((node) => node.moduleType === "m.stream")
    .map((node) => node.id)
    .sort();
  for (const streamId of streamIds) next = expandOneStream(next, streamId);
  return next;
}

export function expandStreamNode(graph: GraphDocument, streamNodeId: NodeId): GraphDocument {
  return expandOneStream(graph, streamNodeId);
}
