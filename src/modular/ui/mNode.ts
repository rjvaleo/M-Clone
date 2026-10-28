/**
 * Where M's tracks go on the canvas.
 *
 * A track's notes play on every sound module cabled to its output, and a
 * track with any cable is taken off M's built-in synth, so cabling a track to
 * a module moves its sound there rather than doubling it.
 */

import type { GraphDocument, NodeId } from "../model/graph";
import { M_NODE_TYPE, M_TRACKS, trackPort } from "../registry/mModule";

export { M_NODE_TYPE, M_TRACKS, trackPort };

export function findMNode(graph: GraphDocument): NodeId | null {
  return Object.values(graph.nodes).find((node) => node.moduleType === M_NODE_TYPE)?.id ?? null;
}

/** Track index → the nodes its output is cabled to, in cable order. */
export function trackTargets(graph: GraphDocument, mNodeId: NodeId): Map<number, NodeId[]> {
  const targets = new Map<number, NodeId[]>();
  for (const edge of Object.values(graph.edges)) {
    if (!edge.enabled || edge.from.nodeId !== mNodeId) continue;
    const track = Array.from({ length: M_TRACKS }, (_, i) => i).find((i) => trackPort(i) === edge.from.portId);
    if (track === undefined) continue;
    targets.set(track, [...(targets.get(track) ?? []), edge.to.nodeId]);
  }
  return targets;
}

export function routedTracks(graph: GraphDocument, mNodeId: NodeId): Set<number> {
  return new Set(trackTargets(graph, mNodeId).keys());
}
